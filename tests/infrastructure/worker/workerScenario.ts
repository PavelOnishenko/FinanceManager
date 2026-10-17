import assert from "node:assert/strict";
import type { Update } from "grammy/types";
import { createTelegramDriver } from "../telegram/telegramDriver";
import { createTelegramOutput, type TelegramApiCall } from "../telegram/telegramOutput";
import type { createWorkerFixture } from "./workerFixture";

type WorkerFixture = Awaited<ReturnType<typeof createWorkerFixture>>;
type ExpenseRow = Awaited<ReturnType<WorkerFixture["data"]["expenses"]>>[number];

// Raw responses remain available when the HTTP rejection itself is under test.
export function createWebhookUser(fixture: WorkerFixture, userId: number, botId: number, secret: string) {
  return createTelegramDriver(userId, { id: botId, is_bot: true, first_name: "Test bot" }, update => fixture.webhook(update, secret));
}

export function createWorkerScenario(fixture: WorkerFixture, userId: number, botId: number, secret: string) {
  let calls: TelegramApiCall[] = [];
  const dispatch = async (update: Update) => {
    const response = await fixture.webhook(update, secret);
    assert.equal(response.status, 200, `Webhook rejected update ${update.update_id}: ${await response.text()}`);
    calls = await fixture.calls();
  };
  const output = createTelegramOutput(() => calls);
  const driver = createTelegramDriver(userId, { id: botId, is_bot: true, first_name: "Test bot" }, dispatch);
  const expenses = fixture.data.expenses;
  const expectExpense = async (id: number, expected: Partial<ExpenseRow>) => {
    const expense = (await expenses()).find(expense => expense.id === id);
    assert(expense, `Expected expense #${id} to exist`);
    for (const key of Object.keys(expected) as (keyof ExpenseRow)[])
      assert.deepEqual(expense[key], expected[key], `Expense #${id}: ${key}`);
  };
  return {
    ...driver,
    ...output,
    expenses,
    expectExpense,
    pressButtonNamed: (text: string) => driver.pressButton(output.button(text).callback_data),
    expectExpenseCount: async (count: number) => assert.equal((await expenses()).length, count),
    seedMember: fixture.data.seedMember
  };
}
