import type { CategoryId } from "../config/categories";
import type { SqlDatabase, SqlValue } from "./SqlDatabase";
export type Member = { telegramUserId: string; displayName: string };

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

  async getEnabledMember(telegramUserId: string): Promise<Member | null> {
    const row = await this.database.prepare(`
      SELECT telegram_user_id, display_name FROM members
      WHERE telegram_user_id = ? AND enabled = 1`).bind(telegramUserId).one<{ telegram_user_id: string; display_name: string }>();
    return row ? { telegramUserId: row.telegram_user_id, displayName: row.display_name } : null;
  }

  async createExpense(input: CreateExpenseInput): Promise<{ expense: Expense; created: boolean }> {
    const session = this.database.withPrimarySession();
    const result = await session.prepare(`
      INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, comment, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(source_action_key) DO NOTHING`).bind(
      input.sourceActionKey, input.amountRsd, input.categoryId, input.spentOn, input.comment ?? null, input.createdBy
    ).execute();
    const row = await session.prepare(`${expenseSelect} WHERE e.source_action_key = ?`).bind(input.sourceActionKey).one<ExpenseRow>();
    if (!row) throw new Error(`Expense was not found after create: ${input.sourceActionKey}`);
    return { expense: mapExpense(row), created: result.changedRows === 1 };
  }

  async getExpenseById(expenseId: number): Promise<Expense | null> {
    const row = await this.database.prepare(`${expenseSelect} WHERE e.id = ?`).bind(expenseId).one<ExpenseRow>();
    return row ? mapExpense(row) : null;
  }

  async getRecentExpenses(): Promise<Expense[]> {
    const rows = await this.database.prepare(`${expenseSelect} ORDER BY e.id DESC LIMIT 10`).many<ExpenseRow>();
    return rows.map(mapExpense);
  }

  async updateExpenseAmount(expenseId: number, amountRsd: number): Promise<Expense | null> {
    return this.updateExpense(expenseId, "amount_rsd = ?", amountRsd);
  }

  async updateExpenseCategory(expenseId: number, categoryId: CategoryId): Promise<Expense | null> {
    return this.updateExpense(expenseId, "category_id = ?", categoryId);
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
