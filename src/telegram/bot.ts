import { InstanceConfigurationError, type InstanceSettingsLoader } from "../config/instanceSettings";
import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import type { CategoryOption } from "../config/categories";
import { handleCategoryAction, handleCategoryReply, showCategoryList } from "./categoryManagement";
import {
  ApplicationResultKind as Result, checkAccess, createExpenseAfterCategorySelection, deleteExpense, editExpense, getExpenseDetails,
  getExpenseHistory, getExpenseHistoryForRange, getPreviousMonthStatistics, getStatisticsForRange, processExpenseMessage, type AccessDenied, type InvalidInput
} from "../application/financeApplication";
import { firstStatisticsYear, getCalendarMonthRange, getDateInFinanceTimeZone, type DateRange } from "../application/dateRange";
import { createEditPrompt, parseEditPrompt } from "../domain/editPrompt";
import type { D1FinanceRepository, Expense } from "../storage/D1FinanceRepository";
import { formatCallbackData, parseCallbackData } from "./callbackData";
import { parseEditReply } from "./parseEditReply";
import { addMonthNavigation, calendarButtons, calendarText } from "./periodPicker";
import { periodHistoryView, recentHistoryView } from "./historyView";

const menu = new Keyboard().text("История").text("Статистика").text("Категории").text("Помощь").resized().persistent();
const help = "Отправьте расход: 2490 продукты Lidl или просто 2490 и выберите категорию. Дата редактирования: ДД.ММ.ГГГГ.";
const invalidRangeText = "Конец периода не может быть раньше начала";
const statisticsStartText = `Статистика доступна с ${firstStatisticsYear} года.`;
const statisticsYearLimitText = `${statisticsStartText} Откройте её заново.`;
const historyYearLimitText = `История доступна с ${firstStatisticsYear} года. Откройте её заново.`;
const percentageFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export function createFinanceBot(token: string, repository: D1FinanceRepository, loadSettings: InstanceSettingsLoader) {
  const bot = new Bot(token);
  bot.use(async (context, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof InstanceConfigurationError)
        throw error;
      console.error(`Telegram update ${context.update.update_id} failed`, error);
      try {
        if (context.chat) await context.reply(failureText(context.update.update_id));
      } catch (notificationError) {
        console.error(`Could not notify user for update ${context.update.update_id}`, notificationError);
      }
      throw error;
    }
  });
  bot.command("start", async context => {
    if (!await allowMessage(context, repository)) return;
    await context.reply(`Добро пожаловать! ${help}`, { reply_markup: menu });
  });
  bot.command("help", async context => {
    if (await allowMessage(context, repository)) await context.reply(help, { reply_markup: menu });
  });

  bot.on("message:text", async context => {
    if (!await allowMessage(context, repository)) return;
    const text = context.message.text;
    if (text === "Категории") {
      await showCategoryList(context, repository);
      return;
    }
    if (text === "Помощь") return void await context.reply(help, { reply_markup: menu });
    if (text === "История") {
      const result = await getExpenseHistory(repository, String(context.from.id));
      if (result.kind === Result.AccessDenied) return void await context.reply(accessDeniedText(result.telegramUserId));
      const view = recentHistoryView(result.expenses, result.expenses.length ? (await loadSettings()).displayCurrency : undefined);
      return void await context.reply(view.text, { reply_markup: view.reply_markup });
    }
    if (text === "Статистика") {
      const settings = await loadSettings();
      const result = await getPreviousMonthStatistics(repository, String(context.from.id), new Date(), settings.financeTimeZone);
      if (result.kind !== Result.ExpenseStatistics)
        return void await context.reply(result.kind === Result.AccessDenied ? accessDeniedText(result.telegramUserId) : result.message);
      if (!getCalendarMonthRange(result.range.fromDate.slice(0, 7))) return void await context.reply(statisticsStartText);
      return void await context.reply(statisticsText(result, settings.displayCurrency), { reply_markup: statisticsButtons(result.range.fromDate.slice(0, 7)) });
    }

    const target = context.message.reply_to_message;
    if (target) {
      if (target.from?.id === context.me.id && "text" in target && typeof target.text === "string"
          && await handleCategoryReply(context, repository, target.text, text, menu))
        return;
      const edit = target.from?.id === context.me.id && "text" in target && typeof target.text === "string" ? parseEditPrompt(target.text) : undefined;
      if (!edit) return void await context.reply("Ответьте на запрос редактирования, отправленный этим ботом.", { reply_markup: menu });
      const settings = await loadSettings();
      const parsed = parseEditReply(edit.field, text.trim(), settings.displayCurrency);
      if ("error" in parsed) return void await context.reply(parsed.error, { reply_markup: menu });
      const result = await editExpense(repository, String(context.from.id), edit.expenseId, parsed.edit, settings.displayCurrency);
      if (result.kind === Result.ExpenseUpdated)
        return void await context.reply(`Обновлено: ${describe(result.expense, settings.displayCurrency)}`, { reply_markup: menu });
      if (result.kind === Result.InvalidInput)
        return void await context.reply(result.message, { reply_markup: menu });
      if (result.kind === Result.AccessDenied)
        return void await context.reply(accessDeniedText(result.telegramUserId), { reply_markup: menu });
      return void await context.reply("Расход не найден.", { reply_markup: menu });
    }

    const settings = await loadSettings();
    const result = await processExpenseMessage(repository, {
      telegramUserId: String(context.from.id), sourceUpdateId: context.update.update_id, text, currentTime: new Date()
    }, settings);
    if (result.kind === Result.InvalidInput) return void await context.reply(result.message);
    if (result.kind === Result.AccessDenied) return void await context.reply(accessDeniedText(result.telegramUserId));
    if (result.kind === Result.ExpenseSaved)
      return void await context.reply(result.created ? `Сохранено: ${describe(result.expense, settings.displayCurrency)}` : "Расход уже сохранён");
    if (result.kind === Result.CategorySelection) {
      const keyboard = new InlineKeyboard(result.categories.map(category => [{
        text: category.name,
        callback_data: formatCallbackData({ kind: "create", sourceUpdateId: result.sourceUpdateId, amountRsd: result.amountRsd, categoryId: category.id })
      }]));
      await context.reply(`${result.amountRsd} ${settings.displayCurrency} · выберите категорию:`, { reply_markup: keyboard });
    }
  });

  bot.on("message", async context => {
    if (!await allowMessage(context, repository)) return;
    await context.reply("Поддерживаются только текстовые сообщения. Отправьте, например: 2490 продукты Lidl.");
  });

  bot.on("callback_query:data", async context => {
    let acknowledgement = "";
    let showAlert = false;
    try {
      const denial = await getAccessDenial(context, repository);
      if (denial) {
        acknowledgement = denial;
        showAlert = true;
        return;
      }
      const action = parseCallbackData(context.callbackQuery.data);
      if (!action) {
        acknowledgement = "Кнопка недействительна";
        showAlert = true;
        return;
      }
      const userId = String(context.from.id);
      if (action.kind === "statistics-year-too-old" || action.kind === "history-year-too-old") {
        acknowledgement = action.kind === "history-year-too-old" ? historyYearLimitText : statisticsYearLimitText;
        showAlert = true;
        return;
      }
      if (action.kind === "manage-category") {
        await handleCategoryAction(context, repository, action);
        return;
      }
      if (action.kind === "calendar-noop") return;
      if (action.kind === "history-recent") {
        const result = await getExpenseHistory(repository, userId);
        if (result.kind === Result.AccessDenied)
          return void (acknowledgement = accessDeniedText(result.telegramUserId));
        const view = recentHistoryView(result.expenses, result.expenses.length ? (await loadSettings()).displayCurrency : undefined);
        await context.editMessageText(view.text, { reply_markup: view.reply_markup });
      } else if (action.kind === "history-picker") {
        const month = getDateInFinanceTimeZone(new Date(), (await loadSettings()).financeTimeZone).slice(0, 7);
        await context.editMessageText(calendarText(month), { reply_markup: calendarButtons(month, "history") });
      } else if (action.kind === "history-month") {
        acknowledgement = await showHistoryPeriod(context, repository, userId, getCalendarMonthRange(action.month)!, 0, loadSettings);
      } else if (action.kind === "history-page") {
        acknowledgement = await showHistoryPeriod(context, repository, userId, action, action.page, loadSettings);
      } else if (action.kind === "statistics-month") {
        const range = getCalendarMonthRange(action.month)!;
        const result = await getStatisticsForRange(repository, userId, range);
        if (result.kind !== Result.ExpenseStatistics) 
          return void (acknowledgement = result.kind === Result.AccessDenied ? accessDeniedText(result.telegramUserId) : result.message);
        await context.editMessageText(statisticsText(result, (await loadSettings()).displayCurrency), { reply_markup: statisticsButtons(action.month) });
      } else if (action.kind === "calendar") {
        await context.editMessageText(calendarText(action.month, action.startDate), {
          reply_markup: calendarButtons(action.month, action.destination, action.startDate)
        });
      } else if (action.kind === "calendar-day") {
        const selectedDate = `${action.month}-${String(action.day).padStart(2, "0")}`;
        if (!action.startDate) 
          await context.editMessageText(calendarText(action.month, selectedDate), {
            reply_markup: calendarButtons(action.month, action.destination, selectedDate)
          });
        else if (selectedDate < action.startDate) {
          acknowledgement = invalidRangeText;
          showAlert = true;
        } else if (action.destination === "history") {
          acknowledgement = await showHistoryPeriod(context, repository, userId,
            { fromDate: action.startDate, toDate: selectedDate }, 0, loadSettings);
        } else {
          const result = await getStatisticsForRange(repository, userId, { fromDate: action.startDate, toDate: selectedDate });
          if (result.kind !== Result.ExpenseStatistics) 
            return void (acknowledgement = result.kind === Result.AccessDenied ? accessDeniedText(result.telegramUserId) : result.message);
          await context.editMessageText(statisticsText(result, (await loadSettings()).displayCurrency), {
            reply_markup: new InlineKeyboard().text("Другой период", formatCallbackData({ kind: "calendar", month: action.month, destination: "statistics" }))
          });
        }
      } else if (action.kind === "create") {
        const settings = await loadSettings();
        const result = await createExpenseAfterCategorySelection(repository, {
          telegramUserId: userId, sourceUpdateId: action.sourceUpdateId, amountRsd: action.amountRsd,
          categoryId: action.categoryId, currentTime: new Date()
        }, settings);
        if (result.kind === Result.ExpenseSaved) {
          acknowledgement = result.created ? "Расход сохранён" : "Расход уже сохранён";
          if (result.created)
            await context.editMessageText(`Сохранено: ${describe(result.expense, settings.displayCurrency)}`);
        } else acknowledgement = result.kind === Result.InvalidInput ? result.message : accessDeniedText(result.telegramUserId);
      } else if (action.kind === "details") {
        const result = await getExpenseDetails(repository, userId, action.expenseId);
        if (result.kind !== Result.ExpenseDetails) return void (acknowledgement = callbackFailure(result));
        await context.reply(describe(result.expense, (await loadSettings()).displayCurrency), { reply_markup: detailButtons(action.expenseId) });
      } else if (action.kind === "category-list" || action.kind === "edit-actions") {
        const result = await getExpenseDetails(repository, userId, action.expenseId);
        if (result.kind !== Result.ExpenseDetails)
          return void (acknowledgement = callbackFailure(result));
        if (action.kind === "category-list")
          await context.editMessageText(`Выберите категорию для расхода #${action.expenseId}:`, {
            reply_markup: categoryButtons(action.expenseId, await repository.getCategories())
          });
        else
          await context.editMessageText(describe(result.expense, (await loadSettings()).displayCurrency), {
            reply_markup: detailButtons(action.expenseId)
          });
      } else if (action.kind === "edit-prompt") {
        const result = await getExpenseDetails(repository, userId, action.expenseId);
        if (result.kind !== Result.ExpenseDetails) return void (acknowledgement = callbackFailure(result));
        await context.reply(createEditPrompt(action, action.field === "amount" ? (await loadSettings()).displayCurrency : undefined), {
          reply_markup: { force_reply: true, selective: true }
        });
      } else if (action.kind === "edit-category") {
        const settings = await loadSettings();
        const result = await editExpense(repository, userId, action.expenseId, { field: "category", categoryId: action.categoryId }, settings.displayCurrency);
        if (result.kind === Result.ExpenseUpdated)
          await context.reply(`Обновлено: ${describe(result.expense, settings.displayCurrency)}`);
        else acknowledgement = callbackFailure(result);
      } else if (action.kind === "delete-request") {
        const result = await getExpenseDetails(repository, userId, action.expenseId);
        if (result.kind !== Result.ExpenseDetails) return void (acknowledgement = callbackFailure(result));
        await context.reply(`Удалить расход #${action.expenseId}?`, {
          reply_markup: new InlineKeyboard().text("Да, удалить", formatCallbackData({ kind: "delete-confirm", expenseId: action.expenseId }))
        });
      } else {
        const result = await deleteExpense(repository, userId, action.expenseId);
        acknowledgement = result.kind === Result.ExpenseDeleted ? "Расход удалён" : callbackFailure(result);
        if (result.kind === Result.ExpenseDeleted) await context.editMessageText(`Расход #${action.expenseId} удалён.`);
      }
    } catch (error) {
      if (error instanceof InstanceConfigurationError) {
        acknowledgement = "Бот не настроен. Обратитесь к владельцу.";
        showAlert = true;
        throw error;
      }
      console.error(`Callback update ${context.update.update_id} failed`, error);
      acknowledgement = failureText(context.update.update_id);
      showAlert = true;
    } finally {
      const isProblem = !!acknowledgement && ![
        "Расход сохранён", "Расход удалён", "Расход уже сохранён", invalidRangeText, statisticsYearLimitText, historyYearLimitText
      ].includes(acknowledgement);
      if (isProblem && context.chat?.type === "private") {
        try {
          await context.reply(acknowledgement);
        } catch (error) {
          console.error(`Could not send callback explanation for update ${context.update.update_id}`, error);
        }
      }
      await context.answerCallbackQuery({ text: acknowledgement, show_alert: showAlert || isProblem || acknowledgement === "Расход уже сохранён" });
    }
  });

  bot.on("callback_query", async context => {
    await context.answerCallbackQuery({ text: "Кнопка не поддерживается", show_alert: true });
  });

  return bot;
}

