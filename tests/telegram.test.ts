import assert from "node:assert/strict";
import test from "node:test";
import type { Chat, Message, Update, User, UserFromGetMe } from "grammy/types";
import { categories } from "../src/config/categories";
import { formatCallbackData, parseCallbackData, type BotAction } from "../src/telegram/callbackData";
import { createFinanceBot } from "../src/telegram/bot";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";
import type { SqlDatabase } from "../src/storage/SqlDatabase";
import { hasValidWebhookSecret } from "../src/telegram/webhookSecret";

type ReplyTarget = NonNullable<Message["reply_to_message"]>;
let telegramFixtureNumber = 0;

function createTestBotInfo(botId: number): UserFromGetMe {
  return {
    id: botId, is_bot: true, first_name: "Test", username: "test_bot", can_join_groups: false, can_read_all_group_messages: false,
    supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false,
    allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false
  };
}

async function addMember(database: SqlDatabase, userId: number, displayName: string, enabled: number) {
  await database.prepare("INSERT INTO members (telegram_user_id, display_name, enabled) VALUES (?, ?, ?)")
    .bind(String(userId), displayName, enabled).execute();
}

async function createTelegramFixture(userId: number, botId: number) {
  const database = await createMigratedLocalD1(`telegram-scenario-${++telegramFixtureNumber}`);
  const repository = new D1FinanceRepository(database.DB);
  const chat: Chat.PrivateChat = { id: userId, type: "private", first_name: "Test user" };
  const user: User = { id: userId, is_bot: false, first_name: "Test user" };
  const botInfo = createTestBotInfo(botId);
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const bot = createFinanceBot("123:fixture", repository);
  bot.botInfo = botInfo;
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "sendMessage" ? { message_id: 20, date: 0, chat } : true } as never;
  });
  const replyTarget = (text: string, from: User): ReplyTarget => ({ message_id: 20, date: 0, chat, from, text, reply_to_message: undefined });
  const message = (updateId: number, text: string, replyTo?: ReplyTarget): Update => ({
    update_id: updateId, message: { message_id: updateId, date: 0, chat, from: user, text, ...(replyTo ? { reply_to_message: replyTo } : {}) }
  });
  const command = (updateId: number, text: string): Update => ({
    update_id: updateId, message: { message_id: updateId, date: 0, chat, from: user, text,
      entities: [{ type: "bot_command", offset: 0, length: text.length }] }
  });
  const callback = (updateId: number, data: string): Update => ({
    update_id: updateId, callback_query: { id: String(updateId), from: user, chat_instance: "fixture", data, message: { message_id: 20, date: 0, chat } }
  });
  return { database, repository, bot, botInfo, calls, chat, user, message, command, callback, replyTarget };
}

test("callback actions round-trip within Telegram's 64-byte limit", () => {
  const actions: BotAction[] = [
    { kind: "calendar-noop" },
    { kind: "create", sourceUpdateId: 9007199254740991, amountRsd: 9007199254740991, categoryId: "personal-care" },
    { kind: "details", expenseId: 23 }, { kind: "delete-request", expenseId: 23 }, { kind: "delete-confirm", expenseId: 23 },
    { kind: "edit-prompt", expenseId: 23, field: "comment" }, { kind: "edit-category", expenseId: 23, categoryId: "groceries" },
    { kind: "statistics-month", month: "2026-02" }, { kind: "calendar", month: "2026-03", startDate: "2026-02-28" },
    { kind: "calendar-day", month: "2026-03", day: 1, startDate: "2026-02-28" }
  ];
  for (const action of actions) {
    const data = formatCallbackData(action);
    assert.deepEqual(parseCallbackData(data), action);
    assert(new TextEncoder().encode(data).length <= 64);
  }
});

test("rejects a create callback with a zero source update ID", () => {
  assert.equal(parseCallbackData("c:0:2490:0"), undefined);
});

test("rejects a create callback with a category index outside the category list", () => {
  assert.equal(parseCallbackData(`c:41:2490:${categories.length}`), undefined);
});

test("rejects a details callback with an extra field", () => {
  assert.equal(parseCallbackData("d:1:extra"), undefined);
});

