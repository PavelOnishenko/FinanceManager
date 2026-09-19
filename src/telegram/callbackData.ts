import { categories, type CategoryId } from "../config/categories";
import type { TextEditField } from "../domain/editPrompt";

// todo typify "kind" to constants?
export type BotAction =
  | { kind: "create"; sourceUpdateId: number; amountRsd: number; categoryId: CategoryId }
  | { kind: "details" | "delete-request" | "delete-confirm"; expenseId: number }
  | { kind: "edit-prompt"; expenseId: number; field: TextEditField }
  | { kind: "edit-category"; expenseId: number; categoryId: CategoryId };

const categoryIndex = new Map<string, number>(categories.map((category, index) => [category.id, index]));
const editFields = ["amount", "date", "comment"] as const;

export function formatCallbackData(action: BotAction): string {
  let data: string;
  if (action.kind === "create") data = `c:${action.sourceUpdateId}:${action.amountRsd}:${categoryIndex.get(action.categoryId)}`;
  else if (action.kind === "edit-category") data = `e:${action.expenseId}:${categoryIndex.get(action.categoryId)}`;
  else if (action.kind === "edit-prompt") data = `p:${action.expenseId}:${editFields.indexOf(action.field)}`;
  else data = `${{ details: "d", "delete-request": "r", "delete-confirm": "x" }[action.kind]}:${action.expenseId}`;
  if (new TextEncoder().encode(data).length > 64) throw new Error("Telegram callback_data exceeds 64 bytes");
  return data;
}

export function parseCallbackData(data: string): BotAction | undefined {
  const parts = data.split(":");
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
