import { buttonNamed } from "../../infrastructure/telegram/telegramOutput";
import { createTelegramFixture } from "../../infrastructure/telegram/telegramFixture";
import { createSettings } from "../../infrastructure/createSettings";
import assert from "node:assert/strict";
import test from "node:test";
import { categories } from "../../infrastructure/defaultCategories";
import { parseCallbackData } from "../../../src/telegram/callbackData";
import { hasValidWebhookSecret } from "../../../src/telegram/webhookSecret";

test("period history reaches older expenses and clamps the last page after a date edit", async context => {
  const fixture = await createTelegramFixture(127, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(127, "Анна");
  await fixture.seedMember(128, "Борис");
  // Eleven expenses put #1 outside the ten most recent entries and on the second period page.
  for (let index = 1; index <= 11; index++)
    await fixture.seedExpense({ amountRsd: index * 100, categoryId: "groceries", spentOn: "2026-01-15", createdBy: "128" });
  await fixture.archiveCategory("groceries");

  // Open recent history. d:<expense ID> opens details; #1 must not be among the recent ten.
  await fixture.sendMessage("История");
  assert.equal(fixture.keyboard()[0]?.[0]?.text, "Другой период");
  assert.equal(fixture.expenseButtons().length, 10);
  assert(!fixture.expenseButtons().some(button => button.callback_data === "d:1"));

  // h:<YYYYMM> — select all of January 2026, including archived-category expenses.
  await fixture.pressButton("h:202601");
  assert.match(fixture.text(), /2026-01-01 — 2026-01-31\nСтраница 1/);
  assert.equal(fixture.keyboard()[0]?.[0]?.text, "Другой период");
  assert(fixture.expenseButtons().some(button => /1100 EUR.*Продукты.*15\.01\.2026/.test(button.text)));
  assert(!fixture.hasButton("◀ Предыдущий месяц"));
  // hp:<from YYYYMMDD>:<to YYYYMMDD>:<zero-based page> — page 1 means the second page.
  const secondPage = fixture.button("Далее").callback_data;
  assert.equal(secondPage, "hp:20260101:20260131:1");
  await fixture.pressButton(secondPage);
  assert.match(fixture.text(), /Страница 2/);
  assert.deepEqual(fixture.expenseButtons().map(button => button.callback_data), ["d:1"]);
  assert(!fixture.hasButton("Далее"));

  // Go back and forward using the displayed controls; the January range must survive both transitions.
  await fixture.pressButtonNamed("Назад");
  assert.match(fixture.text(), /2026-01-01 — 2026-01-31\nСтраница 1/);
  await fixture.pressButtonNamed("Далее");
  // d:<expense ID> — inspect the older expense, then reply to its date-edit prompt.
  await fixture.pressButton("d:1");
  assert.match(fixture.text(), /#1 · 100 EUR.*Борис/);
  await fixture.pressButtonNamed("Дата");
  await fixture.replyToPrompt("01.02.2026", fixture.text());
  assert.equal((await fixture.expense(1)).spentOn, "2026-02-01");

  // Reuse the old second-page button. With #1 moved to February, January now fits on page one.
  await fixture.pressButton(secondPage);
  assert.match(fixture.text(), /2026-01-01 — 2026-01-31\nСтраница 1/);
  assert(!fixture.hasButton("Далее"));
});

test("deleting an expense in an archived category empties its period and allows returning to recent history", async context => {
  const fixture = await createTelegramFixture(127, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(127, "Анна");
  await fixture.seedExpense({ amountRsd: 100, categoryId: "groceries", spentOn: "2026-02-01", createdBy: "127" });
  // Keep an expense outside February so returning to recent history has a surviving row to display.
  await fixture.seedExpense({ amountRsd: 200, categoryId: "transport", spentOn: "2026-01-15", createdBy: "127" });
  await fixture.archiveCategory("groceries");

  // h:<YYYYMM> — open February, then d:<expense ID> — inspect its only expense.
  await fixture.pressButton("h:202602");
  await fixture.pressButton("d:1");
  await fixture.pressButtonNamed("Удалить");
  await fixture.pressButtonNamed("Да, удалить");
  assert.equal(await fixture.repository.getExpenseById(1), null);

  // h:<YYYYMM> — refresh the same period after deletion.
  await fixture.pressButton("h:202602");
  assert.match(fixture.text(), /За выбранный период расходов нет\./);
  await fixture.pressButtonNamed("Последние 10");
  assert.equal(fixture.text(), "Последние 10 расходов:");
  // d:<expense ID> — only the January expense (#2) remains after deleting #1.
  assert.deepEqual(fixture.expenseButtons().map(button => button.callback_data), ["d:2"]);
});

test("history calendar selects inclusive cross-month and single-day ranges, rejects reversed dates and resets the start", async context => {
  const fixture = await createTelegramFixture(127, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(127, "Анна");
  for (const spentOn of ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"])
    await fixture.seedExpense({ amountRsd: 100, categoryId: "groceries", spentOn, createdBy: "127" });
  const before = await fixture.database.DB.prepare("SELECT * FROM expenses ORDER BY id").many();

  // k:<destination>:<YYYYMM>:<start YYYYMMDD or 0> — open the history calendar with no start selected.
  await fixture.pressButton("k:history:202602:0");
  await fixture.pressButtonNamed("28");
  // The reset button retains the month and history destination, but clears the selected start (0).
  const reset = fixture.button("Сбросить начало").callback_data;
  assert.equal(reset, "k:history:202602:0");
  await fixture.pressButtonNamed("27");
  fixture.expectAcknowledgement("Конец периода не может быть раньше начала");

  // The next-month button must retain February 28 as the start.
  // k:<destination>:<YYYYMM>:<start YYYYMMDD> — March calendar for a range starting February 28.
  assert.equal(fixture.button("▶").callback_data, "k:history:202603:20260228");
  await fixture.pressButtonNamed("▶");
  await fixture.pressButtonNamed("1");
  assert.match(fixture.text(), /Расходы: 2026-02-28 — 2026-03-01/);
  // d:<expense ID> — only #3 (March 1) and #2 (February 28) lie within the inclusive range.
  assert.deepEqual(fixture.expenseButtons().map(button => button.callback_data), ["d:3", "d:2"]);

  // Choose a new range whose start and end are the same day.
  await fixture.pressButtonNamed("Другой период");
  await fixture.pressButtonNamed("28");
  await fixture.pressButtonNamed("[28]");
  assert.deepEqual(fixture.expenseButtons().map(button => button.callback_data), ["d:2"]);
  await fixture.pressButton(reset);
  assert.match(fixture.text(), /Выберите начало периода/);
  assert(!fixture.hasButton("Сбросить начало"));

  // s:<YYYYMM> — statistics remain a separate destination: February contains two expenses of 100 RSD.
  await fixture.pressButton("s:202602");
  assert.match(fixture.text(), /Итого: 200 RSD/);
  assert.deepEqual(await fixture.database.DB.prepare("SELECT * FROM expenses ORDER BY id").many(), before);
});

test("history calendar stops at January 2026 and explains a button with an older range start", async context => {
  const fixture = await createTelegramFixture(127, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(127, "Анна");

  // k:<destination>:<YYYYMM>:<start or 0> — January has no previous-month control.
  await fixture.pressButton("k:history:202601:0");
  assert(!fixture.hasButton("◀"));
  // t:<destination>:<YYYYMM>:<start YYYYMMDD>:<day> — the month is valid, but the start is in 2025.
  await fixture.pressButton("t:history:202601:20251231:1");
  fixture.expectAlert("История доступна с 2026 года. Откройте её заново.");
});

test("empty history offers a picker in the configured current month and full-month selection", async context => {
  const fixture = await createTelegramFixture(127, createSettings({ financeTimeZone: "America/New_York" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(127, "Анна");
  // It is already March in UTC, but still February in the family's configured time zone.
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-01T00:30:00Z") });
  await fixture.sendMessage("История");
  assert.equal(fixture.text(), "Расходов пока нет.");
  await fixture.pressButtonNamed("Другой период");
  assert.match(fixture.text(), /^2026-02/);
  await fixture.pressButtonNamed("Весь месяц");
  assert.equal(fixture.text(), "Расходы: 2026-02-01 — 2026-02-28\nЗа выбранный период расходов нет.");
  await fixture.pressButtonNamed("Следующий месяц ▶");
  assert.match(fixture.text(), /2026-03-01 — 2026-03-31/);
  // hr returns to recent history; hi opens the history period picker.
  assert.equal(fixture.button("Последние 10").callback_data, "hr");
  assert(fixture.hasButton("Другой период"));
});

for (const membership of ["unknown", "disabled"] as const) {
  test(`${membership} members cannot use history month, calendar, page or return buttons`, async context => {
    const fixture = await createTelegramFixture(127, createSettings());
    context.after(() => fixture.database.dispose());
    if (membership === "disabled") {
      await fixture.seedMember(127, "Анна");
      await fixture.disableMember(127);
    }
    for (const data of [
      "hi", // History period picker.
      "hr", // Return to recent history.
      "h:202601", // h:<YYYYMM> — January history.
      "k:history:202601:0", // k:<destination>:<YYYYMM>:<start or 0> — calendar without a start.
      "t:history:202601:0:1", // t:<destination>:<YYYYMM>:<start or 0>:<day> — choose January 1.
      "hp:20260101:20260131:1", // hp:<from YYYYMMDD>:<to YYYYMMDD>:<zero-based page> — second January page.
      "d:1" // d:<expense ID> — expense details.
    ]) {
      await fixture.pressButton(data);
      fixture.expectAcknowledgement("Нет доступа. Ваш Telegram ID: 127");
      fixture.expectNoMessageEdits();
    }
  });
}

test("January 2026 has no previous-month button and old buttons explain the limit", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  // s:<YYYYMM> — open January 2026 statistics.
  await fixture.pressButton("s:202601");
  const buttons = fixture.keyboard();
  assert.deepEqual(buttons.flat().map(button => parseCallbackData(button.callback_data)), [
    { kind: "statistics-month", month: "2026-02" },
    { kind: "calendar", destination: "statistics", month: "2026-01" }
  ]);
  const januaryScreen = fixture.screen();
  // s:<YYYYMM> — tap an old statistics button for December 2025.
  await fixture.pressButton("s:202512");
  fixture.expectAlert("Статистика доступна с 2026 года. Откройте её заново.");
  assert.equal(fixture.screen(), januaryScreen);
});

test("monthly statistics displays family totals and percentages in the configured currency", async context => {
  const userId = 127;
  const otherUserId = 128;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.seedMember(otherUserId, "Борис");
  await fixture.seedExpenses([
    { amountRsd: 1000, categoryId: "groceries", spentOn: "2026-02-01", createdBy: String(userId) },
    { amountRsd: 1500, categoryId: "transport", spentOn: "2026-02-15", createdBy: String(otherUserId) },
    { amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(otherUserId) }
  ]);

  // s:<YYYYMM> — open February 2026 statistics.
  await fixture.pressButton("s:202602");
  assert.match(fixture.text(), /2026-02-01 — 2026-02-28\nИтого: 4500 EUR\nПродукты: 3000 EUR \(66,7%\)\nТранспорт: 1500 EUR \(33,3%\)/);
  const reportButtons = fixture.keyboard();
  assert.deepEqual(reportButtons.flat().map(button => parseCallbackData(button.callback_data)), [
    { kind: "statistics-month", month: "2026-01" },
    { kind: "statistics-month", month: "2026-03" },
    { kind: "calendar", destination: "statistics", month: "2026-02" }
  ]);
});

test("calendar placeholder acknowledges a tap without editing the message", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  // k:<destination>:<YYYYMM>:<start YYYYMMDD or 0> — open February with no start selected.
  await fixture.pressButton("k:statistics:202602:0");
  const calendarButtons = fixture.keyboard();
  const placeholder = buttonNamed(calendarButtons, "·");
  assert.deepEqual(parseCallbackData(placeholder.callback_data), { kind: "calendar-noop" });
  assert(calendarButtons.flat().some(button => parseCallbackData(button.callback_data)?.kind === "calendar-day"));
  const calendarScreen = fixture.screen();
  // Tap the calendar padding cell (n = acknowledge without changing the calendar).
  await fixture.pressButton(placeholder.callback_data);
  fixture.expectAcknowledgement();
  assert.equal(fixture.screen(), calendarScreen);
});

test("calendar rejects an end date before the selected start", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  // k:<destination>:<YYYYMM>:<start YYYYMMDD or 0> — open February with no start selected.
  await fixture.pressButton("k:statistics:202602:0");
  // t:<destination>:<YYYYMM>:<start YYYYMMDD or 0>:<day> — select February 15 as the start.
  await fixture.pressButton("t:statistics:202602:0:15");
  assert.match(fixture.text(), /Начало: 2026-02-15/);
  const selectedStartScreen = fixture.screen();
  // t:<destination>:<YYYYMM>:<start YYYYMMDD>:<day> — try February 14 after a February 15 start.
  await fixture.pressButton("t:statistics:202602:20260215:14");
  assert.equal(fixture.screen(), selectedStartScreen);
  fixture.expectAlert(/Конец периода не может быть раньше начала/);
});

test("calendar keeps the start date across months and includes both range boundaries", async context => {
  const userId = 127;
  const otherUserId = 128;
  const startDate = "2026-02-15";
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.seedMember(otherUserId, "Борис");
  await fixture.seedExpenses([
    { amountRsd: 1000, categoryId: "other", spentOn: "2026-02-14", createdBy: String(userId) },
    { amountRsd: 1500, categoryId: "transport", spentOn: startDate, createdBy: String(otherUserId) },
    { amountRsd: 2000, categoryId: "groceries", spentOn: "2026-02-28", createdBy: String(userId) },
    { amountRsd: 9000, categoryId: "other", spentOn: "2026-03-01", createdBy: String(otherUserId) },
    { amountRsd: 3000, categoryId: "other", spentOn: "2026-03-02", createdBy: String(userId) }
  ]);

  // k:<destination>:<YYYYMM>:<start YYYYMMDD or 0> — open February with no start selected.
  await fixture.pressButton("k:statistics:202602:0");
  // t:<destination>:<YYYYMM>:<start YYYYMMDD or 0>:<day> — select February 15 as the start.
  await fixture.pressButton("t:statistics:202602:0:15");
  const nextMonthButton = fixture.button("▶");
  assert.deepEqual(parseCallbackData(nextMonthButton.callback_data), { kind: "calendar", destination: "statistics", month: "2026-03", startDate });
  await fixture.pressButton(nextMonthButton.callback_data);
  assert.match(fixture.text(), /Начало: 2026-02-15/);
  const firstDayButton = fixture.button("1");
  assert.deepEqual(parseCallbackData(firstDayButton.callback_data), { kind: "calendar-day", destination: "statistics", month: "2026-03", day: 1, startDate });
  await fixture.pressButton(firstDayButton.callback_data);
  assert.match(fixture.text(),
    /2026-02-15 — 2026-03-01\nИтого: 12500 RSD\nДругое: 9000 RSD \(72%\)\nПродукты: 2000 RSD \(16%\)\nТранспорт: 1500 RSD \(12%\)/);
});

test("denies an unknown user and welcomes an enabled member", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.sendCommand("/start");
  assert.match(fixture.lastText(), /Нет доступа. Ваш Telegram ID: 127/);

  await fixture.seedMember(userId, "Анна");
  await fixture.sendCommand("/start");
  assert.match(fixture.lastText(), /Добро пожаловать/);
});

test("category selection uses stable IDs and saves only once after repeated taps", async context => {
  const userId = 127;
  const sourceUpdateId = 400;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");

  await fixture.sendMessage("2490", { updateId: sourceUpdateId });
  assert.match(fixture.lastText(), /2490 EUR/);
  const buttons = fixture.keyboard();
  assert.equal(buttons.length, categories.length);
  assert.deepEqual(await fixture.expenses(), []);
  assert.deepEqual(parseCallbackData(buttonNamed(buttons, "Продукты").callback_data), {
    kind: "create",
    sourceUpdateId,
    amountRsd: 2490,
    categoryId: "groceries"
  });

  await fixture.pressButton(buttonNamed(buttons, "Продукты").callback_data);
  assert.match(fixture.text(), /2490 EUR/);
  await fixture.pressButton(buttonNamed(buttons, "Транспорт").callback_data);
  assert.equal((await fixture.expenses()).length, 1);
  fixture.expectAcknowledgement("Расход уже сохранён");
});

test("menu buttons return help and previous-month statistics", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");

  await fixture.sendMessage("Помощь");
  assert.match(fixture.lastText(), /^Отправьте расход:/);
  await fixture.sendMessage("Статистика");
  assert.match(fixture.lastText(), /Итого: 0 RSD/);
});

test("history shows one button per recent expense", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.seedExpense({ amountRsd: 2490, categoryId: "groceries", spentOn: "2026-09-17", comment: "Lidl", createdBy: String(userId) });
  await fixture.seedExpense({ amountRsd: 700, categoryId: "transport", spentOn: "2026-09-18", comment: "Такси", createdBy: String(userId) });

  await fixture.sendMessage("История");
  assert.deepEqual(fixture.keyboard().flat().map(button => button.text), [
    "Другой период",
    "#2 · 700 EUR · Транспорт · 18.09.2026",
    "#1 · 2490 EUR · Продукты · 17.09.2026"
  ]);
});

test("expense details keep categories behind a button and can return from the category list", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage("2490 продукты Lidl");

  // d:<expense ID> — open expense #1.
  await fixture.pressButton("d:1");
  assert.match(fixture.text(), /2490 EUR/);
  const detailButtons = fixture.keyboard().flat();
  assert.deepEqual(detailButtons.map(button => button.text), ["Сумма", "Дата", "Комментарий", "Категория", "Удалить"]);

  await fixture.pressButtonNamed("Категория");
  assert.deepEqual(fixture.keyboard().flat().map(button => button.text), [...categories.map(category => category.name), "Назад"]);

  await fixture.pressButtonNamed("Назад");
  assert.match(fixture.text(), /2490 EUR/);
  assert.deepEqual(fixture.keyboard().flat().map(button => button.text), detailButtons.map(button => button.text));
});

test("amount edit ignores a prompt not sent by the bot", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage("2490 продукты Lidl");
  assert.equal((await fixture.expense(1)).amountRsd, 2490);

  // p:<expense ID>:<field index> — ask to edit #1; 0 = amount, 1 = date, 2 = comment.
  await fixture.pressButton("p:1:0");
  // Reply to identical prompt text from another sender; it must not authorize editing.
  await fixture.replyToPrompt("3000", fixture.text(), fixture.user);
  assert.equal((await fixture.expense(1)).amountRsd, 2490);
  fixture.expectMenu();
});

test("amount edit accepts the bot's prompt and restores the menu", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage("2490 продукты Lidl");
  assert.equal((await fixture.expense(1)).amountRsd, 2490);

  // p:<expense ID>:<field index> — ask to edit #1; 0 = amount, 1 = date, 2 = comment.
  await fixture.pressButton("p:1:0");
  const prompt = fixture.text();
  assert.match(prompt, /Отправьте целую сумму в EUR/);
  // Reject zero without changing the expense, then allow a valid reply to the same prompt.
  await fixture.replyToPrompt("0", prompt);
  assert.match(fixture.lastText(), /Сумма должна быть целым положительным числом в EUR/);
  assert.equal((await fixture.expense(1)).amountRsd, 2490);
  await fixture.replyToPrompt("3000", prompt);
  assert.equal((await fixture.expense(1)).amountRsd, 3000);
  assert.match(fixture.lastText(), /Обновлено:.*3000 EUR/);
  fixture.expectMenu();
});