test("rejects invalid calendar callback dates and months", () => {
  assert.equal(parseCallbackData("s:202613"), undefined);
  assert.equal(parseCallbackData("k:202602:20260229"), undefined);
  assert.equal(parseCallbackData("t:202602:0:30"), undefined);
  assert.equal(parseCallbackData("t:202602:0:0"), undefined);
  assert.equal(parseCallbackData("s:202602:extra"), undefined);
  assert.deepEqual(parseCallbackData("s:202512"), { kind: "statistics-year-too-old" });
  assert.deepEqual(parseCallbackData("k:000001:0"), { kind: "statistics-year-too-old" });
  assert.deepEqual(parseCallbackData("t:202601:20251231:1"), { kind: "statistics-year-too-old" });
});

test("January 2026 has no previous-month button and old buttons explain the limit", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.callback(710, formatCallbackData({ kind: "statistics-month", month: "2026-01" })));
  const buttons = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { callback_data: string }[][]
  }).inline_keyboard;
  assert.deepEqual(buttons.flat().map(button => parseCallbackData(button.callback_data)), [
    { kind: "statistics-month", month: "2026-02" }, { kind: "calendar", month: "2026-01" }
  ]);
  await fixture.bot.handleUpdate(fixture.callback(711, "s:202512"));
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
  assert.equal(fixture.calls.at(-1)?.payload.text, "Статистика доступна с 2026 года. Откройте её заново.");
  assert.equal(fixture.calls.filter(call => call.method === "editMessageText").length, 1);
});

test("monthly statistics includes boundary dates and lists family categories by total", async context => {
  const userId = 127;
  const otherUserId = 128;
  const month = "2026-02";
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await addMember(fixture.database.DB, otherUserId, "Борис", 1);
  await fixture.repository.createExpense({ sourceActionKey: "before", amountRsd: 900, categoryId: "other", spentOn: "2026-01-31", createdBy: String(userId) });
  await fixture.repository.createExpense({ sourceActionKey: "start", amountRsd: 1000, categoryId: "groceries", spentOn: "2026-02-01", createdBy: String(userId) });
  await fixture.repository.createExpense({ sourceActionKey: "middle", amountRsd: 1500, categoryId: "transport", spentOn: "2026-02-15", createdBy: String(otherUserId) });
  await fixture.repository.createExpense({ sourceActionKey: "end", amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(otherUserId) });
  await fixture.repository.createExpense({ sourceActionKey: "after", amountRsd: 9000, categoryId: "other", spentOn: "2026-03-01", createdBy: String(userId) });

  await fixture.bot.handleUpdate(fixture.callback(700, formatCallbackData({ kind: "statistics-month", month })));
  const report = String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text);
  assert.match(report, /2026-02-01 — 2026-02-28\nИтого: 4500 RSD\nПродукты: 3000 RSD\nТранспорт: 1500 RSD/);
  const reportButtons = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { callback_data: string }[][]
  }).inline_keyboard;
  assert.deepEqual(reportButtons.flat().map(button => parseCallbackData(button.callback_data)), [
    { kind: "statistics-month", month: "2026-01" }, { kind: "statistics-month", month: "2026-03" }, { kind: "calendar", month }
  ]);
});

test("calendar placeholder acknowledges a tap without editing the message", async context => {
  const userId = 127;
  const month = "2026-02";
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.callback(701, formatCallbackData({ kind: "calendar", month })));
  const calendarButtons = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data: string }[][]
  }).inline_keyboard;
  const placeholder = calendarButtons.flat().find(button => button.text === "·");
  assert(placeholder);
  assert.deepEqual(parseCallbackData(placeholder.callback_data), { kind: "calendar-noop" });
  assert(calendarButtons.flat().some(button => parseCallbackData(button.callback_data)?.kind === "calendar-day"));
  await fixture.bot.handleUpdate(fixture.callback(706, placeholder.callback_data));
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.filter(call => call.method === "editMessageText").length, 1);
});

