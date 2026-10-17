import assert from "node:assert/strict";
import test from "node:test";
import { createWebhookUser, createWorkerScenario } from "../../infrastructure/worker/workerScenario";
import { createWorkerFixture } from "../../infrastructure/worker/workerFixture";

test("missing settings make health unhealthy and block expense writes", async context => {
  const secret = "settings-secret";
  const userId = 101;
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  const { data } = fixture;
  await data.removeSettings();
  await data.seedMember(userId, "Анна");
  const health = await fixture.worker.fetch("http://local/health");
  assert.equal(health.status, 503);
  assert.match(JSON.stringify(await health.json()), /instance_settings/);
  const user = createWebhookUser(fixture, userId, 9001, secret);
  const response = await user.sendMessage("200 продукты");
  assert.equal(response.status, 503);
  assert.deepEqual(await data.expenses(), []);
});

test("a currency change affects the next request without rewriting existing expenses", async context => {
  const secret = "settings-change-secret";
  const botId = 9001;
  const userId = 101;
  const initialCurrency = "EUR";
  const nextCurrency = "USD";
  const amountRsd = 620;
  const fixture = await createWorkerFixture("123:fixture", secret, botId);
  context.after(() => fixture.dispose());
  const { data } = fixture;
  await data.setFinanceSettings(initialCurrency, "Europe/Belgrade");
  await data.seedMember(userId, "Анна");
  await data.seedExpense({
    sourceActionKey: "expense:122",
    amountRsd,
    categoryId: "groceries",
    spentOn: "2026-01-05",
    createdBy: String(userId),
    createdAt: "2026-01-05T08:00:00.000Z",
    updatedAt: "2026-01-06T08:00:00.000Z"
  });
  const before = await data.expenses();
  const user = createWorkerScenario(fixture, userId, botId, secret);
  // d:<expense ID> — inspect the persisted expense before changing the currency.
  await user.pressButton("d:1");
  assert.match(user.text(), new RegExp(`${amountRsd} ${initialCurrency}`));
  await data.setDisplayCurrency(nextCurrency);
  // d:<expense ID> — reopen #1; the next request must see the changed setting.
  await user.pressButton("d:1");
  assert.match(user.text(), new RegExp(`${amountRsd} ${nextCurrency}`));
  assert.deepEqual(await data.expenses(), before);
});

test("help, categories and explicit empty history remain available before settings are migrated", async context => {
  const secret = "selective-secret";
  const userId = 101;
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  const { data } = fixture;
  await data.dropSettingsTable();
  await data.seedMember(userId, "Анна");
  const user = createWorkerScenario(fixture, userId, 9001, secret);
  // These menu actions do not need finance settings, even before the settings table exists.
  await user.sendMessage("Помощь");
  assert.match(user.text(), /Отправьте расход/);
  await user.sendMessage("Категории");
  assert.match(user.text(), /Категории/);
  await user.sendMessage("История");
  assert.match(user.text(), /Расходов пока нет/);
  // k:<destination>:<YYYYMM>:<start or 0> — an explicitly dated history calendar needs no settings.
  await user.pressButton("k:history:202601:0");
  assert.match(user.text(), /Выберите начало периода/);
  // h:<YYYYMM> — January history also needs no current-month lookup.
  await user.pressButton("h:202601");
  assert.match(user.text(), /За выбранный период расходов нет/);
  // hr — return to recent history.
  await user.pressButton("hr");
  assert.match(user.text(), /Расходов пока нет/);
});

test("opening history at the current month requires instance settings", async context => {
  const secret = "selective-secret";
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  const { data } = fixture;
  await data.dropSettingsTable();
  await data.seedMember(101, "Анна");
  const user = createWebhookUser(fixture, 101, 9001, secret);

  // hi — the history picker needs settings to determine the family's current month.
  assert.equal((await user.pressButton("hi")).status, 503);
});

test("missing settings block category-selection and edit callbacks without changing expenses", async context => {
  const secret = "selective-secret";
  const userId = 101;
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  const { data } = fixture;
  await data.removeSettings();
  await data.seedMember(userId, "Анна");
  await data.seedExpense({
    sourceActionKey: "expense:150",
    amountRsd: 350,
    categoryId: "groceries",
    spentOn: "2026-02-17",
    createdBy: String(userId),
    createdAt: "2026-02-17T08:00:00Z",
    updatedAt: "2026-02-17T08:00:00Z"
  });
  const before = await data.expenses();
  const user = createWebhookUser(fixture, userId, 9001, secret);
  // c1:<source update ID>:<amount>:<category ID> — try to save 200 in groceries.
  // e1:<expense ID>:<category ID> — try to change existing expense #1 to other.
  for (const callbackData of ["c1:151:200:groceries", "e1:1:other"]) {
    const response = await user.pressButton(callbackData);
    assert.equal(response.status, 503, callbackData);
    assert.match(JSON.stringify(await response.json()), /instance_settings/);
    assert.deepEqual(await data.expenses(), before);
  }
});
