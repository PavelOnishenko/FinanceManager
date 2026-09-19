import { categories, type CategoryId } from "../config/categories";
import { parseExpenseInput } from "../domain/parseExpenseInput";
import { createExpenseActionKey } from "../domain/sourceActionKey";
import type { D1FinanceRepository, Expense, Member } from "../storage/D1FinanceRepository";
import { getDateInFinanceTimeZone, getPreviousCalendarMonthRange, isValidCalendarDate, isValidInclusiveDateRange, type DateRange } from "./dateRange";

export const ApplicationResultKind = {
  AccessAllowed: "allowed",
  AccessDenied: "access-denied",
  InvalidInput: "invalid-input",
  CategorySelection: "category-selection",
  ExpenseSaved: "expense-saved",
  ExpenseHistory: "expense-history",
  ExpenseDetails: "expense-details",
  ExpenseNotFound: "expense-not-found",
  ExpenseUpdated: "expense-updated",
  ExpenseDeleted: "expense-deleted",
  ExpenseStatistics: "expense-statistics"
} as const;

export type AccessResult = { kind: typeof ApplicationResultKind.AccessAllowed; member: Member } | AccessDenied;
export type AccessDenied = { kind: typeof ApplicationResultKind.AccessDenied; telegramUserId: string };
export type InvalidInput = { kind: typeof ApplicationResultKind.InvalidInput; message: string };
export type ExpenseSaved = { kind: typeof ApplicationResultKind.ExpenseSaved; expense: Expense; created: boolean };
export type ExpenseMessageResult = AccessDenied | InvalidInput | ExpenseSaved | {
  kind: typeof ApplicationResultKind.CategorySelection;
  sourceUpdateId: number;
  amountRsd: number;
  categories: readonly { id: CategoryId; name: string }[];
};

// todo typify "field" like with ApplicationResultKind?
export type ExpenseEdit =
  | { field: "amount"; amountRsd: number }
  | { field: "category"; categoryId: CategoryId }
  | { field: "date"; spentOn: string }
  | { field: "comment"; comment?: string };

type SubmitExpenseMessageInput = {
  telegramUserId: string;
  sourceUpdateId: number;
  text: string;
  currentTime: Date;
};

type CreateExpenseWithCategoryInput = {
  telegramUserId: string;
  sourceUpdateId: number;
  amountRsd: number;
  categoryId: CategoryId;
  currentTime: Date;
};

const categoryOptions = categories.map(({ id, name }) => ({ id, name }));
const categoryIds = new Set<CategoryId>(categories.map(category => category.id));

export async function checkAccess(repository: D1FinanceRepository, telegramUserId: string): Promise<AccessResult> {
  const member = await repository.getEnabledMember(telegramUserId);
  return member ? { kind: ApplicationResultKind.AccessAllowed, member } : { kind: ApplicationResultKind.AccessDenied, telegramUserId };
}