test("calendar rejects an end date before the selected start", async context => {
  const userId = 127;
  const month = "2026-02";
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.callback(701, formatCallbackData({ kind: "calendar", month })));
  await fixture.bot.handleUpdate(fixture.callback(702, formatCallbackData({ kind: "calendar-day", month, day: 15 })));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Начало: 2026-02-15/);
  await fixture.bot.handleUpdate(fixture.callback(703, formatCallbackData({ kind: "calendar-day", month, day: 14, startDate: "2026-02-15" })));
  assert.equal(fixture.calls.filter(call => call.method === "editMessageText").length, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Конец периода не может быть раньше начала/);
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("calendar keeps the start date across months and includes both range boundaries", async context => {
  const userId = 127;
  const otherUserId = 128;
  const startDate = "2026-02-15";
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await addMember(fixture.database.DB, otherUserId, "Борис", 1);
  await fixture.repository.createExpense({ sourceActionKey: "before", amountRsd: 1000, categoryId: "other", spentOn: "2026-02-14", createdBy: String(userId) });
  await fixture.repository.createExpense({ sourceActionKey: "start", amountRsd: 1500, categoryId: "transport", spentOn: startDate, createdBy: String(otherUserId) });
  await fixture.repository.createExpense({ sourceActionKey: "middle", amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(userId) });
  await fixture.repository.createExpense({ sourceActionKey: "end", amountRsd: 9000, categoryId: "other", spentOn: "2026-03-01", createdBy: String(otherUserId) });
  await fixture.repository.createExpense({ sourceActionKey: "after", amountRsd: 3000, categoryId: "other", spentOn: "2026-03-02", createdBy: String(userId) });

  await fixture.bot.handleUpdate(fixture.callback(701, formatCallbackData({ kind: "calendar", month: "2026-02" })));
  await fixture.bot.handleUpdate(fixture.callback(702, formatCallbackData({ kind: "calendar-day", month: "2026-02", day: 15 })));
  const nextMonthButton = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data: string }[][]
  }).inline_keyboard[0]?.find(button => button.text === "▶");
  assert(nextMonthButton);
  assert.deepEqual(parseCallbackData(nextMonthButton.callback_data), { kind: "calendar", month: "2026-03", startDate });
  await fixture.bot.handleUpdate(fixture.callback(704, nextMonthButton.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Начало: 2026-02-15/);
  const firstDayButton = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data: string }[][]
  }).inline_keyboard.flat().find(button => button.text === "1");
  assert(firstDayButton);
  assert.deepEqual(parseCallbackData(firstDayButton.callback_data), { kind: "calendar-day", month: "2026-03", day: 1, startDate });
  await fixture.bot.handleUpdate(fixture.callback(705, firstDayButton.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /2026-02-15 — 2026-03-01\nИтого: 12500 RSD/);
  assert.equal(fixture.calls.filter(call => call.method === "answerCallbackQuery").length, 4);
});

test("denies an unknown user and welcomes an enabled member", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate(fixture.command(390, "/start"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа. Ваш Telegram ID: 127/);

  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.command(391, "/start"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Добро пожаловать/);
});

test("creates an expense directly from a complete Telegram message", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);

  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal(fixture.calls.at(-1)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Сохранено: #1 · 2490 RSD/);
  assert.equal((await fixture.repository.getExpenseById(1))?.comment, "Lidl");
});

test("offers one category per row and saves only once after repeated taps", async context => {
  const userId = 127;
  const sourceUpdateId = 400;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);

  await fixture.bot.handleUpdate(fixture.message(sourceUpdateId, "2490"));
  const buttons = (fixture.calls.at(-1)?.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
  assert.equal(buttons.length, categories.length);
  assert(buttons.every(row => row.length === 1));
  assert.deepEqual(await fixture.repository.getRecentExpenses(), []);
  assert.deepEqual(parseCallbackData(buttons[0]![0]!.callback_data), {
    kind: "create", sourceUpdateId, amountRsd: 2490, categoryId: "groceries"
  });

  await fixture.bot.handleUpdate(fixture.callback(401, buttons[0]![0]!.callback_data));
  await fixture.bot.handleUpdate(fixture.callback(402, buttons[1]![0]!.callback_data));
  assert.equal((await fixture.repository.getRecentExpenses()).length, 1);
  assert(fixture.calls.some(call => call.method === "answerCallbackQuery" && call.payload.text === "Расход уже сохранён"));
});

