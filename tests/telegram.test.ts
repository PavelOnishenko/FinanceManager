import { createTelegramUpdates } from "./telegramUpdates";
import { createSettings } from "./createSettings";
import type { InstanceSettings } from "../src/config/instanceSettings";
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

type TelegramFixture = ReturnType<typeof createTelegramUpdates> & {
  database: Awaited<ReturnType<typeof createMigratedLocalD1>>;
  repository: D1FinanceRepository;
  bot: ReturnType<typeof createFinanceBot>;
  botInfo: UserFromGetMe;
  calls: TelegramApiCall[];
};

async function createTelegramFixture(userId: number, botId: number, settings: InstanceSettings): Promise<TelegramFixture> {
  const database = await createMigratedLocalD1(`telegram-scenario-${++telegramFixtureNumber}`);
  const repository = new D1FinanceRepository(database.DB);
  const updates = createTelegramUpdates(userId);
  const botInfo = createTestBotInfo(botId);
  const calls: TelegramApiCall[] = [];
  const bot = createFinanceBot("123:fixture", repository, async () => settings);
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

function inlineKeyboard(calls: TelegramApiCall[], method: "sendMessage" | "editMessageText") {
  const markup = calls.findLast(call => call.method === method)?.payload.reply_markup as {
    inline_keyboard: { text: string; callback_data: string }[][]
  } | undefined;
  assert(markup?.inline_keyboard, `Expected an inline keyboard from ${method}`);
  return markup.inline_keyboard;
}

function buttonData(calls: TelegramApiCall[], method: "sendMessage" | "editMessageText", text: string) {
  const button = inlineKeyboard(calls, method).flat().find(button => button.text === text);
  assert(button, `Expected button: ${text}`);
  return button.callback_data;
}

test("period history reaches older expenses, keeps its range while paging, and supports details, editing and deletion", async context => {
  const fixture = await createTelegramFixture(127, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, 127, "Анна", 1);
  await addMember(fixture.database.DB, 128, "Борис", 1);
  for (let index = 1; index <= 11; index++)
    expectRepositorySuccess(await fixture.repository.createExpense({
      sourceActionKey: `history:${index}`, amountRsd: index * 100, categoryId: "groceries", spentOn: "2026-01-15", createdBy: "128"
    }));
  expectRepositorySuccess(await fixture.repository.setCategoryActive("groceries", false));
  await fixture.bot.handleUpdate(fixture.message(800, "История"));
  const recent = inlineKeyboard(fixture.calls, "sendMessage");
  assert.equal(recent[0]?.[0]?.text, "Другой период");
  assert.equal(recent.flat().filter(button => parseCallbackData(button.callback_data)?.kind === "details").length, 10);
  assert(!recent.flat().some(button => button.callback_data === "d:1"));

  await fixture.bot.handleUpdate(fixture.callback(801, "h:202601"));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /2026-01-01 — 2026-01-31\nСтраница 1/);
  const first = inlineKeyboard(fixture.calls, "editMessageText");
  assert.equal(first[0]?.[0]?.text, "Другой период");
  assert(first.flat().some(button => /1100 EUR.*Продукты.*15\.01\.2026/.test(button.text)));
  assert(!first.flat().some(button => /Предыдущий месяц/.test(button.text)));
  const next = buttonData(fixture.calls, "editMessageText", "Далее");
  assert.deepEqual(parseCallbackData(next), { kind: "history-page", fromDate: "2026-01-01", toDate: "2026-01-31", page: 1 });
  await fixture.bot.handleUpdate(fixture.callback(802, next));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Страница 2/);
  const older = inlineKeyboard(fixture.calls, "editMessageText").flat().filter(button => button.callback_data === "d:1");
  assert.equal(older.length, 1);
  assert(!inlineKeyboard(fixture.calls, "editMessageText").flat().some(button => button.text === "Далее"));
  await fixture.bot.handleUpdate(fixture.callback(8021, buttonData(fixture.calls, "editMessageText", "Назад")));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Страница 1/);
  await fixture.bot.handleUpdate(fixture.callback(8022, buttonData(fixture.calls, "editMessageText", "Далее")));
  await fixture.bot.handleUpdate(fixture.callback(803, older[0]!.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text), /#1 · 100 EUR.*Борис/);
  await fixture.bot.handleUpdate(fixture.callback(804, buttonData(fixture.calls, "sendMessage", "Дата")));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  await fixture.bot.handleUpdate(fixture.message(805, "01.02.2026", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(1))?.spentOn, "2026-02-01");
  await fixture.bot.handleUpdate(fixture.callback(806, next));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Страница 1/);
  assert(!inlineKeyboard(fixture.calls, "editMessageText").flat().some(button => button.text === "Далее"));

  await fixture.bot.handleUpdate(fixture.callback(807, "h:202602"));
  await fixture.bot.handleUpdate(fixture.callback(808, "d:1"));
  await fixture.bot.handleUpdate(fixture.callback(809, buttonData(fixture.calls, "sendMessage", "Удалить")));
  await fixture.bot.handleUpdate(fixture.callback(810, buttonData(fixture.calls, "sendMessage", "Да, удалить")));
  assert.equal(await fixture.repository.getExpenseById(1), null);
  await fixture.bot.handleUpdate(fixture.callback(811, "h:202602"));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /За выбранный период расходов нет\./);
  await fixture.bot.handleUpdate(fixture.callback(812, buttonData(fixture.calls, "editMessageText", "Последние 10")));
  assert.equal(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text, "Последние 10 расходов:");
});

