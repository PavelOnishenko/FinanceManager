import type { ExpenseEdit } from "../application/financeApplication";
import type { TextEditField } from "../domain/editPrompt";

export function parseEditReply(field: TextEditField, value: string): { edit: ExpenseEdit } | { error: string } {
  if (field === "amount") {
    const amountRsd = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(amountRsd))
      return { error: "Сумма должна быть целым положительным числом в RSD." };
    return { edit: { field: "amount", amountRsd } };
  }

  if (field === "date") {
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(value)) return { error: "Введите дату в формате ДД.ММ.ГГГГ." };
    const [day, month, year] = value.split(".");
    return { edit: { field: "date", spentOn: `${year}-${month}-${day}` } };
  }

  return { edit: { field: "comment", comment: value === "-" ? undefined : value } };
}
