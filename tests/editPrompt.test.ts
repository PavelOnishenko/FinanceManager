import assert from "node:assert/strict";
import test from "node:test";
import { createEditPrompt, parseEditPrompt } from "../src/domain/editPrompt";

test("creates an amount edit prompt", () => {
  assert.equal(createEditPrompt({ expenseId: 123, field: "amount" }, "RSD"), "Редактирование расхода №123 · Новая сумма\n\nОтправьте целую сумму в RSD.");
});

test("parses an edit prompt", () => {
  const prompt = "Редактирование расхода №321 · Новый комментарий\n\n Напишите новый комментарий";
  assert.deepEqual(parseEditPrompt(prompt), { expenseId: 321, field: "comment" });
});

test("recovers an edit target from a ForceReply prompt", () => {
  const prompt = createEditPrompt({ expenseId: 123, field: "amount" }, "RSD");
  assert.deepEqual(parseEditPrompt(prompt), { expenseId: 123, field: "amount" });
});

test("supports every text edit field", () => {
  for (const field of ["amount", "date", "comment"] as const) {
    const prompt = createEditPrompt({ expenseId: 7, field }, "RSD");
    assert.deepEqual(parseEditPrompt(prompt), { expenseId: 7, field });
  }
});

test("rejects unrelated or malformed prompts", () => {
  assert.equal(parseEditPrompt("Введите новую сумму"), undefined);
  assert.equal(parseEditPrompt("Редактирование расхода №0 · Новая сумма"), undefined);
});

test("amount prompts use the selected currency", () => {
  const displayCurrency = "EUR";
  const expenseId = 123;
  assert.equal(createEditPrompt({ expenseId, field: "amount" }, displayCurrency),
    `Редактирование расхода №${expenseId} · Новая сумма\n\nОтправьте целую сумму в ${displayCurrency}.`);
});
