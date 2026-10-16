import { isValidCategoryId, type CategoryId } from "../config/categories";
import type { TextEditField } from "../domain/editPrompt";
import { firstStatisticsYear, isValidCalendarDate, isValidInclusiveDateRange } from "../application/dateRange";

export type PeriodDestination = "statistics" | "history";

// todo typify "kind" to constants?
export type BotAction =
  | { kind: "manage-category"; operation: "list" | "archived" | "add" | "details" | "rename" | "archive" | "confirm" | "restore"; categoryId?: CategoryId }
  | { kind: "calendar-noop" }
  | { kind: "create"; sourceUpdateId: number; amountRsd: number; categoryId: CategoryId }
  | { kind: "details" | "category-list" | "edit-actions" | "delete-request" | "delete-confirm"; expenseId: number }
  | { kind: "edit-prompt"; expenseId: number; field: TextEditField }
  | { kind: "edit-category"; expenseId: number; categoryId: CategoryId }
  | { kind: "statistics-month"; month: string }
  | { kind: "history-recent" }
  | { kind: "history-picker" }
  | { kind: "history-month"; month: string }
  | { kind: "history-page"; fromDate: string; toDate: string; page: number }
  | { kind: "calendar"; month: string; startDate?: string; destination: PeriodDestination }
  | { kind: "calendar-day"; month: string; day: number; startDate?: string; destination: PeriodDestination };

const editFields = ["amount", "date", "comment"] as const;

