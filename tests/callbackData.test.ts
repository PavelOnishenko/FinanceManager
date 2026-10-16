import assert from "node:assert/strict";
import test from "node:test";
import { formatCallbackData, parseCallbackData, type BotAction } from "../src/telegram/callbackData";

test("callback actions round-trip within Telegram's 64-byte limit", () => {
  const actions: BotAction[] = [
    { kind: "calendar-noop" },
    { kind: "create", sourceUpdateId: Number.MAX_SAFE_INTEGER, amountRsd: Number.MAX_SAFE_INTEGER, categoryId: "u_0123456789_-" },
    { kind: "create", sourceUpdateId: 9007199254740991, amountRsd: 9007199254740991, categoryId: "personal-care" },
    { kind: "details", expenseId: 23 }, 
    { kind: "category-list", expenseId: 23 }, 
    { kind: "edit-actions", expenseId: 23 },
    { kind: "delete-request", expenseId: 23 },
    { kind: "delete-confirm", expenseId: 23 },
    { kind: "edit-prompt", expenseId: 23, field: "comment" }, 
    { kind: "edit-category", expenseId: 23, categoryId: "groceries" },
    { kind: "statistics-month", month: "2026-02" }, 
    { kind: "calendar", destination: "statistics", month: "2026-03", startDate: "2026-02-28" },
    { kind: "calendar-day", destination: "statistics", month: "2026-03", day: 1, startDate: "2026-02-28" },
    { kind: "history-recent" }, { kind: "history-picker" }, 
    { kind: "history-month", month: "2026-01" },
    { kind: "history-page", fromDate: "2026-01-01", toDate: "9999-12-31", page: Number.MAX_SAFE_INTEGER },
    { kind: "calendar", destination: "history", month: "2026-03", startDate: "2026-02-28" },
    { kind: "calendar-day", destination: "history", month: "2026-03", day: 1, startDate: "2026-02-28" }
  ];
  for (const action of actions) {
    const data = formatCallbackData(action);
    assert.deepEqual(parseCallbackData(data), action);
    assert(new TextEncoder().encode(data).length <= 64);
  }
});

// todo would be nice to have a callback text structure reminder here to easily understand what exactly is wrong with the examples. 
// I mean, just a comment. Here and in other places heavily relying on the callback text structure.
test("history callbacks reject malformed pages and ranges and enforce the shared 2026 floor", () => {
  for (const data of [
    "h:202613", "k:history:202602:20260229", "t:history:202602:0:30", "t:history:202602:0:1:extra", "hr:extra",
    "hp:20260201:20260228:-1", "hp:20260201:20260228:1.5", "hp:20260201:20260228:9007199254740992",
    "hp:20260229:20260301:0", "hp:20260301:20260228:0", "hp:20260201:20260228:0:extra"
  ])
    assert.equal(parseCallbackData(data), undefined, data);
  for (const data of ["h:202512", "k:history:202512:0", "t:history:202601:20251231:1", "hp:20251231:20260101:0"])
    assert.deepEqual(parseCallbackData(data), { kind: "history-year-too-old" }, data);
});

test("rejects malformed and obsolete expense callbacks", () => {
  // Old messages can still contain category indices from before stable category IDs.
  for (const data of ["c:41:2490:0", "e:1:0", "c1:0:2490:groceries", "d:1:extra", "c1:1:1:invalid:id", "e1:1:u_short"])
    assert.equal(parseCallbackData(data), undefined, data);
});

test("rejects invalid calendar callback dates and months", () => {
  assert.equal(parseCallbackData("k:unknown:202602:0"), undefined);
  assert.equal(parseCallbackData("s:202613"), undefined);
  assert.equal(parseCallbackData("k:statistics:202602:20260229"), undefined);
  assert.equal(parseCallbackData("t:statistics:202602:0:30"), undefined);
  assert.equal(parseCallbackData("t:statistics:202602:0:0"), undefined);
  assert.equal(parseCallbackData("s:202602:extra"), undefined);
  assert.deepEqual(parseCallbackData("s:202512"), { kind: "statistics-year-too-old" });
  assert.deepEqual(parseCallbackData("k:statistics:000001:0"), { kind: "statistics-year-too-old" });
  assert.deepEqual(parseCallbackData("t:statistics:202601:20251231:1"), { kind: "statistics-year-too-old" });
});
