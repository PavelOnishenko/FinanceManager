import { createSettings } from "../../infrastructure/createSettings";
import assert from "node:assert/strict";
import test from "node:test";
import { createMigratedLocalD1 } from "../../../scripts/createLocalD1";
import { D1FinanceRepository } from "../../../src/storage/D1FinanceRepository";
import { expectRepositorySuccess } from "../../infrastructure/repositoryAssertions";
import { manageCategories, type CategoryCommand } from "../../../src/application/categoryApplication";
import { createExpenseAfterCategorySelection, editExpense, processExpenseMessage } from "../../../src/application/financeApplication";

test("unknown and disabled members cannot read or change categories", async context => {
  const database = await createMigratedLocalD1("category-access");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  const disabledUserId = "124";
  const unknownUserId = "125";
  const categoryId = "groceries";
  const initialName = "Продукты";
  const rejectedName = "Питание";
  await database.DB.prepare("INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, 0)").bind(disabledUserId, "Анна").execute();
  const commands: CategoryCommand[] = [
    { kind: "list", active: true }, { kind: "list", active: false }, { kind: "details", categoryId }, { kind: "add", name: rejectedName },
    { kind: "rename", categoryId, name: rejectedName }, { kind: "active", categoryId, active: false }, { kind: "active", categoryId, active: true }
  ];
  for (const telegramUserId of [disabledUserId, unknownUserId])
    for (const command of commands)
      assert.deepEqual(await manageCategories(repository, telegramUserId, command), { kind: "access-denied", telegramUserId });
  assert.equal((await repository.getCategory(categoryId))?.name, initialName);
  assert.equal((await repository.getCategory(categoryId))?.active, true);
  assert.equal((await repository.getCategories()).length, 19);
});

test("application uses current names and stable IDs after rename and archive", async context => {
  const database = await createMigratedLocalD1("stable-category-buttons");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  const memberId = "126";
  const categoryId = "groceries";
  const initialName = "Продукты";
  const renamedName = "Питание";
  const currentTime = new Date("2026-10-12T10:00:00Z");
  const sourceUpdateId = 9100;
  const amountRsd = 700;
  await database.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(memberId, "Анна").execute();
  assert.equal((await repository.getCategory(categoryId))?.name, initialName);
  expectRepositorySuccess(await repository.renameCategory(categoryId, renamedName));
  const saved = await createExpenseAfterCategorySelection(repository, {
    telegramUserId: memberId, sourceUpdateId, amountRsd, categoryId, currentTime
  }, createSettings());
  assert(saved.kind === "expense-saved");
  assert.equal(saved.expense.categoryId, categoryId);
  assert.equal(saved.expense.categoryName, renamedName);
  assert.equal((await processExpenseMessage(repository, {
    telegramUserId: memberId, sourceUpdateId: 9101, text: `200 ${initialName}`, currentTime
  }, createSettings())).kind, "invalid-input");
  assert.equal((await processExpenseMessage(repository, {
    telegramUserId: memberId, sourceUpdateId: 9102, text: `200 ${renamedName}`, currentTime
  }, createSettings())).kind, "expense-saved");
  expectRepositorySuccess(await repository.setCategoryActive(categoryId, false));
  assert.equal((await createExpenseAfterCategorySelection(repository, {
    telegramUserId: memberId, sourceUpdateId: 9103, amountRsd, categoryId, currentTime
  }, createSettings())).kind, "invalid-input");
  assert.equal((await editExpense(repository, memberId, saved.expense.id, { field: "category", categoryId }, "RSD")).kind, "invalid-input");
  await editExpense(repository, memberId, saved.expense.id, { field: "category", categoryId: "other" }, "RSD");
  assert.equal((await repository.getExpenseById(saved.expense.id))?.categoryId, "other");
});

test("archiving between application validation and SQL returns a refusal without creating or moving an expense", async context => {
  const database = await createMigratedLocalD1("category-result-race");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  const memberId = "127";
  const initialCategoryId = "other";
  const requestedCategoryId = "groceries";
  const amountRsd = 500;
  const sourceUpdateId = 9200;
  const currentTime = new Date("2026-10-12T10:00:00Z");
  await database.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(memberId, "Анна").execute();
  const saved = expectRepositorySuccess(await repository.createExpense({
    sourceActionKey: "expense:9199", amountRsd, categoryId: initialCategoryId, spentOn: "2026-10-12", createdBy: memberId
  }));
  // Another member can archive the category between validation and the write.
  const readCategory = repository.getCategory.bind(repository);
  context.mock.method(repository, "getCategory", async (categoryId: string) => {
    const category = await readCategory(categoryId);
    expectRepositorySuccess(await repository.setCategoryActive(categoryId, false));
    return category;
  });
  assert.equal((await createExpenseAfterCategorySelection(repository, {
    telegramUserId: memberId, sourceUpdateId, amountRsd, categoryId: requestedCategoryId, currentTime
  }, createSettings())).kind, "invalid-input");
  expectRepositorySuccess(await repository.setCategoryActive(requestedCategoryId, true));
  assert.equal((await editExpense(repository, memberId, saved.expense.id, { field: "category", categoryId: requestedCategoryId }, "RSD")).kind, "invalid-input");
  assert.equal((await repository.getRecentExpenses()).length, 1);
  assert.equal((await repository.getExpenseById(saved.expense.id))?.categoryId, initialCategoryId);
});