async function allowMessage(context: Context, repository: D1FinanceRepository): Promise<boolean> {
  const denial = await getAccessDenial(context, repository);
  if (!denial) return true;
  if (context.chat) await context.reply(denial);
  return false;
}

async function getAccessDenial(context: Context, repository: D1FinanceRepository): Promise<string | undefined> {
  if (!context.from) return "Не удалось определить ваш Telegram ID. Отправьте сообщение лично от своего аккаунта.";
  if (context.chat?.type !== "private") return "Бот работает только в личном чате. Напишите ему напрямую.";
  const result = await checkAccess(repository, String(context.from.id));
  return result.kind === Result.AccessDenied ? accessDeniedText(result.telegramUserId) : undefined;
}

function accessDeniedText(telegramUserId: string): string {
  return `Нет доступа. Ваш Telegram ID: ${telegramUserId}`;
}

function callbackFailure(result: AccessDenied | InvalidInput | { kind: typeof Result.ExpenseNotFound }): string {
  if (result.kind === Result.AccessDenied) return accessDeniedText(result.telegramUserId);
  if (result.kind === Result.InvalidInput) return result.message;
  return "Расход не найден";
}

function failureText(updateId: number): string {
  return `Ошибка обработки. Если добавляли или меняли расход, проверьте «История» перед повтором. Код: ${updateId}`;
}

