# Family release artifacts (installer Task 2)

Status: packaging implemented; clean Windows x64 acceptance is pending. This is a preliminary
release, not an operational installer. Tasks 3–6 supply provider adapters, installation, updates,
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

## Prepare the Windows toolchain (developer only, network required)

Run from the repository root on a development machine with Node/npm. The same npm preparation
works on Linux using `--os=win32 --cpu=x64`; no Windows binaries are executed during packaging.
These commands download public artifacts and do not contact customer accounts.

```powershell
$stage = Join-Path $PWD 'work\windows-toolchain'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item package.json, package-lock.json $stage
npm.cmd ci --prefix $stage --os=win32 --cpu=x64 --ignore-scripts --no-audit --no-fund --update-notifier=false

$archive = Join-Path $PWD 'work\node-v24.13.0-win-x64.zip'
Invoke-WebRequest 'https://nodejs.org/dist/v24.13.0/node-v24.13.0-win-x64.zip' -OutFile $archive
$expected = 'ca2742695be8de44027d71b3f53a4bdb36009b95575fe1ae6f7f0b5ce091cb88'
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node ZIP SHA256 mismatch' }
Expand-Archive $archive -DestinationPath 'work\node-extracted' -Force
New-Item -ItemType Directory -Path "$stage\runtime" -Force | Out-Null
Copy-Item 'work\node-extracted\node-v24.13.0-win-x64\node.exe' "$stage\runtime"
Copy-Item 'work\node-extracted\node-v24.13.0-win-x64\LICENSE' "$stage\runtime"
```

The archive checksum above was checked against Node's official `SHASUMS256.txt`. The builder also
requires `node.exe` SHA-256 `d14ba95cdce1ef7dc9ad3ac74949ca5db38b27378ee30f30a23cf26f9e875a11`.
Changing Node requires a deliberate pin/checksum update and Windows revalidation.
Install scripts are disabled: the Windows native packages are included explicitly through optional
dependencies, so their postinstall download/fallback logic is unnecessary.

## Commands and expected results

```powershell
npm.cmd run installer:check
npm.cmd run installer:test
npm.cmd run installer:demo
npm.cmd run release:family -- work/windows-toolchain work/releases
```

- `installer:check`: independent Node TypeScript check, exit 0; Worker tsconfig remains unchanged.
- `installer:test`: focused package validation, customer-config, migration sequence, dependency closure,
  and ZIP tests. Independent ZIP verification requires Python: `python` on Windows, `python3` on Linux.
- `installer:demo`: offline packaging demo of fresh, interrupted, complete and unknown migration
  histories. Expected final message: `Симуляция провайдеров, установки и обновления появится в задачах 3–5.`
  This is deliberately not the full setup/retry/update provider simulation required by Section 7;
  that requirement remains pending until the corresponding behavior exists.
- `release:family`: emits `Release 1: ... files; ...zip`, a ZIP, SHA256SUMS.txt and the inspected
  package directory under `work/releases/family-finance-1-windows-x64/`. No existing output release
  is overwritten. Use a new output parent for a local rebuild. Nothing is uploaded.

The ZIP uses fixed timestamps and sorted paths and needs no external archiver to build. Validation
finishes before atomic publication of the output directory. Failed builds remove their staging directory.
Checksums are adjacent developer/distribution files, not an extra installer version manifest.

## Remaining owner check: clean Windows x64

Use a supported clean Windows x64 machine/user profile without Node/npm/Git or developer credentials.
Copy only the generated ZIP, extract into a path containing spaces and Cyrillic characters,
disconnect the network, then double-click `Start setup.cmd`.

Expected: `Комплект релиза 1 проверен. Миграций: 5.` followed by the explicit notice that the
installer is unavailable. The launcher does not open a browser yet and pauses so the result stays visible.
Move the extracted folder and repeat. Remove a copied migration or Wrangler native file and repeat:
the launcher must report an incomplete package, exit nonzero and pause.

For the bundled runtime/CLI check, run these **offline** commands from that extracted folder:

```powershell
.\runtime\node.exe --version
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_HIDE_BANNER = 'true'
.\runtime\node.exe .\wrangler\node_modules\wrangler\bin\wrangler.js --version
.\runtime\node.exe .\wrangler\node_modules\wrangler\bin\wrangler.js d1 migrations apply --help
.\wrangler\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe --version
.\wrangler\node_modules\wrangler\node_modules\@esbuild\win32-x64\esbuild.exe --version
```

Expected Node `v24.13.0`, Wrangler `4.133.0`, workerd `2026-09-16` (package `1.20260916.1`),
esbuild `0.28.1`, and command help without dependency installation.
Record Windows version, outputs, and any missing system-library errors. OAuth, actual D1 migrations,
Worker deployment and Telegram delivery are not part of this offline check. Full provider and
clean-machine setup/update rehearsal remains Tasks 3–6 and Section 7; do not mark the pilot ready.
