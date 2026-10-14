export type TextEditField = "amount" | "date" | "comment";

export interface EditTarget {
  expenseId: number;
  field: TextEditField;
}

const promptTitles: Record<TextEditField, string> = {
  amount: "Новая сумма",
  date: "Новая дата",
  comment: "Новый комментарий"
};

const promptPattern = /^Редактирование расхода №([1-9]\d*) · (Новая сумма|Новая дата|Новый комментарий)$/u;
const fieldsByTitle = new Map(Object.entries(promptTitles).map(([field, title]) => [title, field as TextEditField]));

export function createEditPrompt(target: EditTarget, displayCurrency: string): string {
  let instructions: string;
  switch (target.field) {
    case "amount":
      instructions = `Отправьте целую сумму в ${displayCurrency}.`;
      break;
    case "date":
      instructions = "Отправьте дату в формате ДД.ММ.ГГГГ.";
      break;
    case "comment":
      instructions = "Отправьте новый комментарий или один символ «-», чтобы удалить комментарий.";
  }
  return `Редактирование расхода №${target.expenseId} · ${promptTitles[target.field]}\n\n${instructions}`;
}

export function parseEditPrompt(promptText: string): EditTarget | undefined {
  const firstLine = promptText.split("\n", 1)[0] ?? "";
  const match = firstLine.match(promptPattern);
  if (!match) return undefined;

  const expenseId = Number(match[1]);
  const field = fieldsByTitle.get(match[2] ?? "");
  if (!Number.isSafeInteger(expenseId) || !field) return undefined;
  return { expenseId, field };
}
