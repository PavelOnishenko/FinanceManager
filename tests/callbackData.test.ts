import assert from "node:assert/strict";
import test from "node:test";
import { formatCallbackData, parseCallbackData, type BotAction } from "../src/telegram/callbackData";

test("callback actions round-trip within Telegram's 64-byte limit", () => {
  const actions: BotAction[] = [
    { kind: "calendar-noop" },
    { kind: "create", sourceUpdateId: Number.MAX_SAFE_INTEGER, amountRsd: Number.MAX_SAFE_INTEGER, categoryId: "u_0123456789_-" },
    { kind: "create", sourceUpdateId: 9007199254740991, amountRsd: 9007199254740991, categoryId: "personal-care" },
    { kind: "details", expenseId: 23 }, { kind: "category-list", expenseId: 23 }, { kind: "edit-actions", expenseId: 23 },
    { kind: "delete-request", expenseId: 23 }, { kind: "delete-confirm", expenseId: 23 },
    { kind: "edit-prompt", expenseId: 23, field: "comment" }, { kind: "edit-category", expenseId: 23, categoryId: "groceries" },
    { kind: "statistics-month", month: "2026-02" }, { kind: "calendar", month: "2026-03", startDate: "2026-02-28" },
    { kind: "calendar-day", month: "2026-03", day: 1, startDate: "2026-02-28" }
  ];
  for (const action of actions) {
    const data = formatCallbackData(action);
    assert.deepEqual(parseCallbackData(data), action);
    assert(new TextEncoder().encode(data).length <= 64);
  }
});

test("rejects malformed and obsolete expense callbacks", () => {
  // Old messages can still contain category indices from before stable category IDs.
  for (const data of ["c:41:2490:0", "e:1:0", "c1:0:2490:groceries", "d:1:extra", "c1:1:1:invalid:id", "e1:1:u_short"])
    assert.equal(parseCallbackData(data), undefined, data);
});

test("rejects invalid calendar callback dates and months", () => {
  assert.equal(parseCallbackData("s:202613"), undefined);
  assert.equal(parseCallbackData("k:202602:20260229"), undefined);
  assert.equal(parseCallbackData("t:202602:0:30"), undefined);
  assert.equal(parseCallbackData("t:202602:0:0"), undefined);
  assert.equal(parseCallbackData("s:202602:extra"), undefined);
  assert.deepEqual(parseCallbackData("s:202512"), { kind: "statistics-year-too-old" });
  assert.deepEqual(parseCallbackData("k:000001:0"), { kind: "statistics-year-too-old" });
  assert.deepEqual(parseCallbackData("t:202601:20251231:1"), { kind: "statistics-year-too-old" });
});
