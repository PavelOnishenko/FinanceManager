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

export function forbiddenName(name: string): boolean {
  return /^(\.git|\.wrangler|\.env.*|\.dev\.vars.*|\.npmrc|\.bin|logs?|instance(?:[.-].*)?|release\.json)$/i.test(name) || /\.log$/i.test(name);
}

// Never copy nested dependencies implicitly. Every dependency is selected from the lock separately.
export async function copyPublicTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === "node_modules" || forbiddenName(entry.name))
      continue;
    if (entry.isDirectory())
      await copyPublicTree(path.join(source, entry.name), path.join(destination, entry.name));
    else
      await cp(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

export async function assertWindowsX64Executable(filename: string): Promise<void> {
  const bytes = await readFile(filename);
  assert(bytes.length >= 64 && bytes.toString("ascii", 0, 2) === "MZ", `Not a Windows executable: ${filename}`);
  const pe = bytes.readUInt32LE(60);
  assert(pe + 6 <= bytes.length && bytes.toString("ascii", pe, pe + 4) === "PE\0\0" && bytes.readUInt16LE(pe + 4) === 0x8664,
    `Not a Windows x64 PE executable: ${filename}`);
}

export async function copyToolchain(source: string, destination: string, lock: Lock): Promise<string> {
  await assertWindowsX64Executable(path.join(source, "runtime/node.exe"));
  assert.equal(createHash("sha256").update(await readFile(path.join(source, "runtime/node.exe"))).digest("hex"),
    "d14ba95cdce1ef7dc9ad3ac74949ca5db38b27378ee30f30a23cf26f9e875a11", `Expected official Windows x64 Node ${NODE_VERSION}`);
  const nodeLicense = await readFile(path.join(source, "runtime/LICENSE"), "utf8");
  assert(nodeLicense.includes("Node.js"), "Missing Node license");
  await mkdir(path.join(destination, "runtime"), { recursive: true });
  for (const name of ["node.exe", "LICENSE"])
    await cp(path.join(source, "runtime", name), path.join(destination, "runtime", name));
  const notices = [`Node.js ${NODE_VERSION}: runtime/LICENSE (includes bundled third-party notices).`];
  for (const location of collectWindowsX64WranglerPackagePaths(lock)) {
    const metadata = JSON.parse(await readFile(path.join(source, location, "package.json"), "utf8"));
    assert.equal(metadata.version, lock.packages[location]!.version, `Toolchain version mismatch: ${location}`);
    await copyPublicTree(path.join(source, location), path.join(destination, "wrangler", location));
    const licenseNames = (await readdir(path.join(source, location))).filter(name => /^(license|licence|copying|notice)(\.|$|-)/i.test(name));
    notices.push(`\n${metadata.name}@${metadata.version}: ${lock.packages[location]!.license ?? metadata.license ?? "See package notices"}`);
    for (const name of licenseNames)
      notices.push(`${location}/${name}\n${await readFile(path.join(source, location, name), "utf8")}`);
  }
  await assertWindowsX64Executable(path.join(destination, "wrangler/node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe"));
  // Wrangler uses its own esbuild version, distinct from the application's builder.
  await assertWindowsX64Executable(path.join(destination, "wrangler/node_modules/wrangler/node_modules/@esbuild/win32-x64/esbuild.exe"));
  return notices.join("\n");
}
