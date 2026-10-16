# Independent family deployment: implementation plan

Status: P0 implemented and locally verified on October 11, 2026. P1 fully completed:
the owner confirmed live verification in demo and production on October 13, 2026. P2/P3 bot-side support is complete
and merged; the owner confirmed live verification in demo and production on October 15, 2026.
P4 (expense history by period) is planned for documentation review before implementation; complete it before resuming installer work.
Installer phases remain pending.
The subsequent P1 repository-result refactor passed 83/83 tests on October 12, 2026. After removing nested ternaries,
three focused tests, the type check, and the dry-run build passed. Local tests/check/build are authorized;
commands accessing remote resources require an explicit owner decision.
Latest P1 simplification (October 12, 2026): strict Russian/English category alphabet with ASCII digits, spaces and hyphens;
obsolete category-index callbacks are rejected without a legacy ID snapshot. 89/89 tests, type check, and dry-run build passed.
Repository inspection and provider documentation review: October 10, 2026.

This document is a standalone implementation handoff. Checked boxes describe completed work; unchecked boxes describe future work.
No installer, release package, update flow, or customer-account deployment has been verified yet.

## How to read and implement this plan

- **Ordered phases:** In Section 3, complete P0 before P1, then implement P2/P3 together, then P4. Complete P4 before resuming Section 6; complete installer
  Tasks 1-6 in order. The numbered lists under P1 and the owner journeys in Section 4 are actual step sequences.
- **Checklists:** Checkboxes within a phase or installer task are required work and behavior, but their printed order is
  not an implementation sequence unless a dependency is stated. The `Acceptance` paragraphs and Section 12 define
  completion criteria; Section 7 lists verification scenarios, not additional implementation steps.
- **Testing approach for the whole plan:** For most testable TypeScript behavior and meaningful D1 changes, write a focused
  failing behavior test, implement the smallest change that passes it, and repeat. Run focused tests during the work and
  the relevant regression suite, type check, and build at phase completion. Test outcomes rather than mirroring code.
  Do not force TDD onto documentation, trivial wiring, packaging, or exploratory provider work; prove external operations
  first, then add useful adapter/integration tests around the behavior learned. This applies to suitable work in every phase.

## 1. Goal and first-release decisions

First remove the existing alias behavior, then make categories editable in the bot and the displayed currency and finance timezone configurable through the installer.
Add expense history browsing by month and arbitrary date range before continuing installer work.
Then let another family use its own instance without giving the project developer administrative access to its data.
The family should not need to run commands, write SQL, install developer tools, or configure Cloudflare resources manually.

Use the following model for the first release:

- One family owns one Telegram bot, one Cloudflare Worker, and one D1 database.
- The family owns the Cloudflare account and creates the Telegram bot through BotFather.
- A local setup wizard runs on the owner's computer and opens a simple browser interface.
- The wizard creates infrastructure and performs maintenance using the owner's Cloudflare authorization.
- Tokens and customer data do not pass through a developer-operated server.
- Updates require the owner to launch the wizard and confirm a specific release.
- Target Windows x64 first. Confirm the friend's operating system before packaging; other platforms are separate work.
- Keep the bot and installer interfaces in Russian, including setup, updates, progress, and errors; keep positive
  integer amounts and configure `Europe/Belgrade` explicitly for existing instances.
- Complete alias removal, category management, the bot's currency-display and timezone support, and P4 expense history browsing
  in Section 3 before building the sharing tools in Section 6.
  Finish the installer controls for currency and timezone selection/change in Section 6 before inviting the family.
- Seed the current categories as defaults, then allow both family members to manage them inside their own bot.
- Select a display currency during installation and allow a later change through the installer.
- Select an IANA finance timezone during installation and allow a later change through the installer.
- For this experimental pilot, do not build database export, backup, or restore features. Data loss remains possible;
  the owner should accept that risk before using the bot for records they cannot afford to lose.

Registration/sign-in to Cloudflare and bot creation are the two unavoidable manual steps in this selected implementation.
After setup, the computer and wizard can be turned off; the bot continues running in Cloudflare.

Currency is a text label only: changing it does not convert stored numbers, alter calculations, or assign different currencies
to individual expenses. The new label appears on both existing and future expenses and reports. Show this effect clearly before saving a change.
The finance timezone controls how the current calendar date, month, and year are determined for new expenses and
time-relative bot actions such as previous-month statistics. Changing it affects future decisions only: never rewrite
existing `spent_on` dates, timestamps, amounts, or migration history. Existing expenses keep their stored calendar dates;
their membership in a newly requested relative period may differ because that period's boundaries can change.

### Privacy boundary

The developer must not be a member of the customer's Cloudflare account, possess its API/OAuth credentials or Telegram bot token,
or be an enabled member of its finance bot. The developer releases software; the owner runs it.

This removes the developer's normal administrative access. It does not provide protection against malicious supplied software:
the owner still trusts the installer and Worker code. Telegram and Cloudflare also remain service providers processing the data.
Do not describe this arrangement as end-to-end encryption or cryptographic protection from the software author.

Access to Worker deployment is also access to potential data extraction: a changed Worker could read D1 and transmit its contents.
Do not solve updates by retaining a developer deployment token or a hidden remote administration endpoint.

## 2. Current repository baseline

Recheck these files before implementing; code takes precedence over this snapshot:

| Existing component | Reuse and constraints |
| --- | --- |
| `src/index.ts` | Public `GET /health`, protected `POST /telegram`, one `DB` binding |
| `src/storage/D1FinanceRepository.ts` | One shared family history; queries have no family/tenant discriminator |
| `src/telegram/bot.ts` | Existing access checks and access-denied response containing the caller's Telegram ID |
| `src/application/dateRange.ts` | Hard-coded `Europe/Belgrade` timezone for current dates/months; fixed statistics lower bound of 2026 |
| `src/config/categories.ts` | Static category names, aliases, and `CategoryId` type to replace at runtime |
| `src/telegram/callbackData.ts` | Category positions are encoded in Telegram callback data |
| `src/domain/parseExpenseInput.ts` | Category aliases are compiled from the static list; replace with name-only matching; amount errors mention RSD |
| `src/telegram/bot.ts` | Category options and money displays are hard-coded; no category management flow |
| `src/domain/editPrompt.ts`, `src/telegram/parseEditReply.ts` | Amount editing text also mentions RSD |
| `migrations/0001_initial.sql` | Members, categories, expenses, and initial category data |
| `migrations/0002_add_expense_categories.sql` | Additional categories |
| `migrations/0003_add_communication_category.sql` | Communication category; three migrations currently seed 19 categories |
| `wrangler.jsonc` | Real developer production database binding and a separate `env.demo` binding |
| `docs/TEST_ENVIRONMENT.md` | Existing manual recipe for D1, migrations, Worker, secrets, webhook, and participants |
| `tests/webhookSmoke.test.ts` | Local Worker/D1 journey with a simulated Telegram API |
| `scripts/createLocalD1.ts` | Temporary local D1 with application migrations for existing tests |

Do not copy either existing Cloudflare database ID into a customer package.
Do not add the new family to the developer's production database: all enabled members of that database share its expenses.
Do not modify existing production/demo configuration to make the installer work. Their new required currency and timezone
values are seeded by product migration `0005`; apply it to each database before deploying the Worker that requires them.
Preserve existing documentation, examples, commands, and user-authored task lists.

The existing local D1 helper applies SQL directly. It does not prove Wrangler migration history or production update behavior.
Add dedicated upgrade tests instead of claiming that existing fresh-database tests cover upgrades.

