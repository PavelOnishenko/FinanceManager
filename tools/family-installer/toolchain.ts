import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NODE_VERSION, WRANGLER_VERSION } from "./release";

type LockedPackage = {
  version: string;
  license?: string;
  os?: string[];
  cpu?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
export type Lock = { packages: Record<string, LockedPackage> };

export function collectWindowsX64WranglerPackagePaths(lock: Lock): string[] {
  const selected = new Set<string>();
  function visit(location: string) {
    if (selected.has(location))
      return;
    const entry = lock.packages[location];
    assert(entry, `Dependency missing from lock: ${location}`);
    selected.add(location);
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      let parent = location;
      let dependency = `${parent}/node_modules/${name}`;
      while (!lock.packages[dependency] && parent.includes("node_modules/")) {
        parent = parent.slice(0, Math.max(0, parent.lastIndexOf("node_modules/") - 1));
        dependency = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`;
      }
      const candidate = lock.packages[dependency];
      assert(candidate, `Dependency missing from lock: ${name}`);
      const supported = (!candidate.os || candidate.os.includes("win32")) && (!candidate.cpu || candidate.cpu.includes("x64"));
      if (supported)
        visit(dependency);
      else
        assert(name in (entry.optionalDependencies ?? {}), `Unsupported required dependency: ${name}`);
    }
  }
  visit("node_modules/wrangler");
  assert.equal(lock.packages["node_modules/wrangler"]?.version, WRANGLER_VERSION);
  return [...selected].sort();
}

// Never copy nested dependencies implicitly. Every dependency is selected from the lock separately.
export async function copyPackageContents(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === "node_modules")
      continue;
    if (entry.isDirectory())
      await copyPackageContents(path.join(source, entry.name), path.join(destination, entry.name));
    else
      await cp(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

export async function copyToolchain(source: string, destination: string, lock: Lock): Promise<string> {
  const nodeExeFileContents = await readFile(path.join(source, "runtime/node.exe"));
  assert.equal(createHash("sha256").update(nodeExeFileContents).digest("hex"),
    "d14ba95cdce1ef7dc9ad3ac74949ca5db38b27378ee30f30a23cf26f9e875a11", `Expected official Windows x64 Node ${NODE_VERSION}`);
  await readFile(path.join(source, "runtime/LICENSE"), "utf8");
  await mkdir(path.join(destination, "runtime"), { recursive: true });
  for (const name of ["node.exe", "LICENSE"])
    await cp(path.join(source, "runtime", name), path.join(destination, "runtime", name));
  const notices = [`Node.js ${NODE_VERSION}: runtime/LICENSE (includes bundled third-party notices).`];
  for (const location of collectWindowsX64WranglerPackagePaths(lock)) {
    const metadata = JSON.parse(await readFile(path.join(source, location, "package.json"), "utf8"));
    assert.equal(metadata.version, lock.packages[location]!.version, `Toolchain version mismatch: ${location}`);
    const fullLocationPath = path.join(source, location);
    await copyPackageContents(fullLocationPath, path.join(destination, "wrangler", location));
    const licenseNames = (await readdir(fullLocationPath)).filter(name => /^(license|licence|copying|notice)(\.|$|-)/i.test(name));
    notices.push(`\n${metadata.name}@${metadata.version}: ${lock.packages[location]!.license ?? metadata.license ?? "See package notices"}`);
    for (const name of licenseNames) {
      const licenseFilePath = path.join(source, location, name);
      notices.push(`${location}/${name}\n${await readFile(licenseFilePath, "utf8")}`);
    }
  }
  return notices.join("\n");
}
