import type { SqlDatabase } from "../storage/SqlDatabase";

export type InstanceSettings = { displayCurrency: string; financeTimeZone: string };
type SettingsRow = { display_currency: unknown; finance_time_zone: unknown };

export class InstanceConfigurationError extends Error {}

export function validateInstanceSettings(row: SettingsRow): InstanceSettings {
  if (typeof row.display_currency !== "string" || !Intl.supportedValuesOf("currency").includes(row.display_currency))
    throw new InstanceConfigurationError("display_currency: expected a supported uppercase ISO 4217 currency code");
  if (typeof row.finance_time_zone !== "string" || !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(row.finance_time_zone))
    throw new InstanceConfigurationError("finance_time_zone: expected an IANA timezone identifier");
  try {
    new Intl.DateTimeFormat("en", { timeZone: row.finance_time_zone }).format();
  } catch {
    throw new InstanceConfigurationError("finance_time_zone: unsupported IANA timezone identifier");
  }
  return { displayCurrency: row.display_currency, financeTimeZone: row.finance_time_zone };
}

export async function readInstanceSettings(database: SqlDatabase): Promise<InstanceSettings> {
  let rows: SettingsRow[];
  try {
    rows = await database.withPrimarySession().prepare("SELECT display_currency, finance_time_zone FROM instance_settings").many<SettingsRow>();
  } catch {
    throw new InstanceConfigurationError("instance_settings: could not read configuration");
  }
  if (rows.length !== 1)
    throw new InstanceConfigurationError("instance_settings: expected exactly one row");
  return validateInstanceSettings(rows[0]!);
}
