import assert from "node:assert/strict";
import test from "node:test";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";
import { expectRepositorySuccess } from "./repositoryAssertions";
import type { SqlDatabase } from "../src/storage/SqlDatabase";

test("category lifecycle preserves expenses, totals and reserved names", async context => {
  const database = await createMigratedLocalD1("category-lifecycle");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  const memberId = "123";
  const initialName = "Дети-School 2026";
  const renamedName = "Образование";
  const amountRsd = 800;
  await database.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(memberId, "Анна").execute();
  const category = expectRepositorySuccess(await repository.addCategory(initialName));
  assert.match(category.id, /^u_[A-Za-z0-9_-]{12}$/);
  const saved = expectRepositorySuccess(await repository.createExpense({
    sourceActionKey: "category-test", amountRsd, categoryId: category.id, spentOn: "2026-10-12", createdBy: memberId
  }));
  expectRepositorySuccess(await repository.renameCategory(category.id, renamedName));
  assert.equal((await repository.getExpenseById(saved.expense.id))?.categoryName, renamedName);
  expectRepositorySuccess(await repository.setCategoryActive(category.id, false));
  assert.equal((await repository.getCategories()).some(item => item.id === category.id), false);
  assert.deepEqual(await repository.addCategory("  ОБРАЗОВАНИЕ  "), { kind: "category-name-taken" });
  assert.deepEqual(await repository.createExpense({
    sourceActionKey: "stale-category", amountRsd, categoryId: category.id, spentOn: "2026-10-12", createdBy: memberId
  }), { kind: "category-unavailable" });
  assert.equal((await repository.getStatistics("2026-10-01", "2026-10-31")).totalRsd, amountRsd);
  expectRepositorySuccess(await repository.setCategoryActive(category.id, true));
  assert.equal((await repository.getCategories()).find(item => item.id === category.id)?.name, renamedName);
});

test("simultaneous normalized category names cannot create duplicates", async context => {
  const database = await createMigratedLocalD1("category-duplicates");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  // Two family members can submit equivalent names before either sees the other's category.
  const results = await Promise.all([repository.addCategory("Детский сад"), repository.addCategory("  ДЕТСКИЙ   САД  ")]);
  assert.equal(results.filter(result => result.kind === "success").length, 1);
  assert.equal(results.filter(result => result.kind === "category-name-taken").length, 1);
  assert.equal((await repository.getCategories()).filter(category => category.name === "Детский сад").length, 1);
  const other = expectRepositorySuccess(await repository.addCategory("Образование"));
  assert.deepEqual(await repository.renameCategory(other.id, "ДЕТСКИЙ САД"), { kind: "category-name-taken" });
  assert.equal((await repository.getCategory(other.id))?.name, "Образование");
});

test("expected category failures are explicit results and do not mutate stored names", async context => {
  const database = await createMigratedLocalD1("category-result-failures");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  const categoryId = "groceries";
  const initialName = "Продукты";
  const invalidCategoryId = "invalid:id";
  const missingCategoryId = "u_aaaaaaaaaaaa";
  assert.deepEqual(await repository.addCategory("Школа!"), { kind: "invalid-category-name", reason: "invalid-format" });
  assert.deepEqual(await repository.renameCategory(categoryId, "!"), { kind: "invalid-category-name", reason: "invalid-format" });
  assert.deepEqual(await repository.renameCategory(invalidCategoryId, "Питание"), { kind: "invalid-category-id" });
  assert.deepEqual(await repository.setCategoryActive(invalidCategoryId, false), { kind: "invalid-category-id" });
  assert.deepEqual(await repository.renameCategory(missingCategoryId, "Питание"), { kind: "category-not-found" });
  assert.deepEqual(await repository.setCategoryActive(missingCategoryId, false), { kind: "category-not-found" });
  assert.deepEqual(await repository.updateExpenseCategory(123, categoryId), { kind: "expense-not-found" });
  assert.equal((await repository.getCategory(categoryId))?.name, initialName);
});

test("technical database failures remain exceptions in category storage", async context => {
  const technicalError = new Error("D1_ERROR: database unavailable");
  const database: SqlDatabase = {
    prepare: () => ({ bind() { return this; }, one: async () => null, many: async () => [], execute: async () => { throw technicalError; } }),
    withPrimarySession() { return this; }
  };
  const repository = new D1FinanceRepository(database);
  await assert.rejects(repository.addCategory("Школа"), error => error === technicalError);
  await assert.rejects(repository.renameCategory("groceries", "Питание"), error => error === technicalError);
  await assert.rejects(repository.createExpense({
    sourceActionKey: "expense:9300", amountRsd: 500, categoryId: "groceries", spentOn: "2026-10-12", createdBy: "128"
  }), error => error === technicalError);
});
