import assert from "node:assert/strict";
import test from "node:test";
import { parseExpenseInput } from "../src/domain/parseExpenseInput";

test("parses an integer amount", () => {
  assert.deepEqual(parseExpenseInput("2490"), { kind: "amount", amountRsd: 2490 });
  assert.deepEqual(parseExpenseInput("2 490"), { kind: "amount", amountRsd: 2490 });
});

test("parses category and optional comment", () => {
  assert.deepEqual(parseExpenseInput("2490 продукты"), { kind: "expense", amountRsd: 2490, categoryId: "groceries" });
  assert.deepEqual(parseExpenseInput("2 490 продукты Lidl"), { kind: "expense", amountRsd: 2490, categoryId: "groceries", comment: "Lidl" });
});

test("uses the longest matching category alias", () => {
  assert.deepEqual(parseExpenseInput("800 снеки и сладости"), { kind: "expense", amountRsd: 800, categoryId: "snacks" });
  assert.deepEqual(parseExpenseInput("500 гигиена и красота"), { kind: "expense", amountRsd: 500, categoryId: "personal-care" });
});

test("supports useful category aliases", () => {
  assert.deepEqual(parseExpenseInput("1000 ИП"), { kind: "expense", amountRsd: 1000, categoryId: "business" });
  assert.deepEqual(parseExpenseInput("350 коммуналка"), { kind: "expense", amountRsd: 350, categoryId: "utilities" });
});

test("rejects invalid input", () => {
  assert.equal(parseExpenseInput("0").kind, "invalid");
  assert.equal(parseExpenseInput("12.5 продукты").kind, "invalid");
  assert.equal(parseExpenseInput("100 неизвестно").kind, "invalid");
});

