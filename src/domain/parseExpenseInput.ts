import type { CategoryOption, CategoryId } from "../config/categories";

// todo typify kind field similar to ApplicationResultKind?
export type ParsedExpenseInput =
  | { kind: "amount"; amountRsd: number }
  | { kind: "expense"; amountRsd: number; categoryId: CategoryId; comment?: string }
  | { kind: "invalid"; message: string };

export function parseExpenseInput(input: string, activeCategories: readonly CategoryOption[], displayCurrency: string): ParsedExpenseInput {
  const normalizedInput = input.trim().replace(/\s+/g, " ");
  if (!normalizedInput) return { kind: "invalid", message: "Введите сумму расхода." };

  const amount = parseRsdAmount(normalizedInput);
  if (amount !== undefined) return { kind: "amount", amountRsd: amount };

  for (const { name, id } of [...activeCategories].sort((left, right) => right.name.length - left.name.length)) {
    const match = normalizedInput.match(new RegExp(`^([0-9][0-9 ]*) ${name}(?: (.*))?$`, "i"));
    if (!match)
      continue;

    const parsedAmount = parseRsdAmount(match[1] ?? "");
    if (parsedAmount === undefined)
      return invalidAmount(displayCurrency);

    const comment = match[2]?.trim();
    return { kind: "expense", amountRsd: parsedAmount, categoryId: id, ...(comment ? { comment } : {}) };
  }

  if (/^[0-9]/.test(normalizedInput)) return { kind: "invalid", message: "Не удалось распознать категорию расхода." };
  return { kind: "invalid", message: "Введите сумму, например: 2490 или 2490 продукты Lidl." };
}

function parseRsdAmount(value: string): number | undefined {
  if (!/^[0-9][0-9 ]*$/.test(value)) return undefined;
  const amount = Number(value.replaceAll(" ", ""));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : undefined;
}

function invalidAmount(displayCurrency: string): ParsedExpenseInput {
  return { kind: "invalid", message: `Сумма должна быть целым положительным числом в ${displayCurrency}.` };
}