The current database has `categories` with stable text IDs, names, order, and `active`; aliases exist only in code.
There is no `instance_settings` table yet; currency text and finance timezone are hard-coded in the Worker.
`expenses.amount_rsd` remains the existing integer storage column in the first currency-label release for compatibility;
its old name must not be taken as evidence that the selected label changes the number or performs conversion.

## 3. Product prerequisites before sharing

Finish P0 first. Only after its acceptance checks pass, begin P1 and the bot-side parts of P2 and P3 on the existing bot.
Complete the installer-side parts of P2 and P3 during Section 6; validate the combined behavior before treating any package as pilot ready.
Complete P4 on the existing bot before resuming installer work. Review and approve the P4 documentation PR before implementing it.
The installer later deploys the same tested Worker and migrations to an independent account.
P4 adds history date filtering and pagination; income, conversion, and a general database administration screen remain out of scope.

### Task P0: Remove existing category aliases

- [x] Remove the `aliases` arrays and alias-validation loop from `src/config/categories.ts`; keep the current IDs and display names.
- [x] Remove `categoryAliases`, alias sorting, and alias matching from `src/domain/parseExpenseInput.ts`.
  Match only the category's current display name, ignoring case and repeated spaces, with a whole-name boundary before an optional comment.
  Check longer names first so a shorter name cannot consume the beginning of another category name.
- [x] Preserve full-text entry using a category name, amount-only entry followed by a category button, positive-integer amount
  validation, comments, and existing expense IDs and data. Do not add a database migration for this removal: aliases are only in code.
- [x] Replace alias-focused parser tests with name-only tests. Cover case-insensitive and multiword names, optional comments,
  amount-only input, and rejection of former synonyms such as `кафе`, `коммуналка`, and `сервис`.
  Update affected Telegram/application tests and any examples or help text that rely on an old synonym.
- [x] Run the relevant tests, full test suite, type check, and build. Verify that the new parser behavior works before starting P1.

Acceptance gate: no production alias fields, lookup logic, or tests expecting alias acceptance remain; category-name entry and
button-based entry both work, and former synonym-only inputs are rejected. P0 changes no database rows or schema.

P0 verification (October 11, 2026): `npm.cmd test` passed 72/72 tests, `npm.cmd run check` passed, and
`npm.cmd run build` passed (Worker dry run). No database migrations or remote deployment were performed.

### Task P1: Manage categories inside the bot

Status: fully completed. Local checks passed; the owner confirmed verification in demo and production on October 13, 2026.

Implement P1 in this order, applying the plan-wide testing approach where it helps:

1. Add the normalized-name migration and category repository operations; verify fresh and existing databases with expenses.
2. Move parsing and application logic to active category names from D1.
3. Change callbacks to stable IDs, retaining the defined behavior of previously sent buttons.
4. Add the Telegram category-management flow and verify the complete journeys.

The checkboxes below state required behavior across these steps.

- [x] Define the first-release permission rule: every enabled family member can add, rename, archive, and restore categories.
  Apply the existing member access check to every management action and reject unknown/disabled users.
- [x] Add a new numbered migration; never rewrite `0001`-`0003` after distribution.
  Add a normalized name key to `categories`, populate it for the 19 existing defaults, and enforce uniqueness with an index.
  Keep the existing text primary key and expense foreign key; do not create an alias table or migrate alias data.
- [x] Keep the existing stable text IDs for seeded categories. For each user-created category, generate an opaque ID from
  nine cryptographically random bytes encoded as 12 base64url characters with a `u_` prefix. Retry on an ID collision;
  enforce uniqueness with the existing primary key. Never derive an ID from the name or list position.
- [x] Make D1 the runtime source for active categories, display names, and order.
  Keep default seed data in migrations, then let each database diverge through user edits.
  Replace the compile-time `CategoryId` union with a validated stable string ID at the application/storage boundaries.
- [x] Keep category IDs immutable and short enough for Telegram's 64-byte `callback_data` limit.
  Use a new, explicitly versioned callback format carrying the category ID, rather than a mutable list index.
  Owner decision: reject previously sent index-based callbacks with the existing invalid-button reply; users request new buttons.
  Do not retain a frozen category-ID snapshot or an index decoder.
  Recheck category activity at action time; an old button must not create an expense in a deactivated category.
- [x] Load active categories for amount-only buttons, full-text parsing, and expense-category editing.
  Read names from D1 for each update or use a cache with explicit invalidation; never rely on an old static array.
  Preserve existing `source_action_key` idempotency when old/new category buttons are tapped more than once.
- [x] Add a **Категории** entry to the existing Telegram menu. Show active categories and actions to add, rename,
  and archive, plus an archived-category list with **Восстановить**. Use the existing stateless `ForceReply` pattern for text entry
  and a confirmation button for archiving. Explain there that previous expenses stay in history and statistics.
  Avoid calling this operation **Удалить** in the UI.
- [x] Change P0's name-only parser to read the current active names from D1. Keep its matching and comment rules unchanged.
- [x] Generate the same normalized name key for add/rename and parsing. Reject empty, duplicate, or invalid names with a clear bot reply.
  Enforce uniqueness in D1, including Cyrillic case folding; SQLite `NOCASE` alone is insufficient.
- [x] Implement **Архивировать** as `active = 0` and **Восстановить** as `active = 1`. Keep the row and immutable ID; never delete its expenses.
  Archived categories disappear from new expense selection, text parsing, and category-change choices. Reject stale buttons
  that try to assign one. Existing expenses in an archived category remain readable and can still have their amount, date,
  and comment edited; moving one to another active category remains possible.
  Keep the archived name reserved to avoid ambiguity on restoration.
- [x] State in the UI that renaming changes the displayed category name for historical expenses as well.
  History, details, and statistics must include expenses from archived categories, grouped by the immutable category ID.
  Archiving/restoring must not change past totals, percentages, or which expenses appear. The old name stops being
  accepted for new text input after a rename; existing expenses and button-based entry remain intact.
Acceptance: either member can manage the category list through Telegram, newly added categories work in both expense entry paths,
and archiving/restoring/renaming never removes or misattributes older expenses or changes historical totals.
Existing deployed databases and a fresh D1 both migrate cleanly.
Apply the migration and updated Worker to the developer's own test/prod environments using the normal release process
and verify the result; do not claim remote success from local tests.

P1 implementation verification (October 12, 2026): `npm.cmd test` passed 80/80 tests, `npm.cmd run check` passed,
and `npm.cmd run build` passed (Worker dry run). The two category-management Telegram journeys were rerun and passed
after simplifying prompt wording. Tests cover both enabled members, access denial, normalized-name conflicts,
random-ID collision retry, dynamic parsing, legacy/versioned callbacks, archive/restore, and historical totals.
The dedicated Wrangler test applies `0001`-`0003`, inserts a declared expense and member, applies `0004`, checks every
stored expense/member field and migration history, repeats migration application, and compares categories with a fresh installation.
On October 13, 2026, this test was simplified: state queries were combined and the fresh-install comparison removed,
reducing Wrangler invocations from ten to five. Upgrade preservation and repeat-application checks remain;
fresh migrated D1 coverage remains in repository tests. The focused migration test and type check passed.

- [x] Local implementation and automated P1 checks.
- [x] Owner-run remote migration and Worker deployment for demo and production.
- [x] Live Telegram acceptance after deployment, confirmed by the owner on October 13, 2026.

