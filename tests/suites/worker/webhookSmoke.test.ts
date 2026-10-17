import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramUpdates } from "../../infrastructure/telegram/telegramUpdates";
import { createWorkerFixture } from "../../infrastructure/worker/workerFixture";
import { createWorkerScenario } from "../../infrastructure/worker/workerScenario";

test("local webhook rejects invalid secrets and unknown members, then accepts a newly enabled member", async context => {
  const userId = 101;
  const secret = "local-smoke-secret";
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  const user = createWorkerScenario(fixture, userId, 9001, secret);
  const update = createTelegramUpdates(userId).message(390, "2490 продукты Lidl");

  assert.deepEqual(await (await fixture.worker.fetch("http://smoke.local/health")).json(), { status: "ok", service: "family-finance-bot" });

  // Invalid webhook credentials must be rejected before contacting Telegram or writing to D1.
  assert.equal((await fixture.webhook(update)).status, 401);
  assert.equal((await fixture.webhook(update, "wrong-secret")).status, 401);
  assert.deepEqual(await fixture.calls(), []);
  await user.expectExpenseCount(0);

  // A valid webhook secret does not grant an unregistered user access to the family.
  await user.sendMessage("2490 продукты Lidl");
  assert.match(user.text(), /Нет доступа.*101/);
  await user.expectExpenseCount(0);

  // Enabling the member takes effect on the next webhook request.
  await user.seedMember(userId, "Тестовый участник");
  await user.sendMessage("2490 продукты Lidl");
  await user.expectExpenseCount(1);
  await user.expectExpense(1, { amount_rsd: 2490, category_id: "groceries", comment: "Lidl" });
});

test("local webhook saves expenses once and applies edits, period selection and confirmed deletion", async context => {
  const userId = 101;
  const botId = 9001;
  const secret = "local-smoke-secret";
  const fixture = await createWorkerFixture("123:fixture", secret, botId);
  context.after(() => fixture.dispose());
  const user = createWorkerScenario(fixture, userId, botId, secret);
  await user.seedMember(userId, "Тестовый участник");

  // Save a full-text expense, then choose a category for an amount-only expense.
  await user.sendMessage("2490 продукты Lidl");
  await user.expectExpenseCount(1);
  await user.expectExpense(1, { amount_rsd: 2490, category_id: "groceries", comment: "Lidl" });
  await user.sendMessage("700");
  // c1:<source update ID>:<amount>:<category ID> comes from the displayed category picker.
  // Retain both buttons: even tapping a different category on that old picker must not save twice.
  const groceries = user.button("Продукты");
  const transport = user.button("Транспорт");
  await user.pressButton(groceries.callback_data);
  await user.pressButton(transport.callback_data);
  await user.expectExpenseCount(2);
  await user.expectExpense(2, { amount_rsd: 700, category_id: "groceries" });
  user.expectAcknowledgement("Расход уже сохранён");

  // Pin dates before testing edits and statistics, independently of the current day.
  await fixture.data.setExpenseDate(1, "2026-01-10");
  await fixture.data.setExpenseDate(2, "2026-01-11");

  // Open history, browse a month and a custom range, then inspect expense #1.
  await user.sendMessage("История");
  assert.match(user.text(), /Последние 10 расходов/);
  // h:<YYYYMM> — January history.
  await user.pressButton("h:202601");
  assert.match(user.text(), /Расходы: 2026-01-01 — 2026-01-31/);
  // t:<destination>:<YYYYMM>:<start YYYYMMDD>:<day> — history from January 11 through February 15.
  await user.pressButton("t:history:202602:20260111:15");
  assert.match(user.text(), /Расходы: 2026-01-11 — 2026-02-15/);
  // d:<expense ID> — inspect expense #1.
  await user.pressButton("d:1");
  assert.match(user.text(), /#1 · 2490 RSD/);

  // p:<expense ID>:<field index> asks for a ForceReply: 0 = amount, 1 = date, 2 = comment.
  await user.pressButton("p:1:0");
  await user.replyToPrompt("3000", user.text());
  await user.expectExpense(1, { amount_rsd: 3000 });
  // p:1:1 — change the date of expense #1.
  await user.pressButton("p:1:1");
  await user.replyToPrompt("15.02.2026", user.text());
  await user.expectExpense(1, { spent_on: "2026-02-15" });
  // p:1:2 — change the comment of expense #1.
  await user.pressButton("p:1:2");
  await user.replyToPrompt("Покупка", user.text());
  await user.expectExpense(1, { comment: "Покупка" });
  // e1:<expense ID>:<stable category ID> — move #1 to health.
  await user.pressButton("e1:1:health");
  await user.expectExpense(1, { category_id: "health" });

  // p:2:1 — move the second expense into February as well.
  await user.pressButton("p:2:1");
  await user.replyToPrompt("28.02.2026", user.text());
  // s:<YYYYMM> — view February statistics after both dates have changed.
  await user.pressButton("s:202602");
  assert.match(user.text(), /Итого: 3700 RSD\nЗдоровье: 3000 RSD \(81,1%\)\nПродукты: 700 RSD \(18,9%\)/);

  // t:<destination>:<YYYYMM>:<start YYYYMMDD or 0>:<day> — choose February 15, then February 28.
  await user.pressButton("t:statistics:202602:0:15");
  await user.pressButton("t:statistics:202602:20260215:28");
  assert.match(user.text(), /2026-02-15 — 2026-02-28\nИтого: 3700 RSD/);

  // r:<expense ID> requests deletion; x:<expense ID> confirms it. The request alone preserves both rows.
  await user.pressButton("r:2");
  assert.match(user.text(), /Удалить расход #2/);
  await user.expectExpenseCount(2);
  await user.pressButton("x:2");
  await user.expectExpenseCount(1);
  // s:<YYYYMM> — refresh February statistics after deleting expense #2.
  await user.pressButton("s:202602");
  assert.match(user.text(), /Итого: 3000 RSD/);
});
