import { InlineKeyboard, type Context, type Keyboard } from "grammy";
import { isValidCategoryId } from "../config/categories";
import { manageCategories } from "../application/categoryApplication";
import type { D1FinanceRepository } from "../storage/D1FinanceRepository";
import { formatCallbackData, type BotAction } from "./callbackData";

type CategoryAction = Extract<BotAction, { kind: "manage-category" }>;
const renameWarning = "Переименование: новое название будет отображаться и у прошлых расходов.";
const archiveWarning = "Архивирование: категория исчезнет из выбора для новых расходов. "
  + "Прошлые расходы останутся в истории и статистике. Её название нельзя будет использовать для другой категории.";
const nameInstructions = "Отправьте название: 1–80 символов, русские/английские буквы, цифры 0–9, пробелы и дефис «-».";

function categoryCallback(operation: CategoryAction["operation"], categoryId?: string): string {
  return formatCallbackData({ kind: "manage-category", operation, categoryId });
}

function categoryResultError(result: Awaited<ReturnType<typeof manageCategories>>): string | undefined {
  if (result.kind === "access-denied")
    return `Нет доступа. Ваш Telegram ID: ${result.telegramUserId}`;
  if (result.kind === "invalid-input")
    return result.message;
  return undefined;
}

export async function showCategoryList(context: Context, repository: D1FinanceRepository, archived = false): Promise<void> {
  const result = await manageCategories(repository, String(context.from!.id), { kind: "list", active: !archived });
  if (result.kind !== "categories") {
    await context.reply(categoryResultError(result)!);
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const category of result.categories)
    keyboard.text(category.name, categoryCallback("details", category.id)).row();
  if (archived)
    keyboard.text("Активные категории", categoryCallback("list"));
  else
    keyboard.text("Добавить", categoryCallback("add")).text("Архив", categoryCallback("archived"));
  await context.reply(archived ? "Архив категорий:" : "Категории: выберите категорию или добавьте новую.", { reply_markup: keyboard });
}

export async function handleCategoryAction(context: Context, repository: D1FinanceRepository, action: CategoryAction): Promise<void> {
  if (action.operation === "list" || action.operation === "archived") {
    await showCategoryList(context, repository, action.operation === "archived");
    return;
  }
  // Recheck access even for prompts and confirmations.
  const result = await manageCategories(repository, String(context.from!.id), action.operation === "add"
    ? { kind: "list", active: true } : { kind: "details", categoryId: action.categoryId! });
  if (categoryResultError(result)) {
    await context.reply(categoryResultError(result)!);
    return;
  }
  if (action.operation === "add" || action.operation === "rename") {
    await context.reply(action.operation === "add" ? `Добавление категории\n\n${nameInstructions}`
      : `Переименование категории · ${action.categoryId}\n\n${renameWarning}\n${nameInstructions}`,
    { reply_markup: { force_reply: true, selective: true } });
    return;
  }
  if (result.kind !== "category")
    return;
  if (action.operation === "details") {
    const keyboard = new InlineKeyboard().text("Переименовать", categoryCallback("rename", result.category.id)).row();
    keyboard.text(result.category.active ? "Архивировать" : "Восстановить",
      categoryCallback(result.category.active ? "archive" : "restore", result.category.id)).row().text("Назад", categoryCallback("list"));
    await context.reply(`${result.category.name}${result.category.active ? "" : " (в архиве)"}\n\n${renameWarning}\n\n${archiveWarning}`,
      { reply_markup: keyboard });
    return;
  }
  if (action.operation === "archive") {
    await context.reply(`Архивировать «${result.category.name}»?\n${archiveWarning}`, {
      reply_markup: new InlineKeyboard().text("Да, архивировать", categoryCallback("confirm", result.category.id))
        .text("Назад", categoryCallback("details", result.category.id))
    });
    return;
  }
  const saved = await manageCategories(repository, String(context.from!.id), {
    kind: "active", categoryId: result.category.id, active: action.operation === "restore"
  });
  await context.reply(categoryResultError(saved) ?? (action.operation === "restore" ? "Категория восстановлена." : "Категория архивирована."));
  if (saved.kind === "category-saved")
    await showCategoryList(context, repository);
}

export async function handleCategoryReply(context: Context, repository: D1FinanceRepository, prompt: string, text: string, menu: Keyboard): Promise<boolean> {
  const match = /^(Добавление категории|Переименование категории)(?: · ([A-Za-z0-9_-]+))?$/.exec(prompt.split("\n", 1)[0]!);
  if (!match || (match[1] === "Добавление категории" ? !!match[2] : !isValidCategoryId(match[2] ?? "")))
    return false;
  const result = await manageCategories(repository, String(context.from!.id), match[1] === "Добавление категории"
    ? { kind: "add", name: text } : { kind: "rename", categoryId: match[2]!, name: text });
  await context.reply(categoryResultError(result) ?? "Категория сохранена.", { reply_markup: menu });
  if (result.kind === "category-saved")
    await showCategoryList(context, repository);
  return true;
}