Before the owner-run release, remote read-only checks found `0004_category_name_keys.sql` pending in both configured databases. An initial D1 `7403`
was followed by successful migration-list checks, but Worker secret-list checks returned `No access to the specified resource`
in both environments. The agent performed no remote migration or deployment. The owner subsequently released P1 and confirmed
live verification in both demo and production on October 13, 2026; P1 has no remaining release or acceptance steps.
See [Category management and owner-run release checks](CATEGORY_MANAGEMENT.md).

Subsequent P1 refactor (October 12, 2026): expected repository write refusals now return an explicit `RepositoryResult<T>`;
application code maps them to bot results without catching domain exceptions. Technical failures still throw, and the D1
adapter translates only recognized category-name uniqueness violations. Existing callers/tests were updated and three
behavior tests were added for failure results, archive/write races, and technical exceptions. No schema change was needed.
The earlier 80/80 result predates this refactor. The subsequent full test run passed 83/83 tests on October 12, 2026;
three focused tests, type check, and dry-run build subsequently passed after removing nested ternaries.
The Wrangler migration test now disables its banner/npm update check,
closes child stdin, and bounds each invocation to 30 seconds, preserving all database assertions.

- [x] Full tests after the repository-result refactor: 83/83.
- [x] Local type check and dry-run build after the repository-result refactor.

Category alphabet simplification (October 12, 2026): new/renamed names accept only Russian letters including `Ё/ё`, English
letters, ASCII digits, ordinary spaces and `-`, with at least one letter and the existing 80-character limit.
TDD started with five failing tests; all 12 focused tests then passed, followed by 88/88 full tests, type check and dry-run build.
NFC, duplicate parser comparison, and unused validation/normalization helpers were removed, reducing production code.
Case and spacing rules, longest-name matching, comments and existing seeded migration keys remain intact; no new migration is required.

Owner decision (October 12, 2026): removed the frozen category-ID snapshot and legacy `c`/`e` index decoding.
Such buttons return the existing invalid-button explanation without expense writes; `c1`/`e1` use ordinary category IDs from D1.
A focused test failed before implementation and three focused tests passed afterward. Full tests passed 89/89,
along with type check and dry-run build. Existing expense/category rows are unchanged.

### Task P2: Make the displayed currency configurable

Bot-side implementation is complete and merged. The owner deployed and verified it in demo and production
on October 15, 2026. See [the settings contract](INSTANCE_SETTINGS.md) for supported labels, migration-seeded
initial settings and the installer setup/change protocol. Installer controls remain in Tasks 4 and 6.

- [x] Define a required `display_currency` value in the single D1 settings row and validate a nonempty, supported label.
  Missing or invalid values must cause an explicit configuration failure, never imply `RSD`.
  Migration `0005` seeds `RSD` in D1; the Worker never substitutes it when the value is missing or invalid.
- [x] Replace user-visible hard-coded `RSD` in expense confirmation, history, details, editing prompts/errors,
  category-selection prompts, and statistics with this setting. Keep amount validation and integer arithmetic unchanged.
- [x] Create a request-local settings loader in `src/index.ts`; read and validate settings only when an operation needs
  currency or timezone, and pass the values through the Telegram/application boundaries that use them. Do not cache it without a tested invalidation strategy, use global mutable state,
  store the label on every expense, or add exchange-rate logic.
- [x] Keep the current `amount_rsd` database column and its values unchanged in this release.
  Treat it as a legacy field name; renaming it would require a separate compatibility migration and is unnecessary for a text change.
- [x] Define the installer contract: choose a short validated label during setup and change it later by updating the
  customer's D1 settings row. Read the current value from D1 before showing a change; do not keep an authoritative
  local or Worker-configuration copy. Explain that old amounts keep the same number and receive the new label.
  If a write times out, read D1 again before reporting whether the old or new label is in effect.
  Implement the actual wizard controls in installer Tasks 4 and 6.
- [x] Add tests using a label other than `RSD` and verify all bot money text changes while stored amounts,
  statistics totals/percentages, editing, source action keys, and expense dates remain numerically identical.
  Verify missing/invalid settings fail visibly and test a later label change with existing expenses.

Local verification (October 13, 2026): TDD reproduced failing currency prompts, timezone boundaries,
and request-level configuration handling before implementation. The full regression suite passed 138/138 tests;
subsequent focused checks also passed for duplicate/absent settings tables, a timezone change, DST evenings,
and non-RSD totals/percentages. Type check and Worker dry-run build passed. Both fresh-D1 and local Wrangler
upgrade tests passed; no remote D1 operations or Worker deployment were performed.

Selective settings loading (October 14, 2026): unknown routes and invalid webhook secrets no longer read settings.
Telegram loads settings only when an operation uses currency or timezone; health always validates them.
A lazy loader reuses its promise only within the current request. Configuration errors propagate from both
message and callback handlers as HTTP 503 before dependent expense writes. Help, category management,
expense deletion, explicit calendar navigation, date/comment prompts, and empty history work without settings.
TDD reproduced the previous failures; 165/165 full tests, type check, and dry-run build passed.
No remote D1 operations or Worker deployment were performed.

Initial settings seed (October 14, 2026): migration `0005` now inserts `RSD` and `Europe/Belgrade`.
Fresh and populated local databases receive the row; reapplying Wrangler migrations preserves customer-selected values.
Worker validation and selective loading are unchanged. Missing-row tests explicitly delete the seeded row.
TDD reproduced the empty-table behavior before the change; 166/166 full tests, type check, dry-run build,
and the local application example passed. No remote D1 operations or Worker deployment were performed.

Bot-side acceptance before installer work: a test D1 with another display label consistently
renders it for old and new expenses without changing any stored amount or calculation. Final acceptance includes
choosing and changing the label through the installer during the separate-account rehearsal.

### Task P3: Make the finance timezone configurable

Bot-side support is complete and merged with P2; they share a migration and ship together. The owner deployed
and verified both in demo and production on October 15, 2026. Installer controls remain pending in Tasks 4 and 6.
See [the settings contract](INSTANCE_SETTINGS.md).

- [x] Define a required `finance_time_zone` value in the same D1 settings row. Accept only a valid IANA timezone identifier
  supported by the Worker runtime; missing, invalid, or unsupported values must fail visibly, never imply `Europe/Belgrade`.
  Migration `0005` seeds `Europe/Belgrade` in D1; the Worker never substitutes it when the value is missing or invalid.
- [x] Replace the hard-coded timezone in `src/application/dateRange.ts` with the validated value read from D1 and passed
  through the Telegram/application calls that need the current local date. Avoid process-global mutable state.
- [x] Use the selected timezone when assigning `spent_on` to a newly created expense, including both full-text entry and
  amount-plus-category selection. Use the time of the actual creation action; do not reinterpret a prior message's timestamp.
- [x] Use it for current date/month/year decisions in time-relative actions, especially previous-month statistics and
  the calendar month initially shown from that action. Preserve the fixed `firstStatisticsYear = 2026` history floor:
  it is a product rule, not a timezone-dependent current year.
- [x] Keep explicitly entered dates and existing `expenses.spent_on` values exactly as stored. Do not run a D1 data migration,
  backfill, UTC conversion, or recomputation when the selected timezone changes. Do not alter existing UTC creation/update timestamps.
- [x] Define the installer contract: choose the timezone at setup, show the current and proposed zones when changing it,
  and explain that newly added expenses and relative-period boundaries may change while historical dates stay fixed.
  Update only the D1 settings row; verify the committed value by reading it back. If the write result is unknown, reconcile
  against D1 before reporting success or failure. No Worker redeployment is needed for a settings-only change.
  Implement the actual wizard controls in installer Tasks 4 and 6.
