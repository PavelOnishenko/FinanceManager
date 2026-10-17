# Test execution optimization research

Date: 2026-10-01

## Conclusion

The tests do not need to move to the cloud to become substantially faster. The main bottleneck is exactly the repeated setup: the current 71-test run starts Miniflare/D1 45 times, and 27 of those starts are inside `telegram.test.ts`. Each start also reapplies all migrations as eight separate D1 calls. The full suite took **40.2 seconds** in this checkout, while the Telegram file alone took **39.0 seconds**, so it is the critical path despite Node running different test files in parallel.

The best first implementation is:

1. Apply all migration statements with one `D1Database.batch()` call.
2. Create one migrated Miniflare/D1 instance per database-heavy test file, reset mutable tables before each test with one transactional batch, and dispose it after the file.
3. If the result is still above roughly 15 seconds, split the large Telegram file into a few cohesive files so Node can execute those files in parallel. Each file should still share only its own database.

I estimate steps 1-2 will reduce a full local run to roughly **18-22 seconds**. A sensible Telegram split should make **10-15 seconds** realistic. These are projections from the benchmarks below, not timings of an implemented refactor.

## Measured baseline

All measurements used the current checkout, Node 24.13.0, `tsx --test`, and in-memory Miniflare D1. They are single-run measurements, so they should be compared by order of magnitude rather than treated as a permanent performance budget.

| Scope | Tests | Duration |
| --- | ---: | ---: |
| Full `npm.cmd test` | 71 | 40.2 s |
| `telegram.test.ts` | 34 | 39.0 s |
| `application.test.ts` | 10 | 14.5 s |
| `storage.test.ts` | 7 | 14.3 s |
| `newCategories.test.ts` + `webhookSmoke.test.ts` | 2 | 4.5 s |

The durations are not additive. Node executes matching test files in separate child processes and limits concurrency at the file level, while tests declared inside one file execute on that file's single application thread. This explains why the full run is close to the Telegram duration rather than the sum of all files. See the [Node test-runner execution model](https://nodejs.org/api/test.html#test-runner-execution-model).

Pure parsing and domain tests generally finish in less than 10 ms. Tests that call `createMigratedLocalD1()` generally take 0.7-3.0 seconds, depending on the database work performed after setup.

## Where the time goes

The current suite creates databases as follows:

| Test area | Miniflare/D1 starts |
| --- | ---: |
| Telegram fixtures | 27 |
| Application contexts | 8 |
| Storage contexts | 7 |
| Telegram failure edge, category migration check, webhook smoke | 3 |
| **Total** | **45** |

`createMigratedLocalD1()` currently performs this work for every start:

- starts a new `workerd`/Miniflare instance;
- obtains a new D1 binding;
- reads both migration files;
- executes eight migration statements as eight awaited D1 calls;
- later disposes the entire Miniflare instance.

A small local benchmark produced these median results:

| Operation | Median |
| --- | ---: |
| Start Miniflare, apply migrations sequentially, become ready | 715 ms |
| Same operation including disposal | 751 ms |
| Start Miniflare and apply the same migrations with `batch()` | 488 ms |
| Same batched operation including disposal | 520 ms |

