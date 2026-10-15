import { createSettings } from "./createSettings";
import { readInstanceSettings } from "../src/config/instanceSettings";
import { expectRepositorySuccess } from "./repositoryAssertions";
import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "./defaultCategories";
import {
  ApplicationResultKind, checkAccess, createExpenseAfterCategorySelection, deleteExpense, editExpense, getExpenseDetails, getExpenseHistory,
  getPreviousMonthStatistics, getStatisticsForRange, processExpenseMessage
} from "../src/application/financeApplication";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";
import type { SqlDatabase } from "../src/storage/SqlDatabase";

let testDatabaseNumber = 0;

async function createApplicationTestContext() {
  const context = await createMigratedLocalD1(`application-test-${++testDatabaseNumber}`);
  return { ...context, repository: new D1FinanceRepository(context.DB) };
}

async function seedMember(database: SqlDatabase, telegramUserId: string, displayName: string, enabled: number) {
  await database.prepare("INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, ?)")
    .bind(telegramUserId, displayName, enabled).execute();
}

test("checks access against enabled family members", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const enabledUserId = "101";
  const disabledUserId = "102";
  const unknownUserId = "999";
  await seedMember(context.DB, enabledUserId, "Анна", 1);
  await seedMember(context.DB, disabledUserId, "Борис", 0);
  assert.deepEqual(await checkAccess(context.repository, enabledUserId), {
    kind: ApplicationResultKind.AccessAllowed, member: { telegramUserId: enabledUserId, displayName: "Анна" }
  });
  assert.deepEqual(await checkAccess(context.repository, disabledUserId), { kind: ApplicationResultKind.AccessDenied, telegramUserId: disabledUserId });
  assert.deepEqual(await checkAccess(context.repository, unknownUserId), { kind: ApplicationResultKind.AccessDenied, telegramUserId: unknownUserId });
});

test("creates a full-message expense using the configured local date", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const telegramUserId = "201";
  const sourceUpdateId = 4100;
  const currentTime = new Date("2026-03-01T00:30:00Z");
  await seedMember(context.DB, telegramUserId, "Анна", 1);
  const result = await processExpenseMessage(context.repository, {
    telegramUserId, sourceUpdateId, text: "2490 продукты Lidl", currentTime
  }, createSettings({ financeTimeZone: "America/New_York" }));
  assert(result.kind === ApplicationResultKind.ExpenseSaved);
  assert.equal(result.created, true);
  assert.equal(result.expense.sourceActionKey, `expense:${sourceUpdateId}`);
  assert.equal(result.expense.amountRsd, 2490);
  assert.equal(result.expense.categoryId, "groceries");
  assert.equal(result.expense.comment, "Lidl");
  assert.equal(result.expense.spentOn, "2026-02-28");
  assert.equal(result.expense.createdBy, telegramUserId);
});

test("prepares every category after an amount-only message without creating a draft", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const telegramUserId = "301";
  const sourceUpdateId = 5100;
  const amountRsd = 2490;
  await seedMember(context.DB, telegramUserId, "Анна", 1);
  const result = await processExpenseMessage(context.repository, {
    telegramUserId, sourceUpdateId, text: amountRsd.toString(), currentTime: new Date("2026-09-18T10:00:00.000Z")
  }, createSettings());
  assert.deepEqual(result, {
    kind: ApplicationResultKind.CategorySelection, sourceUpdateId, amountRsd,
    categories: categories.map(({ id, name }) => ({ id, name }))
  });
  assert.deepEqual(await context.repository.getRecentExpenses(), []);
});

test("creates only one expense when category selection is delivered twice", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const telegramUserId = "401";
  const sourceUpdateId = 6100;
  const amountRsd = 700;
  const currentTime = new Date("2026-09-18T10:00:00.000Z");
  await seedMember(context.DB, telegramUserId, "Анна", 1);
  const first = await createExpenseAfterCategorySelection(context.repository, {
    telegramUserId, sourceUpdateId, amountRsd, categoryId: "transport", currentTime
  }, createSettings());
  const duplicate = await createExpenseAfterCategorySelection(context.repository, {
    telegramUserId, sourceUpdateId, amountRsd, categoryId: "groceries", currentTime
  }, createSettings());
  assert(first.kind === ApplicationResultKind.ExpenseSaved);
  assert(duplicate.kind === ApplicationResultKind.ExpenseSaved);
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.expense.id, first.expense.id);
  assert.equal(duplicate.expense.categoryId, "transport");
  assert.equal((await context.repository.getRecentExpenses()).length, 1);
});

test("returns shared history and expense details to another enabled member", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const authorId = "501";
  const viewerId = "502";
  await seedMember(context.DB, authorId, "Анна", 1);
  await seedMember(context.DB, viewerId, "Борис", 1);
  const saved = await processExpenseMessage(context.repository, {
    telegramUserId: authorId, sourceUpdateId: 7100, text: "800 рестораны Ужин", currentTime: new Date("2026-09-18T10:00:00.000Z")
  }, createSettings());
  assert(saved.kind === ApplicationResultKind.ExpenseSaved);
  const history = await getExpenseHistory(context.repository, viewerId);
  const details = await getExpenseDetails(context.repository, viewerId, saved.expense.id);
  assert(history.kind === ApplicationResultKind.ExpenseHistory);
  assert.deepEqual(history.expenses.map(expense => expense.id), [saved.expense.id]);
  assert.deepEqual(details, { kind: ApplicationResultKind.ExpenseDetails, expense: saved.expense });
});