- [x] Test different zones at the same instant near day, month, and year boundaries, plus daylight-saving transitions.
  Verify the new expense date and previous-month range use the selected zone, and changing zones leaves existing expense
  rows, explicit dates, amounts, and UTC timestamps untouched. Verify missing/invalid settings fail visibly.

Bot-side acceptance before installer work: the same test instant produces the expected local expense date and
previous-month range in two configured zones, without changing stored historical rows. Final acceptance includes
choosing and changing the zone through the installer during the separate-account rehearsal.

P2 and P3 share one new numbered migration: create `instance_settings` with an integer primary key constrained to `id = 1`,
`display_currency TEXT NOT NULL`, and `finance_time_zone TEXT NOT NULL`, with no SQL `DEFAULT` clauses.
Migration `0005` creates the table and inserts `id = 1`, `RSD`, and `Europe/Belgrade` as initial values.
For existing production/demo instances, applying this migration preserves their current behavior without separate SQL.
During setup, the installer reads the seeded row, shows the current values for owner confirmation or change, and updates
that row before deploying the Worker/registering the webhook. Migration history prevents reseeding on updates;
never overwrite customer-selected values. Preserve migrations `0001`–`0004`. If the earlier unseeded revision of `0005`
was already applied, editing its file will not initialize that database; see [the settings contract](INSTANCE_SETTINGS.md).

Always read and validate the settings row for `/health`. For Telegram, read settings only when the action needs currency
or timezone, before any dependent expense write. Unknown routes, invalid webhook secrets, access denials, help, category
management, expense deletion, explicit calendar navigation, and date/comment prompts do not read settings. An empty history
or a missing expense can also be reported without settings. Use at most one settings read per request, reusing its result
within that request only. Missing, duplicate, or invalid settings make health unhealthy and dependent Telegram operations
return HTTP 503 without changing expenses; log the setting name and reason without logging secrets. Local and deployment
test fixtures use the migration seed or explicitly update it for their scenario. Missing-setting tests delete the row.
The Worker must never fall back to initial values. The installer reads D1 as authoritative and requires confirmation
or a change of the initial choices before first use.
Test the migration on fresh and populated D1 databases, reject a second settings row, and verify that a settings update
changes the next Worker response without changing expense rows or deploying a new Worker.

Implement and verify P0 first, then P1 and the bot-side support for P2/P3. P2 and P3 share the settings migration
and must ship together; P1 may ship separately if its migration remains compatible.
Then implement and verify P4 before resuming Section 6. All P0-P4 product acceptance checks must pass before the
independent-account rehearsal is accepted.

### Task P4: Browse expense history by month or arbitrary period

Status: planned, not implemented. This documentation change must be reviewed and approved by the owner before implementation.
P4 is the next product prerequisite after the completed bot-side P2/P3 work; finish it before continuing independent-family installer work.

- [ ] Keep **История** as the entry point and show the latest 10 expenses by default, preserving the current newest-ID-first order,
  date, amount, configured display currency, category name, and buttons opening expense details.
- [ ] Put **Другой период** in the first inline-keyboard row, above the expense buttons. Keep it available for an empty list too.
  Provide **Последние 10** from period views to return to the default history.
- [ ] Reuse the statistics interface for period selection: **Предыдущий месяц** / **Следующий месяц** browse full calendar months,
  and **Другой период** opens the existing day calendar. Start the picker in the current month determined by `finance_time_zone`;
  allow that full month to be selected without choosing its first and last days individually.
- [ ] Reuse the calendar's two-click range selection: first choose the start day, then the end day. Preserve the selected start
  while navigating between months, allow resetting it, accept a single-day range, and reject an end before the start with the
  same explanation as statistics. Show the chosen range in the history heading; show a clear empty-period message with navigation.
- [ ] Filter by stored `expenses.spent_on`, including both selected boundary dates, just like statistics. Do not filter by creation
  timestamps or reinterpret stored dates through a timezone. Include both members' expenses and archived-category expenses.
  History must reach every stored expense date; do not accidentally inherit the statistics-only `firstStatisticsYear = 2026` floor
  if older expenses exist. Preserve the statistics floor and its current behavior.
- [ ] Make every expense in a selected period reachable with pages of at most 10 records and **Назад** / **Далее** controls.
  Preserve the period when paging and order by descending expense ID, as in the default history, so ties in `spent_on` are unambiguous.
  Reset to the first page when changing the period; do not silently truncate a period to its latest 10 records or send an unbounded list.
  If edits/deletions change matching records between requests, refresh from current data and keep navigation usable, including an empty page.
- [ ] Reuse the date-range helpers, month navigation, and calendar rendering from statistics instead of maintaining a second calendar.
  Carry an explicit history/statistics destination in callbacks so selecting a day in history returns an expense list and selecting
  it in statistics still returns totals. Preserve already-sent statistics buttons and the Telegram 64-byte callback-data limit.
  Keep selections in callback data using the existing stateless approach; no server-side conversation store is needed.
- [ ] Apply the existing enabled-member access check to every new calendar, month, page, and details action. Preserve expense
  details/edit/delete behavior for records opened from period history, including records older than the default latest 10.
  Browsing history must not modify expenses, categories, settings, or source action keys; no schema migration is expected.
- [ ] Add focused repository/application coverage for inclusive range boundaries and a period spanning more than 10 records,
  including archived categories. Add Telegram journey coverage for monthly browsing, a cross-month custom range, pagination,
  empty results, returning to **Последние 10**, and denied access. Verify history/statistics callback routing and retain existing
  statistics behavior. Run the affected tests, full regression suite, type check, and Worker dry-run build.
- [ ] Provide a short owner verification scenario: open **История**, choose a month containing more than 10 expenses, reach an
  older expense on the next page and open its details, select a cross-month day range, then return to **Последние 10**.
  Verify a single-day and an empty period, and check that **Статистика** still calculates the same periods and totals.
  Record local verification separately from owner-authorized deployment and live Telegram acceptance on the existing bot.

Acceptance: either enabled member can reach any stored expense through monthly or custom-period history, including records
outside the latest 10, without changing financial data. Period boundaries agree with statistics, navigation remains available
for empty results, and the existing statistics and expense details/edit/delete journeys still work.
Complete local checks and owner-confirmed live acceptance on the existing bot before resuming the installer phases.

## 4. Owner journeys

### Initial installation

1. Open the official BotFather in Telegram, send `/newbot`, choose a name and available username, and obtain the bot token.
2. Download the trusted release ZIP, extract it, and launch `Start setup.cmd`.
3. Click **Подключить Cloudflare**. The browser opens Cloudflare's authorization flow; register/sign in and approve access.
4. If more than one Cloudflare account is available, choose the intended account in the wizard.
5. Paste the Telegram token. The wizard shows the bot username and asks the owner to confirm it.
6. Choose the display currency label and finance timezone, review the default categories, then click **Установить**.
   Wait for database creation, migrations, settings-row initialization, Worker deployment, secrets, and webhook setup.
7. Each family member sends `/start` to the new bot. Before approval, it responds with their Telegram ID.
8. Enter the two Telegram IDs and display names in the wizard, review them, and click **Добавить участников**.
9. Both members send `/start` again. Add one sample expense, view it from the other account, then edit and delete it.
10. Close the wizard. Keep the small local file containing the Cloudflare account ID, D1 database ID, and Worker name.

