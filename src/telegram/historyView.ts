import { InlineKeyboard } from "grammy";
import { getCalendarMonthRange, type DateRange } from "../application/dateRange";
import type { Expense, ExpenseHistoryPage } from "../storage/D1FinanceRepository";
import { formatCallbackData } from "./callbackData";
import { addMonthNavigation } from "./periodPicker";

export function recentHistoryView(expenses: Expense[], displayCurrency?: string) {
  const keyboard = new InlineKeyboard().text("Другой период", formatCallbackData({ kind: "history-picker" }));
  addExpenseButtons(keyboard, expenses, displayCurrency);
  return { text: expenses.length ? "Последние 10 расходов:" : "Расходов пока нет.", reply_markup: keyboard };
}

export function periodHistoryView(result: ExpenseHistoryPage & { range: DateRange }, displayCurrency?: string) {
  const keyboard = new InlineKeyboard()
    .text("Другой период", formatCallbackData({ kind: "calendar", month: result.range.fromDate.slice(0, 7), destination: "history" }))
    .text("Последние 10", formatCallbackData({ kind: "history-recent" }));
  addExpenseButtons(keyboard, result.expenses, displayCurrency);
  if (result.page > 0 || result.hasNext)
    keyboard.row();
  if (result.page > 0)
    keyboard.text("Назад", formatCallbackData({ kind: "history-page", ...result.range, page: result.page - 1 }));
  if (result.hasNext)
    keyboard.text("Далее", formatCallbackData({ kind: "history-page", ...result.range, page: result.page + 1 }));
  const month = result.range.fromDate.slice(0, 7);
  const monthRange = getCalendarMonthRange(month);
  if (monthRange?.fromDate === result.range.fromDate && monthRange.toDate === result.range.toDate)
    addMonthNavigation(keyboard.row(), month, "history");
  const heading = `Расходы: ${result.range.fromDate} — ${result.range.toDate}`;
  return {
    text: `${heading}\n${result.expenses.length ? `Страница ${result.page + 1}` : "За выбранный период расходов нет."}`,
    reply_markup: keyboard
  };
}

function addExpenseButtons(keyboard: InlineKeyboard, expenses: Expense[], displayCurrency?: string) {
  for (const expense of expenses)
    keyboard.row().text(
      `#${expense.id} · ${expense.amountRsd} ${displayCurrency} · ${expense.categoryName} · ${expense.spentOn.split("-").reverse().join(".")}`,
      formatCallbackData({ kind: "details", expenseId: expense.id })
    );
}
