# Instance settings: Worker and assisted setup contract

Migration `0005_instance_settings.sql` creates `instance_settings` and inserts one
row with `id = 1`, `display_currency = 'RSD'`, and
`finance_time_zone = 'Europe/Belgrade'`. These are initial database values;
the Worker never substitutes them when settings are missing or invalid.
P2 currency support and P3 finance timezone support share this migration.
Migrations `0001`–`0004` are unchanged.

## Existing production and demo instances

The owner applies the migration to each database before deploying the new Worker.
The migration preserves the existing currency/timezone behavior without a
separate initialization command. Verify the stored row after applying it:

```sql
SELECT id, display_currency, finance_time_zone FROM instance_settings;
```

No remote migration, setting change, or deployment was performed during implementation.

### If the earlier unseeded revision of 0005 was already applied

Editing the migration file does not rerun a migration already recorded by Wrangler.
Read the settings row first. Only if it is missing, the owner can explicitly initialize
that database with the existing instance's settings:

```sql
INSERT INTO instance_settings (id, display_currency, finance_time_zone)
VALUES (1, 'RSD', 'Europe/Belgrade');
```

If the row already exists, read it and preserve its chosen values. Do not replace it
as part of a migration, update, retry, or package replacement. After deployment,
`GET /health` must return HTTP 200. Missing settings, an unreadable settings table,
or invalid values return HTTP 503 with a configuration reason. Telegram updates that need currency or timezone
also return HTTP 503 without changing expenses in that state. Configuration errors
log only the setting name and validation reason, without values or secrets.

## Validation and setup

Use `validateInstanceSettings` in `src/config/instanceSettings.ts` as the shared
validation contract. `display_currency` is a supported uppercase ISO 4217 code
from the runtime's `Intl.supportedValuesOf("currency")`, such as `RSD`, `EUR`, or
`USD`. Symbols, lowercase codes, whitespace, arbitrary text, and unknown codes
are rejected. This code is used as plain display text; no conversion is performed.

`finance_time_zone` is `UTC` or an IANA identifier with a region/path, such as
`Europe/Belgrade` or `America/New_York`, accepted by the runtime's
`Intl.DateTimeFormat`. Offset strings and abbreviations such as `CET` are rejected.
Worker validation remains authoritative if the operator tools and Worker runtimes differ.
Neither setting has a fallback.

During setup, apply migrations and read the seeded settings row from D1. Show its
current currency and timezone to the owner and require confirmation or a change
before the bot starts accepting expenses. Save a changed choice using parameter-bound
`UPDATE` statements for `id = 1`, then read back the values before deploying/registering
the webhook. The primary key and `CHECK (id = 1)` reject extra rows; both setting
columns are non-null and have no SQL `DEFAULT` clauses.

Migration history ensures the seed runs only when 0005 is first applied. Updates,
retries, and package replacement must preserve customer-selected values; never
repeat the seed or use `INSERT OR REPLACE` to restore the initial values.

## Changing settings later

During assisted maintenance, the operator reads the current settings from the family's D1 database
before proposing a change. D1 is authoritative; local files and Worker configuration
must not keep a separate authoritative copy. Show current and proposed values and
require confirmation with these explanations in Russian:

- Валюта — только подпись. Числа не пересчитываются. Новая подпись будет показана
  для всех старых и новых расходов и отчётов.
- Часовой пояс влияет на даты новых расходов и границы относительных периодов,
  например предыдущего месяца. Сохранённые даты, суммы и временные метки старых
  расходов не изменятся. Состав статистики может измениться.

Validate the proposed values and update only the relevant settings columns,
never expenses. Example parameterized operations:

```sql
UPDATE instance_settings SET display_currency = ? WHERE id = 1;
UPDATE instance_settings SET finance_time_zone = ? WHERE id = 1;
SELECT id, display_currency, finance_time_zone FROM instance_settings;
```

Read back the committed values before reporting success. If a write times out or
its outcome is unknown, read D1 again and reconcile the stored value with both
the old and proposed values. If that read also fails, report that the outcome is
unknown; do not claim success or failure and do not silently restore an old value.

Health always reads and validates settings through a primary D1 session. Other
requests read settings only when their operation needs currency or timezone,
before any dependent expense write. Unknown routes and invalid webhook secrets
are rejected without reading settings. Access denials, help, category management,
expense deletion, explicit calendar navigation, date/comment prompts, empty
history, and missing-expense replies also do not need settings. Editing an expense
still reads settings before writing because its confirmation displays money.

Each request has its own lazy loader. Its first call reads and validates the row;
further calls reuse the same promise and settings snapshot. No value is cached
across requests, and no global mutable state is used. A committed change applies
to the next request that needs settings, without redeployment.

## Compatibility and pilot acceptance

`expenses.amount_rsd`, existing integer amounts, source action keys, explicit
expense dates, and UTC timestamps remain unchanged. New expenses use the actual
creation action's time in the selected zone. Relative statistics use that zone;
the fixed first statistics year remains 2026. Changing settings never rewrites
expense rows or migration history.

The operator performs setup, changes and readback using the manual procedure in
[installation instructions](../deployment/FAMILY_INSTALLATION.md). The operator reads and updates settings through parameterized D1 queries.
Final acceptance still requires the separate-account rehearsal. The Worker implementation
and local checks do not establish that the remote instance has been configured.