After setup, either member manages categories from the bot's **Категории** menu.
The owner changes the display currency through **Изменить валюту** in the installer; old numeric amounts stay unchanged.
The owner changes the timezone through **Изменить часовой пояс** in the installer; existing expense dates stay unchanged.

Expected setup time is roughly 10-20 minutes if registration proceeds normally. Measure this during the pilot rehearsal.
There is no copying of the developer's expenses or family members into the new database.

### Routine update

1. The developer publishes a tested release ZIP and short release notes.
2. The owner extracts the new package and launches its wizard. It reads the three resource identifiers from the stable local data directory.
3. Click **Обновить** and review the installed version discovered from Cloudflare, target version, database, Worker, and account.
4. Sign in again only if authorization has expired or is unavailable.
5. Confirm. The wizard applies pending migrations, deploys the Worker, and verifies the result.
6. Send `/start` and open the bot's history to complete the Telegram smoke check.

The routine update does not require recreating the bot/database or re-entering participants.
It preserves the existing Worker secrets and webhook. Do not promise automatic Telegram API diagnostics without a token:
if the owner requests them, ask for the token temporarily rather than retaining it between sessions.

### Connection and settings

**Проверить подключение** verifies account/resource identity, health, and migration status; it does not modify expenses.
**Изменить валюту** updates the D1 settings row and preserves all expense values.
**Изменить часовой пояс** updates the same row and preserves all existing expense dates and values.
These operations may require Cloudflare sign-in. A health response alone is not proof that Telegram or D1 is working.

## 5. Deliverables and architecture

Implement a separate installer tool inside this repository. Category, currency, timezone, and P4 history browsing behavior are product prerequisites;
the installer performs deployment and instance configuration, not category editing or other finance logic.

Suggested source layout; paths are proposals and do not exist yet:

```text
tools/family-installer/
  server.ts                 Local HTTP server and operation routing
  installation.ts           Ordered setup steps and safe retry after failure
  updates.ts                Compatibility checks, migrations, deployment
  cloudflare.ts             Wrangler invocation and account/resource verification
  telegram.ts               Token check and initial webhook configuration
  resourceIds.ts            Three persistent resource identifiers
  ui/                       Small browser interface, styles, and client code
  tsconfig.json             Separate Node-oriented type checking
scripts/build-family-release.ts
tests/installer/             Fixtures, adapter tests, and update integration tests
docs/FAMILY_INSTALLATION.md  Short owner instructions, written when behavior exists
```

Use bundled Node.js and a pinned Wrangler installation in the delivered ZIP.
Include Wrangler's required runtime/native dependencies and license notices; verify the package in a clean Windows environment.
The recipient must not need global Node.js, npm, Git, or an initial dependency installation.
Use plain HTML/CSS/browser JavaScript for the wizard unless a demonstrated need justifies more dependencies.

The local Node service controls providers. The browser is only a UI; it never invokes a privileged generic shell or SQL endpoint.
Suggested operation API: status, connect, validate bot, install, enable participants, update, check connection.
Run only one wizard action at a time. Disable action buttons while it runs; keep progress/status available.
Enforce the same exclusion in the local Node service, including across browser tabs and two launched wizard processes.
There is no pause control. A later retry after a failure or process restart first checks what actually completed.

### Local data and secrets

Use a stable per-user directory such as `%LOCALAPPDATA%\FamilyFinanceBot`, outside extracted release directories.
The first version manages one family instance per Windows user; supporting an instance selector is later work.
Persist only the Cloudflare account ID, D1 database ID, and Worker name. Save each identifier as soon as it is known;
choose and save the Worker name before creating resources so a retry can recognize an uncertain creation result.
Use atomic file replacement and a cross-process operation lock. Do not persist an operation journal or progress checkpoints.
On each launch or retry, read the current Worker release/version and configuration from Cloudflare and migration history
from D1. Read the Worker URL and D1 name from Cloudflare when needed. Compare applied migration names with the numbered
files in the package; do not keep a second local migration ledger.
If remote release or migration state cannot be determined,
stop the update rather than guessing. Keep progress and sanitized errors only in memory while the wizard is running.
The currency label and finance timezone live only in the customer's D1 `instance_settings` row. Read them from D1
for display and changes; do not store a second copy in local instance state.
Do not place instance state in the source checkout or release archive. Treat participant IDs/names as private owner data.
Use stored resource IDs on retry; never infer ownership from a name alone or recreate a missing resource silently.
If database creation has an unknown outcome and its ID was not saved, show any matching resource for explicit owner
selection and verification; never adopt it automatically or create another database without resolving the ambiguity.
If the local identifiers are lost, let the owner explicitly select the existing resources after Cloudflare authorization
and verify their bindings and identity before saving them; never silently start a new installation.

Cloudflare OAuth credentials may remain in Wrangler's supported local credential store on the owner's computer.
Keep the token form and generated webhook secret in memory only while setup needs them.
If setup is restarted and needs a secret again, ask for the Telegram token and follow a documented secret-recovery step.
Long-lived bot secrets belong in the customer's Worker secret storage.

Bind the local server to loopback only. Require an unguessable per-launch session and validate request origin/host for mutations.
Disable cross-origin access, use POST for mutations, and keep session tokens out of URLs sent to external providers and diagnostic logs.
Avoid logging raw Telegram requests, token-bearing URLs, subprocess secret input, or expense contents.
Diagnostics should contain operation names, target identifiers, exit status, and redacted error messages.

### Release layout and version

Each ZIP uses fixed paths for the compiled installer, prebuilt `worker.js`, a Wrangler configuration template containing
the compatibility date, numbered `migrations/*.sql` files, bundled runtime/Wrangler, and Russian release notes.
There is no `release.json`. The build embeds one incrementing release number in the installer; the installer sets the
same number as `APP_RELEASE_VERSION` when deploying the Worker. Read the installed number from the deployed Worker.
Use fixed paths and sort migrations by their numeric prefixes; reject missing files, duplicate numbers, an applied
migration not present in the package, or an applied-name sequence that is not a prefix of the packaged sequence.
Never change the contents or names of a migration already included in a published release.

For the pilot, update only from release N to N+1. If the owner missed a release, apply the intermediate ZIPs in order.
Reject unknown installed versions and downgrades. Test each adjacent update before publishing it; require additive
migrations that leave the previous Worker usable if deployment fails. Do not offer installer-managed rollback.
The first version uses manually downloaded releases from a trusted distribution location. An automatic downloader,
signatures, and automatic update scheduling are separate future decisions.

## 6. Ordered installer implementation tasks

Begin or resume these tasks only after P0/P1, P2/P3's bot-side acceptance checks, and P4 history acceptance in Section 3.
Complete installer Tasks 1-6 in order; the checkboxes inside each task are required work, not a fixed sub-order unless
one item depends on another. Each task needs a reproducible check, expected result, and an explicit statement of external
checks not run.
Follow `AGENTS.md`: meaningful fixtures belong inside their tests, and update fixtures must have different initial/final values.
Use the existing Node test runner and actual local D1 where storage behavior matters.

### Task 1: Prove provider operations and pin the supported toolchain

- [ ] Read the referenced provider documentation and inspect the pinned Wrangler CLI's actual help.
- [ ] Reproduce the existing manual deployment recipe using a disposable bot and a separate test Cloudflare account.
- [ ] Verify OAuth login, account enumeration, explicit account selection, database creation, migrations, secrets,
  creation/read/update of the one-row D1 settings table, and Worker deployment.
