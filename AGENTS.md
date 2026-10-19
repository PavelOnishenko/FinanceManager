# Project guidance

## Starting work

- Before starting work, pull the latest `master` from `origin` and create the task branch from that updated base.
  When resuming an existing task branch, fetch `origin/master` and check whether the branch needs updating before making changes.
  Preserve uncommitted work when updating; do not assume the initial checkout is current.

## Command permissions

- Local `test`, `build`, and `check` commands may be run without asking for approval. Run the relevant checks before handing changes back to the user.
- Commands that connect to remote Workers, databases, or other internet resources require explicit user approval before execution, including read-only commands.
  Tell the user what command is needed, which resource it accesses, and whether it changes anything. The user decides whether to run it themselves or authorize the agent.
- Permission for a local build does not authorize deployment or remote database operations. Local tests using temporary databases and simulated services are allowed.
- Keep local checks offline where possible; disable optional telemetry and update checks rather than treating permission for local checks as permission to access internet resources.

## Telegram button compatibility

- For new work or changes to button formats, do not implement compatibility with previously sent buttons or old `callback_data` formats by default.
  Add backward compatibility only when the user explicitly requests it in their task.

## Directory structure

- Aim for 5–7 directly contained files per directory, with a maximum of 10. Count files, not child directories.
  Smaller directories are fine when they represent a clear responsibility; do not add filler files to meet the target.
- Keep test cases in `tests/suites/` and reusable test infrastructure in `tests/infrastructure/`.
  Group suites by execution boundary (`unit`, `integration`, `worker`) and infrastructure by responsibility (`telegram`, `worker`).
  Keep shared helpers directly in `tests/infrastructure/`; keep the test TypeScript configuration in `tests/tsconfig.json`.
- Before adding an eleventh file, split the directory into meaningful subdirectories. Apply the same target and limit to `docs/`,
  grouping documents by topic (`design`, `testing`, `deployment`), and to new or changed production directories.
- When moving files, update imports, paths resolved from `import.meta.url`, package scripts, documentation links, and examples together.
  Keep default test discovery recursive so new nested suites are included. Preserve test coverage and production behavior during directory-only refactors.

## Tests

- Avoid adding production logic solely to accommodate tests, including test-mode branches, fallback values, and optional build-time inputs.
  Keep required production inputs explicit. Adapt test setup to the production contract rather than weakening that contract for tests.
- During implementation iterations and PR review, run only tests directly related to the changes made. Select individual tests or
  the smallest relevant test files; do not run unrelated tests.
- Run the full regression suite only for final task verification or after substantial changes spanning multiple layers.
  A small review fix, a test-file edit, a commit, a push, or a reply to the user is not a reason to repeat the full suite.
  While the PR remains under review, use targeted tests for follow-up fixes rather than treating each fix as final task verification.
- For documentation-only changes, do not run application tests; review the diff and run appropriate document checks instead.
- Keep the suite easy to read, small, and useful for this project's actual risks. Prioritize protection against lost or incorrect financial data,
  duplicate writes, and unauthorized access. Match testing effort to failure consequences and maintenance cost; avoid numerical test or coverage quotas.
- Add a test when it protects a meaningful requirement or catches a credible bug that existing tests do not already cover.
  A distinct behavior or an uncovered branch does not automatically need its own test. Use TDD when it helps clarify behavior or prevent meaningful mistakes;
  do not require a failing test for every mechanical change, trivial helper, or low-risk adjustment.
- Before adding defensive code or a test for an unusual state, identify how that state can occur through supported inputs, persisted data,
  external responses, or a credible dependency failure. A known bug or documented contract is also a valid reason.
  Do not invent impossible internal states through casts, unrealistic mocks, or violations of enforced invariants just to exercise a defensive branch.
  Untrusted input and genuine external failures remain valid scenarios even if they have not occurred yet.
- When a defensive branch appears to handle an unreachable or unsupported situation, question whether the branch is needed instead of automatically
  adding tests for it. Check the boundary that enforces the invariant. Treat removal of production code as a separate behavior decision, not incidental test cleanup.
