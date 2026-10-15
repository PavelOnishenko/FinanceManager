import assert from "node:assert/strict";
import test from "node:test";
import { createExpenseActionKey } from "../src/domain/sourceActionKey";

test("identifies each Telegram update with a stable expense key", () => {
  assert.equal(createExpenseActionKey(918273), "expense:918273");
  assert.equal(createExpenseActionKey(918274), "expense:918274");
});