- [ ] Choose a supported way to isolate/select Wrangler credentials. Named profiles are currently documented as experimental:
  use them only if the shipped version supports the required behavior; otherwise document and test the supported alternative.
- [ ] Ensure child processes cannot inherit unrelated Cloudflare credential/account overrides or load the developer's `.env` files.
- [ ] Always pass the generated instance configuration and explicit remote target. Never execute in the developer checkout by default.
- [ ] Verify that redeploy preserves existing Worker secrets and that migration history remains intact.
- [ ] Prove that the installed Worker release, resource bindings, and applied migration names can be read back after
  restarting the wizard with only the three local identifiers. Resolve any missing readback before relying on this design.
- [ ] Record the exact successful CLI/API calls, output parsing strategy, native dependencies, and runtime versions in a toolchain note.

Acceptance: a real disposable instance works and survives a redeploy.
Stop implementation of an unproven provider operation and resolve it before wrapping it in UI.
Do not deploy test resources into the existing production account/configuration as a substitute for this account-boundary check.

### Task 2: Generate reusable release artifacts

- [ ] Add the release builder and installer-specific Node tsconfig without mixing Node types into the Worker tsconfig.
- [ ] Build the Worker once on the developer's machine; the owner does not compile application source.
- [ ] Package the Worker, migrations, runtime, Wrangler configuration template, notices, and launcher at fixed paths
  without real configuration or credentials. Do not include `release.json`.
- [ ] Create an instance-config template with `DB`, `migrations_dir`, and compatibility date; fill account/database/Worker IDs at setup.
- [ ] Validate the fixed files exist, paths stay within the extracted package, and migration numbering is unambiguous.
- [ ] Embed the same incrementing release number in the installer and deployed Worker configuration.
- [ ] Exclude `.git`, `.env*`, `.dev.vars*`, `.wrangler`, instance settings, logs, and source deployment IDs.
- [ ] Add proposed scripts `installer:check`, `installer:test`, `installer:demo`, and `release:family` to `package.json`.
  Make their actual commands and expected outputs explicit when implementing them.

Acceptance: the ZIP runs on a clean Windows x64 machine without developer tools and contains no developer account/bot data.

### Task 3: Implement provider adapters and instance state

- [ ] Build narrow adapters for the exact operations in Task 1; avoid a general-purpose Cloudflare abstraction or SQL console.
- [ ] Invoke the bundled Node/Wrangler executable with argument arrays and `shell: false`.
  Supply secrets through supported stdin or private temporary input files, never command-line arguments.
- [ ] Parse structured provider output where supported; test any unavoidable text parser against the pinned version.
- [ ] Implement timeouts, redaction, cancellation handling, and reconciliation after an operation times out with an unknown result.
- [ ] Persist only the three resource identifiers; derive completed steps from verified remote state on retry.
- [ ] On retry after a failure or restart, query remote resources and migration state before repeating a mutation.
- [ ] Choose a unique Worker name before resource creation and verify IDs/bindings on retry. Treat same-name unrelated resources as a conflict.
- [ ] Do not delete resources automatically after setup fails. Explain the failed step and let the owner retry safely.

Acceptance: fake-provider tests demonstrate wrong-account rejection, safe retry, no duplicate D1 creation, and secret redaction.

### Task 4: Implement fresh installation and participant enrollment

- [ ] Verify the bot with Telegram `getMe`, show its ID/username for owner confirmation, and do not persist either locally.
- [ ] Require the owner to confirm or change and validate the initial currency label and finance timezone during setup.
  Block installation while either value is absent or invalid.
- [ ] Check `getWebhookInfo`. If another webhook already owns the bot, stop and explain the conflict; do not silently replace it.
- [ ] Create the D1 database and generate a dedicated instance configuration with an explicit `account_id` and `DB` binding.
- [ ] Apply all release migrations with Wrangler's migration system and verify no pending migrations remain.
- [ ] Read the settings row seeded by migration `0005` and show its current values. Require owner confirmation or change;
  update the row with the chosen values using parameter-bound SQL and verify it by reading it back.
  On retry, read the existing row and keep its values; do not overwrite it with migration seeds or earlier form values.
- [ ] Verify a clean baseline: the expected default categories and normalized names, selected display currency and finance timezone,
  zero members, and zero expenses. Derive expected counts from release fixtures rather than fixing 19 forever.
- [ ] Deploy the bundled Worker without registering a webhook yet, so the named Worker exists before setting secrets.
- [ ] Generate a cryptographically random Telegram-compatible webhook secret and set both required Worker secrets.
- [ ] Verify health, then register `/telegram` using Telegram `setWebhook` and the matching secret.
- [ ] Confirm `getWebhookInfo` reports the expected URL. Preserve pending updates; do not discard them as a default.
- [ ] Show enrollment instructions using the existing `/start` access-denied ID response.
- [ ] Validate two distinct positive Telegram IDs and nonempty display names; preview them before submission.
- [ ] Insert/update members safely, scoped to this database. Retry must not duplicate members or reset existing expense data.
  Use parameter binding through a supported API for variable SQL values; do not interpolate names into shell/SQL strings.
- [ ] Report installation success only after resource checks and the owner's Telegram smoke test; do not save a local completion flag.

Acceptance: two approved users share expenses, another user is denied, repeated setup adds no resources or duplicate participants.
No production finance behavior needs to change for this enrollment approach.

### Task 5: Implement updates and failure handling

- [ ] Read the three local identifiers and verify the current account, database, Worker, package layout, and remote migration state.
- [ ] Read and validate the D1 settings row before any update decision. Never substitute packaged values if it is missing
  or invalid; a missing row is a repair condition, not a new installation.
- [ ] Read the installed release from the deployed Worker and the schema state from D1, then display installed/target
  versions and require target N+1 before modifying anything.
- [ ] If local identifiers are absent, require explicit selection and verification of the existing Cloudflare resources;
  do not create a replacement database.
- [ ] For unchanged code/schema, report **Уже обновлено** without executing another migration/deploy.
- [ ] Apply only pending migration files. Preserve historical migration contents and their names.
- [ ] Deploy the target Worker with the existing binding and secrets. Do not repeat initial `setWebhook` or membership seeding.
- [ ] Preserve the settings row through migrations and Worker deployment; verify its values after the update.
- [ ] Check health, migration status, and deployed release identity before reporting the update as successful.
- [ ] Add optional `APP_RELEASE_VERSION` to the Worker environment and a `version` field in health when it is present.
  Set this variable to the build's release number in every generated customer configuration.
  Keep the original health response unchanged when the variable is absent and update relevant tests.
- [ ] After an interrupted update, reconcile actual cloud state before retrying the incomplete step.
- [ ] Detect a partially applied schema by comparing D1 migration history with the deployed Worker release;
  never report success from local state alone.
- [ ] Keep the owner-visible operation result and the final Telegram smoke-test checklist.

First-release update policy: support code-only changes and additive schema migrations compatible with the previous Worker.
If a migration fails, leave the old Worker deployed. Earlier migration files may already have succeeded; inspect actual state before retrying.
If deployment fails after migration, keep the compatible old Worker and retry deployment after reconciliation.
Do not assume the entire migration-and-deployment sequence is one transaction.

For future renames, removals, or incompatible transformations, use multiple compatible releases or design a maintenance procedure.
The first wizard must reject such schema changes rather than guessing their order or asking the family to execute SQL.
This pilot has no installer-managed rollback, database backup, or restore path;
a destructive migration or accidental data change may cause permanent data loss.

