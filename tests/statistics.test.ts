import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpenseStatistics } from "../src/domain/statistics";

test("calculates total and category totals in descending order", () => {
  const result = calculateExpenseStatistics([
    { amountRsd: 1000, categoryId: "groceries" },
    { amountRsd: 400, categoryId: "transport" },
    { amountRsd: 700, categoryId: "groceries" }
  ]);

  assert.deepEqual(result, {
    totalRsd: 2100,
    categoryTotals: [
      { categoryId: "groceries", amountRsd: 1700 },
      { categoryId: "transport", amountRsd: 400 }
    ]
  });
});

