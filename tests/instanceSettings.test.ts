import assert from "node:assert/strict";
import test from "node:test";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { createInstanceSettingsLoader, readInstanceSettings, validateInstanceSettings } from "../src/config/instanceSettings";

test("settings migration seeds the existing currency and timezone", async context => {
  const database = await createMigratedLocalD1("settings-empty");
  context.after(() => database.dispose());
  assert.deepEqual(await readInstanceSettings(database.DB), { displayCurrency: "RSD", financeTimeZone: "Europe/Belgrade" });
});

test("reads a supported currency and timezone from D1", async context => {
  const displayCurrency = "EUR";
  const financeTimeZone = "America/New_York";
  const database = await createMigratedLocalD1("settings-configured");
  context.after(() => database.dispose());
  await database.DB.prepare("UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1")
    .bind(displayCurrency, financeTimeZone).execute();
  assert.deepEqual(await readInstanceSettings(database.DB), { displayCurrency, financeTimeZone });
});

for (const displayCurrency of ["", " ", "eur", "EURO", "XYZ", "<EUR>", "EUR\n"]) {
  test(`rejects unsupported currency ${JSON.stringify(displayCurrency)}`, () => {
    const financeTimeZone = "Europe/Belgrade";
    assert.throws(() => validateInstanceSettings({ display_currency: displayCurrency, finance_time_zone: financeTimeZone }), /display_currency/);
  });
}

for (const financeTimeZone of ["", "Europe/Invalid", "+01:00", "CET", " Europe/Belgrade"]) {
  test(`rejects invalid IANA timezone ${JSON.stringify(financeTimeZone)}`, () => {
    const displayCurrency = "RSD";
    assert.throws(() => validateInstanceSettings({ display_currency: displayCurrency, finance_time_zone: financeTimeZone }), /finance_time_zone/);
  });
}

test("settings table rejects a second singleton row", async context => {
  const displayCurrency = "EUR";
  const financeTimeZone = "UTC";
  const database = await createMigratedLocalD1("settings-singleton");
  context.after(() => database.dispose());
  await assert.rejects(database.DB.prepare("INSERT INTO instance_settings VALUES (2, ?, ?)").bind(displayCurrency, financeTimeZone).execute());
});

test("reader rejects duplicate settings even if the table constraints are missing", async context => {
  const displayCurrency = "EUR";
  const financeTimeZone = "UTC";
  const database = await createMigratedLocalD1("settings-duplicate");
  context.after(() => database.dispose());
  await database.DB.prepare("DROP TABLE instance_settings").execute();
  await database.DB.prepare("CREATE TABLE instance_settings (display_currency TEXT, finance_time_zone TEXT)").execute();
  for (let row = 0; row < 2; row++)
    await database.DB.prepare("INSERT INTO instance_settings VALUES (?, ?)").bind(displayCurrency, financeTimeZone).execute();
  await assert.rejects(readInstanceSettings(database.DB), /instance_settings.*exactly one row/);
});

test("reader reports an absent settings table as a configuration error", async context => {
  const database = await createMigratedLocalD1("settings-no-table");
  context.after(() => database.dispose());
  await database.DB.prepare("DROP TABLE instance_settings").execute();
  await assert.rejects(readInstanceSettings(database.DB), /instance_settings.*could not read configuration/);
});

test("settings loader waits until first use to read the database", async context => {
  const displayCurrency = "EUR";
  const financeTimeZone = "UTC";
  const database = await createMigratedLocalD1("settings-lazy");
  context.after(() => database.dispose());
  const loadSettings = createInstanceSettingsLoader(database.DB);
  await database.DB.prepare("UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1").bind(displayCurrency, financeTimeZone).execute();
  assert.deepEqual(await loadSettings(), { displayCurrency, financeTimeZone });
});

test("one settings loader reads once and a new loader sees a committed change", async context => {
  const initialCurrency = "EUR";
  const nextCurrency = "USD";
  const financeTimeZone = "UTC";
  const database = await createMigratedLocalD1("settings-snapshot");
  context.after(() => database.dispose());
  await database.DB.prepare("UPDATE instance_settings SET display_currency = ?, finance_time_zone = ? WHERE id = 1").bind(initialCurrency, financeTimeZone).execute();
  const loadSettings = createInstanceSettingsLoader(database.DB);
  assert.deepEqual(await loadSettings(), { displayCurrency: initialCurrency, financeTimeZone });
  await database.DB.prepare("UPDATE instance_settings SET display_currency = ? WHERE id = 1").bind(nextCurrency).execute();
  assert.deepEqual(await loadSettings(), { displayCurrency: initialCurrency, financeTimeZone });
  assert.deepEqual(await createInstanceSettingsLoader(database.DB)(), { displayCurrency: nextCurrency, financeTimeZone });
});
