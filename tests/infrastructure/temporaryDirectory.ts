import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

export async function temporaryDirectory(context: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "family package with spaces "));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
