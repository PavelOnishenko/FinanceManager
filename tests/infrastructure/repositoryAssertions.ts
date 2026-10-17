import assert from "node:assert/strict";
import type { RepositoryResult } from "../../src/storage/D1FinanceRepository";

export function expectRepositorySuccess<Value>(result: RepositoryResult<Value>): Value {
  assert(result.kind === "success", `Expected repository success, received ${result.kind}`);
  return result.value;
}
