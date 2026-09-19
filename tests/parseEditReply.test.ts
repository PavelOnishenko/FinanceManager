import assert from "node:assert/strict";
import test from "node:test";
import { parseEditReply } from "../src/telegram/parseEditReply";

test("parses a positive integer amount without accepting numeric shortcuts", () => {
  assert.deepEqual(parseEditReply("amount", "3000"), { edit: { field: "amount", amountRsd: 3000 } });
  assert.deepEqual(parseEditReply("amount", "1e3"), { error: "Сумма должна быть целым положительным числом в RSD." });
  assert.deepEqual(parseEditReply("amount", "0"), { error: "Сумма должна быть целым положительным числом в RSD." });
  assert.deepEqual(parseEditReply("amount", "9007199254740992"), { error: "Сумма должна быть целым положительным числом в RSD." });
});

test("converts a written date to the storage format", () => {
  assert.deepEqual(parseEditReply("date", "18.09.2026"), { edit: { field: "date", spentOn: "2026-09-18" } });
  assert.deepEqual(parseEditReply("date", "18/09/2026"), { error: "Введите дату в формате ДД.ММ.ГГГГ." });
});

test("keeps comment text and treats one dash as removal", () => {
  assert.deepEqual(parseEditReply("comment", "Покупка"), { edit: { field: "comment", comment: "Покупка" } });
  assert.deepEqual(parseEditReply("comment", "-"), { edit: { field: "comment", comment: undefined } });
});