test("category callback replaces the original category", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage("2490 продукты Lidl");
  assert.equal((await fixture.expense(1)).categoryId, "groceries");

  // e1:<expense ID>:<stable category ID> — change #1 to health.
  await fixture.pressButton("e1:1:health");
  assert.equal((await fixture.expense(1)).categoryId, "health");
  assert.match(fixture.text(), /Обновлено:.*2490 EUR/);
});

test("delete requires a separate confirmation callback", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage("2490 продукты Lidl");
  assert.equal((await fixture.expenses()).length, 1);

  // r:<expense ID> — request deletion of #1, without confirming it.
  await fixture.pressButton("r:1");
  assert.equal((await fixture.expenses()).length, 1);
  // x:<expense ID> — confirm deletion of #1.
  await fixture.pressButton("x:1");
  assert.equal((await fixture.expenses()).length, 0);
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
  const fixture = await createTelegramFixture(127, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.sendCommand("/start", { chat: { id: -100, type: "supergroup", title: "Семья" } });
  assert.match(fixture.lastText(), /только в личном чате/);
});

test("group callback shows a private-chat alert", async context => {
  const fixture = await createTelegramFixture(127, createSettings());
  context.after(() => fixture.database.dispose());
  // d:<expense ID> — open expense #1.
  await fixture.pressButton("d:1", {
    chat: { id: -100, type: "supergroup", title: "Семья" }
  });
  fixture.expectAlert(/только в личном чате/);
});

