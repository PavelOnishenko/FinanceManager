export const financeTimeZone = "Europe/Belgrade";
export const firstStatisticsYear = 2026;

export type DateRange = { fromDate: string; toDate: string };

export function getDateInFinanceTimeZone(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: financeTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error(`Could not determine date in ${financeTimeZone}.`);
  return `${year}-${month}-${day}`;
}

export function getPreviousCalendarMonthRange(instant: Date): DateRange {
  const [currentYear, currentMonth] = getDateInFinanceTimeZone(instant).split("-").map(Number);
  if (!currentYear || !currentMonth) throw new Error(`Could not determine previous month in ${financeTimeZone}.`);
  const year = currentMonth === 1 ? currentYear - 1 : currentYear;
  const month = currentMonth === 1 ? 12 : currentMonth - 1;
  return { fromDate: formatDate(year, month, 1), toDate: formatDate(year, month, daysInMonth(year, month)) };
}

export function getCalendarMonthRange(month: string): DateRange | undefined {
  const parsed = parseCalendarMonth(month);
  if (!parsed) return undefined;
  return { fromDate: `${month}-01`, toDate: formatDate(parsed.year, parsed.monthNumber, daysInMonth(parsed.year, parsed.monthNumber)) };
}

export function shiftCalendarMonth(month: string, offset: -1 | 1): string | undefined {
  const parsed = parseCalendarMonth(month);
  if (!parsed) return undefined;
  const next = parsed.year * 12 + parsed.monthNumber - 1 + offset;
  const nextYear = Math.floor(next / 12);
  if (nextYear < firstStatisticsYear || nextYear > 9999) return undefined;
  return `${nextYear.toString().padStart(4, "0")}-${(next % 12 + 1).toString().padStart(2, "0")}`;
}

function parseCalendarMonth(month: string): { year: number; monthNumber: number } | undefined {
  const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (year < firstStatisticsYear) return undefined;
  return { year, monthNumber: Number(match[2]) };
}

export function isValidCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function isValidInclusiveDateRange(fromDate: string, toDate: string): boolean {
  return isValidCalendarDate(fromDate) && isValidCalendarDate(toDate) && fromDate <= toDate;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function formatDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