export async function submitExpenseMessage(repository: D1FinanceRepository, input: SubmitExpenseMessageInput): Promise<ExpenseMessageResult> {
  const access = await checkAccess(repository, input.telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;

  const sourceActionKey = getSourceActionKey(input.sourceUpdateId);
  if (!sourceActionKey) return invalidSourceUpdateId();
  const parsed = parseExpenseInput(input.text);
  if (parsed.kind === "invalid") return { kind: ApplicationResultKind.InvalidInput, message: parsed.message };
  if (parsed.kind === "amount") 
    return { kind: ApplicationResultKind.CategorySelection, sourceUpdateId: input.sourceUpdateId, amountRsd: parsed.amountRsd, categories: categoryOptions };

  const saved = await repository.createExpense({
    sourceActionKey, amountRsd: parsed.amountRsd, categoryId: parsed.categoryId, spentOn: getDateInFinanceTimeZone(input.currentTime),
    comment: parsed.comment, createdBy: access.member.telegramUserId
  });
  return { kind: ApplicationResultKind.ExpenseSaved, ...saved };
}

export async function createExpenseAfterCategorySelection(repository: D1FinanceRepository, input: CreateExpenseWithCategoryInput)
    : Promise<AccessDenied | InvalidInput | ExpenseSaved> {
  const access = await checkAccess(repository, input.telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;
  const sourceActionKey = getSourceActionKey(input.sourceUpdateId);
  if (!sourceActionKey) return invalidSourceUpdateId();
  if (!isPositiveRsdAmount(input.amountRsd)) return { kind: ApplicationResultKind.InvalidInput, message: "Сумма должна быть целым положительным числом в RSD." };
  if (!categoryIds.has(input.categoryId)) return { kind: ApplicationResultKind.InvalidInput, message: "Неизвестная категория расхода." };

  const saved = await repository.createExpense({
    sourceActionKey, amountRsd: input.amountRsd, categoryId: input.categoryId, spentOn: getDateInFinanceTimeZone(input.currentTime),
    createdBy: access.member.telegramUserId
  });
  return { kind: ApplicationResultKind.ExpenseSaved, ...saved };
}

export async function getExpenseHistory(repository: D1FinanceRepository, telegramUserId: string) {
  const access = await checkAccess(repository, telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;
  return { kind: ApplicationResultKind.ExpenseHistory, expenses: await repository.getRecentExpenses() };
}

export async function getExpenseDetails(repository: D1FinanceRepository, telegramUserId: string, expenseId: number) {
  const access = await checkAccess(repository, telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;
  const expense = await repository.getExpenseById(expenseId);
  return expense ? { kind: ApplicationResultKind.ExpenseDetails, expense } : { kind: ApplicationResultKind.ExpenseNotFound, expenseId };
}

export async function editExpense(repository: D1FinanceRepository, telegramUserId: string, expenseId: number, edit: ExpenseEdit) {
  const access = await checkAccess(repository, telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0) return invalidExpenseId();

  let expense: Expense | null;
  if (edit.field === "amount") {
    if (!isPositiveRsdAmount(edit.amountRsd)) return { kind: ApplicationResultKind.InvalidInput, message: "Сумма должна быть целым положительным числом в RSD." };
    expense = await repository.updateExpenseAmount(expenseId, edit.amountRsd);
  } else if (edit.field === "category") {
    if (!categoryIds.has(edit.categoryId)) return { kind: ApplicationResultKind.InvalidInput, message: "Неизвестная категория расхода." };
    expense = await repository.updateExpenseCategory(expenseId, edit.categoryId);
  } else if (edit.field === "date") {
    if (!isValidCalendarDate(edit.spentOn)) return { kind: ApplicationResultKind.InvalidInput, message: "Дата должна существовать и иметь формат ГГГГ-ММ-ДД." };
    expense = await repository.updateExpenseDate(expenseId, edit.spentOn);
  } else expense = await repository.updateExpenseComment(expenseId, edit.comment?.trim() || undefined);

  return expense ? { kind: ApplicationResultKind.ExpenseUpdated, expense } : { kind: ApplicationResultKind.ExpenseNotFound, expenseId };
}

export async function deleteExpense(repository: D1FinanceRepository, telegramUserId: string, expenseId: number) {
  const access = await checkAccess(repository, telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;
  if (!Number.isSafeInteger(expenseId) || expenseId <= 0) return invalidExpenseId();
  return await repository.deleteExpense(expenseId) ? { kind: ApplicationResultKind.ExpenseDeleted, expenseId } 
    : { kind: ApplicationResultKind.ExpenseNotFound, expenseId };
}

export async function getPreviousMonthStatistics(repository: D1FinanceRepository, telegramUserId: string, currentTime: Date) {
  return getStatisticsForRange(repository, telegramUserId, getPreviousCalendarMonthRange(currentTime));
}

export async function getStatisticsForRange(repository: D1FinanceRepository, telegramUserId: string, range: DateRange) {
  const access = await checkAccess(repository, telegramUserId);
  if (access.kind === ApplicationResultKind.AccessDenied) return access;
  if (!isValidInclusiveDateRange(range.fromDate, range.toDate))
    return { kind: ApplicationResultKind.InvalidInput, message: "Укажите существующий включительный диапазон дат." };
  return { kind: ApplicationResultKind.ExpenseStatistics, range, statistics: await repository.getStatistics(range.fromDate, range.toDate) };
}

function getSourceActionKey(sourceUpdateId: number): string | undefined {
  try {
    return createExpenseActionKey(sourceUpdateId);
  } catch {
    return undefined;
  }
}

function isPositiveRsdAmount(amountRsd: number): boolean {
  return Number.isSafeInteger(amountRsd) && amountRsd > 0;
}

function invalidSourceUpdateId(): InvalidInput {
  return { kind: ApplicationResultKind.InvalidInput, message: "Некорректный идентификатор исходного сообщения." };
}

function invalidExpenseId(): InvalidInput {
  return { kind: ApplicationResultKind.InvalidInput, message: "Некорректный идентификатор расхода." };
}