test("photo message asks for text instead of remaining silent", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendPhoto();
  assert.match(fixture.lastText(), /только текстовые сообщения/);
});

test("callback reports access revoked between checks in chat and alert", async context => {
  const userId = 127;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  const getMember = fixture.repository.getEnabledMember.bind(fixture.repository);
  // An administrator can revoke access while an update is being handled.
  context.mock.method(fixture.repository, "getEnabledMember", async (id: string) => {
    const member = await getMember(id);
    await fixture.database.DB.prepare("UPDATE members SET enabled = 0 WHERE telegram_user_id = ?").bind(id).execute();
    return member;
  });
  // d:<expense ID> — open expense #1.
  await fixture.pressButton("d:1");
  assert.match(fixture.text(), /Нет доступа.*127/);
  fixture.expectAlert(/Нет доступа.*127/);
});

test("unexpected failures include the update ID without exposing internal details", async context => {
  const userId = 127;
  const updateId = 600;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  context.mock.method(fixture.repository, "getEnabledMember", async () => { throw new Error("secret-db-detail"); });
  context.mock.method(console, "error", () => undefined);
  await assert.rejects(fixture.sendMessage("История", { updateId }), /secret-db-detail/);
  assert.match(fixture.lastText(), /Код: 600/);
  assert.doesNotMatch(fixture.lastText(), /secret-db-detail/);

  // d:<expense ID> — open expense #1.
  await fixture.pressButton("d:1", { updateId: 601 });
  fixture.expectAlert(/Код: 601/);
  assert.match(fixture.text(), /Код: 601/);
});

