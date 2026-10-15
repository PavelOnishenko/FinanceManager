import { createTelegramUpdates } from "./telegramUpdates";
import { createSettings } from "./createSettings";
import { InstanceConfigurationError, type InstanceSettings } from "../src/config/instanceSettings";
import { expectRepositorySuccess } from "./repositoryAssertions";
import assert from "node:assert/strict";
import test from "node:test";
import type { UserFromGetMe } from "grammy/types";
import { categories } from "./defaultCategories";
import { formatCallbackData, parseCallbackData } from "../src/telegram/callbackData";
import { createFinanceBot } from "../src/telegram/bot";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";
import type { SqlDatabase } from "../src/storage/SqlDatabase";
import { hasValidWebhookSecret } from "../src/telegram/webhookSecret";

type TelegramApiCall = { method: string; payload: Record<string, unknown> };
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

// todo I would like to have a return type here to understand what we are constructing
async function createTelegramFixture(userId: number, botId: number, settings: InstanceSettings | (() => Promise<InstanceSettings>)) {
  const database = await createMigratedLocalD1(`telegram-scenario-${++telegramFixtureNumber}`);
  const repository = new D1FinanceRepository(database.DB);
  const updates = createTelegramUpdates(userId);
  const botInfo = createTestBotInfo(botId);
  const calls: TelegramApiCall[] = [];
  const bot = createFinanceBot("123:fixture", repository, typeof settings === "function" ? settings : async () => settings);
  bot.botInfo = botInfo;
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "sendMessage" ? { message_id: 20, date: 0, chat: updates.chat } : true } as never;
  });
  return { database, repository, bot, botInfo, calls, ...updates };
}

function assertMenuShown(calls: TelegramApiCall[]) {
  const keyboard = calls.findLast(call => call.method === "sendMessage")?.payload.reply_markup as { keyboard: { text: string }[][] } | undefined;
  assert(keyboard);
  assert.deepEqual(keyboard.keyboard[0]?.map(button => button.text), ["История", "Статистика", "Категории", "Помощь"]);
}

test("January 2026 has no previous-month button and old buttons explain the limit", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
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
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await addMember(fixture.database.DB, otherUserId, "Борис", 1);
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "before", amountRsd: 900, categoryId: "other", spentOn: "2026-01-31", createdBy: String(userId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "start", amountRsd: 1000, categoryId: "groceries", spentOn: "2026-02-01", createdBy: String(userId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "middle", amountRsd: 1500, categoryId: "transport", spentOn: "2026-02-15", createdBy: String(otherUserId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "end", amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(otherUserId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "after", amountRsd: 9000, categoryId: "other", spentOn: "2026-03-01", createdBy: String(userId) }));

  await fixture.bot.handleUpdate(fixture.callback(700, formatCallbackData({ kind: "statistics-month", month })));
  const report = String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text);
  assert.match(report, /2026-02-01 — 2026-02-28\nИтого: 4500 RSD\nПродукты: 3000 RSD \(66,7%\)\nТранспорт: 1500 RSD \(33,3%\)/);
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
  const fixture = await createTelegramFixture(userId, 999, createSettings());
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
  const fixture = await createTelegramFixture(userId, 999, createSettings());
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
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await addMember(fixture.database.DB, otherUserId, "Борис", 1);
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "before", amountRsd: 1000, categoryId: "other", spentOn: "2026-02-14", createdBy: String(userId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "start", amountRsd: 1500, categoryId: "transport", spentOn: startDate, createdBy: String(otherUserId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "middle", amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(userId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "end", amountRsd: 9000, categoryId: "other", spentOn: "2026-03-01", createdBy: String(otherUserId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "after", amountRsd: 3000, categoryId: "other", spentOn: "2026-03-02", createdBy: String(userId) }));

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
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text),
    /2026-02-15 — 2026-03-01\nИтого: 12500 RSD\nДругое: 9000 RSD \(72%\)\nПродукты: 2000 RSD \(16%\)\nТранспорт: 1500 RSD \(12%\)/);
  assert.equal(fixture.calls.filter(call => call.method === "answerCallbackQuery").length, 4);
});

test("denies an unknown user and welcomes an enabled member", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate(fixture.command(390, "/start"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа. Ваш Telegram ID: 127/);

  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.command(391, "/start"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Добро пожаловать/);
});

