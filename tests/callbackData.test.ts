import assert from "node:assert/strict";
import test from "node:test";
import { formatCallbackData, parseCallbackData, type BotAction } from "../src/telegram/callbackData";

test("callback actions round-trip within Telegram's 64-byte limit", () => {
  const actions: BotAction[] = [
    { kind: "calendar-noop" },
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

test("rejects a create callback with a zero source update ID", () => {
  assert.equal(parseCallbackData("c1:0:2490:groceries"), undefined);
});

test("rejects obsolete category callbacks instead of interpreting their indices", () => {
  for (const data of ["c:41:2490:0", "e:1:0", "c:41:2490:19", "e:1:19", "c:41:2490:groceries", "e:1:groceries"])
    assert.equal(parseCallbackData(data), undefined, data);
});

test("rejects a details callback with an extra field", () => {
  assert.equal(parseCallbackData("d:1:extra"), undefined);
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

test("category callbacks carry seeded and custom IDs without depending on category names", () => {
  const categoryId = "groceries";
  const sourceUpdateId = 9100;
  const amountRsd = 700;
  const expenseId = 1;
  assert.deepEqual(parseCallbackData(formatCallbackData({ kind: "create", sourceUpdateId, amountRsd, categoryId })), {
    kind: "create", sourceUpdateId, amountRsd, categoryId
  });
  assert.deepEqual(parseCallbackData(formatCallbackData({ kind: "edit-category", expenseId, categoryId })), { kind: "edit-category", expenseId, categoryId });
  const customCategoryId = "u_0123456789_-";
  const action = { kind: "create" as const, sourceUpdateId: Number.MAX_SAFE_INTEGER, amountRsd: Number.MAX_SAFE_INTEGER, categoryId: customCategoryId };
  assert.deepEqual(parseCallbackData(formatCallbackData(action)), action);
  assert(new TextEncoder().encode(formatCallbackData(action)).length <= 64);
  assert.equal(parseCallbackData("c1:1:1:invalid:id"), undefined);
  assert.equal(parseCallbackData("e1:1:u_short"), undefined);
});
