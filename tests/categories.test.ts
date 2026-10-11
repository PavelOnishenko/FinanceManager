import assert from "node:assert/strict";
import test from "node:test";
import { assertPlainCategoryText } from "../src/config/categories";

test("rejects special characters in category names", () => {
  assert.throws(() => assertPlainCategoryText("интернет+ТВ", "Category"));
  assert.throws(() => assertPlainCategoryText("дети (школа)", "Category"));
});

