import { categories, type CategoryId } from "../config/categories";
import type { TextEditField } from "../domain/editPrompt";
import { firstStatisticsYear, isValidCalendarDate } from "../application/dateRange";

// todo typify "kind" to constants?
export type BotAction =
  | { kind: "calendar-noop" }
  | { kind: "create"; sourceUpdateId: number; amountRsd: number; categoryId: CategoryId }
  | { kind: "details" | "delete-request" | "delete-confirm"; expenseId: number }
  | { kind: "edit-prompt"; expenseId: number; field: TextEditField }
  | { kind: "edit-category"; expenseId: number; categoryId: CategoryId }
  | { kind: "statistics-month"; month: string }
  | { kind: "calendar"; month: string; startDate?: string }
  | { kind: "calendar-day"; month: string; day: number; startDate?: string };

const categoryIndex = new Map<string, number>(categories.map((category, index) => [category.id, index]));
const editFields = ["amount", "date", "comment"] as const;

export function formatCallbackData(action: BotAction): string {
  let data: string;
  if (action.kind === "calendar-noop") data = "n";
  else if (action.kind === "create") data = `c:${action.sourceUpdateId}:${action.amountRsd}:${categoryIndex.get(action.categoryId)}`;
  else if (action.kind === "statistics-month") data = `s:${action.month.replace("-", "")}`;
  else if (action.kind === "calendar") data = `k:${action.month.replace("-", "")}:${action.startDate?.replaceAll("-", "") ?? "0"}`;
  else if (action.kind === "calendar-day") data = `t:${action.month.replace("-", "")}:${action.startDate?.replaceAll("-", "") ?? "0"}:${action.day}`;
  else if (action.kind === "edit-category") data = `e:${action.expenseId}:${categoryIndex.get(action.categoryId)}`;
  else if (action.kind === "edit-prompt") data = `p:${action.expenseId}:${editFields.indexOf(action.field)}`;
  else data = `${{ details: "d", "delete-request": "r", "delete-confirm": "x" }[action.kind]}:${action.expenseId}`;
  if (new TextEncoder().encode(data).length > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return data;
}

export function parseCallbackData(data: string): BotAction | { kind: "statistics-year-too-old" } | undefined {
  if (data === "n") return { kind: "calendar-noop" };
  const parts = data.split(":");
  if (["s", "k", "t"].includes(parts[0] ?? "")) {
    if (!/^\d{4}(0[1-9]|1[0-2])$/.test(parts[1] ?? "")) return undefined;
    if (parts.length !== (parts[0] === "s" ? 2 : parts[0] === "k" ? 3 : 4)) return undefined;
    const month = `${parts[1]!.slice(0, 4)}-${parts[1]!.slice(4)}`;
    if (Number(month.slice(0, 4)) < firstStatisticsYear) return { kind: "statistics-year-too-old" };
    if (parts[0] === "s") return { kind: "statistics-month", month };
    if (/^\d{8}$/.test(parts[2] ?? "") && Number(parts[2]!.slice(0, 4)) < firstStatisticsYear)
      return { kind: "statistics-year-too-old" };
    const startDate = parts[2] === "0" ? undefined : /^\d{8}$/.test(parts[2] ?? "")
      ? `${parts[2]!.slice(0, 4)}-${parts[2]!.slice(4, 6)}-${parts[2]!.slice(6)}` : undefined;
    if (parts[2] !== "0" && (!startDate || !isValidCalendarDate(startDate))) return undefined;
    if (parts[0] === "k") return { kind: "calendar", month, ...(startDate ? { startDate } : {}) };
    if (!/^(?:[1-9]|[12]\d|3[01])$/.test(parts[3] ?? "") || !isValidCalendarDate(`${month}-${parts[3]!.padStart(2, "0")}`)) return undefined;
    return { kind: "calendar-day", month, day: Number(parts[3]), ...(startDate ? { startDate } : {}) };
  }
  const positive = (value: string | undefined) => value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
  const index = (value: string | undefined) => value && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
  const expenseId = positive(parts[1]);
  if (parts[0] === "c" && parts.length === 4) {
    const sourceUpdateId = expenseId;
    const amountRsd = positive(parts[2]);
    const categoryId = categories[index(parts[3])]?.id;
    if (sourceUpdateId && amountRsd && categoryId) return { kind: "create", sourceUpdateId, amountRsd, categoryId };
  }
  if (!expenseId || parts.length !== (parts[0] === "p" || parts[0] === "e" ? 3 : 2)) return undefined;
  if (parts[0] === "d") return { kind: "details", expenseId };
  if (parts[0] === "r") return { kind: "delete-request", expenseId };
  if (parts[0] === "x") return { kind: "delete-confirm", expenseId };
  if (parts[0] === "p") {
    const field = editFields[index(parts[2])];
    if (field) return { kind: "edit-prompt", expenseId, field };
  }
  if (parts[0] === "e") {
    const categoryId = categories[index(parts[2])]?.id;
    if (categoryId) return { kind: "edit-category", expenseId, categoryId };
  }
  return undefined;
}