- Test a rule at the simplest suitable level. At higher levels, test what those layers add, such as passing settings, handling errors,
  or formatting a response. Keep real integration checks where SQL constraints, migrations, Worker routing, or wiring are the risk;
  do not repeat detailed rule checks at every layer or assume mocks prove that an integration works.
- Test observable behavior. Do not assert internal calls, their count, or their order unless those details are themselves a requirement.
  If an intended implementation change breaks tests while required behavior remains correct, simplify the implementation-coupled assertions.
- Assert only properties relevant to the scenario. Include unchanged state after rejection or final state after retries when that is part of the requirement.
  Determine expected outcomes independently of the production logic being tested.
- Keep each test focused on one meaningful behavior. Multiple assertions may establish that behavior; do not make each assertion a separate test.
  Keep multi-step scenarios when the transitions matter, and do not combine unrelated behaviors merely to reduce test count or execution time.
- Choose representative inputs and relevant boundaries. Combine input dimensions when their interaction matters; avoid enumerating equivalent inputs
  or every combination of independent conditions. Use table-driven cases only when setup, action, and assertion structure are the same,
  with explicit inputs, expected outcomes, and clear identification of failing cases.
- Name tests for their condition and observable outcome. Keep setup, action, and assertions easy to follow, using only the actions needed for the scenario.
- Extract repeated mechanical setup only when it improves readability. Prefer small helpers with explicit arguments over deep fixture hierarchies,
  boolean mode flags, or helpers that hide scenario actions. Use the simplest sufficient infrastructure; start a Worker, temporary database,
  or Wrangler only when the behavior requires it.
- Keep every test-created value that is asserted or drives the behavior inside that test, either inline or in a local variable.
  Helpers may supply irrelevant boilerplate defaults. Canonical application data from production migrations or configuration belongs to the system under test
  and does not need to be recreated in the test.
- Keep values used only once inline unless naming them improves readability or clarifies a complex expression. Introduce a variable when the value is reused.
- In update tests, explicitly set initial values for fields being changed and make them different from the expected final values.
- Use `assert` for expectations whenever possible, including type narrowing. Prefer `assert(initial.kind === ApplicationResultKind.ExpenseSaved)`
  over an `if` that throws an expectation error. Keep explicit throws that simulate a failure under test.
- Keep tests deterministic and independent. Control relevant clocks, randomness, environment variables, and external responses.
  Restore mocks and release resources even after failure; avoid arbitrary sleeps and dependencies on execution order.
- During test refactoring, use existing tests first and establish a baseline for the affected area. Remove duplication and unnecessary setup;
  do not add tests merely to mirror a new helper. Keep production behavior unchanged and avoid unrelated tooling or infrastructure changes.
- Reassess existing tests rather than preserving them automatically. Delete or merge redundant tests when surviving cases protect the same meaningful behavior.
  A low-value test may be removed without replacement when its protection does not justify its maintenance cost; explain the specific tradeoff.
  Preserve useful known-bug scenarios, and explain unusual inputs in the test name or a short comment.
- When fixture lifecycle or shared state changes, verify the affected tests individually and together and check for execution-order dependencies.
  Keep the run scoped to the affected tests unless the full-suite conditions above apply. Distinguish pre-existing failures from new regressions.
  Do not hide failures by skipping required scenarios, weakening meaningful assertions, or reducing default test discovery.
- Summarize meaningful coverage retained or intentionally dropped and checks performed. Explain removed coverage rather than requiring a mapping for every test.
  Treat line and branch coverage as aids for finding gaps, not proof of test value or completeness.

### Scenario readability and test helpers

- Write high-level tests as readable sequences: prepare meaningful data, perform user actions, and assert observable outcomes.
  A reader should understand the scenario from the test without unpacking transport objects, SQL chains, or API-call searches.
  More infrastructure code is acceptable when it makes the tests easier to read; minimizing total line count is not the goal.
- Reuse and extend the existing helpers before adding parallel infrastructure:
  `tests/infrastructure/telegram/telegramDriver.ts`, `tests/infrastructure/telegram/telegramFixture.ts`,
  `tests/infrastructure/telegram/telegramOutput.ts`, `tests/infrastructure/telegram/telegramUpdates.ts`,
  `tests/infrastructure/worker/workerScenario.ts`, `tests/infrastructure/worker/workerData.ts`, and `tests/infrastructure/migrationFixture.ts`.
  Keep real Worker, D1, and Wrangler integration paths where those boundaries are what the test protects.
