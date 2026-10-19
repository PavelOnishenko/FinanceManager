import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { configTemplate, FIXED_FILES, migrationSequence, packageFile, validatePackage } from "../tools/family-installer/package";
import { COMPATIBILITY_DATE, RELEASE_VERSION } from "../tools/family-installer/release";
import { copyToolchain, type Lock } from "../tools/family-installer/toolchain";
import { distributionFiles, writeZip } from "../tools/family-installer/zip";

const repository = fileURLToPath(new URL("../", import.meta.url));

export async function buildFamilyRelease(toolchain: string, outputParent: string) {
  const output = path.resolve(outputParent);
  const relativeOutput = path.relative(path.resolve(toolchain), output);
  assert(relativeOutput === ".." || relativeOutput.startsWith(".." + path.sep) || path.isAbsolute(relativeOutput),
    "Output must be outside toolchain to prevent recursive copying");
  await mkdir(output, { recursive: true });
  const scratch = await mkdtemp(path.join(output, ".family-build-"));
  const stage = path.join(scratch, "package");
  await mkdir(stage);
  try {
    const notices = await copyToolchain(path.resolve(toolchain), stage,
      JSON.parse(await readFile(path.join(repository, "package-lock.json"), "utf8")) as Lock);
    const migrations = migrationSequence(await readdir(path.join(repository, "migrations")));
    await mkdir(path.join(stage, "migrations"));
    for (const name of migrations)
      await cp(await packageFile(path.join(repository, "migrations"), name), path.join(stage, "migrations", name));
    await writeFile(path.join(stage, "wrangler.template.json"), JSON.stringify(configTemplate(), null, 2) + "\n");
    for (const name of ["Start setup.cmd", "RELEASE_NOTES.ru.md"])
      await cp(path.join(repository, "tools/family-installer/assets", name), path.join(stage, name));
    await writeFile(path.join(stage, "Start setup.cmd"),
      (await readFile(path.join(stage, "Start setup.cmd"), "utf8")).replace(/\r?\n/g, "\r\n"));
    // No source wrangler.jsonc, env files, plugins, or owner-side application compilation.
    const workerBuild = await build({
      absWorkingDir: repository,
      entryPoints: ["src/index.ts"],
      outfile: path.join(stage, "worker/worker.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      conditions: ["browser"],
      target: "es2023",
      metafile: true,
      legalComments: "linked"
    });
    const workerPackages = new Set<string>();
    for (const input of Object.keys(workerBuild.metafile!.inputs)) {
      const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
      if (match)
        workerPackages.add(match[1]!);
    }
    const workerNotices = [];
    for (const location of [...workerPackages].sort()) {
      const metadata = JSON.parse(await readFile(path.join(repository, location, "package.json"), "utf8"));
      workerNotices.push(`\nWorker: ${metadata.name}@${metadata.version} (${metadata.license ?? "see notices"})`);
      for (const name of (await readdir(path.join(repository, location))).filter(name => /^(license|copying|notice)(\.|$|-)/i.test(name)))
        workerNotices.push(await readFile(path.join(repository, location, name), "utf8"));
    }
    await writeFile(path.join(stage, "THIRD_PARTY_NOTICES.txt"), notices + "\n" + workerNotices.join("\n") +
      "\nCloudflare workers-sdk license texts (Wrangler, Miniflare and related packages):\n" +
      await readFile(path.join(repository, "tools/family-installer/assets/workers-sdk-LICENSE-MIT"), "utf8") + "\n" +
      await readFile(path.join(repository, "tools/family-installer/assets/workers-sdk-LICENSE-APACHE"), "utf8"));
    await build({
      absWorkingDir: repository,
      entryPoints: ["tools/family-installer/main.ts"],
      outfile: path.join(stage, "installer/installer.cjs"),
      bundle: true,
      format: "cjs",
      platform: "node",
      target: "node24",
      define: { __FAMILY_FILES__: JSON.stringify(["installer/installer.cjs", ...await distributionFiles(stage)]) },
      legalComments: "linked"
    });
    assert.equal(JSON.parse(await readFile(path.join(stage, "wrangler.template.json"), "utf8")).compatibility_date, COMPATIBILITY_DATE);
    await validatePackage(stage, FIXED_FILES);
    const files = await distributionFiles(stage);
    const zip = path.join(scratch, `family-finance-${RELEASE_VERSION}-windows-x64.zip`);
    writeZip(stage, files, zip);
    const digest = createHash("sha256").update(await readFile(zip)).digest("hex");
    // Atomic publication into a fresh directory; an existing release is never replaced.
    await writeFile(path.join(scratch, "SHA256SUMS.txt"), `${digest}  ${path.basename(zip)}\n`);
    const final = path.join(output, `family-finance-${RELEASE_VERSION}-windows-x64`);
    await rename(scratch, final);
    console.log(`Release ${RELEASE_VERSION}: ${files.length} files; ${path.join(final, path.basename(zip))}`);
    return final;
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4, "Usage: npm run release:family -- <prepared-windows-toolchain> <output-directory>");
  await buildFamilyRelease(process.argv[2]!, process.argv[3]!);
}
