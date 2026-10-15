import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "./defaultCategories";
import { parseExpenseInput as parseWithCategories } from "../src/domain/parseExpenseInput";

const parseExpenseInput = (input: string) => parseWithCategories(input, categories, "RSD");

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

test("rejects former synonyms and incomplete or extended category names", () => {
  for (const name of ["кафе", "снеки", "продуктыExtra"])
    assert.equal(parseExpenseInput(`700 ${name} комментарий`).kind, "invalid", name);
});

test("rejects zero, fractional, unsafe, negative and unknown-category expenses", () => {
  for (const input of ["0", "12.5 продукты", "100 неизвестно", "0 продукты", "9007199254740992 продукты", "-100 продукты"])
    assert.equal(parseExpenseInput(input).kind, "invalid", input);
});

test("parses hyphenated mixed-case names and preserves unrestricted comment text", () => {
  const activeCategories = [{ id: "u_aaaaaaaaaaaa", name: "Ёлка-School 2026" }];
  const comment = "Café ſport 🎒";
  assert.deepEqual(parseWithCategories(`2 490 ЁЛКА-school 2026 ${comment}`, activeCategories, "RSD"), {
    kind: "expense", amountRsd: 2490, categoryId: activeCategories[0]!.id, comment
  });
});

test("rejects unsupported characters in expense category names", () => {
  const activeCategories = [{ id: "u_aaaaaaaaaaaa", name: "Ёжик" }, { id: "u_bbbbbbbbbbbb", name: "Sport" }];
  for (const name of ["Е\u0308жик", "ſport"])
    assert.equal(parseWithCategories(`500 ${name}`, activeCategories, "RSD").kind, "invalid", name);
});

test("dynamic names use case-insensitive longest whole-name matching", () => {
  const activeCategories = [{ id: "u_aaaaaaaaaaaa", name: "Дети" }, { id: "u_bbbbbbbbbbbb", name: "Дети школа" },
    { id: "u_cccccccccccc", name: "2026 Отпуск" }, { id: "u_dddddddddddd", name: "Cafe" }];
  assert.deepEqual(parseWithCategories("500 ДЕТИ   ШКОЛА Книги", activeCategories, "RSD"), {
    kind: "expense", amountRsd: 500, categoryId: activeCategories[1]!.id, comment: "Книги"
  });
  assert.deepEqual(parseWithCategories("2 490 2026 отпуск", activeCategories, "RSD"), {
    kind: "expense", amountRsd: 2490, categoryId: activeCategories[2]!.id
  });
  assert.deepEqual(parseWithCategories("500 CAFE Кофе", activeCategories, "RSD"), {
    kind: "expense", amountRsd: 500, categoryId: activeCategories[3]!.id, comment: "Кофе"
  });
  assert.equal(parseWithCategories("500 детиExtra", activeCategories, "RSD").kind, "invalid");
});

test("invalid full-text amounts report the configured currency", () => {
  const displayCurrency = "EUR";
  const activeCategories = [{ id: "groceries", name: "Продукты" }];
  assert.deepEqual(parseWithCategories("0 продукты", activeCategories, displayCurrency), {
    kind: "invalid", message: `Сумма должна быть целым положительным числом в ${displayCurrency}.`
  });
});
