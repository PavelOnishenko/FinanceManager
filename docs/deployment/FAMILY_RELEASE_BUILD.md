# Windows ZIP for the assisted pilot

The owner confirmed the initial packaging checks on two Windows machines (Task 2).
For the [assisted pilot](INDEPENDENT_FAMILY_DEPLOYMENT_PLAN.md), the developer checks the finished ZIP before distribution;
the operator then installs the bot manually using its bundled tools and instructions.

The builder includes the operator instructions and tools listed below. Building and extracting the revised ZIP
can be checked on Linux; Windows runtime checks and the complete manual installation are confirmed separately.
Building and checking the ZIP makes no Cloudflare or Telegram calls.

## Inputs and layout

`tools/family-installer/release.ts` is the single source for release number **1**, Node **24.13.0**,
Wrangler **4.133.0**, and compatibility date **2026-09-16**. Increment the release number for each
published release; never change already distributed migrations. No `release.json` is used.
The builder validates the official Windows x64 Node executable's SHA-256 and the dependency
versions against `package-lock.json`. Prepare dependencies using `npm ci`, which verifies npm integrity.
Use a fresh preparation directory; the builder does not download anything or repair dependencies.
The output directory must be outside that toolchain directory to prevent recursive copying.

Paths inside the pilot ZIP:

```text
worker/worker.js
wrangler.template.json
migrations/0001_initial.sql ... 0005_instance_settings.sql
runtime/node.exe
runtime/LICENSE
wrangler/node_modules/...
THIRD_PARTY_NOTICES.txt
RELEASE_NOTES.ru.md
FAMILY_INSTALLATION.md
```

The template contains placeholders, `DB`, `migrations_dir`, `no_bundle: true`, and
`APP_RELEASE_VERSION: "1"`. The operator copies the template to `wrangler.instance.json`, fills the account,
database and Worker identifiers, and keeps it next to the packaged Worker/migrations in a separate working copy.
Keep the original template unchanged so it can be reused. Never pass the unresolved template
to remote commands. Existing production/demo configurations remain unchanged. Read the installed release from
`APP_RELEASE_VERSION` in the active Cloudflare version bindings; `/health` does not expose a release number.
For an update, use the new package template with the existing resource identifiers, preserving the new release number.

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
The developer checks the allowed file list, configuration template and migration sequence during preparation,
then extracts the finished ZIP and checks its contents and bundled tools. These checks belong on the developer computer.

Migration names must be consecutive four-digit numeric prefixes starting at 0001, with no duplicates.
Applied history must match an exact prefix of the package sequence; otherwise stop before mutation.
The package helpers validate these rules locally. During the assisted pilot, the operator compares the remote history
with the package before applying pending migrations.

## Build and verification

The [completed Task 2 acceptance](FAMILY_RELEASE_ACCEPTANCE.md) records the original package and its Windows checks.
It is a historical record, not a checklist for the current pilot ZIP.
For the current package, run `npm.cmd run installer:check` and `npm.cmd run installer:test`, build the ZIP,
extract it and compare its layout with the paths above. Confirm that the instructions, migrations,
configuration template, licenses and bundled tools are present.
Windows execution and the full installation are checked in
[Task 4](INDEPENDENT_FAMILY_DEPLOYMENT_PLAN.md#task-4-отрепетировать-полный-проход).

The builder accepts a prepared toolchain path and an output directory:

```powershell
npm.cmd run release:family -- <prepared-windows-toolchain> <output-directory>
```

Each successful build publishes `family-finance-1-windows-x64/` containing the ZIP
and the unpacked `package/` directory. An existing release directory is not overwritten.
The ZIP uses fixed timestamps and sorted paths and needs no external archiver to build.
Failed builds remove their staging directory.