test("creates an expense directly from a complete Telegram message", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
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
  const fixture = await createTelegramFixture(userId, 999, createSettings());
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
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
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
  const groceriesDate = "2026-09-17";
  const transportDate = "2026-09-18";
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "history-groceries", amountRsd: 2490, categoryId: "groceries", spentOn: groceriesDate, comment: "Lidl", createdBy: String(userId)
  }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "history-transport", amountRsd: 700, categoryId: "transport", spentOn: transportDate, comment: "Такси", createdBy: String(userId)
  }));

  await fixture.bot.handleUpdate(fixture.message(402, "История"));
  const buttons = (fixture.calls.at(-1)?.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
  assert.equal(buttons.length, 2);
  assert(buttons.every(row => row.length === 1));
  assert.deepEqual(buttons.map(row => row[0]?.text), ["#2 · 700 RSD · Транспорт · 18.09.2026", "#1 · 2490 RSD · Продукты · 17.09.2026"]);
});

test("expense details keep categories behind a button and can return from the category list", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "details", expenseId: 1 })));
  const detailButtons = (fixture.calls.findLast(call => call.method === "sendMessage")?.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data: string }[][]
  }).inline_keyboard.flat();
  assert.deepEqual(detailButtons.map(button => button.text), ["Сумма", "Дата", "Комментарий", "Категория", "Удалить"]);

  await fixture.bot.handleUpdate(fixture.callback(402, detailButtons.find(button => button.text === "Категория")!.callback_data));
  const categoryButtons = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data: string }[][]
  }).inline_keyboard;
  assert.deepEqual(categoryButtons.map(row => row[0]!.text), [...categories.map(category => category.name), "Назад"]);
  assert(categoryButtons.every(row => row.length === 1));

  await fixture.bot.handleUpdate(fixture.callback(403, categoryButtons.at(-1)![0]!.callback_data));
  const returnedButtons = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { text: string }[][]
  }).inline_keyboard.flat();
  assert.deepEqual(returnedButtons.map(button => button.text), detailButtons.map(button => button.text));
});

test("amount edit ignores a prompt not sent by the bot", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "amount" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "3000", { replyTo: fixture.replyTarget(prompt, fixture.user) }));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);
  assertMenuShown(fixture.calls);
});

test("amount edit accepts the bot's prompt and restores the menu", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "amount" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "3000", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 3000);
  assertMenuShown(fixture.calls);
});

test("date edit changes the explicitly seeded original date", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  await fixture.repository.updateExpenseDate(1, "2026-09-17");
  assert.equal((await fixture.repository.getExpenseById(1))?.spentOn, "2026-09-17");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "date" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "18.09.2026", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(1))?.spentOn, "2026-09-18");
  assertMenuShown(fixture.calls);
});

test("comment edit replaces the original comment", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.comment, "Lidl");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "comment" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(402, "Покупка", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(1))?.comment, "Покупка");
  assertMenuShown(fixture.calls);
});

test("category callback replaces the original category", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.categoryId, "groceries");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-category", expenseId: 1, categoryId: "health" })));
  assert.equal((await fixture.repository.getExpenseById(1))?.categoryId, "health");
});

test("delete requires a separate confirmation callback", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
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
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
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
  const fixture = await createTelegramFixture(127, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate(fixture.command(500, "/start", { chat: { id: -100, type: "supergroup", title: "Семья" } }));
  assert.equal(fixture.calls.at(-1)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только в личном чате/);
});

test("group callback shows a private-chat alert", async context => {
  const fixture = await createTelegramFixture(127, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate(fixture.callback(506, formatCallbackData({ kind: "details", expenseId: 1 }), {
    chat: { id: -100, type: "supergroup", title: "Семья" }
  }));
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только в личном чате/);
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("message without a sender explains why access cannot be checked", async context => {
  const fixture = await createTelegramFixture(127, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate(fixture.message(501, "2490", { from: undefined }));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Не удалось определить ваш Telegram ID/);
});

test("photo message asks for text instead of remaining silent", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.photo(502));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только текстовые сообщения/);
});

test("history reports access revoked between checks", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.message(503, "История"));
  assert.equal(accessChecks, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа.*127/);
});

test("statistics reports access revoked between checks", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.message(504, "Статистика"));
  assert.equal(accessChecks, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа.*127/);
});

test("expense input reports access revoked between checks", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  let accessChecks = 0;
  fixture.repository.getEnabledMember = async () => ++accessChecks === 1 ? { telegramUserId: String(userId), displayName: "Анна" } : null;
  await fixture.bot.handleUpdate(fixture.message(505, "2490"));
  assert.equal(accessChecks, 2);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Нет доступа.*127/);
});

