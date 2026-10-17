import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { migrationSequence, validateAppliedMigrations } from "./package";
import { RELEASE_VERSION } from "./release";

// Packaging demo only. Provider simulation is introduced alongside adapters in Tasks 3–5.
const packaged = migrationSequence(await readdir(new URL("../../migrations/", import.meta.url)));
validateAppliedMigrations(packaged, []);
console.log(`Релиз ${RELEASE_VERSION}: новая установка — ${packaged.length} миграций в комплекте.`);
const interrupted = packaged.slice(0, 2);
validateAppliedMigrations(packaged, interrupted);
console.log(`Прерванная установка: после сверки истории осталось ${packaged.length - interrupted.length} миграций.`);
validateAppliedMigrations(packaged, packaged);
console.log("Повторная проверка: миграции уже применены.");
assert.throws(() => validateAppliedMigrations(packaged, ["9999_unknown.sql"]));
console.log("Неизвестная история отклонена. Демо упаковки завершено без сетевых обращений.");
console.log("Симуляция провайдеров, установки и обновления появится в задачах 3–5.");
