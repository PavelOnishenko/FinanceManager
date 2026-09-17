import assert from "node:assert/strict";
import test from "node:test";
import { createExpenseActionKey } from "../src/domain/sourceActionKey";

test("creates the same expense key for every handler of one Telegram update", () => {
  assert.equal(createExpenseActionKey(918273), "expense:918273");
  assert.equal(createExpenseActionKey(918273), "expense:918273");
});

test("creates different keys for different source updates", () => {
  assert.notEqual(createExpenseActionKey(918273), createExpenseActionKey(918274));
});

test("rejects invalid Telegram update IDs", () => {
  assert.throws(() => createExpenseActionKey(-1));
  assert.throws(() => createExpenseActionKey(1.5));
});