test("history calendar keeps a cross-month start, resets it, rejects reversed ranges and returns expenses rather than statistics", async context => {
  const fixture = await createTelegramFixture(127, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, 127, "Анна", 1);
  for (const spentOn of ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"])
    expectRepositorySuccess(await fixture.repository.createExpense({
      sourceActionKey: spentOn, amountRsd: 100, categoryId: "groceries", spentOn, createdBy: "127"
    }));
  const before = await fixture.database.DB.prepare("SELECT * FROM expenses ORDER BY id").many();
  await fixture.bot.handleUpdate(fixture.callback(820, "hk:202602:0"));
  await fixture.bot.handleUpdate(fixture.callback(821, buttonData(fixture.calls, "editMessageText", "28")));
  const reset = buttonData(fixture.calls, "editMessageText", "Сбросить начало");
  assert.deepEqual(parseCallbackData(reset), { kind: "calendar", month: "2026-02", destination: "history" });
  await fixture.bot.handleUpdate(fixture.callback(822, buttonData(fixture.calls, "editMessageText", "27")));
  assert.equal(fixture.calls.at(-1)?.payload.text, "Конец периода не может быть раньше начала");
  const nextMonth = buttonData(fixture.calls, "editMessageText", "▶");
  assert.deepEqual(parseCallbackData(nextMonth), { kind: "calendar", month: "2026-03", startDate: "2026-02-28", destination: "history" });
  await fixture.bot.handleUpdate(fixture.callback(823, nextMonth));
  await fixture.bot.handleUpdate(fixture.callback(824, buttonData(fixture.calls, "editMessageText", "1")));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Расходы: 2026-02-28 — 2026-03-01/);
  assert.deepEqual(inlineKeyboard(fixture.calls, "editMessageText").flat().filter(button => /^d:/.test(button.callback_data))
    .map(button => button.callback_data), ["d:3", "d:2"]);
  await fixture.bot.handleUpdate(fixture.callback(825, buttonData(fixture.calls, "editMessageText", "Другой период")));
  await fixture.bot.handleUpdate(fixture.callback(826, buttonData(fixture.calls, "editMessageText", "28")));
  await fixture.bot.handleUpdate(fixture.callback(827, buttonData(fixture.calls, "editMessageText", "[28]")));
  assert.deepEqual(inlineKeyboard(fixture.calls, "editMessageText").flat().filter(button => /^d:/.test(button.callback_data))
    .map(button => button.callback_data), ["d:2"]);
  await fixture.bot.handleUpdate(fixture.callback(828, reset));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Выберите начало периода/);
  assert(!inlineKeyboard(fixture.calls, "editMessageText").flat().some(button => button.text === "Сбросить начало"));
  await fixture.bot.handleUpdate(fixture.callback(829, "hk:202601:0"));
  assert(!inlineKeyboard(fixture.calls, "editMessageText").flat().some(button => button.text === "◀"));
  await fixture.bot.handleUpdate(fixture.callback(830, "ht:202601:20251231:1"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /История доступна с 2026 года/);
  await fixture.bot.handleUpdate(fixture.callback(831, "s:202602"));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Итого: 200 RSD/);
  assert.deepEqual(await fixture.database.DB.prepare("SELECT * FROM expenses ORDER BY id").many(), before);
});

