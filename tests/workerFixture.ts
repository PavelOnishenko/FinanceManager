import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { CloudflareD1Database, type CloudflareD1Binding } from "../src/storage/CloudflareD1Database";

export async function createWorkerFixture(token: string, secret: string, botId: number) {
  const bundled = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["browser"] });
  const miniflare = new Miniflare({ workers: [
    { config: {
      name: "finance-settings", type: "worker", compatibilityDate: "2026-09-16",
      env: { DB: { type: "d1" }, TELEGRAM_BOT_TOKEN: { type: "text", value: token }, TELEGRAM_WEBHOOK_SECRET: { type: "text", value: secret } },
      manifest: { mainModule: "index.js", modulesRoot: process.cwd(), modules: { "index.js": { type: "esm", contents: bundled.outputFiles[0]!.text } } }
    }, dev: { outboundService: { type: "worker", worker: "telegram-mock" } } },
    { config: {
      name: "telegram-mock", type: "worker", compatibilityDate: "2026-09-16",
      env: { BOT_ID: { type: "text", value: String(botId) }, BOT_TOKEN: { type: "text", value: token } },
      manifest: { mainModule: "mock.js", modulesRoot: process.cwd(), modules: {
        "mock.js": { type: "esm", contents: await readFile(new URL("./mockTelegramApiWorker.js", import.meta.url), "utf8") }
      } }
    } }
  ] });
  const DB = new CloudflareD1Database((await miniflare.getBindings<{ DB: CloudflareD1Binding }>("finance-settings")).DB);
  for (const name of (await readdir(new URL("../migrations/", import.meta.url))).filter(name => name.endsWith(".sql")).sort()) {
    for (const statement of (await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")).split(";").map(part => part.trim()).filter(Boolean))
      await DB.prepare(statement).execute();
  }
  return {
    DB, worker: await miniflare.getWorker("finance-settings"), mock: await miniflare.getWorker("telegram-mock"), dispose: () => miniflare.dispose()
  };
}
