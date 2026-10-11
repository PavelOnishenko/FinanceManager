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

test("matches case-insensitive multiword names with repeated spaces and comments", () => {
  assert.deepEqual(parseExpenseInput("800 снеки и сладости"), { kind: "expense", amountRsd: 800, categoryId: "snacks" });
  assert.deepEqual(parseExpenseInput(" 500 ГИГИЕНА   и  Красота шампунь "),
    { kind: "expense", amountRsd: 500, categoryId: "personal-care", comment: "шампунь" });
});

test("accepts current category names", () => {
  assert.deepEqual(parseExpenseInput("1000 Фирмы"), { kind: "expense", amountRsd: 1000, categoryId: "business" });
  assert.deepEqual(parseExpenseInput("350 коммунальные услуги"), { kind: "expense", amountRsd: 350, categoryId: "utilities" });
  assert.deepEqual(parseExpenseInput("2000 подарки"), { kind: "expense", amountRsd: 2000, categoryId: "gifts" });
  assert.deepEqual(parseExpenseInput("500 потерянные деньги"), { kind: "expense", amountRsd: 500, categoryId: "lost-money" });
  assert.deepEqual(parseExpenseInput("900 подписки Netflix"), { kind: "expense", amountRsd: 900, categoryId: "subscriptions", comment: "Netflix" });
  assert.deepEqual(parseExpenseInput("350 связь"), { kind: "expense", amountRsd: 350, categoryId: "communication" });
});

test("rejects former synonyms and incomplete or extended category names", () => {
  for (const name of ["кафе", "коммуналка", "сервис", "ИП", "подарок", "потеряно", "подписка", "снеки", "гигиена", "продуктыExtra"])
    assert.equal(parseExpenseInput(`700 ${name} комментарий`).kind, "invalid", name);
});

test("rejects invalid input", () => {
  assert.equal(parseExpenseInput("0").kind, "invalid");
  assert.equal(parseExpenseInput("12.5 продукты").kind, "invalid");
  assert.equal(parseExpenseInput("100 неизвестно").kind, "invalid");
  assert.equal(parseExpenseInput("0 продукты").kind, "invalid");
  assert.equal(parseExpenseInput("9007199254740992 продукты").kind, "invalid");
  assert.equal(parseExpenseInput("-100 продукты").kind, "invalid");
});

