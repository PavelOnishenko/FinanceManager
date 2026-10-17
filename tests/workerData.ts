import type { SqlDatabase } from "../src/storage/SqlDatabase";
import { seedMember } from "./seedMember";

type StoredExpense = {
  sourceActionKey: string;
  amountRsd: number;
  categoryId: string;
  spentOn: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type ExpenseRow = {
  id: number;
  source_action_key: string;
  amount_rsd: number;
  category_id: string;
  spent_on: string;
  comment: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function createWorkerData(database: SqlDatabase) {
  return {
    seedMember: (id: number, name: string) => seedMember(database, id, name),
    seedExpense: (expense: StoredExpense) => database.prepare(`
      INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(expense.sourceActionKey, expense.amountRsd, expense.categoryId, expense.spentOn, expense.createdBy, expense.createdAt, expense.updatedAt)
      .execute(),
    expenses: () => database.prepare("SELECT * FROM expenses ORDER BY id").many<ExpenseRow>(),
    setExpenseDate: (id: number, date: string) => database.prepare("UPDATE expenses SET spent_on = ? WHERE id = ?").bind(date, id).execute(),
    setFinanceSettings: (currency: string, timeZone: string) => database
      .prepare("UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1").bind(currency, timeZone).execute(),
    setDisplayCurrency: (currency: string) => database.prepare("UPDATE instance_settings SET display_currency = ? WHERE id = 1").bind(currency).execute(),
    removeSettings: () => database.prepare("DELETE FROM instance_settings").execute(),
    dropSettingsTable: () => database.prepare("DROP TABLE instance_settings").execute()
  };
}