Migration batching therefore removed about 230-240 ms per fresh database in this benchmark. Cloudflare explicitly documents that `batch()` reduces round trips and executes the statements as a transaction: [D1 `batch()` documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

I also benchmarked resetting a shared migrated database 30 times. Three separate reset calls (`DELETE expenses`, `DELETE members`, restore category activity) took 4.15 seconds total, while one D1 batch per reset took 1.41 seconds total, approximately **47 ms per isolated test reset**.

## Recommended design

### 1. Batch migrations

Keep the current migration-file reading and statement splitting, because the existing Miniflare harness cannot apply the multi-statement SQL through `exec()`. Replace the loop of individual `run()` calls with one `database.batch(statements.map(statement => database.prepare(statement)))` call.

This is a narrow change at the concrete Cloudflare/Miniflare boundary. It does not require adding batching to the production `SqlDatabase` interface.

Expected effect with the current per-test database design: approximately 6-7 seconds off the Telegram critical path and around 10 seconds less cumulative setup work across the full suite.

### 2. Share one database per heavy test file

Use Node's suite/file hooks to create and migrate once, reset before each test, and dispose once:

```ts
let database: LocalTestDatabase;

before(async () => database = await createMigratedLocalD1("telegram-tests"));
beforeEach(async () => await database.reset());
after(async () => await database.dispose());
```

The exact code should preserve the project's fixture rule: user IDs, amounts, dates, comments, and other asserted or behavior-driving values stay declared in each test. Only infrastructure lifecycle and irrelevant cleanup move into hooks.

The reset should be a single D1 batch and should at least:

1. delete `expenses` before `members` because of the foreign key;
2. delete all `members`;
3. restore mutable canonical category fields, currently `active = 1`;
4. optionally clear `sqlite_sequence` if future tests require deterministic IDs.

Reset **before** each test, not only after it, so a failed test cannot contaminate the next one. Keep tests within each shared file non-concurrent. Node provides `before`, `beforeEach`, and `after` specifically for this lifecycle: [Node test hooks](https://nodejs.org/api/test.html#hooks).

Do not create one global database shared across every test file. Per-file ownership retains Node's process isolation and file-level parallelism, while a global singleton would couple otherwise independent files and require disabling normal isolation.

The category-migration alignment test should keep its own fresh database because its purpose is to verify the real migration output. The webhook smoke test should also keep its full independent Worker setup because it verifies a different boundary.

### 3. Split the Telegram critical path only if needed

After shared setup, measure again. If Telegram remains the longest file, split by behavior rather than by arbitrary test count, for example:

- callback parsing, webhook-secret checks, and other database-free tests;
- statistics and calendar integration tests;
- expense creation, history, details, edits, and deletion;
- access denial and error-reporting behavior.

Each integration file gets one private shared Miniflare instance. This allows Node's existing file-level child-process concurrency to work for the currently sequential 39-second Telegram path. Avoid creating many tiny files: every database-backed file adds one Miniflare startup and increases fixture duplication.

### 4. Keep test lanes, but do not hide failures locally

Useful scripts after the refactor would be:

- `test`: all tests; target 10-20 seconds locally;
- `test:unit`: database-free parser/domain/callback tests for near-instant feedback;
- `test:integration`: storage, application, and Telegram integration files;
- `test:smoke`: the full webhook smoke test.

The default `test` command should still run everything once it is fast enough. A quick lane is useful during editing, but it should not become a reason that the complete local suite is rarely run.

## Options I would not choose first

### Running each test concurrently with its own Miniflare

It preserves perfect isolation but can start roughly 27 `workerd` instances at once for the Telegram file. That trades predictable setup cost for CPU and memory contention and is more likely to become flaky across developer machines. Limited concurrency could be benchmarked later, but shared per-file infrastructure is simpler and cheaper.

### Replacing D1 with mocks in most Telegram tests

This could be faster, especially for denial and formatting cases, but application and bot functions currently depend on the concrete `D1FinanceRepository` type. Introducing a repository interface or extensive casts solely for test speed would broaden the architecture and reduce the integration coverage that currently catches real SQL/migration behavior. It is a later, selective option rather than the first optimization.

### Moving immediately to Cloudflare's Vitest integration

Cloudflare currently recommends its Workers Vitest integration for most Worker tests. It provides per-file storage isolation and fast reruns through module reuse/hot reloading: [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/) and [isolation model](https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/). It may be a good future migration for runtime fidelity and watch-mode speed, but it changes the runner, configuration, test APIs, and dependencies. The present bottleneck can be removed without that migration.

## GitHub Actions

GitHub Actions is useful as an independent merge gate, not as a replacement for local feedback. A normal Node workflow can run `npm ci`, `npm test`, `npm run check`, and `npm run build` on pushes and pull requests; GitHub recommends `setup-node` for consistent Node versions: [Building and testing Node.js](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).

The current test suite is local and Miniflare-backed, so the test job should not need a live D1 database or Telegram token. CI should be added after or alongside the local optimization, but waiting for a remote runner will always be slower than a 10-20 second local check.

## Suggested implementation order and acceptance criteria

1. Record three baseline runs of the full suite and the Telegram file.
2. Batch migration application; verify all tests and compare three runs.
3. Add a test-only reset owned by the local D1 fixture and share one instance in `storage.test.ts`, `application.test.ts`, and `telegram.test.ts`.
4. Run the full suite repeatedly and randomize or temporarily reverse test order to expose leaked state.
5. Split Telegram tests only if the measured full run is still inconvenient.
6. Optionally add the unit/integration/smoke scripts and GitHub Actions.

Acceptance criteria:

- all existing assertions and real migration coverage remain;
- each test passes alone and as part of the full suite;
- repeated runs do not depend on test order;
- no production repository abstraction is added only for the test harness;
- median full-suite time is below 20 seconds, or the remaining measured hotspot is documented before further work.
