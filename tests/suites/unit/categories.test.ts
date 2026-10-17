import assert from "node:assert/strict";
import test from "node:test";
import { validateCategoryName } from "../../../src/config/categories";

test("accepts Russian and English letters, ASCII digits, spaces and hyphens", () => {
  const name = "Ёжик-ёжик ABC-xyz 0123456789";
  assert.deepEqual(validateCategoryName(name), { kind: "valid-category-name", name, nameKey: "ёжик-ёжик abc-xyz 0123456789" });
});

test("preserves display case and normalizes spaces and case for uniqueness", () => {
  const input = "  Дети   School-2026  ";
  const name = "Дети School-2026";
  const nameKey = "дети school-2026";
  assert.deepEqual(validateCategoryName(input), { kind: "valid-category-name", name, nameKey });
});

test("rejects characters outside the strict category alphabet before normalization", () => {
  const invalidNames = [
    "Café", "cafe\u0301", "ſport", "Kлуб", "Σχολή", "Школа і", "Школа １", "Школа ²", "Школа—сад", "Школа–сад", "Школа_сад",
    "Школа\u00a0сад", "Школа\tсад", "Школа\nсад", "Школа\n", "Школа\r", "е\u0308жик", "Школа 🎒", "интернет+ТВ", "дети (школа)"
  ];
  for (const name of invalidNames)
    assert.deepEqual(validateCategoryName(name), { kind: "invalid-category-name", reason: "invalid-format" }, JSON.stringify(name));
});

test("keeps name length and required letter constraints", () => {
  const maximumName = "Я".repeat(80);
  assert.deepEqual(validateCategoryName(maximumName), { kind: "valid-category-name", name: maximumName, nameKey: maximumName.toLowerCase() });
  for (const name of ["", "   ", "Я".repeat(81)])
    assert.deepEqual(validateCategoryName(name), { kind: "invalid-category-name", reason: "invalid-format" });
  for (const name of ["123", "---", "123 - 456"])
    assert.deepEqual(validateCategoryName(name), { kind: "invalid-category-name", reason: "missing-letter" });
});

