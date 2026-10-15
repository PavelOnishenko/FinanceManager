import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramUpdates } from "./telegramUpdates";
import { createWorkerFixture } from "./workerFixture";

test("missing settings make health unhealthy and block expense writes", async context => {
  const secret = "settings-secret";
  const userId = 101;
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  await fixture.DB.prepare("DELETE FROM instance_settings").execute();
  await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
  const health = await fixture.worker.fetch("http://local/health");
  assert.equal(health.status, 503);
  assert.match(JSON.stringify(await health.json()), /instance_settings/);
  const response = await fixture.webhook(createTelegramUpdates(userId).message(120, "200 продукты"), secret);
  assert.equal(response.status, 503);
  assert.deepEqual(await fixture.DB.prepare("SELECT * FROM expenses").many(), []);
});

test("a currency change affects the next request without rewriting existing expenses", async context => {
  const token = "123:fixture";
  const secret = "settings-change-secret";
  const botId = 9001;
  const userId = 101;
  const initialCurrency = "EUR";
  const nextCurrency = "USD";
  const initialZone = "Europe/Belgrade";
  const amountRsd = 620;
  const spentOn = "2026-01-05";
  const sourceActionKey = "expense:122";
  const createdAt = "2026-01-05T08:00:00.000Z";
  const updatedAt = "2026-01-06T08:00:00.000Z";
  const fixture = await createWorkerFixture(token, secret, botId);
  context.after(() => fixture.dispose());
  await fixture.DB.prepare("UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1").bind(initialCurrency, initialZone).execute();
  await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
  await fixture.DB.prepare(`INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, created_by, created_at, updated_at)
    VALUES (?, ?, 'groceries', ?, ?, ?, ?)`).bind(sourceActionKey, amountRsd, spentOn, String(userId), createdAt, updatedAt).execute();
  const before = await fixture.DB.prepare("SELECT * FROM expenses").many();
  const details = async (updateId: number) => {
    const response = await fixture.webhook(createTelegramUpdates(userId).callback(updateId, "d:1"), secret);
    assert.equal(response.status, 200);
    return (await fixture.lastCall("sendMessage"))?.payload.text;
  };
  assert.match(String(await details(123)), new RegExp(`${amountRsd} ${initialCurrency}`));
  await fixture.DB.prepare("UPDATE instance_settings SET display_currency = ? WHERE id = 1")
    .bind(nextCurrency).execute();
  assert.match(String(await details(124)), new RegExp(`${amountRsd} ${nextCurrency}`));
  assert.deepEqual(await fixture.DB.prepare("SELECT * FROM expenses").many(), before);
});

test("help and categories remain available before settings are migrated", async context => {
  const secret = "selective-secret";
  const userId = 101;
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  await fixture.DB.prepare("DROP TABLE instance_settings").execute();
  await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
  for (const [updateId, text, expected] of [[150, "Помощь", /Отправьте расход/], [151, "Категории", /Категории/]] as const) {
    assert.equal((await fixture.webhook(createTelegramUpdates(userId).message(updateId, text), secret)).status, 200, text);
    assert.match(String((await fixture.lastCall("sendMessage"))?.payload.text), expected);
  }
});

test("missing settings block category-selection and edit callbacks without changing expenses", async context => {
  const secret = "selective-secret";
  const userId = 101;
  const fixture = await createWorkerFixture("123:fixture", secret, 9001);
  context.after(() => fixture.dispose());
  await fixture.DB.prepare("DELETE FROM instance_settings").execute();
  await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
  await fixture.DB.prepare(`INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, created_by, created_at, updated_at)
    VALUES ('expense:150', 350, 'groceries', '2026-02-17', ?, '2026-02-17T08:00:00Z', '2026-02-17T08:00:00Z')`).bind(String(userId)).execute();
  const before = await fixture.DB.prepare("SELECT * FROM expenses").many();
  for (const [updateId, data] of [[151, "c1:151:200:groceries"], [152, "e1:1:other"]] as const) {
    const response = await fixture.webhook(createTelegramUpdates(userId).callback(updateId, data), secret);
    assert.equal(response.status, 503, data);
    assert.match(JSON.stringify(await response.json()), /instance_settings/);
    assert.deepEqual(await fixture.DB.prepare("SELECT * FROM expenses").many(), before);
  }
});