test("menu buttons return help and previous-month statistics", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);

  await fixture.bot.handleUpdate(fixture.message(416, "Помощь"));
  assert.equal(fixture.calls.at(-1)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /^Отправьте расход:/);
  await fixture.bot.handleUpdate(fixture.message(417, "Статистика"));
  assert.equal(fixture.calls.at(-1)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Итого: 0 RSD/);
});

test("history shows one button per recent expense", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  await fixture.bot.handleUpdate(fixture.message(401, "700 транспорт Такси"));

  await fixture.bot.handleUpdate(fixture.message(402, "История"));
  const buttons = (fixture.calls.at(-1)?.payload.reply_markup as { inline_keyboard: unknown[][] }).inline_keyboard;
  assert.equal(buttons.length, 2);
  assert(buttons.every(row => row.length === 1));
});

test("amount edit ignores a forged prompt and accepts the bot's prompt", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "amount" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "3000", fixture.replyTarget(prompt, fixture.user)));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);
  await fixture.bot.handleUpdate(fixture.message(403, "3000", fixture.replyTarget(prompt, fixture.botInfo)));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 3000);
});

test("date edit changes the explicitly seeded original date", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  await fixture.repository.updateExpenseDate(1, "2026-09-17");
  assert.equal((await fixture.repository.getExpenseById(1))?.spentOn, "2026-09-17");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "date" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "18.09.2026", fixture.replyTarget(prompt, fixture.botInfo)));
  assert.equal((await fixture.repository.getExpenseById(1))?.spentOn, "2026-09-18");
});

test("comment edit replaces the original comment", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.comment, "Lidl");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "comment" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "Покупка", fixture.replyTarget(prompt, fixture.botInfo)));
  assert.equal((await fixture.repository.getExpenseById(1))?.comment, "Покупка");
});

test("category callback replaces the original category", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.categoryId, "groceries");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-category", expenseId: 1, categoryId: "health" })));
  assert.equal((await fixture.repository.getExpenseById(1))?.categoryId, "health");
});

test("delete requires a separate confirmation callback", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getRecentExpenses()).length, 1);

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "delete-request", expenseId: 1 })));
  assert.equal((await fixture.repository.getRecentExpenses()).length, 1);
  await fixture.bot.handleUpdate(fixture.callback(402, formatCallbackData({ kind: "delete-confirm", expenseId: 1 })));
  assert.equal((await fixture.repository.getRecentExpenses()).length, 0);
  assert.equal(fixture.calls.filter(call => call.method === "answerCallbackQuery").length, 2);
});

test("smoke: a saved message appears in history and opens its details", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  await fixture.bot.handleUpdate(fixture.message(401, "История"));
  await fixture.bot.handleUpdate(fixture.callback(402, formatCallbackData({ kind: "details", expenseId: 1 })));

  assert.equal(fixture.calls.at(-2)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-2)?.payload.text), /#1 · 2490 RSD · Продукты/);
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
});