function describe(expense: Expense, displayCurrency: string): string {
  return `#${expense.id} · ${expense.amountRsd} ${displayCurrency} · ${expense.categoryName} · ${expense.spentOn} · ${expense.authorName}`
    + (expense.comment ? ` · ${expense.comment}` : "");
}

function statisticsText(result: Extract<Awaited<ReturnType<typeof getStatisticsForRange>>, { kind: typeof Result.ExpenseStatistics }>, displayCurrency: string): string {
  const lines = result.statistics.categoryTotals.map(category =>
    `${category.categoryName}: ${category.amountRsd} ${displayCurrency} (${percentageFormatter.format(category.amountRsd / result.statistics.totalRsd * 100)}%)`
  );
  return `${result.range.fromDate} — ${result.range.toDate}\nИтого: ${result.statistics.totalRsd} ${displayCurrency}`
    + (lines.length ? `\n${lines.join("\n")}` : "");
}

function statisticsButtons(month: string): InlineKeyboard {
  const keyboard = addMonthNavigation(new InlineKeyboard(), month, "statistics");
  return keyboard.row().text("Другой период", formatCallbackData({ kind: "calendar", month, destination: "statistics" }));
}

async function showHistoryPeriod(context: Context, repository: D1FinanceRepository, userId: string, range: DateRange, page: number,
    loadSettings: InstanceSettingsLoader): Promise<string> {
  const result = await getExpenseHistoryForRange(repository, userId, range, page);
  if (result.kind !== Result.ExpenseHistory)
    return result.kind === Result.AccessDenied ? accessDeniedText(result.telegramUserId) : result.message;
  const view = periodHistoryView(result, result.expenses.length ? (await loadSettings()).displayCurrency : undefined);
  await context.editMessageText(view.text, { reply_markup: view.reply_markup });
  return "";
}

function detailButtons(expenseId: number): InlineKeyboard {
  return new InlineKeyboard().text("Сумма", formatCallbackData({ kind: "edit-prompt", expenseId, field: "amount" }))
    .text("Дата", formatCallbackData({ kind: "edit-prompt", expenseId, field: "date" }))
    .text("Комментарий", formatCallbackData({ kind: "edit-prompt", expenseId, field: "comment" })).row()
    .text("Категория", formatCallbackData({ kind: "category-list", expenseId })).row()
    .text("Удалить", formatCallbackData({ kind: "delete-request", expenseId }));
}

function categoryButtons(expenseId: number, activeCategories: readonly CategoryOption[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const category of activeCategories)
    keyboard.text(category.name, formatCallbackData({ kind: "edit-category", expenseId, categoryId: category.id })).row();
  return keyboard.text("Назад", formatCallbackData({ kind: "edit-actions", expenseId }));
}
