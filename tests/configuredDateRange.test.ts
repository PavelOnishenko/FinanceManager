import assert from "node:assert/strict";
import test from "node:test";
import { getDateInFinanceTimeZone, getPreviousCalendarMonthRange } from "../src/application/dateRange";

for (const instant of ["2026-01-01T00:30:00Z", "2026-03-01T00:30:00Z"]) {
  test(`configured zones determine the local date at ${instant}`, () => {
    const date = new Date(instant);
    const eastZone = "Europe/Belgrade";
    const westZone = "America/New_York";
    assert.equal(getDateInFinanceTimeZone(date, eastZone), instant.slice(0, 10));
    assert.equal(getDateInFinanceTimeZone(date, westZone), new Date(date.getTime() - 86400000).toISOString().slice(0, 10));
  });
}

test("previous month uses the configured zone at a year boundary", () => {
  const instant = new Date("2026-01-01T00:30:00Z");
  const eastZone = "Europe/Belgrade";
  const westZone = "America/New_York";
  assert.deepEqual(getPreviousCalendarMonthRange(instant, eastZone), { fromDate: "2025-12-01", toDate: "2025-12-31" });
  assert.deepEqual(getPreviousCalendarMonthRange(instant, westZone), { fromDate: "2025-11-01", toDate: "2025-11-30" });
});

test("Belgrade uses UTC+1 on the evening before the spring clock change", () => {
  assert.equal(getDateInFinanceTimeZone(new Date("2026-03-28T22:30:00Z"), "Europe/Belgrade"), "2026-03-28");
});

test("Belgrade uses UTC+2 on the evening after the spring clock change", () => {
  assert.equal(getDateInFinanceTimeZone(new Date("2026-03-29T22:30:00Z"), "Europe/Belgrade"), "2026-03-30");
});

test("Belgrade uses UTC+2 on the evening before the autumn clock change", () => {
  assert.equal(getDateInFinanceTimeZone(new Date("2026-10-24T22:30:00Z"), "Europe/Belgrade"), "2026-10-25");
});

test("Belgrade uses UTC+1 on the evening after the autumn clock change", () => {
  assert.equal(getDateInFinanceTimeZone(new Date("2026-10-25T22:30:00Z"), "Europe/Belgrade"), "2026-10-25");
});