- Name action helpers in plain English, such as `sendMessage`, `pressButtonNamed`, and `replyToPrompt`, with few explicit arguments.
  Extract mechanical update construction, dispatch, SQL setup, response lookup, type narrowing, and repeated assertions.
  Keep meaningful user actions visible in order; do not hide a whole scenario behind a vaguely named helper.
- Let fixtures allocate routine update IDs and irrelevant boilerplate values. Specify IDs in the test when their identity matters,
  such as a source update used for deduplication, a replayed update, or an update ID included in an error message.
  Keep amounts, dates, members, initial and final values, and other behavior-driving inputs explicit in the test.
- Add short comments before meaningful stages to explain the user's intent and any non-obvious state transitions.
  Explain unusual inputs and simulated failures. Comments should clarify why a step matters rather than repeat the function name.
  For reply helpers, make clear who sends the new reply and who authored the message being replied to when that distinction matters.
- Keep callback strings literal in tests that supply or verify their format. Do not introduce callback builders or use the production formatter
  to manufacture inputs or expected strings for those checks. In formatter tests, compare its output against explicit literal expectations.
  Clicking a displayed button by its label may use the callback returned by the bot; helpers must not reconstruct its encoding.
- Place callback format reminders beside the relevant strings or a contiguous group with the same format. Explain the action prefix,
  field order, destinations, IDs, date encodings, sentinels such as `0`, and the exact defect in each malformed example.
  Explain the user-visible meaning too: for a calendar callback, distinguish the displayed month from an already selected range start;
  opening another month preserves the start and does not select the end date. Do not rely on readers memorizing the encoding.
- Use message, button, acknowledgement, alert, and persisted-data helpers for repeated expectations instead of nested API-call searches,
  casts, optional chains, and non-null assertions in scenarios. Keep scenario-specific expected values visible and failures informative.
  Preserve meaningful protocol checks: an acknowledgement answers a button press, an alert also requires `show_alert`, and ForceReply
  requests a reply to a particular bot message. These assertions inspect outgoing requests; they do not prove Telegram client rendering.
- Split long tests when they combine independent behaviors. Keep multi-step flows together when transitions are the requirement,
  such as paging after an edit or selecting a range across months. When splitting, preserve relevant setup, including archived categories,
  other members, out-of-range expenses, and state that must remain unchanged after rejection or deletion.
- Prefer a named exported input type over nested `Parameters`/`ReturnType` expressions when both express the same contract clearly.
  Keep helpers tied to the actual method's input contract so incompatible signature changes produce compile-time errors.
- During a readability rework, inspect TODOs throughout the tests and test infrastructure, resolve the underlying issues, and remove the markers
  once resolved. Do not merely delete TODO comments or replace explicit scenarios with opaque helpers to make the file shorter.

For an existing fixture, a calendar scenario should read like this:

```ts
await fixture.seedMember(127, "Анна");

// k:<destination>:<YYYYMM>:<start YYYYMMDD or 0> — open February history with no start selected.
await fixture.pressButton("k:history:202602:0");

// The user selects February 28, moves to March while retaining that start, then selects March 1 as the end.
await fixture.pressButtonNamed("28");
await fixture.pressButtonNamed("▶");
await fixture.pressButtonNamed("1");
assert.match(fixture.text(), /Расходы: 2026-02-28 — 2026-03-01/);
```

## Code style

- If a list of array elements, object or type fields, or similar items spans three or more lines, put each item on its own line.
  Do not group multiple items on the same line in such lists.
- Do not use nested ternary expressions. When conditional expressions become nested, replace them with `if`, `switch`, or another clear control flow.

- In new code, place the body of every `if` on the next line, even when it contains only one statement. Braces are optional for a single statement.
  Do not reformat existing code solely to apply this rule.
- Introduce a variable only when its value is used at least twice, or when inlining would make the expression cognitively complex, too long, or hard to read. Otherwise, inline values that are used once. Apply this rule to production and test code.
- Keep lines at 170 characters or fewer, except when wrapping would make the expression harder to read or otherwise be unreasonable.