test("webhook secret validation rejects missing and mismatching headers", () => {
  const secret = "local-fixture-secret";
  const url = "https://example.test/telegram";
  assert.equal(hasValidWebhookSecret(new Request(url), secret), false);
  assert.equal(hasValidWebhookSecret(new Request(url, { headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" } }), secret), false);
  assert.equal(hasValidWebhookSecret(new Request(url, { headers: { "X-Telegram-Bot-Api-Secret-Token": secret } }), secret), true);
  assert.equal(hasValidWebhookSecret(new Request(url, { headers: { "X-Telegram-Bot-Api-Secret-Token": secret } }), undefined), false);
});

test("group command explains that the bot works in private chat", async context => {
  const fixture = await createTelegramFixture(127, 999);
  context.after(() => fixture.database.dispose());
  const groupChat: Chat.SupergroupChat = { id: -100, type: "supergroup", title: "Семья" };
  await fixture.bot.handleUpdate({ update_id: 500, message: {
    message_id: 500, date: 0, chat: groupChat, from: fixture.user, text: "/start",
    entities: [{ type: "bot_command", offset: 0, length: 6 }]
  } });
  assert.equal(fixture.calls.at(-1)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только в личном чате/);
});

test("group callback shows a private-chat alert", async context => {
  const fixture = await createTelegramFixture(127, 999);
  context.after(() => fixture.database.dispose());
  const groupChat: Chat.SupergroupChat = { id: -100, type: "supergroup", title: "Семья" };
  await fixture.bot.handleUpdate({ update_id: 506, callback_query: {
    id: "506", from: fixture.user, chat_instance: "fixture", data: formatCallbackData({ kind: "details", expenseId: 1 }),
    message: { message_id: 20, date: 0, chat: groupChat }
  } });
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только в личном чате/);
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("message without a sender explains why access cannot be checked", async context => {
  const fixture = await createTelegramFixture(127, 999);
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate({ update_id: 501, message: {
    message_id: 501, date: 0, chat: fixture.chat, text: "2490"
  } } as Update);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Не удалось определить ваш Telegram ID/);
});

test("photo message asks for text instead of remaining silent", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate({ update_id: 502, message: {
    message_id: 502, date: 0, chat: fixture.chat, from: fixture.user,
    photo: [{ file_id: "photo", file_unique_id: "photo", width: 1, height: 1 }]
  } });
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только текстовые сообщения/);
});

test("history reports access revoked between checks", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.message(503, "История"));
  assert.equal(accessChecks, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа.*127/);
});

test("statistics reports access revoked between checks", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.message(504, "Статистика"));
  assert.equal(accessChecks, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа.*127/);
});

test("expense input reports access revoked between checks", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.message(505, "2490"));
  assert.equal(accessChecks, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа.*127/);
});

test("callback reports access revoked between checks in chat and alert", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999);
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.callback(507, formatCallbackData({ kind: "details", expenseId: 1 })));
  assert.equal(accessChecks, 2);
  assert.equal(fixture.calls.at(-2)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-2)?.payload.text), /Нет доступа.*127/);
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("unsupported callback is acknowledged with an explanation", async context => {
  const fixture = await createTelegramFixture(127, 999);
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate({ update_id: 508, callback_query: {
    id: "508", from: fixture.user, chat_instance: "fixture", game_short_name: "unsupported",
    message: { message_id: 20, date: 0, chat: fixture.chat }
  } });
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.at(-1)?.payload.text, "Кнопка не поддерживается");
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("unexpected failures include the update ID without exposing internal details", async context => {
  const userId = 127;
  const botId = 999;
  const updateId = 600;
  const database = await createMigratedLocalD1("telegram-failure-edge-test");
  context.after(() => database.dispose());
  const repository = new D1FinanceRepository(database.DB);
  repository.getEnabledMember = async () => { throw new Error("secret-db-detail"); };
  const bot = createFinanceBot("123:fixture", repository);
  bot.botInfo = createTestBotInfo(botId);
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "sendMessage" ? { message_id: 20, date: 0, chat: { id: userId, type: "private" } } : true } as never;
  });
  const user = { id: userId, is_bot: false, first_name: "Анна" };
  const privateChat = { id: userId, type: "private" as const };
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(bot.handleUpdate({ update_id: updateId, message: {
      message_id: updateId, date: 0, chat: privateChat, from: user, text: "История"
    } } as Update), /secret-db-detail/);
    assert.match(String(calls.at(-1)?.payload.text), /Код: 600/);
    assert.doesNotMatch(String(calls.at(-1)?.payload.text), /secret-db-detail/);

    await bot.handleUpdate({ update_id: 601, callback_query: {
      id: "601", from: user, chat_instance: "fixture", data: formatCallbackData({ kind: "details", expenseId: 1 }),
      message: { message_id: 20, date: 0, chat: privateChat }
    } } as Update);
    assert.equal(calls.at(-1)?.method, "answerCallbackQuery");
    assert.match(String(calls.at(-1)?.payload.text), /Код: 601/);
    assert.equal(calls.at(-1)?.payload.show_alert, true);
    assert(calls.some(call => call.method === "sendMessage" && String(call.payload.text).includes("Код: 601")));
  } finally {
    console.error = previousError;
  }
});
