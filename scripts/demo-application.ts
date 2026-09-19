import 
{ 
  ApplicationResultKind, 
  createExpenseAfterCategorySelection,
  getExpenseHistory, 
  getPreviousMonthStatistics, 
  processExpenseMessage
} from "../src/application/financeApplication";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";
import { createMigratedLocalD1 } from "./createLocalD1";

const localD1 = await createMigratedLocalD1("application-demo");

try {
  const telegramUserId = "demo-user";
  const expenseTime = new Date("2026-09-18T10:00:00.000Z");
  const reportTime = new Date("2026-10-05T10:00:00.000Z");
  await localD1.DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind(telegramUserId, "Тестовый участник").execute();
  const repository = new D1FinanceRepository(localD1.DB);
  const direct = await processExpenseMessage(repository, {
    telegramUserId, sourceUpdateId: 1001, text: "2490 продукты Lidl", currentTime: expenseTime
  });
  const selection = await processExpenseMessage(repository, {
    telegramUserId, sourceUpdateId: 1002, text: "700", currentTime: expenseTime
  });
  const selected = await createExpenseAfterCategorySelection(repository, {
    telegramUserId, sourceUpdateId: 1002, amountRsd: 700, categoryId: "transport", currentTime: expenseTime
  });
  const duplicate = await createExpenseAfterCategorySelection(repository, {
    telegramUserId, sourceUpdateId: 1002, amountRsd: 700, categoryId: "groceries", currentTime: expenseTime
  });
  const history = await getExpenseHistory(repository, telegramUserId);
  const statistics = await getPreviousMonthStatistics(repository, telegramUserId, reportTime);
  console.log(JSON.stringify({
    directCreated: direct.kind === ApplicationResultKind.ExpenseSaved && direct.created,
    offeredCategories: selection.kind === ApplicationResultKind.CategorySelection ? selection.categories.length : 0,
    selectedCreated: selected.kind === ApplicationResultKind.ExpenseSaved && selected.created,
    duplicateCreated: duplicate.kind === ApplicationResultKind.ExpenseSaved && duplicate.created,
    historyCount: history.kind === ApplicationResultKind.ExpenseHistory ? history.expenses.length : 0,
    previousMonth: statistics.kind === ApplicationResultKind.ExpenseStatistics ? statistics : null
  }, null, 2));
} finally {
  await localD1.dispose();
}
