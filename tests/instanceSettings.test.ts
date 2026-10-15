import assert from "node:assert/strict";
import test from "node:test";
import { createMigratedLocalD1 } from "../scripts/createLocalD1";
import { createInstanceSettingsLoader, readInstanceSettings, validateInstanceSettings } from "../src/config/instanceSettings";

test("migrations seed readable default currency and timezone settings", async context => {
  const database = await createMigratedLocalD1("settings-defaults");
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

test("rejects unsupported currency configuration", () => {
  for (const displayCurrency of ["", "eur", "EURO", "XYZ", "EUR\n"])
    assert.throws(() => validateInstanceSettings({ display_currency: displayCurrency, finance_time_zone: "UTC" }), /display_currency/, JSON.stringify(displayCurrency));
});

test("rejects invalid IANA timezone configuration", () => {
  for (const financeTimeZone of ["", "Europe/Invalid", "+01:00", "CET", " Europe/Belgrade"])
    assert.throws(() => validateInstanceSettings({ display_currency: "RSD", finance_time_zone: financeTimeZone }), /finance_time_zone/, JSON.stringify(financeTimeZone));
});

test("settings table rejects a second singleton row", async context => {
  const displayCurrency = "EUR";
  const financeTimeZone = "UTC";
  const database = await createMigratedLocalD1("settings-singleton");
  context.after(() => database.dispose());
  await assert.rejects(database.DB.prepare("INSERT INTO instance_settings VALUES (2, ?, ?)").bind(displayCurrency, financeTimeZone).execute());
});

test("reader reports an absent settings table as a configuration error", async context => {
  const database = await createMigratedLocalD1("settings-no-table");
  context.after(() => database.dispose());
  await database.DB.prepare("DROP TABLE instance_settings").execute();
  await assert.rejects(readInstanceSettings(database.DB), /instance_settings.*could not read configuration/);
});

test("settings remain stable within a request and refresh on the next request", async context => {
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
