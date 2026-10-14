import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerFixture } from "./workerFixture";

for (const setting of ["missing", "display_currency", "finance_time_zone"]) {
  test(`invalid ${setting} makes health unhealthy and blocks expense writes`, async context => {
    const token = "123:fixture";
    const secret = "settings-secret";
    const userId = 101;
    const fixture = await createWorkerFixture(token, secret, 9001);
    context.after(() => fixture.dispose());
    if (setting !== "missing") {
      const displayCurrency = setting === "display_currency" ? "INVALID" : "EUR";
      const financeTimeZone = setting === "finance_time_zone" ? "Invalid/Zone" : "UTC";
      await fixture.DB.prepare("INSERT INTO instance_settings VALUES (1, ?, ?)").bind(displayCurrency, financeTimeZone).execute();
    }
    await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
    const health = await fixture.worker.fetch("http://local/health");
    assert.equal(health.status, 503);
    assert.match(JSON.stringify(await health.json()), new RegExp(setting === "missing" ? "instance_settings" : setting));
    const response = await fixture.worker.fetch("http://local/telegram", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify({
        update_id: 120, message: { message_id: 120, date: 0, from: { id: userId, is_bot: false, first_name: "Anna" },
          chat: { id: userId, type: "private" }, text: "200 продукты" }
      })
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await fixture.DB.prepare("SELECT * FROM expenses").many(), []);
    assert.deepEqual((await (await fixture.mock.fetch("http://mock.local/calls")).json() as { method: string }[]).map(call => call.method), ["getMe"]);
  });
}

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
  await fixture.DB.prepare("INSERT INTO instance_settings VALUES (1, ?, ?)").bind(initialCurrency, initialZone).execute();
  await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
  await fixture.DB.prepare(`INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, created_by, created_at, updated_at)
    VALUES (?, ?, 'groceries', ?, ?, ?, ?)`).bind(sourceActionKey, amountRsd, spentOn, String(userId), createdAt, updatedAt).execute();
  const before = await fixture.DB.prepare("SELECT * FROM expenses").many();
  const details = async (updateId: number) => {
    const response = await fixture.worker.fetch("http://local/telegram", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify({ update_id: updateId, callback_query: {
        id: String(updateId), from: { id: userId, is_bot: false, first_name: "Anna" }, chat_instance: "fixture", data: "d:1",
        message: { message_id: 20, date: 0, chat: { id: userId, type: "private" } }
      } })
    });
    assert.equal(response.status, 200);
    return (await (await fixture.mock.fetch("http://mock.local/calls")).json() as { method: string; payload: { text?: string } }[])
      .findLast(call => call.method === "sendMessage")?.payload.text;
  };
  assert.match(String(await details(123)), new RegExp(`${amountRsd} ${initialCurrency}`));
  await fixture.DB.prepare("UPDATE instance_settings SET display_currency = ? WHERE id = 1")
    .bind(nextCurrency).execute();
  assert.match(String(await details(124)), new RegExp(`${amountRsd} ${nextCurrency}`));
  assert.deepEqual(await fixture.DB.prepare("SELECT * FROM expenses").many(), before);
});

for (const route of ["/unknown", "/telegram"]) {
  test(`${route} rejects an unrelated or unauthorized request without settings`, async context => {
    const secret = "selective-secret";
    const fixture = await createWorkerFixture("123:fixture", secret, 9001);
    context.after(() => fixture.dispose());
    await fixture.DB.prepare("DROP TABLE instance_settings").execute();
    const response = await fixture.worker.fetch(`http://local${route}`, {
      method: route === "/telegram" ? "POST" : "GET", body: route === "/telegram" ? "{}" : undefined
    });
    assert.equal(response.status, route === "/telegram" ? 401 : 404);
    assert.deepEqual(await (await fixture.mock.fetch("http://mock.local/calls")).json(), []);
  });
}

for (const text of ["Помощь", "Категории"]) {
  test(`${text} works when the settings table is absent`, async context => {
    const secret = "selective-secret";
    const userId = 101;
    const fixture = await createWorkerFixture("123:fixture", secret, 9001);
    context.after(() => fixture.dispose());
    await fixture.DB.prepare("DROP TABLE instance_settings").execute();
    await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
    const response = await fixture.worker.fetch("http://local/telegram", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify({
        update_id: 150, message: { message_id: 150, date: 0, from: { id: userId, is_bot: false, first_name: "Anna" },
          chat: { id: userId, type: "private" }, text }
      })
    });
    assert.equal(response.status, 200);
    assert((await (await fixture.mock.fetch("http://mock.local/calls")).json() as { method: string }[])
      .some(call => call.method === "sendMessage"));
  });
}

for (const data of ["c1:151:200:groceries", "e1:1:other"]) {
  test(`${data} returns a configuration failure before changing expenses`, async context => {
    const secret = "selective-secret";
    const userId = 101;
    const fixture = await createWorkerFixture("123:fixture", secret, 9001);
    context.after(() => fixture.dispose());
    await fixture.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Анна").execute();
    await fixture.DB.prepare(`INSERT INTO expenses (source_action_key, amount_rsd, category_id, spent_on, created_by, created_at, updated_at)
      VALUES ('expense:150', 350, 'groceries', '2026-02-17', ?, '2026-02-17T08:00:00Z', '2026-02-17T08:00:00Z')`).bind(String(userId)).execute();
    const before = await fixture.DB.prepare("SELECT * FROM expenses").many();
    const response = await fixture.worker.fetch("http://local/telegram", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify({ update_id: 151, callback_query: {
        id: "151", from: { id: userId, is_bot: false, first_name: "Anna" }, chat_instance: "fixture", data,
        message: { message_id: 20, date: 0, chat: { id: userId, type: "private" } }
      } })
    });
    assert.equal(response.status, 503);
    assert.match(JSON.stringify(await response.json()), /instance_settings/);
    assert.deepEqual(await fixture.DB.prepare("SELECT * FROM expenses").many(), before);
  });
}