test("empty history offers a picker in the configured current month and full-month selection", async context => {
  const fixture = await createTelegramFixture(127, 999, createSettings({ financeTimeZone: "America/New_York" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, 127, "Анна", 1);
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-01T00:30:00Z") });
  await fixture.bot.handleUpdate(fixture.message(840, "История"));
  assert.equal(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text, "Расходов пока нет.");
  await fixture.bot.handleUpdate(fixture.callback(841, buttonData(fixture.calls, "sendMessage", "Другой период")));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /^2026-02/);
  await fixture.bot.handleUpdate(fixture.callback(842, buttonData(fixture.calls, "editMessageText", "Весь месяц")));
  assert.equal(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text,
    "Расходы: 2026-02-01 — 2026-02-28\nЗа выбранный период расходов нет.");
  await fixture.bot.handleUpdate(fixture.callback(843, buttonData(fixture.calls, "editMessageText", "Следующий месяц ▶")));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /2026-03-01 — 2026-03-31/);
  assert.equal(buttonData(fixture.calls, "editMessageText", "Последние 10"), "hr");
  assert(buttonData(fixture.calls, "editMessageText", "Другой период"));
});

test("unknown and disabled members cannot use history month, calendar, page or return buttons", async context => {
  const fixture = await createTelegramFixture(127, 999, createSettings());
  context.after(() => fixture.database.dispose());
  const callbacks = ["hi", "hr", "h:202601", "hk:202601:0", "ht:202601:0:1", "hp:20260101:20260131:1", "d:1"];
  for (const enabled of [undefined, 0]) {
    if (enabled === 0)
      await addMember(fixture.database.DB, 127, "Анна", enabled);
    for (const data of callbacks) {
      fixture.calls.length = 0;
      await fixture.bot.handleUpdate(fixture.callback(850, data));
      assert(!fixture.calls.some(call => call.method === "editMessageText"), data);
      assert.equal(fixture.calls.at(-1)?.payload.text, "Нет доступа. Ваш Telegram ID: 127", data);
    }
  }
});

test("January 2026 has no previous-month button and old buttons explain the limit", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.callback(710, formatCallbackData({ kind: "statistics-month", month: "2026-01" })));
  const buttons = inlineKeyboard(fixture.calls, "editMessageText");
  assert.deepEqual(buttons.flat().map(button => parseCallbackData(button.callback_data)), [
    { kind: "statistics-month", month: "2026-02" }, { kind: "calendar", month: "2026-01" }
  ]);
  await fixture.bot.handleUpdate(fixture.callback(711, "s:202512"));
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
  assert.equal(fixture.calls.at(-1)?.payload.text, "Статистика доступна с 2026 года. Откройте её заново.");
  assert.equal(fixture.calls.filter(call => call.method === "editMessageText").length, 1);
});