test("callback reports access revoked between checks in chat and alert", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
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
  const fixture = await createTelegramFixture(127, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.bot.handleUpdate(fixture.gameCallback(508, "unsupported"));
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.at(-1)?.payload.text, "Кнопка не поддерживается");
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("unexpected failures include the update ID without exposing internal details", async context => {
  const userId = 127;
  const botId = 999;
  const updateId = 600;
  const fixture = await createTelegramFixture(userId, botId, createSettings());
  context.after(() => fixture.database.dispose());
  fixture.repository.getEnabledMember = async () => { throw new Error("secret-db-detail"); };
  const { bot, calls } = fixture;
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(bot.handleUpdate(fixture.message(updateId, "История")), /secret-db-detail/);
    assert.match(String(calls.at(-1)?.payload.text), /Код: 600/);
    assert.doesNotMatch(String(calls.at(-1)?.payload.text), /secret-db-detail/);

    await bot.handleUpdate(fixture.callback(601, formatCallbackData({ kind: "details", expenseId: 1 })));
    assert.equal(calls.at(-1)?.method, "answerCallbackQuery");
    assert.match(String(calls.at(-1)?.payload.text), /Код: 601/);
    assert.equal(calls.at(-1)?.payload.show_alert, true);
    assert(calls.some(call => call.method === "sendMessage" && String(call.payload.text).includes("Код: 601")));
  } finally {
    console.error = previousError;
  }
});


test("category addition uses ForceReply and enables both expense entry paths", async context => {
  const userId = 127;
  const categoryName = "Дети-School 2026";
  const textAmountRsd = 800;
  const buttonAmountRsd = 500;
  const comment = "Учебники";
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(800, "Категории"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Категории/);
  await fixture.bot.handleUpdate(fixture.callback(801, "m1:add"));
  const prompt = fixture.calls.findLast(call => call.method === "sendMessage")!.payload;
  assert.equal((prompt.reply_markup as { force_reply: boolean }).force_reply, true);
  await fixture.bot.handleUpdate(fixture.message(802, categoryName, { replyTo: fixture.replyTarget(String(prompt.text), fixture.botInfo) }));
  const category = (await fixture.repository.getCategories()).find(item => item.name === categoryName)!;
  assert(category);
  await fixture.bot.handleUpdate(fixture.message(803, `${textAmountRsd} ${categoryName} ${comment}`));
  const saved = (await fixture.repository.getRecentExpenses())[0]!;
  assert.equal(saved.categoryId, category.id);
  assert.equal(saved.comment, comment);
  await fixture.bot.handleUpdate(fixture.message(804, String(buttonAmountRsd)));
  const buttons = (fixture.calls.at(-1)?.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
  const button = buttons.flat().find(item => item.text === categoryName)!;
  assert.match(button.callback_data, /^c1:/);
  await fixture.bot.handleUpdate(fixture.callback(805, button.callback_data));
  assert.equal((await fixture.repository.getRecentExpenses())[0]?.categoryId, category.id);
  assert.equal((await fixture.repository.getRecentExpenses())[0]?.amountRsd, buttonAmountRsd);
});

test("another member renames a category through ForceReply and updates historical display names", async context => {
  const authorId = 127;
  const editorId = 128;
  const initialName = "Дети-School 2026";
  const renamedName = "Образование";
  const fixture = await createTelegramFixture(editorId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, authorId, "Анна", 1);
  await addMember(fixture.database.DB, editorId, "Борис", 1);
  const category = expectRepositorySuccess(await fixture.repository.addCategory(initialName));
  const saved = expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "before-rename", amountRsd: 800, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(authorId)
  }));
  await fixture.bot.handleUpdate(fixture.callback(810, `m1:rename:${category.id}`));
  const prompt = fixture.calls.findLast(call => call.method === "sendMessage")!.payload;
  assert.equal((prompt.reply_markup as { force_reply: boolean }).force_reply, true);
  assert.match(String(prompt.text), /прошлых расходов/);
  await fixture.bot.handleUpdate(fixture.message(811, renamedName, { replyTo: fixture.replyTarget(String(prompt.text), fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(saved.expense.id))?.categoryName, renamedName);
  assert.equal((await fixture.repository.getCategory(category.id))?.name, renamedName);
  await fixture.bot.handleUpdate(fixture.message(812, `700 ${initialName}`));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Не удалось распознать/);
});

