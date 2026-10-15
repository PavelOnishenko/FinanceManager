import assert from "node:assert/strict";
import test from "node:test";
import {
  getCalendarMonthRange, getDateInFinanceTimeZone, getPreviousCalendarMonthRange, isValidCalendarDate, shiftCalendarMonth
} from "../src/application/dateRange";

test("configured zones determine the local date across month and year boundaries", () => {
  for (const [instant, eastDate, westDate] of [
    ["2026-01-01T00:30:00Z", "2026-01-01", "2025-12-31"],
    ["2026-03-01T00:30:00Z", "2026-03-01", "2026-02-28"]
  ] as const) {
    assert.equal(getDateInFinanceTimeZone(new Date(instant), "Europe/Belgrade"), eastDate, instant);
    assert.equal(getDateInFinanceTimeZone(new Date(instant), "America/New_York"), westDate, instant);
  }
});

test("previous month uses the configured zone at a year boundary", () => {
  const instant = new Date("2026-01-01T00:30:00Z");
  assert.deepEqual(getPreviousCalendarMonthRange(instant, "Europe/Belgrade"), { fromDate: "2025-12-01", toDate: "2025-12-31" });
  assert.deepEqual(getPreviousCalendarMonthRange(instant, "America/New_York"), { fromDate: "2025-11-01", toDate: "2025-11-30" });
});

test("Belgrade local dates follow spring and autumn clock changes", () => {
  for (const [instant, expected] of [
    ["2026-03-28T22:30:00Z", "2026-03-28"], ["2026-03-29T22:30:00Z", "2026-03-30"],
    ["2026-10-24T22:30:00Z", "2026-10-25"], ["2026-10-25T22:30:00Z", "2026-10-25"]
  ] as const)
    assert.equal(getDateInFinanceTimeZone(new Date(instant), "Europe/Belgrade"), expected, instant);
});

test("February ranges and calendar dates respect leap years", () => {
  assert.deepEqual(getPreviousCalendarMonthRange(new Date("2024-03-15T12:00:00.000Z"), "Europe/Belgrade"), { fromDate: "2024-02-01", toDate: "2024-02-29" });
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(isValidCalendarDate("2026-02-29"), false);
});

test("statistics month navigation stops at 2026", () => {
  assert.equal(getCalendarMonthRange("2025-12"), undefined);
  assert.equal(getCalendarMonthRange("0000-01"), undefined);
  assert.deepEqual(getCalendarMonthRange("2026-01"), { fromDate: "2026-01-01", toDate: "2026-01-31" });
  assert.equal(shiftCalendarMonth("2026-01", -1), undefined);
  assert.equal(shiftCalendarMonth("2025-12", 1), undefined);
  assert.equal(shiftCalendarMonth("2026-01", 1), "2026-02");
});