test("monthly statistics displays family totals and percentages in the configured currency", async context => {
  const userId = 127;
  const otherUserId = 128;
  const month = "2026-02";
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await addMember(fixture.database.DB, otherUserId, "Борис", 1);
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "start", amountRsd: 1000, categoryId: "groceries", spentOn: "2026-02-01", createdBy: String(userId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "middle", amountRsd: 1500, categoryId: "transport", spentOn: "2026-02-15", createdBy: String(otherUserId) }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "end", amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(otherUserId) }));

  await fixture.bot.handleUpdate(fixture.callback(700, formatCallbackData({ kind: "statistics-month", month })));
  const report = String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text);
  assert.match(report, /2026-02-01 — 2026-02-28\nИтого: 4500 EUR\nПродукты: 3000 EUR \(66,7%\)\nТранспорт: 1500 EUR \(33,3%\)/);
  const reportButtons = inlineKeyboard(fixture.calls, "editMessageText");
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
  const calendarButtons = inlineKeyboard(fixture.calls, "editMessageText");
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
  const nextMonthButton = inlineKeyboard(fixture.calls, "editMessageText")[0]?.find(button => button.text === "▶");
  assert(nextMonthButton);
  assert.deepEqual(parseCallbackData(nextMonthButton.callback_data), { kind: "calendar", month: "2026-03", startDate });
  await fixture.bot.handleUpdate(fixture.callback(704, nextMonthButton.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /Начало: 2026-02-15/);
  const firstDayButton = inlineKeyboard(fixture.calls, "editMessageText").flat().find(button => button.text === "1");
  assert(firstDayButton);
  assert.deepEqual(parseCallbackData(firstDayButton.callback_data), { kind: "calendar-day", month: "2026-03", day: 1, startDate });
  await fixture.bot.handleUpdate(fixture.callback(705, firstDayButton.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text),
    /2026-02-15 — 2026-03-01\nИтого: 12500 RSD\nДругое: 9000 RSD \(72%\)\nПродукты: 2000 RSD \(16%\)\nТранспорт: 1500 RSD \(12%\)/);
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

test("category selection uses stable IDs and saves only once after repeated taps", async context => {
  const userId = 127;
  const sourceUpdateId = 400;
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);

  await fixture.bot.handleUpdate(fixture.message(sourceUpdateId, "2490"));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /2490 EUR/);
  const buttons = inlineKeyboard(fixture.calls, "sendMessage");
  assert.equal(buttons.length, categories.length);
  assert.deepEqual(await fixture.repository.getRecentExpenses(), []);
  assert.deepEqual(parseCallbackData(buttons[0]![0]!.callback_data), {
    kind: "create", sourceUpdateId, amountRsd: 2490, categoryId: "groceries"
  });

  await fixture.bot.handleUpdate(fixture.callback(401, buttons[0]![0]!.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /2490 EUR/);
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
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "history-groceries", amountRsd: 2490, categoryId: "groceries", spentOn: groceriesDate, comment: "Lidl", createdBy: String(userId)
  }));
  expectRepositorySuccess(await fixture.repository.createExpense({
    sourceActionKey: "history-transport", amountRsd: 700, categoryId: "transport", spentOn: transportDate, comment: "Такси", createdBy: String(userId)
  }));

  await fixture.bot.handleUpdate(fixture.message(402, "История"));
  const buttons = inlineKeyboard(fixture.calls, "sendMessage");
  assert.deepEqual(buttons.map(row => row[0]?.text), [
    "Другой период", "#2 · 700 EUR · Транспорт · 18.09.2026", "#1 · 2490 EUR · Продукты · 17.09.2026"
  ]);
});

test("expense details keep categories behind a button and can return from the category list", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "details", expenseId: 1 })));
  assert.match(String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text), /2490 EUR/);
  const detailButtons = inlineKeyboard(fixture.calls, "sendMessage").flat();
  assert.deepEqual(detailButtons.map(button => button.text), ["Сумма", "Дата", "Комментарий", "Категория", "Удалить"]);

  await fixture.bot.handleUpdate(fixture.callback(402, detailButtons.find(button => button.text === "Категория")!.callback_data));
  const categoryButtons = inlineKeyboard(fixture.calls, "editMessageText");
  assert.deepEqual(categoryButtons.map(row => row[0]!.text), [...categories.map(category => category.name), "Назад"]);

  await fixture.bot.handleUpdate(fixture.callback(403, categoryButtons.at(-1)![0]!.callback_data));
  assert.match(String(fixture.calls.findLast(call => call.method === "editMessageText")?.payload.text), /2490 EUR/);
  const returnedButtons = inlineKeyboard(fixture.calls, "editMessageText").flat();
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
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-prompt", expenseId: 1, field: "amount" })));
  const prompt = String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text);
  assert.match(prompt, /Отправьте целую сумму в EUR/);
  await fixture.bot.handleUpdate(fixture.message(402, "0", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Сумма должна быть целым положительным числом в EUR/);
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 2490);
  await fixture.bot.handleUpdate(fixture.message(403, "3000", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.equal((await fixture.repository.getExpenseById(1))?.amountRsd, 3000);
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Обновлено:.*3000 EUR/);
  assertMenuShown(fixture.calls);
});