export function formatCallbackData(action: BotAction): string {
  if ("categoryId" in action && action.categoryId !== undefined && !isValidCategoryId(action.categoryId))
    throw new Error("Invalid category ID");
  let data: string;
  if (action.kind === "manage-category")
    data = `m1:${action.operation}${action.categoryId ? `:${action.categoryId}` : ""}`;
  else if (action.kind === "calendar-noop") data = "n";
  else if (action.kind === "create")
    data = `c1:${action.sourceUpdateId}:${action.amountRsd}:${action.categoryId}`;
  else if (action.kind === "statistics-month") data = `s:${action.month.replace("-", "")}`;
  else if (action.kind === "history-recent")
    data = "hr";
  else if (action.kind === "history-picker")
    data = "hi";
  else if (action.kind === "history-month")
    data = `h:${action.month.replace("-", "")}`;
  else if (action.kind === "history-page")
    data = `hp:${action.fromDate.replaceAll("-", "")}:${action.toDate.replaceAll("-", "")}:${action.page}`;
  else if (action.kind === "calendar")
    data = `k:${action.destination}:${action.month.replace("-", "")}:${action.startDate?.replaceAll("-", "") ?? "0"}`;
  else if (action.kind === "calendar-day")
    data = `t:${action.destination}:${action.month.replace("-", "")}:${action.startDate?.replaceAll("-", "") ?? "0"}:${action.day}`;
  else if (action.kind === "edit-category")
    data = `e1:${action.expenseId}:${action.categoryId}`;
  else if (action.kind === "edit-prompt") data = `p:${action.expenseId}:${editFields.indexOf(action.field)}`;
  else data = `${{ details: "d", "category-list": "l", "edit-actions": "a", "delete-request": "r", "delete-confirm": "x" }[action.kind]}:${action.expenseId}`;
  if (new TextEncoder().encode(data).length > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return data;
}

export function parseCallbackData(data: string): BotAction | { kind: "statistics-year-too-old" } | undefined {
  if (data === "n") return { kind: "calendar-noop" };
  if (data === "hr")
    return { kind: "history-recent" };
  if (data === "hi")
    return { kind: "history-picker" };
  const parts = data.split(":");
  if (parts[0] === "hp") {
    const fromDate = parseCompactDate(parts[1]);
    const toDate = parseCompactDate(parts[2]);
    const page = Number(parts[3]);
    if (parts.length !== 4 || !fromDate || !toDate || !isValidInclusiveDateRange(fromDate, toDate)
        || !/^(0|[1-9]\d*)$/.test(parts[3] ?? "") || !Number.isSafeInteger(page))
      return undefined;
    if (Number(fromDate.slice(0, 4)) < firstStatisticsYear)
      return undefined;
    return { kind: "history-page", fromDate, toDate, page };
  }
  if (["s", "h", "k", "t"].includes(parts[0] ?? "")) {
    const isMonth = parts[0] === "s" || parts[0] === "h";
    const monthValue = parts[isMonth ? 1 : 2];
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(monthValue ?? ""))
      return undefined;
    let expectedParts = isMonth ? 2 : 4;
    if (parts[0] === "t")
      expectedParts = 5;
    if (parts.length !== expectedParts)
      return undefined;
    let destination: PeriodDestination;
    if (isMonth)
      destination = parts[0] === "h" ? "history" : "statistics";
    else if (parts[1] === "history" || parts[1] === "statistics")
      destination = parts[1];
    else
      return undefined;
    const month = `${monthValue!.slice(0, 4)}-${monthValue!.slice(4)}`;
    if (Number(month.slice(0, 4)) < firstStatisticsYear)
      return destination === "statistics" ? { kind: "statistics-year-too-old" } : undefined;
    if (isMonth)
      return { kind: destination === "history" ? "history-month" : "statistics-month", month };
    const startDate = parseCompactDate(parts[3]);
    if (parts[3] !== "0" && (!startDate || !isValidCalendarDate(startDate)))
      return undefined;
    if (startDate && Number(startDate.slice(0, 4)) < firstStatisticsYear)
      return destination === "statistics" ? { kind: "statistics-year-too-old" } : undefined;
    if (parts[0] === "k")
      return { kind: "calendar", month, destination, ...(startDate ? { startDate } : {}) };
    if (!/^(?:[1-9]|[12]\d|3[01])$/.test(parts[4] ?? "") || !isValidCalendarDate(`${month}-${parts[4]!.padStart(2, "0")}`))
      return undefined;
    return { kind: "calendar-day", month, day: Number(parts[4]), destination, ...(startDate ? { startDate } : {}) };
  }
  if (parts[0] === "m1") {
    const operation = parts[1];
    if (["list", "archived", "add"].includes(operation ?? "") && parts.length === 2)
      return { kind: "manage-category", operation: operation as "list" | "archived" | "add" };
    if (["details", "rename", "archive", "confirm", "restore"].includes(operation ?? "")
        && parts.length === 3 && isValidCategoryId(parts[2] ?? ""))
      return { kind: "manage-category", operation: operation as "details" | "rename" | "archive" | "confirm" | "restore", categoryId: parts[2]! };
    return undefined;
  }
  const positive = (value: string | undefined) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const index = (value: string | undefined) => value && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
  const expenseId = positive(parts[1]);
  if (parts[0] === "c1" && parts.length === 4) {
    const sourceUpdateId = expenseId;
    const amountRsd = positive(parts[2]);
    const categoryId = isValidCategoryId(parts[3] ?? "") ? parts[3] : undefined;
    if (sourceUpdateId && amountRsd && categoryId) return { kind: "create", sourceUpdateId, amountRsd, categoryId };
  }
  if (!expenseId || parts.length !== (parts[0] === "p" || parts[0] === "e1" ? 3 : 2))
    return undefined;
  if (parts[0] === "d") return { kind: "details", expenseId };
  if (parts[0] === "l")
    return { kind: "category-list", expenseId };
  if (parts[0] === "a")
    return { kind: "edit-actions", expenseId };
  if (parts[0] === "r") return { kind: "delete-request", expenseId };
  if (parts[0] === "x") return { kind: "delete-confirm", expenseId };
  if (parts[0] === "p") {
    const field = editFields[index(parts[2])];
    if (field) return { kind: "edit-prompt", expenseId, field };
  }
  if (parts[0] === "e1") {
    const categoryId = isValidCategoryId(parts[2] ?? "") ? parts[2] : undefined;
    if (categoryId) return { kind: "edit-category", expenseId, categoryId };
  }
  return undefined;
}

function parseCompactDate(value: string | undefined): string | undefined {
  if (!/^\d{8}$/.test(value ?? ""))
    return undefined;
  return `${value!.slice(0, 4)}-${value!.slice(4, 6)}-${value!.slice(6)}`;
}
