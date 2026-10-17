import type { UserFromGetMe } from "grammy/types";
import type { InstanceSettings } from "../../../src/config/instanceSettings";
import { createFinanceBot } from "../../../src/telegram/bot";
import { createMigratedLocalD1 } from "../../../scripts/createLocalD1";
import { CreateExpenseInput, D1FinanceRepository } from "../../../src/storage/D1FinanceRepository";
import assert from "node:assert/strict";
import { seedMember } from "../seedMember";
import { createTelegramUpdates } from "./telegramUpdates";
import { createTelegramDriver } from "./telegramDriver";
import { createTelegramOutput, type TelegramApiCall } from "./telegramOutput";
import { expectRepositorySuccess } from "../repositoryAssertions";

type SeedExpense = Omit<CreateExpenseInput, "sourceActionKey">;
let telegramFixtureNumber = 0;

function createTestBotInfo(botId: number): UserFromGetMe {
  return {
    id: botId,
    is_bot: true,
    first_name: "Test",
    username: "test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false
  };
}

export async function createTelegramFixture(userId: number, settings: InstanceSettings) {
  const database = await createMigratedLocalD1(`telegram-scenario-${++telegramFixtureNumber}`);
  const repository = new D1FinanceRepository(database.DB);
  const updates = createTelegramUpdates(userId);
  const botInfo = createTestBotInfo(999);
  const calls: TelegramApiCall[] = [];
  const bot = createFinanceBot("123:fixture", repository, async () => settings);
  bot.botInfo = botInfo;
  bot.api.config.use(async (_previous, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: method === "sendMessage" ? { message_id: 20, date: 0, chat: updates.chat } : true } as never;
  });
  const output = createTelegramOutput(() => calls);
  const driver = createTelegramDriver(userId, botInfo, update => bot.handleUpdate(update));
  let seedNumber = 0;
  const seedExpense = async (input: SeedExpense) =>
    expectRepositorySuccess(await repository.createExpense({ ...input, sourceActionKey: `seed:${++seedNumber}` })).expense;
  const seedExpenses = async (inputs: SeedExpense[]) => {
    for (const input of inputs)
      await seedExpense(input);
  };
  const expense = async (id: number) => {
    const saved = await repository.getExpenseById(id);
    assert(saved, `Expected expense #${id} to exist`);
    return saved;
  };
  const latestExpense = async () => {
    const saved = (await repository.getRecentExpenses())[0];
    assert(saved, "Expected a saved expense");
    return saved;
  };
  const category = async (id: string) => {
    const saved = await repository.getCategory(id);
    assert(saved, `Expected category ${JSON.stringify(id)} to exist`);
    return saved;
  };
  const categoryNamed = async (name: string) => {
    const category = (await repository.getCategories()).find(category => category.name === name);
    assert(category, `Expected category ${JSON.stringify(name)} to exist`);
    return category;
  };
  return {
    database,
    repository,
    ...driver,
    ...output,
    expense,
    latestExpense,
    category,
    categoryNamed,
    seedCategory: async (name: string) => expectRepositorySuccess(await repository.addCategory(name)),
    pressButtonNamed: (text: string) => driver.pressButton(output.button(text).callback_data),
    expenses: () => repository.getRecentExpenses(),
    archiveCategory: async (id: string) => expectRepositorySuccess(await repository.setCategoryActive(id, false)),
    disableMember: (id: number) => database.DB.prepare("UPDATE members SET enabled = 0 WHERE telegram_user_id = ?").bind(String(id)).execute(),
    seedMember: (id: number, name: string) => seedMember(database.DB, id, name),
    seedExpense,
    seedExpenses
  };
}
