# Family release artifacts (installer Task 2)

Status: Task 2 complete. The owner confirmed all Part A/B acceptance checks passed on two machines on October 21, 2026.
This is a preliminary release, not an operational installer. Tasks 3–6 supply provider adapters, installation, updates,
and the browser UI. No Cloudflare or Telegram calls are made by the builder, launcher, or packaging demo.

## Inputs and layout

`tools/family-installer/release.ts` is the single source for release number **1**, Node **24.13.0**,
Wrangler **4.133.0**, and compatibility date **2026-09-16**. Increment the release number for each
published release; never change already distributed migrations. No `release.json` is used.
The builder validates the official Windows x64 Node executable's SHA-256 and the dependency
versions against `package-lock.json`. Prepare dependencies using `npm ci`, which verifies npm integrity.
Use a fresh preparation directory; the builder does not download anything or repair dependencies.
The output directory must be outside that toolchain directory to prevent recursive copying.

Fixed paths inside the ZIP:

```text
Start setup.cmd
installer/installer.cjs
worker/worker.js
wrangler.template.json
migrations/0001_initial.sql ... 0005_instance_settings.sql
runtime/node.exe
runtime/LICENSE
wrangler/node_modules/...
THIRD_PARTY_NOTICES.txt
RELEASE_NOTES.ru.md
```

The template contains placeholders, `DB`, `migrations_dir`, `no_bundle: true`, and
`APP_RELEASE_VERSION: "1"`. Future setup must fill it using `instanceConfig` and place it next to
the packaged Worker/migrations in a separate instance workspace. Never pass the unresolved template
to remote commands. Existing production/demo configurations remain unchanged. Worker version
readback through health is still Task 5 work, as specified in the plan.

The builder bundles the Worker once with esbuild's browser conditions. The owner needs neither
source nor a compiler. Wrangler's complete Windows runtime dependency closure is copied at its
locked locations, including its own esbuild **0.28.1**, workerd, WASM, templates and package notices.
The application's esbuild **0.28.2**, TypeScript, tsx, npm and Git are not required in the package.
Node's bundled third-party licenses and available dependency license files are retained.
The workers-sdk MIT/Apache texts are vendored from
`https://raw.githubusercontent.com/cloudflare/workers-sdk/main/LICENSE-MIT` and `LICENSE-APACHE`;
Wrangler's own bundled dependency notices remain in its distributed JavaScript.

Only allowlisted project files and the prepared public dependencies enter the archive. Project
configuration, credentials, instance state and logs are not copy sources. Dependency package contents
are copied without filename filtering; nested `node_modules` directories are handled separately
through the lock rather than copied wholesale.
The complete packaged file allowlist is embedded in the compiled installer, which checks that each
listed path exists and is a regular file. This is a completeness check, not a signature or
tamper-proof verification. Only use trusted release archives.

Migration names must be consecutive four-digit numeric prefixes starting at 0001, with no duplicates.
Applied history must match an exact prefix of the package sequence; otherwise stop before mutation.
The provider adapter will call this check with real readback in later tasks.

## Build and acceptance checklist

Follow the [step-by-step Task 2 acceptance checklist](FAMILY_RELEASE_ACCEPTANCE.md) in Russian.
It contains the exact PowerShell commands and expected results for preparing a fresh toolchain,
running installer checks, building and inspecting the ZIP, and testing it offline on clean Windows x64.
Complete Part A on the developer computer, then Part B on the clean test computer or VM.

The builder accepts a prepared toolchain path and an output directory:

```powershell
npm.cmd run release:family -- <prepared-windows-toolchain> <output-directory>
```

Each successful build publishes `family-finance-1-windows-x64/` containing the ZIP, `SHA256SUMS.txt`
and the unpacked `package/` directory. An existing release directory is not overwritten.
The ZIP uses fixed timestamps and sorted paths and needs no external archiver to build.
Failed builds remove their staging directory. Checksums are adjacent distribution files,
not an extra installer version manifest.
