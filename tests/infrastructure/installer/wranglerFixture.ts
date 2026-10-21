import { mkdir, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import type { TestContext } from "node:test";
import type { WranglerPaths } from "../../../tools/family-installer/wrangler";
import { temporaryDirectory } from "../temporaryDirectory";

export async function createWranglerFixture(context: TestContext, script: string): Promise<WranglerPaths> {
  const root = await temporaryDirectory(context);
  const paths = {
    nodeExecutable: process.execPath,
    wranglerScript: path.join(root, "fake wrangler.cjs"),
    workingDirectory: path.join(root, "Рабочая папка"),
    configFile: path.join(root, "Рабочая папка", "wrangler.json")
  };
  await mkdir(paths.workingDirectory);
  await writeFile(paths.wranglerScript, script);
  await writeFile(paths.configFile, JSON.stringify({ name: "installer-test" }));
  return paths;
}

export function waitForWranglerStart(context: TestContext, workingDirectory: string): Promise<void> {
  return new Promise(resolve => {
    const watcher = watch(workingDirectory, (_event, filename) => {
      if (filename === "operation-started") {
        watcher.close();
        resolve();
      }
    });
    context.after(() => watcher.close());
  });
}
