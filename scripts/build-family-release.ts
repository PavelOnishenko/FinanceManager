import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { configTemplate, FIXED_FILES, migrationSequence, resolvePackageFile, validatePackage } from "../tools/family-installer/package";
import { COMPATIBILITY_DATE, RELEASE_VERSION } from "../tools/family-installer/release";
import { copyToolchain, type Lock } from "../tools/family-installer/toolchain";
import { distributionFiles as getDistributionFilesPaths, writeZip } from "../tools/family-installer/zip";

const repository = fileURLToPath(new URL("../", import.meta.url));

export async function buildFamilyRelease(toolchainPath: string, outputPath: string) {
  const output = path.resolve(outputPath);
  const relativeOutput = path.relative(path.resolve(toolchainPath), output);
  assert(relativeOutput === ".." || relativeOutput.startsWith(".." + path.sep) || path.isAbsolute(relativeOutput),
    "Output must be outside toolchain to prevent recursive copying");
  await mkdir(output, { recursive: true });
  const stagingDirectory = await mkdtemp(path.join(output, ".family-build-"));
  const stagingPackagesFolder = path.join(stagingDirectory, "package");
  await mkdir(stagingPackagesFolder);
  try {
    const lockFileContents = await readFile(path.join(repository, "package-lock.json"), "utf8");
    const notices = await copyToolchain(path.resolve(toolchainPath), stagingPackagesFolder, JSON.parse(lockFileContents) as Lock);
    const migrations = migrationSequence(await readdir(path.join(repository, "migrations")));
    await mkdir(path.join(stagingPackagesFolder, "migrations"));
    for (const name of migrations)
      await cp(await resolvePackageFile(path.join(repository, "migrations"), name), path.join(stagingPackagesFolder, "migrations", name));
    await writeFile(path.join(stagingPackagesFolder, "wrangler.template.json"), JSON.stringify(configTemplate(), null, 2) + "\n");
    await cp(path.join(repository, "tools/family-installer/assets/RELEASE_NOTES.ru.md"), path.join(stagingPackagesFolder, "RELEASE_NOTES.ru.md"));
    await cp(path.join(repository, "docs/deployment/FAMILY_INSTALLATION.md"), path.join(stagingPackagesFolder, "FAMILY_INSTALLATION.md"));
    // No source wrangler.jsonc, env files, plugins, or owner-side application compilation.
    const workerBuild = await build({
      absWorkingDir: repository,
      entryPoints: ["src/index.ts"],
      outfile: path.join(stagingPackagesFolder, "worker/worker.js"),
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
    await writeFile(path.join(stagingPackagesFolder, "THIRD_PARTY_NOTICES.txt"), notices + "\n" + workerNotices.join("\n") +
      "\nCloudflare workers-sdk license texts (Wrangler, Miniflare and related packages):\n" +
      await readFile(path.join(repository, "tools/family-installer/assets/workers-sdk-LICENSE-MIT"), "utf8") + "\n" +
      await readFile(path.join(repository, "tools/family-installer/assets/workers-sdk-LICENSE-APACHE"), "utf8"));
    const configFilePath = await readFile(path.join(stagingPackagesFolder, "wrangler.template.json"), "utf8");
    assert.equal(JSON.parse(configFilePath).compatibility_date, COMPATIBILITY_DATE);
    await validatePackage(stagingPackagesFolder, FIXED_FILES);
    const files = await getDistributionFilesPaths(stagingPackagesFolder);
    const zipFilePath = path.join(stagingDirectory, `family-finance-${RELEASE_VERSION}-windows-x64.zip`);
    writeZip(stagingPackagesFolder, files, zipFilePath);
    // Atomic publication into a fresh directory; an existing release is never replaced.
    const final = path.join(output, `family-finance-${RELEASE_VERSION}-windows-x64`);
    await rename(stagingDirectory, final);
    console.log(`Release ${RELEASE_VERSION}: ${files.length} files; ${path.join(final, path.basename(zipFilePath))}`);
    return final;
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4, "Usage: npm run release:family -- <prepared-windows-toolchain> <output-directory>");
  await buildFamilyRelease(process.argv[2]!, process.argv[3]!);
}
