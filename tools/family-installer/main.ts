import path from "node:path";
import { validatePackage } from "./package";
import { RELEASE_VERSION } from "./release";

async function main() {
  const migrations = await validatePackage(path.resolve(__dirname, ".."));
  console.log(`Комплект релиза ${RELEASE_VERSION} проверен. Миграций: ${migrations.length}.`);
  console.log("Это предварительная сборка. Мастер установки и обновления пока недоступен (задачи 3–6).");
  console.log("Подключение к Cloudflare и Telegram не выполнялось. См. RELEASE_NOTES.ru.md.");
}

main().catch(() => {
  console.error("Комплект релиза повреждён или неполон. Распакуйте доверенный архив заново.");
  process.exitCode = 1;
});
