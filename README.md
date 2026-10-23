# Family Finance Bot

A Telegram bot for quickly tracking shared family expenses with a configurable currency label and finance timezone.

The bot runs in Telegram, while its Worker is deployed to Cloudflare with a remote D1 database. It can add, view, edit, and delete expenses, as well as show statistics for a month or a selected period.

## Local verification

```powershell
npm.cmd install
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run demo:webhook
```

- `npm.cmd test` runs the automated tests.
- `npm.cmd run check` checks the Worker and test types.
- `npm.cmd run build` builds the Worker into `dist` without publishing anything.
- `npm.cmd run dev` starts the Worker locally with `/health` and the protected `POST /telegram` endpoint. A real webhook requires migrated D1 with a valid `instance_settings` row (migration `0005` seeds `RSD` and `Europe/Belgrade`), `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_WEBHOOK_SECRET`. See [Instance settings](docs/design/INSTANCE_SETTINGS.md) before deploying.
- `npm.cmd run demo:storage` creates a temporary local D1 database, saves the same expense twice, and prints the history and statistics. The expected result is `firstCreated: true`, `duplicateCreated: false`, one 2490 RSD entry, and a statistics total of 2490 RSD.
- `npm.cmd run demo:application` demonstrates both ways to add an expense through the application layer. The expected results are `directCreated: true`, 15 suggested categories, `selectedCreated: true`, `duplicateCreated: false`, two history entries, and 3190 RSD for the previous month.
- `npm.cmd run demo:telegram` runs local Telegram update fixtures while intercepting Bot API responses. The expected result is 32 passing tests, including a monthly report, navigation buttons, the January 2026 lower bound, and a calendar range crossing a month boundary. Neither the Telegram network nor the remote Cloudflare D1 database is used.
- `npm.cmd run demo:webhook` starts the Worker in Miniflare with a clean temporary D1 database, applies the migration, adds only the test member, and sends HTTP requests to `/telegram`. A second local Worker intercepts all outgoing Telegram API calls. The expected result is one passing end-to-end test covering `401` without the correct secret, both expense creation methods, a repeated tap without duplication, history, editing every field, deletion, and statistics. This command does not involve `npm.cmd run dev`, the real Telegram service, or the remote D1 database.

The local integration tests use a temporary D1 database and a simulated Telegram Bot API. The commands above do not access the deployed bot or the remote database, and they do not automatically verify the production environment.

Technical decisions are documented in [docs/design/TECHNICAL_DESIGN.md](docs/design/TECHNICAL_DESIGN.md).

Tests live in `tests/suites/`, grouped into `unit`, `integration`, and `worker` suites.
Reusable helpers live in `tests/infrastructure/`, with Telegram and Worker helpers in their own subdirectories.
`npm test` recursively discovers all `*.test.ts` files under `tests/suites/`.
Documentation is grouped into `docs/design/`, `docs/testing/`, and `docs/deployment/`;
the current work is described in [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md).

## Assisted pilot for one family

The next goal is installation for one friend, with the developer operating the friend's
Windows x64 computer through a remote support session. The family owns its Telegram bot, Cloudflare Worker and D1.
Categories, display currency, finance timezone and history periods are already supported by the bot.

Tasks 1 and 2 provide verified provider operations and a Windows ZIP with the Worker, migrations, Node and Wrangler.
The ZIP includes the manual installation instructions and passes build and extraction checks.
Windows command checks and a complete manual installation rehearsal still need confirmation.
Installation and updates use an assisted session with commands from the package instructions.

See the [pilot plan](docs/deployment/INDEPENDENT_FAMILY_DEPLOYMENT_PLAN.md),
[installation instructions](docs/deployment/FAMILY_INSTALLATION.md),
[next task](docs/deployment/INSTALLER_TASK_3.md), and [ZIP build instructions](docs/deployment/FAMILY_RELEASE_BUILD.md).
The release commands below target the developer's existing instance; do not use them to deploy the friend's instance.

## HOW TO RELEASE:
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run deploy

## HOW TO CLEAN EXPENSES IN DB:
npx.cmd wrangler d1 execute family-finance-bot --remote --command "SELECT id, spent_on, amount_rsd, category_id, comment FROM expenses WHERE spent_on >= 'YYYY-MM-DD' AND spent_on < 'YYYY-MM-DD' ORDER BY spent_on, id;"
npx.cmd wrangler d1 execute family-finance-bot --remote --command "DELETE FROM expenses WHERE spent_on >= 'YYYY-MM-DD' AND spent_on < 'YYYY-MM-DD';"
And then select again to check.
EXAMPLE WITH DATES FILLED IN (CAREFUL):
npx.cmd wrangler d1 execute family-finance-bot --remote --command "SELECT id, spent_on, amount_rsd, category_id, comment FROM expenses WHERE spent_on >= '2026-09-27' AND spent_on < '2026-10-01' ORDER BY spent_on, id;"
npx.cmd wrangler d1 execute family-finance-bot --remote --command "DELETE FROM expenses WHERE spent_on >= '2026-09-27' AND spent_on < '2026-10-01';"

Tasks to do:
1. INPRO Show dates in the history list
2. Configurable period in history, just like in statistics (depends on task 1)
3. Show percentages in statistics
4. Add income
5. Add money storages (careful with this, is this safe?)