test("another enabled member can edit and delete a shared expense", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const authorId = "601";
  const editorId = "602";
  await seedMember(context.DB, authorId, "Анна", 1);
  await seedMember(context.DB, editorId, "Борис", 1);
  const saved = await processExpenseMessage(context.repository, {
    telegramUserId: authorId, sourceUpdateId: 8100, text: "1200 продукты Старое", currentTime: new Date("2026-09-18T10:00:00.000Z")
  }, createSettings());
  assert(saved.kind === ApplicationResultKind.ExpenseSaved);
  const expenseId = saved.expense.id;
  const edited = await editExpense(context.repository, editorId, expenseId, { field: "amount", amountRsd: 2400 }, "RSD");
  assert(edited.kind === ApplicationResultKind.ExpenseUpdated);
  assert.equal(edited.expense.amountRsd, 2400);
  assert.equal(edited.expense.createdBy, authorId);
  assert.equal(edited.expense.sourceActionKey, "expense:8100");
  assert.deepEqual(await deleteExpense(context.repository, editorId, expenseId), { kind: ApplicationResultKind.ExpenseDeleted, expenseId });
  assert.deepEqual(await getExpenseDetails(context.repository, authorId, expenseId), { kind: ApplicationResultKind.ExpenseNotFound, expenseId });
});

test("rejects impossible and reversed statistics date ranges", async testContext => {
  const context = await createApplicationTestContext();
  testContext.after(() => context.dispose());
  const telegramUserId = "801";
  await seedMember(context.DB, telegramUserId, "Анна", 1);
  assert.equal((await getStatisticsForRange(context.repository, telegramUserId,
    { fromDate: "2026-09-31", toDate: "2026-10-01" })).kind, ApplicationResultKind.InvalidInput);
  assert.equal((await getStatisticsForRange(context.repository, telegramUserId,
    { fromDate: "2026-09-12", toDate: "2026-09-10" })).kind, ApplicationResultKind.InvalidInput);
});

test("category selection uses the configured local date", async context => {
  const telegramUserId = "zone-member";
  const database = await createApplicationTestContext();
  context.after(() => database.dispose());
  await seedMember(database.DB, telegramUserId, "Анна", 1);
  const result = await createExpenseAfterCategorySelection(database.repository, {
    telegramUserId, sourceUpdateId: 9900, amountRsd: 2490, categoryId: "groceries", currentTime: new Date("2026-03-01T00:30:00Z")
  }, createSettings({ financeTimeZone: "America/New_York" }));
  assert(result.kind === ApplicationResultKind.ExpenseSaved);
  assert.equal(result.expense.spentOn, "2026-02-28");
});

test("configured previous-month statistics use local boundaries", async context => {
  const memberId = "zone-statistics";
  const financeTimeZone = "America/New_York";
  const amountRsd = 370;
  const spentOn = "2026-01-31";
  const database = await createApplicationTestContext();
  context.after(() => database.dispose());
  await seedMember(database.DB, memberId, "Анна", 1);
  expectRepositorySuccess(await database.repository.createExpense({
    sourceActionKey: "expense:9901", amountRsd, categoryId: "groceries", spentOn, createdBy: memberId
  }));
  const result = await getPreviousMonthStatistics(database.repository, memberId, new Date("2026-03-01T00:30:00Z"), financeTimeZone);
  assert(result.kind === ApplicationResultKind.ExpenseStatistics);
  assert.deepEqual(result.range, { fromDate: "2026-01-01", toDate: spentOn });
  assert.equal(result.statistics.totalRsd, amountRsd);
});

test("a timezone change dates future expenses without changing historical rows", async context => {
  const memberId = "zone-change";
  const currentTime = new Date("2026-03-01T00:30:00Z");
  const amountRsd = 470;
  const database = await createApplicationTestContext();
  context.after(() => database.dispose());
  await seedMember(database.DB, memberId, "Анна", 1);
  await database.DB.prepare("UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1").bind("EUR", "Europe/Belgrade").execute();
  const initial = await processExpenseMessage(database.repository, {
    telegramUserId: memberId, sourceUpdateId: 9800, text: `${amountRsd} продукты`, currentTime
  }, await readInstanceSettings(database.DB));
  assert(initial.kind === ApplicationResultKind.ExpenseSaved);
  assert.equal(initial.expense.spentOn, "2026-03-01");
  await database.DB.prepare("UPDATE instance_settings SET finance_time_zone = ? WHERE id = 1").bind("America/New_York").execute();
  const next = await processExpenseMessage(database.repository, {
    telegramUserId: memberId, sourceUpdateId: 9801, text: `${amountRsd} продукты`, currentTime
  }, await readInstanceSettings(database.DB));
  assert(next.kind === ApplicationResultKind.ExpenseSaved);
  assert.equal(next.expense.spentOn, "2026-02-28");
  assert.equal(next.expense.amountRsd, amountRsd);
  assert.deepEqual(await database.repository.getExpenseById(initial.expense.id), initial.expense);
});
