import type { CategoryId } from "../config/categories";

export type ExpenseForStatistics = {
  amountRsd: number;
  categoryId: CategoryId;
}

export function calculateExpenseStatistics(expenses: readonly ExpenseForStatistics[]) {
  const totals = new Map<CategoryId, number>();
  let totalRsd = 0;

  for (const expense of expenses) {
    totalRsd += expense.amountRsd;
    totals.set(expense.categoryId, (totals.get(expense.categoryId) ?? 0) + expense.amountRsd);
  }

  const categoryTotals: ExpenseForStatistics[] = [...totals].map(([categoryId, amountRsd]) => ({ categoryId, amountRsd }));
  categoryTotals.sort((left, right) => right.amountRsd - left.amountRsd);
  return { totalRsd, categoryTotals };
}