Acceptance: code-only, additive-schema, already-current, and interrupted adjacent updates preserve test expenses;
a skipped release is rejected with instructions to install the intermediate ZIP first.

### Task 6: Complete UI, packaging, and owner instructions

- [ ] Provide Russian-language actions **Подключить Cloudflare**, **Установить**,
  **Добавить участников**, **Проверить подключение**, **Изменить валюту**,
  **Изменить часовой пояс**, and **Обновить**. These are user-facing labels; keep technical resource names intact.
- [ ] Disable all action buttons during an operation and show its progress. On failure, show what completed and allow
  a safe retry after checking remote state. Reject a second action in Node, even from another tab or wizard process.
- [ ] Show the current/new display labels and the effect on existing records before confirming a change.
  Update the one D1 row with parameter-bound SQL and read it back; if the outcome is unknown, reconcile with D1.
- [ ] Show the current/new timezone and explain the effect on future expense dates and relative periods before confirmation.
  Update the same row and read it back; a settings-only change does not deploy the Worker.
- [ ] Show progress, account/resource identity, recoverable errors, and next actions in Russian. Show bot identity only
  when a token is temporarily supplied and verified with Telegram `getMe`. Keep provider error codes
  or resource IDs where they help diagnostics, with a clear Russian explanation.
- [ ] Open the local browser automatically; use hidden background helpers and avoid requiring terminal interaction.
- [ ] Use the stable local data directory so extracting a new ZIP does not lose installation state.
- [ ] Confirm behavior when paths contain spaces, the package folder is moved, the process restarts, or a second wizard is launched.
- [ ] Write `docs/FAMILY_INSTALLATION.md` in Russian with BotFather steps, setup/update instructions,
  and expected screens. Write owner-facing release notes in Russian too; developer documentation may remain in English.
- [ ] Explain the pilot's data-loss risk and absence of installer-managed backups/restores in the owner instructions.
- [ ] Document how to preserve the three local identifiers, reselect verified resources if they are lost, reauthorize
  Cloudflare, and request help using redacted diagnostics.
- [ ] Measure setup duration and update duration in the clean-machine rehearsal.

Acceptance: the rehearsal can be completed by following only the owner instructions, without reading this developer plan.

## 7. Verification before involving the friend

### Automated checks

Keep existing application regression coverage. Add adapter fixtures and real local D1 upgrade tests for meaningful new behavior.
Each Telegram journey should remain coherent; use named helpers for irrelevant assertion boilerplate.

Required scenarios:

- Fresh installation, two distinct participants, invalid token, wrong account, conflicting resource name, and existing unrelated webhook.
- Process restart after D1 creation, after migrations, after secrets, and after deployment; no duplicate resources or data reset.
- Cloudflare/Telegram timeouts with an unknown mutation outcome, expired authorization, and a second concurrent wizard.
- Old release with declared test expenses upgraded to new code and an additive migration, with all initial values declared in the test.
- An adjacent update applies each pending migration once; a repeat update leaves rows, source action keys, and participants intact.
  A skipped release is rejected before any mutation.
- Changing the currency label with existing expenses changes every relevant bot message but no expense value or total.
- An update preserves a customer-selected label; installation initializes the selected label.
- Changing the finance timezone with existing expenses changes future local-date and relative-period decisions, but no
  stored `spent_on` date, UTC timestamp, amount, or source action key. An update preserves the selected zone.
- Missing/invalid currency or timezone makes Worker health fail and blocks Telegram expense writes; installation/update
  also stops rather than selecting a hidden fallback value.
- Changing either setting updates only the D1 row; the next Worker request uses the new value without a redeploy.
  A timed-out settings write is resolved by re-reading D1 before showing an outcome.
- Missing package files, ambiguous migration numbering, unknown installed version, skipped release, incompatible schema,
  and downgrade are rejected before mutation.
- Migration succeeds but deployment fails; deployment succeeds but the final connection check fails; neither reports a healthy new release.
- No secret/token-bearing URL or expense content appears in logs, diagnostics, settings, or distribution ZIPs.
- UI mutation endpoints reject requests without the local session or from an unrelated origin.