test("category archiving requires confirmation and preserves historical expenses and totals", async context => {
  const userId = 127;
  const categoryName = "Образование";
  const amountRsd = 800;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  const category = expectRepositorySuccess(await fixture.repository.addCategory(categoryName));
  const saved = expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "before-archive", amountRsd, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(userId)
  }));
  await fixture.bot.handleUpdate(fixture.callback(820, `m1:archive:${category.id}`));
  assert.equal((await fixture.repository.getCategory(category.id))?.active, true);
  assert.match(String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text), /Прошлые расходы останутся/);
  await fixture.bot.handleUpdate(fixture.callback(821, `m1:confirm:${category.id}`));
  assert.equal((await fixture.repository.getCategory(category.id))?.active, false);
  assert.equal((await fixture.repository.getRecentExpenses())[0]?.id, saved.expense.id);
  assert.equal((await fixture.repository.getStatistics("2026-10-01", "2026-10-31")).totalRsd, amountRsd);
});

test("archived categories disappear from current expense menus and full-text entry", async context => {
  const userId = 127;
  const categoryName = "Образование";
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  const category = expectRepositorySuccess(await fixture.repository.addCategory(categoryName));
  const saved = expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "existing-archived", amountRsd: 800, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(userId)
  }));
  expectRepositorySuccess(await fixture.repository.setCategoryActive(category.id, false));
  await fixture.bot.handleUpdate(fixture.message(830, "500"));
  const creationMenu = (fixture.calls.at(-1)?.payload.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
  assert(!creationMenu.flat().some(button => button.text === categoryName));
  await fixture.bot.handleUpdate(fixture.callback(831, `l:${saved.expense.id}`));
  const editingMenu = (fixture.calls.findLast(call => call.method === "editMessageText")?.payload.reply_markup as {
    inline_keyboard: { text: string }[][]
  }).inline_keyboard;
  assert(!editingMenu.flat().some(button => button.text === categoryName));
  await fixture.bot.handleUpdate(fixture.message(833, `700 ${categoryName}`));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Не удалось распознать/);
  assert.equal((await fixture.repository.getRecentExpenses()).length, 1);
  assert.equal((await fixture.repository.getExpenseById(saved.expense.id))?.categoryId, category.id);
});

test("an expense in an archived category can still be edited through ForceReply", async context => {
  const userId = 127;
  const initialExpenseDate = "2026-10-01";
  const finalExpenseDate = "2026-10-02";
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  const category = expectRepositorySuccess(await fixture.repository.addCategory("Образование"));
  const saved = expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "edit-archived", amountRsd: 800, categoryId: category.id, spentOn: initialExpenseDate, createdBy: String(userId)
  }));
  expectRepositorySuccess(await fixture.repository.setCategoryActive(category.id, false));
  await fixture.bot.handleUpdate(fixture.callback(840, `p:${saved.expense.id}:1`));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(841, "02.10.2026", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(saved.expense.id))?.spentOn, finalExpenseDate);
});

test("another member restores a category from the archive and enables new expense entry", async context => {
  const authorId = 127;
  const editorId = 128;
  const categoryName = "Образование";
  const originalAmountRsd = 800;
  const newAmountRsd = 500;
  const fixture = await createTelegramFixture(editorId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, authorId, "Анна", 1);
  await addMember(fixture.database.DB, editorId, "Борис", 1);
  const category = expectRepositorySuccess(await fixture.repository.addCategory(categoryName));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "before-restore", amountRsd: originalAmountRsd, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(authorId)
  }));
  expectRepositorySuccess(await fixture.repository.setCategoryActive(category.id, false));
  await fixture.bot.handleUpdate(fixture.callback(861, "m1:archived"));
  assert.match(String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text), /Архив категорий/);
  await fixture.bot.handleUpdate(fixture.callback(862, `m1:details:${category.id}`));
  assert.match(JSON.stringify(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.reply_markup), /Восстановить/);
  await fixture.bot.handleUpdate(fixture.callback(863, `m1:restore:${category.id}`));
  assert.equal((await fixture.repository.getCategory(category.id))?.active, true);
  assert.equal((await fixture.repository.getCategories()).find(item => item.id === category.id)?.name, categoryName);
  await fixture.bot.handleUpdate(fixture.message(864, String(newAmountRsd)));
  const buttons = (fixture.calls.at(-1)?.payload.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
  await fixture.bot.handleUpdate(fixture.callback(865, buttons.flat().find(button => button.text === categoryName)!.callback_data));
  assert.equal((await fixture.repository.getRecentExpenses()).length, 2);
  assert.equal((await fixture.repository.getRecentExpenses())[0]?.categoryName, categoryName);
  assert.equal((await fixture.repository.getStatistics("2026-01-01", "2026-12-31")).totalRsd, originalAmountRsd + newAmountRsd);
});

