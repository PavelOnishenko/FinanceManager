import { readFileSync } from "node:fs";

// Canonical application defaults are read from the immutable seed migrations.
export const categories = ["0001_initial.sql", "0002_add_expense_categories.sql", "0003_add_communication_category.sql"].flatMap(name =>
  [...readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8").matchAll(/\('([^']+)', '([^']+)', \d+\)/g)]
    .map(match => ({ id: match[1]!, name: match[2]! }))
);
