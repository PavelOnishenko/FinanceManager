import { InlineKeyboard } from "grammy";
import { getCalendarMonthRange, shiftCalendarMonth } from "../application/dateRange";
import { formatCallbackData, type PeriodDestination } from "./callbackData";

export function calendarText(month: string, startDate?: string): string {
  return `${month}\nПн Вт Ср Чт Пт Сб Вс\n${startDate ? `Начало: ${startDate}. Выберите конец периода.` : "Выберите начало периода."}`;
}

export function calendarButtons(month: string, destination: PeriodDestination, startDate?: string): InlineKeyboard {
  const range = getCalendarMonthRange(month)!;
  const keyboard = new InlineKeyboard();
  const previous = shiftCalendarMonth(month, -1);
  const next = shiftCalendarMonth(month, 1);
  if (previous)
    keyboard.text("◀", formatCallbackData({ kind: "calendar", month: previous, startDate, destination }));
  keyboard.text(month, formatCallbackData({ kind: "calendar-noop" }));
  if (next)
    keyboard.text("▶", formatCallbackData({ kind: "calendar", month: next, startDate, destination }));
  keyboard.row();
  if (destination === "history")
    keyboard.text("Весь месяц", formatCallbackData({ kind: "history-month", month })).row();
  const firstWeekday = (new Date(`${range.fromDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = Number(range.toDate.slice(-2));
  for (let cell = 0; cell < firstWeekday + days; cell++) {
    const day = cell - firstWeekday + 1;
    if (day < 1)
      keyboard.text("·", formatCallbackData({ kind: "calendar-noop" }));
    else
      keyboard.text(day === Number(startDate?.slice(-2)) && startDate?.startsWith(month) ? `[${day}]` : String(day),
        formatCallbackData({ kind: "calendar-day", month, day, startDate, destination }));
    if (cell % 7 === 6)
      keyboard.row();
  }
  if (startDate)
    keyboard.row().text("Сбросить начало", formatCallbackData({ kind: "calendar", month, destination }));
  if (destination === "history")
    keyboard.row().text("Последние 10", formatCallbackData({ kind: "history-recent" }));
  return keyboard;
}

export function addMonthNavigation(keyboard: InlineKeyboard, month: string, destination: PeriodDestination): InlineKeyboard {
  const previous = shiftCalendarMonth(month, -1);
  const next = shiftCalendarMonth(month, 1);
  const kind = destination === "history" ? "history-month" : "statistics-month";
  if (previous)
    keyboard.text("◀ Предыдущий месяц", formatCallbackData({ kind, month: previous }));
  if (next)
    keyboard.text("Следующий месяц ▶", formatCallbackData({ kind, month: next }));
  return keyboard;
}

