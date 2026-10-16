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
  | { kind: "calendar"; month: string; startDate?: string; destination?: "history" }
  | { kind: "calendar-day"; month: string; day: number; startDate?: string; destination?: "history" };

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
  else if (action.kind === "calendar") {
    const prefix = action.destination === "history" ? "hk" : "k";
    data = `${prefix}:${action.month.replace("-", "")}:${action.startDate?.replaceAll("-", "") ?? "0"}`;
  } else if (action.kind === "calendar-day") {
    const prefix = action.destination === "history" ? "ht" : "t";
    data = `${prefix}:${action.month.replace("-", "")}:${action.startDate?.replaceAll("-", "") ?? "0"}:${action.day}`;
  } else if (action.kind === "edit-category")
    data = `e1:${action.expenseId}:${action.categoryId}`;
  else if (action.kind === "edit-prompt") data = `p:${action.expenseId}:${editFields.indexOf(action.field)}`;
  else data = `${{ details: "d", "category-list": "l", "edit-actions": "a", "delete-request": "r", "delete-confirm": "x" }[action.kind]}:${action.expenseId}`;
  if (new TextEncoder().encode(data).length > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return data;
}

export function parseCallbackData(data: string): BotAction | { kind: "statistics-year-too-old" } | { kind: "history-year-too-old" } | undefined {
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
      return { kind: "history-year-too-old" };
    return { kind: "history-page", fromDate, toDate, page };
  }
  if (["s", "k", "t", "h", "hk", "ht"].includes(parts[0] ?? "")) {
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(parts[1] ?? "")) return undefined;
    let expectedParts = 4;
    if (parts[0] === "s" || parts[0] === "h")
      expectedParts = 2;
    else if (parts[0] === "k" || parts[0] === "hk")
      expectedParts = 3;
    if (parts.length !== expectedParts)
      return undefined;
    const destination = parts[0]!.startsWith("h") ? { destination: "history" as const } : {};
    const oldYearKind = destination.destination === "history" ? "history-year-too-old" : "statistics-year-too-old";
    const month = `${parts[1]!.slice(0, 4)}-${parts[1]!.slice(4)}`;
    if (Number(month.slice(0, 4)) < firstStatisticsYear)
      return { kind: oldYearKind };
    if (parts[0] === "s") return { kind: "statistics-month", month };
    if (parts[0] === "h")
      return { kind: "history-month", month };
    if (/^\d{8}$/.test(parts[2] ?? "") && Number(parts[2]!.slice(0, 4)) < firstStatisticsYear)
      return { kind: oldYearKind };
    const startDate = parseCompactDate(parts[2]);
    if (parts[2] !== "0" && (!startDate || !isValidCalendarDate(startDate))) return undefined;
    if (parts[0] === "k" || parts[0] === "hk")
      return { kind: "calendar", month, ...destination, ...(startDate ? { startDate } : {}) };
    if (!/^(?:[1-9]|[12]\d|3[01])$/.test(parts[3] ?? "") || !isValidCalendarDate(`${month}-${parts[3]!.padStart(2, "0")}`)) return undefined;
    return { kind: "calendar-day", month, day: Number(parts[3]), ...destination, ...(startDate ? { startDate } : {}) };
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
