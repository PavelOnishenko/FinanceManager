import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import type { Update } from "grammy/types";
import { CloudflareD1Database, type CloudflareD1Binding } from "../src/storage/CloudflareD1Database";

type ApiCall = { method: string; payload: Record<string, unknown> };
type ExpenseRow = { id: number; amount_rsd: number; category_id: string; spent_on: string; comment: string | null };

test("local webhook smoke covers authentication, expenses, editing, deletion and statistics", async () => {
  const userId = 101;
  const botId = 9001;
  const token = "123:fixture";
  const secret = "local-smoke-secret";
  const chat = { id: userId, type: "private" as const, first_name: "Test user" };
  const user = { id: userId, is_bot: false, first_name: "Test user" };
  const bundled = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser"] });
  const mockApi = await readFile(new URL("./mockTelegramApiWorker.js", import.meta.url), "utf8");
  const miniflare = new Miniflare({ workers: [
    { config: {
      name: "finance-smoke", type: "worker", compatibilityDate: "2026-09-16",
      env: { DB: { type: "d1" }, TELEGRAM_BOT_TOKEN: { type: "text", value: token }, TELEGRAM_WEBHOOK_SECRET: { type: "text", value: secret } },
      manifest: { mainModule: "index.js", modulesRoot: process.cwd(), modules: { "index.js": { type: "esm", contents: bundled.outputFiles[0]!.text } } }
    }, dev: { outboundService: { type: "worker", worker: "telegram-mock" } } },
    { config: {
      name: "telegram-mock", type: "worker", compatibilityDate: "2026-09-16",
      env: { BOT_ID: { type: "text", value: String(botId) }, BOT_TOKEN: { type: "text", value: token } },
      manifest: { mainModule: "mock.js", modulesRoot: process.cwd(), modules: { "mock.js": { type: "esm", contents: mockApi } } }
    } }
  ] });

  try {
    const DB = new CloudflareD1Database((await miniflare.getBindings<{ DB: CloudflareD1Binding }>("finance-smoke")).DB);
    const migration = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
    for (const statement of migration.split(";").map(part => part.trim()).filter(Boolean))
      await DB.prepare(statement).execute();

    const worker = await miniflare.getWorker("finance-smoke");
    const mock = await miniflare.getWorker("telegram-mock");
    const calls = async () => await (await mock.fetch("http://mock.local/calls")).json() as ApiCall[];
    const lastCall = async (method: string) => (await calls()).filter(call => call.method === method).at(-1);
    const rows = async () => await DB.prepare("SELECT id, amount_rsd, category_id, spent_on, comment FROM expenses ORDER BY id").many<ExpenseRow>();
    const message = (updateId: number, text: string, replyText?: string): Update => ({ update_id: updateId, message: {
      message_id: updateId, date: 0, chat, from: user, text, ...(replyText ? { reply_to_message: {
        message_id: 20, date: 0, chat, from: { ...user, id: botId, is_bot: true }, text: replyText, reply_to_message: undefined
      } } : {})
    } });
    const callback = (updateId: number, data: string): Update => ({ update_id: updateId, callback_query: {
      id: String(updateId), from: user, chat_instance: "fixture", data, message: { message_id: 20, date: 0, chat }
    } });
    const webhook = async (update: Update, header?: string) => await worker.fetch("http://smoke.local/telegram", {
      method: "POST", headers: header ? { "X-Telegram-Bot-Api-Secret-Token": header } : {}, body: JSON.stringify(update)
    });
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
    assert((await calls()).some(call => call.method === "getMe"));
    assert.equal((await rows()).length, 1);
    assert.equal((await rows())[0]?.amount_rsd, 2490);
    assert.equal((await rows())[0]?.category_id, "groceries");
    assert.equal((await rows())[0]?.comment, "Lidl");
    await accepted(message(401, "700"));
    const categoryButtons = (await lastCall("sendMessage"))?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    assert.equal(categoryButtons.inline_keyboard.length, 15);
    await accepted(callback(402, categoryButtons.inline_keyboard[0]![0]!.callback_data));
    await accepted(callback(403, categoryButtons.inline_keyboard[1]![0]!.callback_data));
    assert.equal((await rows()).length, 2);
    assert.equal((await rows())[1]?.amount_rsd, 700);
    assert.equal((await rows())[1]?.category_id, "groceries");
    assert.equal((await lastCall("answerCallbackQuery"))?.payload.text, "Расход уже сохранён");

    await DB.prepare("UPDATE expenses SET spent_on = ? WHERE id = ?").bind("2026-01-10", 1).execute();
    await DB.prepare("UPDATE expenses SET spent_on = ? WHERE id = ?").bind("2026-01-11", 2).execute();
    assert.deepEqual((await rows()).map(row => row.spent_on), ["2026-01-10", "2026-01-11"]);

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
    await accepted(callback(412, "e:1:8"));
    assert.equal((await rows())[0]?.category_id, "health");

    await accepted(callback(413, "p:2:1"));
    await accepted(message(414, "28.02.2026", String((await lastCall("sendMessage"))?.payload.text)));
    await accepted(callback(415, "s:202602"));
    assert.match(String((await lastCall("editMessageText"))?.payload.text), /Итого: 3700 RSD\nЗдоровье: 3000 RSD\nПродукты: 700 RSD/);
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
  } finally {
    await miniflare.dispose();
  }
});
