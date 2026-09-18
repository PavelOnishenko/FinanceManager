import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { CloudflareD1Database, type CloudflareD1Binding } from "../src/storage/CloudflareD1Database";

export async function createMigratedLocalD1(workerName: string) {
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: workerName, type: "worker", compatibilityDate: "2026-09-16", env: { DB: { type: "d1" } },
        manifest: { mainModule: "index.js", modulesRoot: process.cwd(), modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok') } }" } } }
      }
    }]
  });
  const bindings = await miniflare.getBindings<{ DB: CloudflareD1Binding }>();
  const DB = new CloudflareD1Database(bindings.DB);
  const migration = await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map(part => part.trim()).filter(Boolean))
    await DB.prepare(statement).execute();
  return { DB, dispose: () => miniflare.dispose() };
}
