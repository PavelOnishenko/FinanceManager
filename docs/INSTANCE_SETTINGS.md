# Instance settings: Worker and installer contract

The Worker requires migration `0005_instance_settings.sql` and one explicitly configured
row in `instance_settings` before it can serve requests. P2 currency support and P3
finance timezone support share this migration. Earlier migration files are unchanged.
The migration creates an empty table; it does not select settings for the owner.

## Existing production and demo instances

The owner must apply the migration and insert the current settings into **each**
database before deploying the new Worker. No remote migration, setting change,
or deployment was performed during implementation.

For the existing instances, the explicitly chosen values are:

```sql
INSERT INTO instance_settings (id, display_currency, finance_time_zone)
VALUES (1, 'RSD', 'Europe/Belgrade');

SELECT id, display_currency, finance_time_zone FROM instance_settings;
```

If the row already exists, read it and preserve its chosen values. Do not replace it
as part of a migration, update, retry, or package replacement. After deployment,
`GET /health` must return HTTP 200. Missing settings, an unreadable settings table,
or invalid values return HTTP 503 with a configuration reason. Telegram updates
also return HTTP 503 and are not processed in that state. Configuration errors
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
Runtime validation remains authoritative if installer and Worker runtimes differ.
Neither setting has a fallback.

During setup, collect both choices, apply migrations, insert the singleton row
with `id = 1`, and read it back before deploying/registering the webhook. Use bound
parameters for values. The primary key and `CHECK (id = 1)` reject extra rows;
both setting columns are non-null and have no SQL defaults.

## Changing settings later

The installer must read the current settings from the customer's D1 database
before showing a change. D1 is authoritative; local files and Worker configuration
must not keep a separate authoritative copy. Show current and proposed values and
require confirmation with these explanations in Russian:

- Валюта — только подпись. Числа не пересчитываются. Новая подпись будет показана
  для всех старых и новых расходов и отчётов.
- Часовой пояс влияет на даты новых расходов и границы относительных периодов,
  например предыдущего месяца. Сохранённые даты, суммы и временные метки старых
  расходов не изменятся. Состав относительного отчёта может измениться.

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

Settings are read through a primary D1 session at the start of every Worker
request, including health. There is no settings cache or global mutable state.
A committed change applies on the next request without redeployment. A request
uses the settings snapshot loaded at its start.

## Compatibility and remaining installer work

`expenses.amount_rsd`, existing integer amounts, source action keys, explicit
expense dates, and UTC timestamps remain unchanged. New expenses use the actual
creation action's time in the selected zone. Relative statistics use that zone;
the fixed first statistics year remains 2026. Changing settings never rewrites
expense rows or migration history.

Installer Tasks 4 and 6 must implement the setup/change UI and timeout
reconciliation described above. Final acceptance still requires the separate
account rehearsal. The Worker implementation and local checks do not establish
that the installer or remote instances have been configured.