test("category callback replaces the original category", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.message(400, "2490 продукты Lidl"));
  assert.equal((await fixture.repository.getExpenseById(1))?.categoryId, "groceries");

  await fixture.bot.handleUpdate(fixture.callback(401, formatCallbackData({ kind: "edit-category", expenseId: 1, categoryId: "health" })));
  assert.equal((await fixture.repository.getExpenseById(1))?.categoryId, "health");
  assert.match(String(fixture.calls.findLast(call => call.method === "sendMessage")?.payload.text), /Обновлено:.*2490 EUR/);
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

test("photo message asks for text instead of remaining silent", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  await fixture.bot.handleUpdate(fixture.photo(502));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /только текстовые сообщения/);
});

test("callback reports access revoked between checks in chat and alert", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, 999, createSettings());
  context.after(() => fixture.database.dispose());
  await addMember(fixture.database.DB, userId, "Анна", 1);
  const getMember = fixture.repository.getEnabledMember.bind(fixture.repository);
  // An administrator can revoke access while an update is being handled.
  context.mock.method(fixture.repository, "getEnabledMember", async (id: string) => {
    const member = await getMember(id);
    await fixture.database.DB.prepare("UPDATE members SET enabled = 0 WHERE telegram_user_id = ?").bind(id).execute();
    return member;
  });
  await fixture.bot.handleUpdate(fixture.callback(507, formatCallbackData({ kind: "details", expenseId: 1 })));
  assert.equal(fixture.calls.at(-2)?.method, "sendMessage");
  assert.match(String(fixture.calls.at(-2)?.payload.text), /Нет доступа.*127/);
  assert.equal(fixture.calls.at(-1)?.method, "answerCallbackQuery");
  assert.equal(fixture.calls.at(-1)?.payload.show_alert, true);
});

test("unexpected failures include the update ID without exposing internal details", async context => {
  const userId = 127;
  const botId = 999;
  const updateId = 600;
  const fixture = await createTelegramFixture(userId, botId, createSettings());
  context.after(() => fixture.database.dispose());
  context.mock.method(fixture.repository, "getEnabledMember", async () => { throw new Error("secret-db-detail"); });
  const { bot, calls } = fixture;
  context.mock.method(console, "error", () => undefined);
  await assert.rejects(bot.handleUpdate(fixture.message(updateId, "История")), /secret-db-detail/);
  assert.match(String(calls.at(-1)?.payload.text), /Код: 600/);
  assert.doesNotMatch(String(calls.at(-1)?.payload.text), /secret-db-detail/);

  await bot.handleUpdate(fixture.callback(601, formatCallbackData({ kind: "details", expenseId: 1 })));
  assert.equal(calls.at(-1)?.method, "answerCallbackQuery");
  assert.match(String(calls.at(-1)?.payload.text), /Код: 601/);
  assert.equal(calls.at(-1)?.payload.show_alert, true);
  assert(calls.some(call => call.method === "sendMessage" && String(call.payload.text).includes("Код: 601")));
});

test("category addition uses ForceReply and enables both expense entry paths", async context => {
  const userId = 127;
  const categoryName = "Дети-School 2026";
  const textAmountRsd = 800;
  const buttonAmountRsd = 500;
  const comment = "Учебники";
  const fixture = await createTelegramFixture(userId, 999, createSettings({ displayCurrency: "EUR" }));
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
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Сохранено:.*800 EUR/);
  const saved = (await fixture.repository.getRecentExpenses())[0]!;
  assert.equal(saved.categoryId, category.id);
  assert.equal(saved.comment, comment);
  await fixture.bot.handleUpdate(fixture.message(804, String(buttonAmountRsd)));
  const buttons = inlineKeyboard(fixture.calls, "sendMessage");
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
  const creationMenu = inlineKeyboard(fixture.calls, "sendMessage");
  assert(!creationMenu.flat().some(button => button.text === categoryName));
  await fixture.bot.handleUpdate(fixture.callback(831, `l:${saved.expense.id}`));
  const editingMenu = inlineKeyboard(fixture.calls, "editMessageText");
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
  const buttons = inlineKeyboard(fixture.calls, "sendMessage");
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
  await fixture.bot.handleUpdate(fixture.message(852, "Школа!", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
  assert.match(String(fixture.calls.at(-1)?.payload.text), /Название/);
  await fixture.bot.handleUpdate(fixture.message(853, "  ПРОДУКТЫ ", { replyTo: fixture.replyTarget(prompt, fixture.botInfo) }));
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
