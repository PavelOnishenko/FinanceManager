import { categories, type CategoryId } from "../config/categories";

export type ParsedExpenseInput =
  | { kind: "amount"; amountRsd: number }
  | { kind: "expense"; amountRsd: number; categoryId: CategoryId; comment?: string }
  | { kind: "invalid"; message: string };

const categoryAliases = categories.flatMap(category => category.aliases.map(alias => ({ alias, categoryId: category.id })))
  .sort((left, right) => right.alias.length - left.alias.length);

export function parseExpenseInput(input: string): ParsedExpenseInput {
  const normalizedInput = input.trim().replace(/\s+/g, " ");
  if (!normalizedInput) return { kind: "invalid", message: "Введите сумму расхода." };

  const amount = parseRsdAmount(normalizedInput);
  if (amount !== undefined) return { kind: "amount", amountRsd: amount };

  for (const { alias, categoryId } of categoryAliases) {
    const match = normalizedInput.match(new RegExp(`^([0-9][0-9 ]*) ${alias}(?: (.*))?$`, "iu"));
    if (!match) continue;

    const parsedAmount = parseRsdAmount(match[1] ?? "");
    if (parsedAmount === undefined) return invalidAmount();

    const comment = match[2]?.trim();
    return { kind: "expense", amountRsd: parsedAmount, categoryId, ...(comment ? { comment } : {}) };
  }

  if (/^[0-9]/.test(normalizedInput)) return { kind: "invalid", message: "Не удалось распознать категорию расхода." };
  return { kind: "invalid", message: "Введите сумму, например: 2490 или 2490 продукты Lidl." };
}

function parseRsdAmount(value: string): number | undefined {
  if (!/^[0-9][0-9 ]*$/.test(value)) return undefined;
  const amount = Number(value.replaceAll(" ", ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function invalidAmount(): ParsedExpenseInput {
  return { kind: "invalid", message: "Сумма должна быть целым положительным числом в RSD." };
}
