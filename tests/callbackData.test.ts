import assert from "node:assert/strict";
import test from "node:test";
import { formatCallbackData, parseCallbackData, type BotAction } from "../src/telegram/callbackData";

test("callback actions round-trip within Telegram's 64-byte limit", () => {
  const cases: { action: BotAction; data: string }[] = [
    // n = calendar padding cell: acknowledge the tap without selecting a day.
    { action: { kind: "calendar-noop" }, data: "n" },
    // c1:<source update ID>:<amount>:<stable category ID>. Safe-integer limits must still fit in 64 bytes.
    { action: { kind: "create", sourceUpdateId: Number.MAX_SAFE_INTEGER, amountRsd: Number.MAX_SAFE_INTEGER, categoryId: "u_0123456789_-" },
      data: "c1:9007199254740991:9007199254740991:u_0123456789_-" },
    { action: { kind: "create", sourceUpdateId: 9007199254740991, amountRsd: 9007199254740991, categoryId: "personal-care" },
      data: "c1:9007199254740991:9007199254740991:personal-care" },
    // <action>:<expense ID>: d = details, l = category list, a = edit actions.
    { action: { kind: "details", expenseId: 23 }, data: "d:23" },
    { action: { kind: "category-list", expenseId: 23 }, data: "l:23" },
    { action: { kind: "edit-actions", expenseId: 23 }, data: "a:23" },
    // r = request deletion; x = confirm deletion. Both target expense #23.
    { action: { kind: "delete-request", expenseId: 23 }, data: "r:23" },
    { action: { kind: "delete-confirm", expenseId: 23 }, data: "x:23" },
    // p:<expense ID>:<field index>; 0 = amount, 1 = date, 2 = comment.
    { action: { kind: "edit-prompt", expenseId: 23, field: "comment" }, data: "p:23:2" },
    // e1:<expense ID>:<stable category ID> — replace the expense category.
    { action: { kind: "edit-category", expenseId: 23, categoryId: "groceries" }, data: "e1:23:groceries" },
    // s:<YYYYMM> — monthly statistics.
    { action: { kind: "statistics-month", month: "2026-02" }, data: "s:202602" },
    // k:<destination>:<YYYYMM>:<start YYYYMMDD or 0> — calendar month, retaining the selected range start.
    { action: { kind: "calendar", destination: "statistics", month: "2026-03", startDate: "2026-02-28" }, data: "k:statistics:202603:20260228" },
    // t:<destination>:<YYYYMM>:<start YYYYMMDD or 0>:<day> — select March 1 after a February 28 start.
    { action: { kind: "calendar-day", destination: "statistics", month: "2026-03", day: 1, startDate: "2026-02-28" },
      data: "t:statistics:202603:20260228:1" },
    // hr returns to recent history; hi opens its period picker.
    { action: { kind: "history-recent" }, data: "hr" },
    { action: { kind: "history-picker" }, data: "hi" },
    // h:<YYYYMM> — history for a whole month.
    { action: { kind: "history-month", month: "2026-01" }, data: "h:202601" },
    // hp:<from YYYYMMDD>:<to YYYYMMDD>:<zero-based page> — retain both range boundaries while paging.
    { action: { kind: "history-page", fromDate: "2026-01-01", toDate: "9999-12-31", page: Number.MAX_SAFE_INTEGER },
      data: "hp:20260101:99991231:9007199254740991" },
    // k:<destination>:<YYYYMM>:<start YYYYMMDD> — the same picker can target expense history.
    { action: { kind: "calendar", destination: "history", month: "2026-03", startDate: "2026-02-28" }, data: "k:history:202603:20260228" },
    // t:<destination>:<YYYYMM>:<start YYYYMMDD>:<day> — finish a history range on March 1.
    { action: { kind: "calendar-day", destination: "history", month: "2026-03", day: 1, startDate: "2026-02-28" },
      data: "t:history:202603:20260228:1" }
  ];
  for (const { action, data } of cases) {
    assert.equal(formatCallbackData(action), data);
    assert.deepEqual(parseCallbackData(data), action, data);
    assert(new TextEncoder().encode(data).length <= 64, data);
  }
});

