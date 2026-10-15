# Project guidance

## Command permissions

- Local `test`, `build`, and `check` commands may be run without asking for approval. Run the relevant checks before handing changes back to the user.
- Commands that connect to remote Workers, databases, or other internet resources require explicit user approval before execution, including read-only commands.
  Tell the user what command is needed, which resource it accesses, and whether it changes anything. The user decides whether to run it themselves or authorize the agent.
- Permission for a local build does not authorize deployment or remote database operations. Local tests using temporary databases and simulated services are allowed.
- Keep local checks offline where possible; disable optional telemetry and update checks rather than treating permission for local checks as permission to access internet resources.

## Tests

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
- Run affected tests during editing, then the complete suite and relevant checks after test changes. When fixture lifecycle or shared state changes,
  also verify tests individually and together and check for execution-order dependencies. Distinguish pre-existing failures from new regressions.
  Do not hide failures by skipping required scenarios, weakening meaningful assertions, or reducing default test discovery.
- Summarize meaningful coverage retained or intentionally dropped and checks performed. Explain removed coverage rather than requiring a mapping for every test.
  Treat line and branch coverage as aids for finding gaps, not proof of test value or completeness.

## Code style

- Do not use nested ternary expressions. When conditional expressions become nested, replace them with `if`, `switch`, or another clear control flow.

- In new code, place the body of every `if` on the next line, even when it contains only one statement. Braces are optional for a single statement.
  Do not reformat existing code solely to apply this rule.
- Introduce a variable only when its value is used at least twice, or when inlining would make the expression cognitively complex, too long, or hard to read. Otherwise, inline values that are used once. Apply this rule to production and test code.
- Keep lines at 170 characters or fewer, except when wrapping would make the expression harder to read or otherwise be unreasonable.
