import { isValidCategoryId, validateCategoryName, type CategoryId, type CategoryOption, type InvalidCategoryName } from "../config/categories";
import type { SqlDatabase, SqlValue } from "./SqlDatabase";
export type Member = { telegramUserId: string; displayName: string };
export type Category = CategoryOption & { active: boolean; sortOrder: number };

export type RepositoryFailure = InvalidCategoryName | {
  kind: "invalid-category-id" | "category-not-found" | "category-name-taken" | "category-unavailable" | "expense-not-found"
};
export type RepositoryResult<Value> = { kind: "success"; value: Value } | RepositoryFailure;

export type Expense = {
  id: number;
  sourceActionKey: string;
  amountRsd: number;
  categoryId: CategoryId;
  categoryName: string;
  spentOn: string;
  comment?: string;
  createdBy: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateExpenseInput = {
  sourceActionKey: string;
  amountRsd: number;
  categoryId: CategoryId;
  spentOn: string;
  comment?: string;
  createdBy: string;
};

export type ExpenseStatistics = {
  totalRsd: number;
  categoryTotals: { categoryId: CategoryId; categoryName: string; amountRsd: number }[];
};

export type ExpenseHistoryPage = { expenses: Expense[]; page: number; hasNext: boolean };

type ExpenseRow = {
  id: number;
  source_action_key: string;
  amount_rsd: number;
  category_id: CategoryId;
  category_name: string;
  spent_on: string;
  comment: string | null;
  created_by: string;
  author_name: string;
  created_at: string;
  updated_at: string;
};

const expenseSelect = `
  SELECT e.id, e.source_action_key, e.amount_rsd, e.category_id, c.name AS category_name,
    e.spent_on, e.comment, e.created_by, m.display_name AS author_name, e.created_at, e.updated_at
  FROM expenses e
  JOIN categories c ON c.id = e.category_id
  JOIN members m ON m.telegram_user_id = e.created_by`;

export class D1FinanceRepository {
  constructor(private readonly database: SqlDatabase) {}

  async getCategories(active = true): Promise<CategoryOption[]> {
    return this.database.prepare("SELECT id, name FROM categories WHERE active = ? ORDER BY sort_order, id")
      .bind(Number(active)).many<CategoryOption>();
  }

  async getCategory(categoryId: CategoryId): Promise<Category | null> {
    if (!isValidCategoryId(categoryId))
      return null;
    const row = await this.database.prepare("SELECT id, name, active, sort_order AS sortOrder FROM categories WHERE id = ?")
      .bind(categoryId).one<CategoryOption & { active: number; sortOrder: number }>();
    return row ? { ...row, active: row.active === 1 } : null;
  }

  async addCategory(value: string): Promise<RepositoryResult<CategoryOption>> {
    const validation = validateCategoryName(value);
    if (validation.kind === "invalid-category-name")
      return validation;
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `u_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replaceAll("+", "-").replaceAll("/", "_")}`;
      try {
        const result = await this.database.prepare(`
          INSERT INTO categories (id, name, name_key, sort_order)
          SELECT ?, ?, ?, COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE 1
          ON CONFLICT(id) DO NOTHING`).bind(id, validation.name, validation.nameKey).execute();
        if (result.changedRows === 1)
          return { kind: "success", value: { id, name: validation.name } };
      } catch (error) {
        return this.categoryWriteFailureOrThrow(error);
      }
    }
    throw new Error("Could not generate a unique category ID");
  }

  async renameCategory(categoryId: CategoryId, value: string): Promise<RepositoryResult<void>> {
    const validation = validateCategoryName(value);
    if (validation.kind === "invalid-category-name")
      return validation;
    if (!isValidCategoryId(categoryId))
      return { kind: "invalid-category-id" };
    try {
      const result = await this.database.prepare("UPDATE categories SET name = ?, name_key = ? WHERE id = ?")
        .bind(validation.name, validation.nameKey, categoryId).execute();
      return result.changedRows ? { kind: "success", value: undefined } : { kind: "category-not-found" };
    } catch (error) {
      return this.categoryWriteFailureOrThrow(error);
    }
  }

  async setCategoryActive(categoryId: CategoryId, active: boolean): Promise<RepositoryResult<void>> {
    if (!isValidCategoryId(categoryId))
      return { kind: "invalid-category-id" };
    const result = await this.database.prepare("UPDATE categories SET active = ? WHERE id = ?").bind(Number(active), categoryId).execute();
    return result.changedRows ? { kind: "success", value: undefined } : { kind: "category-not-found" };
  }

  private categoryWriteFailureOrThrow(error: unknown): RepositoryFailure {
    if (/UNIQUE constraint failed: categories\.(?:name_key|name)\b/.test(String(error)))
      return { kind: "category-name-taken" };
    throw error;
  }

  async getEnabledMember(telegramUserId: string): Promise<Member | null> {
    const row = await this.database.prepare(`
      SELECT telegram_user_id, display_name FROM members
      WHERE telegram_user_id = ? AND enabled = 1`).bind(telegramUserId).one<{ telegram_user_id: string; display_name: string }>();
    return row ? { telegramUserId: row.telegram_user_id, displayName: row.display_name } : null;
  }

  async createExpense(input: CreateExpenseInput): Promise<RepositoryResult<{ expense: Expense; created: boolean }>> {
    if (!isValidCategoryId(input.categoryId))
      return { kind: "invalid-category-id" };
    const session = this.database.withPrimarySession();
    const result = await session.prepare(`
      INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, comment, created_by, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE EXISTS (SELECT 1 FROM categories WHERE id = ? AND active = 1)
      ON CONFLICT(source_action_key) DO NOTHING`).bind(
      input.sourceActionKey, input.amountRsd, input.categoryId, input.spentOn, input.comment ?? null, input.createdBy, input.categoryId
    ).execute();
    const row = await session.prepare(`${expenseSelect} WHERE e.source_action_key = ?`).bind(input.sourceActionKey).one<ExpenseRow>();
    if (!row)
      return { kind: "category-unavailable" };
    return { kind: "success", value: { expense: mapExpense(row), created: result.changedRows === 1 } };
  }

  async getExpenseById(expenseId: number): Promise<Expense | null> {
    const row = await this.database.prepare(`${expenseSelect} WHERE e.id = ?`).bind(expenseId).one<ExpenseRow>();
    return row ? mapExpense(row) : null;
  }

  async getRecentExpenses(): Promise<Expense[]> {
    const rows = await this.database.prepare(`${expenseSelect} ORDER BY e.id DESC LIMIT 10`).many<ExpenseRow>();
    return rows.map(mapExpense);
  }

  async getExpensesForRange(range: { fromDate: string; toDate: string }, requestedPage: number): Promise<ExpenseHistoryPage> {
    // Count, clamp and fetch in one statement so concurrent changes cannot empty a page between queries.
    const rows = await this.database.prepare(`
      WITH bounds AS (
        SELECT MIN(?, MAX(0, CAST((COUNT(*) - 1) / 10 AS INTEGER))) AS page, COUNT(*) AS total
        FROM expenses WHERE spent_on >= ? AND spent_on <= ?
      ), page_expenses AS (
        ${expenseSelect} WHERE e.spent_on >= ? AND e.spent_on <= ?
        ORDER BY e.id DESC LIMIT 10 OFFSET (SELECT page * 10 FROM bounds)
      )
      SELECT p.*, b.page, b.total FROM bounds b LEFT JOIN page_expenses p ON 1 = 1 ORDER BY p.id DESC`)
      .bind(requestedPage, range.fromDate, range.toDate, range.fromDate, range.toDate)
      .many<Omit<ExpenseRow, "id"> & { id: number | null; page: number; total: number }>();
    const page = rows[0]!.page;
    return {
      expenses: rows.flatMap(row => row.id === null ? [] : [mapExpense({ ...row, id: row.id })]),
      page, hasNext: (page + 1) * 10 < rows[0]!.total
    };
  }

  async updateExpenseAmount(expenseId: number, amountRsd: number): Promise<Expense | null> {
    return this.updateExpense(expenseId, "amount_rsd = ?", amountRsd);
  }

  async updateExpenseCategory(expenseId: number, categoryId: CategoryId): Promise<RepositoryResult<Expense>> {
    if (!isValidCategoryId(categoryId))
      return { kind: "invalid-category-id" };
    const session = this.database.withPrimarySession();
    const result = await session.prepare(`
      UPDATE expenses SET category_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND EXISTS (SELECT 1 FROM categories WHERE id = ? AND active = 1)`).bind(categoryId, expenseId, categoryId).execute();
    const row = await session.prepare(`${expenseSelect} WHERE e.id = ?`).bind(expenseId).one<ExpenseRow>();
    if (!row)
      return { kind: "expense-not-found" };
    return result.changedRows ? { kind: "success", value: mapExpense(row) } : { kind: "category-unavailable" };
  }

  async updateExpenseDate(expenseId: number, spentOn: string): Promise<Expense | null> {
    return this.updateExpense(expenseId, "spent_on = ?", spentOn);
  }

  async updateExpenseComment(expenseId: number, comment?: string): Promise<Expense | null> {
    return this.updateExpense(expenseId, "comment = ?", comment ?? null);
  }

  async deleteExpense(expenseId: number): Promise<boolean> {
    const result = await this.database.prepare("DELETE FROM expenses WHERE id = ?").bind(expenseId).execute();
    return result.changedRows === 1;
  }

  async getStatistics(fromDate: string, toDate: string): Promise<ExpenseStatistics> {
    const result = await this.database.prepare(`
      SELECT e.category_id, c.name AS category_name, SUM(e.amount_rsd) AS amount_rsd
      FROM expenses e
      JOIN categories c ON c.id = e.category_id
      WHERE e.spent_on >= ? AND e.spent_on <= ?
      GROUP BY e.category_id, c.name
      ORDER BY amount_rsd DESC, c.sort_order ASC`).bind(fromDate, toDate)
      .many<{ category_id: CategoryId; category_name: string; amount_rsd: number }>();
    const categoryTotals = result.map(row => ({
      categoryId: row.category_id, categoryName: row.category_name, amountRsd: row.amount_rsd
    }));
    return { totalRsd: categoryTotals.reduce((total, row) => total + row.amountRsd, 0), categoryTotals };
  }

  private async updateExpense(expenseId: number, assignment: string, value: SqlValue): Promise<Expense | null> {
    await this.database.prepare(`UPDATE expenses SET ${assignment}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
      .bind(value, expenseId).execute();
    return this.getExpenseById(expenseId);
  }
}

function mapExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    sourceActionKey: row.source_action_key,
    amountRsd: row.amount_rsd,
    categoryId: row.category_id,
    categoryName: row.category_name,
    spentOn: row.spent_on,
    ...(row.comment === null ? {} : { comment: row.comment }),
    createdBy: row.created_by,
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