test("category addition uses ForceReply and enables both expense entry paths", async context => {
  const userId = 127;
  const categoryName = "Дети-School 2026";
  const textAmountRsd = 800;
  const buttonAmountRsd = 500;
  const comment = "Учебники";
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "EUR" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage("Категории");
  assert.match(fixture.lastText(), /Категории/);
  // m1:<operation> — request a new category name.
  await fixture.pressButton("m1:add");
  const prompt = fixture.text();
  fixture.expectForceReply();
  await fixture.replyToPrompt(categoryName, prompt);
  const category = await fixture.categoryNamed(categoryName);
  // The new category must work in full-text expense entry.
  await fixture.sendMessage(`${textAmountRsd} ${categoryName} ${comment}`);
  assert.match(fixture.lastText(), /Сохранено:.*800 EUR/);
  const saved = await fixture.latestExpense();
  assert.equal(saved.categoryId, category.id);
  assert.equal(saved.comment, comment);
  // It must also appear in the amount-only picker: c1:<source update ID>:<amount>:<category ID>.
  await fixture.sendMessage(String(buttonAmountRsd));
  const button = fixture.button(categoryName);
  assert.match(button.callback_data, /^c1:/);
  await fixture.pressButton(button.callback_data);
  assert.equal((await fixture.latestExpense()).categoryId, category.id);
  assert.equal((await fixture.latestExpense()).amountRsd, buttonAmountRsd);
});