Existing developer commands:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
npm.cmd run demo:webhook
```

Proposed commands to implement in Task 2; they do not work yet:

```powershell
npm.cmd run installer:check
npm.cmd run installer:test
npm.cmd run installer:demo
npm.cmd run release:family
```

`installer:demo` must simulate providers locally and let the developer exercise setup, retry after failure, and update without accounts or real data.
Offline checks do not prove provider permissions, remote migrations, Windows packaging, or real Telegram delivery.
Use Wrangler migration commands with persistent local D1 for migration-history tests; direct SQL seeding alone is insufficient.

### Real deployment rehearsal

1. Prepare a disposable Telegram bot and a separate customer-like Cloudflare account controlled by the tester.
2. Use a clean VM or separate OS user/browser profile without the developer's runtime, repository, credentials, or environment overrides.
3. Install only the ZIP. Complete the owner instructions and record problems, elapsed time, and exact versions.
4. Use two Telegram users to test that old synonyms are rejected, then category add/rename/archive/restore and both expense entry methods,
   cross-member history/editing, P4 monthly and custom-period history with more than 10 expenses and paging, duplicate taps,
   expense deletion, and statistics. Verify archived-category expenses remain in history and totals.
5. Verify another Telegram user is denied. Turn off the setup computer and verify the bot still works.
6. Change the display currency and finance timezone with existing expenses. Verify unchanged numeric data and stored dates in D1;
   near a day/month boundary, verify that new expenses and previous-month statistics follow the new timezone.
    Run both a code-only update and an additive-schema update; verify the chosen settings and data/key/member preservation.
7. Interrupt setup and update, then retry each operation; verify no duplicate resources or lost test expenses.
8. From a developer-only Cloudflare identity, attempt D1 access without customer credentials: it must be denied.
   Verify that the developer is not a customer-account member and is not enabled in the customer finance bot.
9. Inspect distribution contents, persisted settings, redacted diagnostics, and outgoing destinations for unintended data/secret transfer.
10. Check real Worker CPU usage and D1 usage on the Free plan. Retain observations rather than claiming free operation from request counts alone.

The tester owns both rehearsal identities; the access-denial check demonstrates account isolation, not cryptographic separation from that tester.
With only one Telegram user, some automation can be tested, but the live two-person acceptance check remains incomplete.
The existing demo environment is useful for development; it does not replace a separate-account clean-machine rehearsal.

Release to the friend only after all P0-P4 product prerequisites, setup, update, packaging,
and account isolation have all passed.
Keep a small acceptance record with versions, check dates, results, and any known limitations; exclude private fixtures and credentials.

## 8. Developer release procedure after the pilot

1. Implement the code change and add numbered migrations if needed. Never edit an already distributed migration.
2. Preserve existing category IDs. Use stable IDs for category buttons; pre-P1 index callbacks remain rejected with an invalid-button reply.
3. Increment the release number embedded in the installer and deployed Worker; keep fixed package paths and the Wrangler
   compatibility date in its configuration template.
4. Test fresh install and the adjacent upgrade from the previous release. Verify skipped releases and downgrades are rejected.
5. Run the relevant application/installer checks and complete a disposable remote upgrade before publishing schema changes.
6. Build the ZIP, inspect it for private configuration/credentials, and publish release notes with the artifact.
7. Tell the owner a release is available. The owner downloads it and confirms **Обновить** on their own computer.

No developer-owned CI job, bot manager, or deployment token may push changes into the customer's account in this model.
Automatic updates or a shared central service would be a different trust/operations model and require a separate decision.

## 9. Deferred bot features

Do not add these to the initial installer work merely to make the pilot feel more complete:

- History filters beyond P4 date periods, statistics filtering changes, new reports, or income tracking.
  P4 monthly/custom-period history and its pagination are required prerequisites in Section 3, not deferred features.
- Arbitrary SQL/data administration UI or a new public Mini App.
- Period-based bulk deletion and any category capabilities beyond P1, such as cross-instance sharing of category templates.
- A public web installer, phone-only setup, multiple platform packages, automatic update scheduling, and installer-managed backups/restores.

If period deletion is requested later, specify inclusive start/exclusive end, preview matching count/records, require confirmation,
and verify the affected rows. Prefer a bounded operation over an unrestricted SQL console.
Estimate: approximately 1-2 working days, separate from the installer estimate.

Basic participant setup belongs in the wizard. Full bot roles, member invitations, and participant-management UI remain separate work.

## 10. Alternatives considered

| Alternative | Decision and reason |
| --- | --- |
| Another D1 in the developer's account plus a customer password | Rejected: D1 access uses Cloudflare permissions/tokens/bindings; a password cannot remove the account administrator |
| Developer hosts everything; family only opens Telegram | Convenient, but leaves the developer able to access data/change the Worker |
| Encrypt D1 while the key remains on the developer's server | Does not protect against that operator, who handles plaintext messages and the key |
| Customer-owned infrastructure with the local wizard | Selected: one manual authorization boundary, reusable setup/update tools, no developer credentials |
| Public web installer with retained customer deployment credentials | Deferred: adds a service and grants its operator deployment powers; conflicts with the selected boundary |

Cloudflare supports temporary preview accounts with a later ownership claim, including D1. The user still signs in/registers
and completes the claim within 60 minutes; unclaimed resources are deleted. This is a possible future onboarding alternative,
not required for the local wizard. Production/updates need a permanent account and authenticated workflow.
[Cloudflare claim deployments](https://developers.cloudflare.com/workers/platform/claim-deployments/).

Telegram Managed Bots can reduce creation to opening a link and confirming prefilled details. The user owns the new bot,
but the manager can obtain/replace its token. A developer-operated manager therefore retains control over future message delivery.
No verified complete manager-detachment procedure was established during planning. Use manual BotFather creation for this pilot.
[Managed Bot creation](https://core.telegram.org/bots/features#managed-bots),
[manager capabilities](https://core.telegram.org/api/bots/managed-bots).

## 11. Effort and operating costs

These are preliminary engineering estimates, not measured delivery times. They assume one Windows x64 package,
local UI, manually distributed releases, and only P0/P1/P2/P3/P4 product changes.

| Work | Estimated effort |
| --- | --- |
| P0: remove existing aliases and update tests | 0.5-1 working day |
| P1: editable categories and normalized-name migration | 3-5 working days |
| P2: display currency in bot and installer | 1-2 working days |
| P3: finance timezone in bot and installer | 1-2 working days |
| P4: history periods, shared calendar, and pagination | 2-3 working days |
| Provider/toolchain proof | 4-8 hours |
| Installation automation and state | 8-16 hours |
| Local UI, release builder, and packaging | 8-16 hours |
| Updates and failure handling | 5-8 hours |
| Automated checks, real rehearsal, and owner instructions | 8-16 hours |

Installer work remains roughly 33-64 hours, or 4-8 full working days. With P0/P1/P2/P3/P4, budget about 12-21 full working days total.
These estimates overlap where currency/timezone configuration is built with the installer and depend on the category name migration design.
Re-estimate after P4 and installer Task 1, particularly if packaging or OAuth isolation requires more work.
Additional operating systems, a polished desktop application, a public web service, and incompatible schema migrations are extra scope.

Expected infrastructure budget for a two-person family is $0/month if observed workload stays within the Free plan.
As reviewed on October 10, 2026:

- Workers Free: 100,000 requests/day and 10 ms CPU per invocation. Paid Workers starts at $5/month per account, with possible usage charges.
  Check actual CPU behavior during rehearsal, including startup; low traffic alone does not guarantee free operation.
  [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage, and a 500 MB maximum per database.
  [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
  [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- Ordinary Telegram bot use is free. Paid broadcast features are unnecessary for this pilot.
  [Telegram bot platform](https://core.telegram.org/bots).

No custom domain, always-on personal computer, paid CI, or developer-operated server is required by this plan.
Stay on Free unless measurements justify an explicit owner-approved upgrade. Recheck provider prices before release.

## 12. Completion checklist

- [x] P0 is complete before P1/P2/P3: alias configuration and parsing code are removed, name-only entry works, and former synonyms fail.
- [x] Category management works inside the bot for both enabled members, including safe archive/restore.
- [x] Archived categories cannot be selected for new expenses or category changes; existing expenses remain in history and statistics.
- [x] Full-text expense input matches the current category name without aliases; amount-only input still offers category buttons.
- [x] Migrated and fresh databases expose the same default categories without losing historical expenses.
- [ ] The installer selects and later changes the display currency; existing values, sums, and dates remain unchanged.
- [ ] The selected display currency survives an update.
- [ ] The installer selects and later changes the finance timezone; existing stored expense dates and UTC timestamps remain unchanged.
- [ ] New expense dates and relative-period boundaries follow the selected zone; that zone survives an update.
- [ ] Both settings live in one D1 row in existing and new databases; missing/invalid values fail health and block settings-dependent expense writes.
- [x] Settings changes take effect without Worker deployment (owner-verified in demo and production on October 15, 2026).
- [ ] P4 documentation is owner-approved before implementation, and P4 is complete before installer work resumes.
- [ ] History defaults to the latest 10 and offers month/custom-period selection above the expense list.
- [ ] All expenses in a chosen period are reachable through pagination, including archived-category and older expenses.
- [ ] Inclusive date boundaries, empty periods, access checks, and unchanged statistics/details/edit/delete flows are verified locally and live.
- [ ] A clean Windows x64 environment can run the delivered package without developer tools or manual commands.
- [ ] The owner creates a bot and authorizes Cloudflare; all resource setup happens through the wizard.
- [ ] Two enabled participants can use the existing finance journeys; unknown users are denied.
- [ ] Closing the wizard/computer does not stop the deployed bot.
- [ ] Settings survive package replacement and installation/update can be retried after interruption without resetting data.
- [ ] A tested release upgrades an existing instance and preserves expenses, members, bindings, and secrets.
- [ ] The owner instructions disclose that installer-managed backup and restore are outside this pilot.
- [ ] Unsupported schema transitions and skipped releases are rejected; the absence of installer-managed rollback is documented.
- [ ] No developer credentials, real customer data, or secret/token logs are shipped or sent to the developer.
- [ ] Separate-account access denial and the real provider/Telegram rehearsal are recorded.
- [ ] Owner instructions match the shipped UI; estimates and observed Free-plan usage are updated.

## References for implementation

- [Existing manual deployment recipe](TEST_ENVIRONMENT.md)
- [Current application design](TECHNICAL_DESIGN.md)
- [Project implementation history and verification conventions](NEXT_STEPS.md)
- [Wrangler login, profiles, and identity commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Wrangler D1 creation and migration commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [D1 migration tracking](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 binding access](https://developers.cloudflare.com/d1/worker-api/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

Verify exact flags and behavior against the shipped Wrangler version. Provider documentation may describe a newer version.
