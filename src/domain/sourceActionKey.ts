const expenseActionPrefix = "expense";

export function createExpenseActionKey(sourceUpdateId: number): string {
  if (!Number.isSafeInteger(sourceUpdateId) || sourceUpdateId < 0)
    throw new Error("Telegram update ID must be a non-negative safe integer.");

  return `${expenseActionPrefix}:${sourceUpdateId}`;
}

