import assert from "node:assert/strict";
import test from "node:test";
import type { Update } from "grammy/types";
import { createTelegramUpdates } from "./telegramUpdates";
import { createWorkerFixture } from "./workerFixture";

type ExpenseRow = { id: number; amount_rsd: number; category_id: string; spent_on: string; comment: string | null };

test("local webhook smoke covers authentication, expenses, editing, deletion and statistics", async context => {
  const userId = 101;
  const botId = 9001;
  const token = "123:fixture";
  const secret = "local-smoke-secret";
  const fixture = await createWorkerFixture(token, secret, botId);
  context.after(() => fixture.dispose());
  const { DB, worker, calls, lastCall, webhook } = fixture;
  const updates = createTelegramUpdates(userId);
  const rows = async () => await DB.prepare("SELECT id, amount_rsd, category_id, spent_on, comment FROM expenses ORDER BY id").many<ExpenseRow>();
  const message = (updateId: number, text: string, replyText?: string) => updates.message(updateId, text, {
    replyTo: replyText ? updates.replyTarget(replyText, { ...updates.user, id: botId, is_bot: true }) : undefined
  });
  const { callback } = updates;
  const accepted = async (update: Update) => assert.equal((await webhook(update, secret)).status, 200);

  assert.deepEqual(await (await worker.fetch("http://smoke.local/health")).json(), { status: "ok", service: "family-finance-bot" });
  assert.equal((await webhook(message(390, "2490 продукты Lidl"))).status, 401);
  assert.equal((await webhook(message(391, "2490 продукты Lidl"), "wrong-secret")).status, 401);
  assert.equal((await calls()).length, 0);
  assert.equal((await rows()).length, 0);

  await accepted(message(392, "2490 продукты Lidl"));
  assert.match(String((await lastCall("sendMessage"))?.payload.text), /Нет доступа.*101/);
  await DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(String(userId), "Тестовый участник").execute();

  await accepted(message(400, "2490 продукты Lidl"));
  assert.equal((await rows()).length, 1);
  assert.equal((await rows())[0]?.amount_rsd, 2490);
  assert.equal((await rows())[0]?.category_id, "groceries");
  assert.equal((await rows())[0]?.comment, "Lidl");
  await accepted(message(401, "700"));
  const categoryButtons = (await lastCall("sendMessage"))?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
  await accepted(callback(402, categoryButtons.inline_keyboard[0]![0]!.callback_data));
  await accepted(callback(403, categoryButtons.inline_keyboard[1]![0]!.callback_data));
  assert.equal((await rows()).length, 2);
  assert.equal((await rows())[1]?.amount_rsd, 700);
  assert.equal((await rows())[1]?.category_id, "groceries");
  assert.equal((await lastCall("answerCallbackQuery"))?.payload.text, "Расход уже сохранён");

  await DB.prepare("UPDATE expenses SET spent_on = ? WHERE id = ?").bind("2026-01-10", 1).execute();
  await DB.prepare("UPDATE expenses SET spent_on = ? WHERE id = ?").bind("2026-01-11", 2).execute();

  await accepted(message(404, "История"));
  assert.match(String((await lastCall("sendMessage"))?.payload.text), /Последние 10 расходов/);
  await accepted(callback(405, "d:1"));
  assert.match(String((await lastCall("sendMessage"))?.payload.text), /#1 · 2490 RSD/);

  await accepted(callback(406, "p:1:0"));
  await accepted(message(407, "3000", String((await lastCall("sendMessage"))?.payload.text)));
  assert.equal((await rows())[0]?.amount_rsd, 3000);
  await accepted(callback(408, "p:1:1"));
  await accepted(message(409, "15.02.2026", String((await lastCall("sendMessage"))?.payload.text)));
  assert.equal((await rows())[0]?.spent_on, "2026-02-15");
  await accepted(callback(410, "p:1:2"));
  await accepted(message(411, "Покупка", String((await lastCall("sendMessage"))?.payload.text)));
  assert.equal((await rows())[0]?.comment, "Покупка");
  await accepted(callback(412, "e1:1:health"));
  assert.equal((await rows())[0]?.category_id, "health");

  await accepted(callback(413, "p:2:1"));
  await accepted(message(414, "28.02.2026", String((await lastCall("sendMessage"))?.payload.text)));
  await accepted(callback(415, "s:202602"));
  assert.match(String((await lastCall("editMessageText"))?.payload.text),
    /Итого: 3700 RSD\nЗдоровье: 3000 RSD \(81,1%\)\nПродукты: 700 RSD \(18,9%\)/);
  await accepted(callback(416, "t:202602:0:15"));
  await accepted(callback(417, "t:202602:20260215:28"));
  assert.match(String((await lastCall("editMessageText"))?.payload.text), /2026-02-15 — 2026-02-28\nИтого: 3700 RSD/);

  await accepted(callback(418, "r:2"));
  assert.match(String((await lastCall("sendMessage"))?.payload.text), /Удалить расход #2/);
  assert.equal((await rows()).length, 2);
  await accepted(callback(419, "x:2"));
  assert.equal((await rows()).length, 1);
  await accepted(callback(420, "s:202602"));
  assert.match(String((await lastCall("editMessageText"))?.payload.text), /Итого: 3000 RSD/);
});