test("another member renames a category through ForceReply and updates historical display names", async context => {
  const authorId = 127;
  const editorId = 128;
  const initialName = "Дети-School 2026";
  const renamedName = "Образование";
  const fixture = await createTelegramFixture(editorId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(authorId, "Анна");
  await fixture.seedMember(editorId, "Борис");
  const category = await fixture.seedCategory(initialName);
  const saved = await fixture.seedExpense({ amountRsd: 800, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(authorId) });
  // m1:rename:<stable category ID> — rename the existing category.
  await fixture.pressButton(`m1:rename:${category.id}`);
  const prompt = fixture.text();
  fixture.expectForceReply();
  assert.match(prompt, /прошлых расходов/);
  await fixture.replyToPrompt(renamedName, prompt);
  assert.equal((await fixture.expense(saved.id)).categoryName, renamedName);
  assert.equal((await fixture.category(category.id)).name, renamedName);
  await fixture.sendMessage(`700 ${initialName}`);
  assert.match(fixture.lastText(), /Не удалось распознать/);
});

test("category archiving requires confirmation and preserves historical expenses and totals", async context => {
  const userId = 127;
  const categoryName = "Образование";
  const amountRsd = 800;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  const category = await fixture.seedCategory(categoryName);
  const saved = await fixture.seedExpense({ amountRsd, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(userId) });
  // m1:archive:<stable category ID> — request archiving; confirmation is still required.
  await fixture.pressButton(`m1:archive:${category.id}`);
  assert.equal((await fixture.category(category.id)).active, true);
  assert.match(fixture.text(), /Прошлые расходы останутся/);
  // m1:confirm:<stable category ID> — confirm archiving.
  await fixture.pressButton(`m1:confirm:${category.id}`);
  assert.equal((await fixture.category(category.id)).active, false);
  assert.equal((await fixture.latestExpense()).id, saved.id);
  assert.equal((await fixture.repository.getStatistics("2026-10-01", "2026-10-31")).totalRsd, amountRsd);
});

test("archived categories disappear from current expense menus and full-text entry", async context => {
  const userId = 127;
  const categoryName = "Образование";
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  const category = await fixture.seedCategory(categoryName);
  const saved = await fixture.seedExpense({ amountRsd: 800, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(userId) });
  await fixture.archiveCategory(category.id);
  await fixture.sendMessage("500");
  assert(!fixture.hasButton(categoryName));
  // l:<expense ID> — open the category picker for the saved expense.
  await fixture.pressButton(`l:${saved.id}`);
  assert(!fixture.hasButton(categoryName));
  await fixture.sendMessage(`700 ${categoryName}`);
  assert.match(fixture.lastText(), /Не удалось распознать/);
  assert.equal((await fixture.expenses()).length, 1);
  assert.equal((await fixture.expense(saved.id)).categoryId, category.id);
});

test("an expense in an archived category can still be edited through ForceReply", async context => {
  const userId = 127;
  const initialExpenseDate = "2026-10-01";
  const finalExpenseDate = "2026-10-02";
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  const category = await fixture.seedCategory("Образование");
  const saved = await fixture.seedExpense({ amountRsd: 800, categoryId: category.id, spentOn: initialExpenseDate, createdBy: String(userId) });
  await fixture.archiveCategory(category.id);
  // p:<expense ID>:<field index> — edit the saved expense date (1; amount = 0, comment = 2).
  await fixture.pressButton(`p:${saved.id}:1`);
  await fixture.replyToPrompt("02.10.2026", fixture.text());
  assert.equal((await fixture.expense(saved.id)).spentOn, finalExpenseDate);
});

test("another member restores a category from the archive and enables new expense entry", async context => {
  const authorId = 127;
  const editorId = 128;
  const categoryName = "Образование";
  const originalAmountRsd = 800;
  const newAmountRsd = 500;
  const fixture = await createTelegramFixture(editorId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(authorId, "Анна");
  await fixture.seedMember(editorId, "Борис");
  const category = await fixture.seedCategory(categoryName);
  await fixture.seedExpense({ amountRsd: originalAmountRsd, categoryId: category.id, spentOn: "2026-10-01", createdBy: String(authorId) });
  await fixture.archiveCategory(category.id);
  // m1:<operation> — open the category archive.
  await fixture.pressButton("m1:archived");
  assert.match(fixture.text(), /Архив категорий/);
  // m1:details:<stable category ID> — open the archived category.
  await fixture.pressButton(`m1:details:${category.id}`);
  assert(fixture.hasButton("Восстановить"));
  // m1:restore:<stable category ID> — restore the category for new expenses.
  await fixture.pressButton(`m1:restore:${category.id}`);
  assert.equal((await fixture.category(category.id)).active, true);
  assert.equal((await fixture.categoryNamed(categoryName)).id, category.id);
  await fixture.sendMessage(String(newAmountRsd));
  await fixture.pressButtonNamed(categoryName);
  assert.equal((await fixture.expenses()).length, 2);
  assert.equal((await fixture.latestExpense()).categoryName, categoryName);
  assert.equal((await fixture.repository.getStatistics("2026-01-01", "2026-12-31")).totalRsd, originalAmountRsd + newAmountRsd);
});

test("category prompts reject invalid names, duplicates and replies to another sender", async context => {
  const userId = 129;
  const fixture = await createTelegramFixture(userId, createSettings());
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  // m1:<operation> — request a new category name.
  await fixture.pressButton("m1:add");
  const prompt = fixture.text();
  // Matching prompt text from a non-bot sender does not authorize category creation.
  await fixture.replyToPrompt("Новая категория", prompt, fixture.user);
  assert.match(fixture.lastText(), /запрос редактирования/);
  // A real prompt still rejects punctuation and an existing name with different casing/spacing.
  await fixture.replyToPrompt("Школа!", prompt);
  assert.match(fixture.lastText(), /Название/);
  await fixture.replyToPrompt("  ПРОДУКТЫ ", prompt);
  assert.equal((await fixture.repository.getCategories()).length, categories.length);
  assert.match(fixture.lastText(), /уже существует/);
  fixture.expectMenu();
});

test("obsolete category buttons explain failure without creating or changing an expense", async context => {
  const userId = 130;
  const amountRsd = 500;
  const categoryId = "groceries";
  const fixture = await createTelegramFixture(userId, createSettings({ displayCurrency: "RSD" }));
  context.after(() => fixture.database.dispose());
  await fixture.seedMember(userId, "Анна");
  await fixture.sendMessage(`${amountRsd} продукты`);
  const saved = await fixture.latestExpense();
  // Legacy c:<source update ID>:<amount>:<category index>; e:<expense ID>:<category index>.
  // These pre-stable-ID buttons must reject both creation and editing without data loss.
  for (const data of ["c:9601:700:0", `e:${saved.id}:1`]) {
    await fixture.pressButton(data);
    fixture.expectAlert("Кнопка недействительна");
    assert.equal(fixture.text(), "Кнопка недействительна");
  }
  assert.equal((await fixture.expenses()).length, 1);
  assert.equal((await fixture.expense(saved.id)).categoryId, categoryId);
  assert.equal((await fixture.expense(saved.id)).amountRsd, amountRsd);
});
