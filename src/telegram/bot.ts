import { Bot, InlineKeyboard, Keyboard, type Context } from "grammy";
import { categories } from "../config/categories";
import {
  ApplicationResultKind as Result, checkAccess, createExpenseAfterCategorySelection, deleteExpense, editExpense, getExpenseDetails,
  getExpenseHistory, getPreviousMonthStatistics, processExpenseMessage, type AccessDenied, type InvalidInput
} from "../application/financeApplication";
import { createEditPrompt, parseEditPrompt } from "../domain/editPrompt";
import type { D1FinanceRepository, Expense } from "../storage/D1FinanceRepository";
import { formatCallbackData, parseCallbackData, type BotAction } from "./callbackData";
import { parseEditReply } from "./parseEditReply";

const menu = new Keyboard().text("История").text("Статистика").text("Помощь").resized().persistent();
const help = "Отправьте расход: 2490 продукты Lidl или просто 2490 и выберите категорию. Дата редактирования: ДД.ММ.ГГГГ.";

export function createFinanceBot(token: string, repository: D1FinanceRepository) {
  const bot = new Bot(token);
  bot.use(async (context, next) => {
    try {
      await next();
    } catch (error) {
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
    if (text === "Помощь") return void await context.reply(help, { reply_markup: menu });
    if (text === "История") {
      const result = await getExpenseHistory(repository, String(context.from.id));
      if (result.kind === Result.AccessDenied) return void await context.reply(accessDeniedText(result.telegramUserId));
      const keyboard = new InlineKeyboard(result.expenses.map(expense => [{
        text: `#${expense.id} · ${expense.amountRsd} RSD · ${expense.categoryName}`,
        callback_data: formatCallbackData({ kind: "details", expenseId: expense.id })
      }]));
      return void await context.reply(result.expenses.length ? "Последние 10 расходов:" : "Расходов пока нет.", { reply_markup: keyboard });
    }
    if (text === "Статистика") {
      const result = await getPreviousMonthStatistics(repository, String(context.from.id), new Date());
      if (result.kind !== Result.ExpenseStatistics)
        return void await context.reply(result.kind === Result.AccessDenied ? accessDeniedText(result.telegramUserId) : result.message);
      const lines = result.statistics.categoryTotals.map(category => `${category.categoryName}: ${category.amountRsd} RSD`);
      return void await context.reply(`${result.range.fromDate} — ${result.range.toDate}\nИтого: ${result.statistics.totalRsd} RSD`
        + (lines.length ? `\n${lines.join("\n")}` : ""));
    }

    const target = context.message.reply_to_message;
    if (target) {
      const edit = target.from?.id === context.me.id && "text" in target && typeof target.text === "string" ? parseEditPrompt(target.text) : undefined;
      if (!edit) return void await context.reply("Ответьте на запрос редактирования, отправленный этим ботом.");
      const parsed = parseEditReply(edit.field, text.trim());
      if ("error" in parsed) return void await context.reply(parsed.error);
      const result = await editExpense(repository, String(context.from.id), edit.expenseId, parsed.edit);
      return void await context.reply(result.kind === Result.ExpenseUpdated ? `Обновлено: ${describe(result.expense)}`
        : result.kind === Result.InvalidInput ? result.message : result.kind === Result.AccessDenied
          ? accessDeniedText(result.telegramUserId) : "Расход не найден.");
    }

    const result = await processExpenseMessage(repository, {
      telegramUserId: String(context.from.id), sourceUpdateId: context.update.update_id, text, currentTime: new Date()
    });
    if (result.kind === Result.InvalidInput) return void await context.reply(result.message);
    if (result.kind === Result.AccessDenied) return void await context.reply(accessDeniedText(result.telegramUserId));
    if (result.kind === Result.ExpenseSaved) return void await context.reply(result.created ? `Сохранено: ${describe(result.expense)}` : "Расход уже сохранён");
    if (result.kind === Result.CategorySelection) {
      const keyboard = new InlineKeyboard(result.categories.map(category => [{
        text: category.name,
        callback_data: formatCallbackData({ kind: "create", sourceUpdateId: result.sourceUpdateId, amountRsd: result.amountRsd, categoryId: category.id })
      }]));
      await context.reply(`${result.amountRsd} RSD · выберите категорию:`, { reply_markup: keyboard });
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
      if (action.kind === "create") {
        const result = await createExpenseAfterCategorySelection(repository, {
          telegramUserId: userId, sourceUpdateId: action.sourceUpdateId, amountRsd: action.amountRsd,
          categoryId: action.categoryId, currentTime: new Date()
        });
        if (result.kind === Result.ExpenseSaved) {
          acknowledgement = result.created ? "Расход сохранён" : "Расход уже сохранён";
          if (result.created) await context.editMessageText(`Сохранено: ${describe(result.expense)}`);
        } else acknowledgement = result.kind === Result.InvalidInput ? result.message : accessDeniedText(result.telegramUserId);
      } else if (action.kind === "details") {
        const result = await getExpenseDetails(repository, userId, action.expenseId);
        if (result.kind !== Result.ExpenseDetails) return void (acknowledgement = callbackFailure(result));
        await context.reply(describe(result.expense), { reply_markup: detailButtons(action.expenseId) });
      } else if (action.kind === "edit-prompt") {
        const result = await getExpenseDetails(repository, userId, action.expenseId);
        if (result.kind !== Result.ExpenseDetails) return void (acknowledgement = callbackFailure(result));
        await context.reply(createEditPrompt(action), { reply_markup: { force_reply: true, selective: true } });
      } else if (action.kind === "edit-category") {
        const result = await editExpense(repository, userId, action.expenseId, { field: "category", categoryId: action.categoryId });
        if (result.kind === Result.ExpenseUpdated) await context.reply(`Обновлено: ${describe(result.expense)}`);
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
      console.error(`Callback update ${context.update.update_id} failed`, error);
      acknowledgement = failureText(context.update.update_id);
      showAlert = true;
    } finally {
      const isProblem = !!acknowledgement && !["Расход сохранён", "Расход удалён", "Расход уже сохранён"].includes(acknowledgement);
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

function describe(expense: Expense): string {
  return `#${expense.id} · ${expense.amountRsd} RSD · ${expense.categoryName} · ${expense.spentOn} · ${expense.authorName}`
    + (expense.comment ? ` · ${expense.comment}` : "");
}

function detailButtons(expenseId: number): InlineKeyboard {
  const button = (label: string, action: BotAction) => new InlineKeyboard().text(label, formatCallbackData(action));
  const keyboard = button("Сумма", { kind: "edit-prompt", expenseId, field: "amount" })
    .text("Дата", formatCallbackData({ kind: "edit-prompt", expenseId, field: "date" }))
    .text("Комментарий", formatCallbackData({ kind: "edit-prompt", expenseId, field: "comment" })).row();
  for (const category of categories) keyboard.text(category.name, formatCallbackData({ kind: "edit-category", expenseId, categoryId: category.id })).row();
  return keyboard.text("Удалить", formatCallbackData({ kind: "delete-request", expenseId }));
}