test("rejects malformed and obsolete expense callbacks", () => {
  for (const data of [
    // Legacy c:<source update ID>:<amount>:<category index>; stable category IDs replaced numeric indices.
    "c:41:2490:0",
    // Legacy e:<expense ID>:<category index> — old edit-category button.
    "e:1:0",
    // c1:<source update ID>:<amount>:<category ID> — update ID must be positive.
    "c1:0:2490:groceries",
    // d:<expense ID> — details accept no trailing field.
    "d:1:extra",
    // c1:<source update ID>:<amount>:<category ID> — a colon splits the category into an extra field.
    "c1:1:1:invalid:id",
    // e1:<expense ID>:<category ID> — generated u_ IDs require a full-length suffix.
    "e1:1:u_short"
  ])
    assert.equal(parseCallbackData(data), undefined, data);
});

test("rejects invalid calendar callback dates and months", () => {
  // k:<destination>:<YYYYMM>:<start or 0> — destination must be history or statistics.
  assert.equal(parseCallbackData("k:unknown:202602:0"), undefined);
  // s:<YYYYMM> — month 13 does not exist.
  assert.equal(parseCallbackData("s:202613"), undefined);
  // k:<destination>:<YYYYMM>:<start YYYYMMDD> — February 29 does not exist in 2026.
  assert.equal(parseCallbackData("k:statistics:202602:20260229"), undefined);
  // t:<destination>:<YYYYMM>:<start or 0>:<day> — 0 means no selected start; February 30 and day 0 are invalid.
  assert.equal(parseCallbackData("t:statistics:202602:0:30"), undefined);
  assert.equal(parseCallbackData("t:statistics:202602:0:0"), undefined);
  // s:<YYYYMM> — monthly statistics accept no trailing field.
  assert.equal(parseCallbackData("s:202602:extra"), undefined);
  // Well-formed old buttons produce the year-limit explanation, rather than a malformed-data error.
  // s:<YYYYMM> — December 2025 is before statistics became available.
  assert.deepEqual(parseCallbackData("s:202512"), { kind: "statistics-year-too-old" });
  // k:<destination>:<YYYYMM>:<start or 0> — year 0000 is also below the supported lower bound.
  assert.deepEqual(parseCallbackData("k:statistics:000001:0"), { kind: "statistics-year-too-old" });
  // t:<destination>:<YYYYMM>:<start YYYYMMDD>:<day> — January 2026 is valid, but the retained start is in 2025.
  assert.deepEqual(parseCallbackData("t:statistics:202601:20251231:1"), { kind: "statistics-year-too-old" });
});

test("history callbacks reject malformed pages and ranges and enforce the shared 2026 floor", () => {
  for (const data of [
    "h:202613", // h:<YYYYMM> — month 13 does not exist.
    "k:history:202602:20260229", // k:<destination>:<YYYYMM>:<start YYYYMMDD> — 2026 has no February 29.
    "t:history:202602:0:30", // t:<destination>:<YYYYMM>:<start or 0>:<day> — February has no day 30.
    "t:history:202602:0:1:extra", // Same day-selection format: one trailing field too many.
    "hr:extra", // hr returns to recent history and accepts no fields.
    // hp:<from YYYYMMDD>:<to YYYYMMDD>:<zero-based page> requires a nonnegative safe integer page.
    "hp:20260201:20260228:-1", // Negative page.
    "hp:20260201:20260228:1.5", // Fractional page.
    "hp:20260201:20260228:9007199254740992", // Above the safe-integer limit.
    "hp:20260229:20260301:0", // Impossible start date: February 29, 2026.
    "hp:20260301:20260228:0", // End date is before the start.
    "hp:20260201:20260228:0:extra" // Extra field after the page number.
  ])
    assert.equal(parseCallbackData(data), undefined, data);
  for (const data of [
    "h:202512", // h:<YYYYMM> — the selected month is before 2026.
    "k:history:202512:0", // k:<destination>:<YYYYMM>:<start or 0> — the calendar month is before 2026.
    "t:history:202601:20251231:1", // t:<destination>:<YYYYMM>:<start YYYYMMDD>:<day> — the start is before 2026.
    "hp:20251231:20260101:0" // hp:<from YYYYMMDD>:<to YYYYMMDD>:<zero-based page> — the range starts before 2026.
  ])
    assert.deepEqual(parseCallbackData(data), { kind: "history-year-too-old" }, data);
});