test("category prompts reject invalid names, duplicates and replies to another sender", async context => {
  const userId = 129;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.callback(850, "m1:add"));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(851, "Новая категория", { replyTo: fixture.replyTarget(prompt, fixture.user) }));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /запрос редактирования/);
  for (const name of ["", "Школа!", "123", "Я".repeat(81), "  ПРОДУКТЫ "])
    await fixture.bot.handleUpdate(fixture.message(852, name, { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getCategories()).length, categories.length);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /уже существует/);
  assertMenuShown(fixture.calls);
});

test("obsolete category buttons explain failure without creating or changing an expense", async context => {
  const userId = 130;
  const amountRsd = 500;
  const categoryId = "groceries";
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(9600, `${amountRsd} продукты`));
  const saved = (await fixture.repository.getRecentExpenses())[0]!;
  for (const [index, data] of ["c:9601:700:0", `e:${saved.id}:1`].entries()) {
    await fixture.bot.handleUpdate(fixture.callback(9602 + index, data));
    assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
    assert.equal(fixture.calls.at(-1)?.payload.text, "Кнопка недействительна");
    assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
    assert.equal(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text, "Кнопка недействительна");
  }
  assert.equal((await fixture.repository.getRecentExpenses()).length, 1);
  assert.equal((await fixture.repository.getExpenseById(saved.id))?.categoryId, categoryId);
  assert.equal((await fixture.repository.getExpenseById(saved.id))?.amountRsd, amountRsd);
});


for (const surface of ["history", "details", "edit-actions", "amount-prompt", "selection", "confirmation", "statistics", "category-update", "edit-error"]) {
  test(`configured currency is displayed in ${surface}`, async context => {
    const userId = 711;
    const displayCurrency = "EUR";
    const amountRsd = 600;
    const spentOn = "2026-02-17";
    const sourceActionKey = "expense:711";
    const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency, financeTimeZone: "America/New_York" }));
    context.after(() => fixture.database.dispose());
    await addMember(fixture.database.DB, userId, "Анна", 1);
    const expense = expectRepositorySuccess(await fixture.repository.createExpense({
      sourceActionKey, amountRsd, spentOn, categoryId: "groceries", createdBy: String(userId)
    })).expense;
    const before = await fixture.repository.getExpenseById(expense.id);
    switch (surface) {
      case "history":
        await fixture.bot.handleUpdate(fixture.message(900, "История"));
        break;
      case "details":
        await fixture.bot.handleUpdate(fixture.callback(900, `d:${expense.id}`));
        break;
      case "edit-actions":
        await fixture.bot.handleUpdate(fixture.callback(900, `a:${expense.id}`));
        break;
      case "amount-prompt":
        await fixture.bot.handleUpdate(fixture.callback(900, `p:${expense.id}:0`));
        break;
      case "selection":
        await fixture.bot.handleUpdate(fixture.message(900, String(amountRsd)));
        break;
      case "confirmation":
        await fixture.bot.handleUpdate(fixture.message(900, `${amountRsd} продукты`));
        break;
      case "statistics":
        expectRepositorySuccess(await fixture.repository.createExpense({
          sourceActionKey: "expense:713", amountRsd: 200, spentOn, categoryId: "transport", createdBy: String(userId)
        }));
        await fixture.bot.handleUpdate(fixture.callback(900, "s:202602"));
        break;
      case "category-update":
        await fixture.bot.handleUpdate(fixture.callback(900, `e1:${expense.id}:other`));
        break;
      case "edit-error":
        await fixture.bot.handleUpdate(fixture.message(900, "0", { replyTo: fixture.replyTarget(
          `Редактирование расхода №${expense.id} · Новая сумма\n\nОтправьте целую сумму в ${displayCurrency}.`, fixture.botInfo
        ) }));
    }
    const moneyCall = fixture.calls.findLast(call => call.method === "sendMessage" || call.method === "editMessageText");
    assert(moneyCall);
    assert.match(JSON.stringify(moneyCall.payload), new RegExp(displayCurrency));
    assert.doesNotMatch(JSON.stringify(moneyCall.payload), /RSD/);
    if (surface === "statistics")
      assert.equal(moneyCall.payload.text, `${spentOn.slice(0, 7)}-01 — 2026-02-28\nИтого: ${amountRsd + 200} ${displayCurrency}`
        + `\nПродукты: ${amountRsd} ${displayCurrency} (75%)\nТранспорт: 200 ${displayCurrency} (25%)`);
    if (surface !== "category-update")
      assert.deepEqual(await fixture.repository.getExpenseById(expense.id), before);
  });
}

