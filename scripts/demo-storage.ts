import { createMigratedLocalD1 } from "./createLocalD1";
import { D1FinanceRepository } from "../src/storage/D1FinanceRepository";

const localD1 = await createMigratedLocalD1("storage-demo");

try {
  const { DB } = localD1;
  await DB.prepare("INSERT INTO members (telegram_user_id, display_name) VALUES (?, ?)").bind("demo-user", "Тестовый участник").execute();
  const repository = new D1FinanceRepository(DB);
  const input = {
    sourceActionKey: "demo:1",
    amountRsd: 2490,
    categoryId: "groceries" as const,
    spentOn: "2026-09-17",
    comment: "Lidl",
    createdBy: "demo-user"
  };
  const first = await repository.createExpense(input);
  const duplicate = await repository.createExpense(input);
  console.log(JSON.stringify(
    { 
      firstCreated: first.created, duplicateCreated: duplicate.created, history: await repository.getRecentExpenses(), 
      statistics: await repository.getStatistics("2026-09-17", "2026-09-17") 
    }, 
    null, 2));
} finally {
  await localD1.dispose();
}
