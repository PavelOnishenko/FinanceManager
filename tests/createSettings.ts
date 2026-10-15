import type { InstanceSettings } from "../src/config/instanceSettings";

// Override fields whose values are asserted or determine the behavior under test.
export function createSettings(overrides: Partial<InstanceSettings> = {}): InstanceSettings {
  return { displayCurrency: "RSD", financeTimeZone: "Europe/Belgrade", ...overrides };
}