test("amount editing uses the configured currency in its confirmation", async context => {
  const userId = 712;
  const displayCurrency = "EUR";
  const nextAmount = 750;
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);

  const expense = expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "expense:712",
    amountRsd: 250,
    spentOn: "2026-02-17",
    categoryId: "groceries",
    createdBy: String(userId)
  })).expense;

  const prompt = `Редактирование расхода №${expense.id} · Новая сумма\n\nОтправьте целую сумму в ${displayCurrency}.`;
  await fixture.bot.handleUpdate(fixture.message(950, String(nextAmount), {
    replyTo: fixture.replyTarget(prompt, fixture.botInfo)
  }));

  assert.equal((await fixture.repository.getExpenseById(expense.id))?.amountRsd, nextAmount);
  assert.match(
    String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text),
    new RegExp(`${nextAmount} ${displayCurrency}`)
  );
});

for (const scenario of ["start", "help", "categories", "category-add", "category-archive", "empty-history", "expense-category-list", "date-prompt", "comment-prompt",
  "calendar", "delete-request", "delete-confirm", "access-denied"]) {
  test(`${scenario} does not load instance settings`, async context => {
    const userId = 713;
    let settingsReads = 0;
    const fixture = await createTelegramFixture(userId, 999, async () => {
      settingsReads++;
      throw new InstanceConfigurationError("instance_settings: unavailable");
    });
    context.after(() => fixture.database.dispose());
    await addMember(fixture.database.DB, userId, "Анна", scenario === "access-denied" ? 0 : 1);
    const expenseId = expectRepositorySuccess(await fixture.repository.createExpense({
      sourceActionKey: "expense:713", amountRsd: 250, spentOn: "2026-02-17", categoryId: "groceries", createdBy: String(userId)
    })).expense.id;
    let expectedText: string;
    switch (scenario) {
      case "start":
        await fixture.bot.handleUpdate(fixture.command(960, "/start"));
        expectedText = "Добро пожаловать";
        break;
      case "help":
        await fixture.bot.handleUpdate(fixture.message(960, "Помощь"));
        expectedText = "Отправьте расход";
        break;
      case "categories":
        await fixture.bot.handleUpdate(fixture.message(960, "Категории"));
        expectedText = "Категории: выберите категорию";
        break;
      case "category-add":
        await fixture.bot.handleUpdate(fixture.message(960, "Школа", { replyTo: fixture.replyTarget("Добавление категории", fixture.botInfo) }));
        expectedText = "Категория сохранена";
        break;
      case "category-archive":
        await fixture.bot.handleUpdate(fixture.callback(960, formatCallbackData({ kind: "manage-category", operation: "confirm", categoryId: "groceries" })));
        expectedText = "Категория архивирована";
        break;
      case "empty-history":
        await fixture.repository.deleteExpense(expenseId);
        await fixture.bot.handleUpdate(fixture.message(960, "История"));
        expectedText = "Расходов пока нет";
        break;
      case "expense-category-list":
        await fixture.bot.handleUpdate(fixture.callback(960, `l:${expenseId}`));
        expectedText = "Выберите категорию для расхода";
        break;
      case "date-prompt":
        await fixture.bot.handleUpdate(fixture.callback(960, `p:${expenseId}:1`));
        expectedText = "Новая дата";
        break;
      case "comment-prompt":
        await fixture.bot.handleUpdate(fixture.callback(960, `p:${expenseId}:2`));
        expectedText = "Новый комментарий";
        break;
      case "calendar":
        await fixture.bot.handleUpdate(fixture.callback(960, "k:202602:0"));
        expectedText = "Выберите начало периода";
        break;
      case "delete-request":
        await fixture.bot.handleUpdate(fixture.callback(960, `r:${expenseId}`));
        expectedText = "Удалить расход";
        break;
      case "delete-confirm":
        await fixture.bot.handleUpdate(fixture.callback(960, `x:${expenseId}`));
        expectedText = "удалён";
        break;
      default:
        await fixture.bot.handleUpdate(fixture.message(960, "250 продукты"));
        expectedText = "Нет доступа";
    }
    assert.equal(settingsReads, 0);
    assert(fixture.calls.some(call => String(call.payload.text).includes(expectedText)));
  });
}
