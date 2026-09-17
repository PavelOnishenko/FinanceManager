import assert from "node:assert/strict";
import test from "node:test";
import { assertPlainCategoryText } from "../src/config/categories";

test("rejects special characters in category names and aliases", () => {
  assert.throws(() => assertPlainCategoryText("интернет+ТВ", "Alias"));
  assert.throws(() => assertPlainCategoryText("дети (школа)", "Category"));
});

