# Project guidance

## Command permissions

- Local `test`, `build`, and `check` commands may be run without asking for approval. Run the relevant checks before handing changes back to the user.
- Commands that connect to remote Workers, databases, or other internet resources require explicit user approval before execution, including read-only commands.
  Tell the user what command is needed, which resource it accesses, and whether it changes anything. The user decides whether to run it themselves or authorize the agent.
- Permission for a local build does not authorize deployment or remote database operations. Local tests using temporary databases and simulated services are allowed.
- Keep local checks offline where possible; disable optional telemetry and update checks rather than treating permission for local checks as permission to access internet resources.

## Tests

- Use `assert` for test expectations whenever possible, including checks that narrow a result's type.
  Prefer `assert(initial.kind === ApplicationResultKind.ExpenseSaved)` over an `if` that throws `new Error("Expected saved expense")`.
  Keep explicit throws when they simulate a failure under test rather than express an expectation.

- Match test scope to the complexity of the change and realistic risks. Do not aim to maximize the number of tests or assertions.
- Each new test should verify a distinct behavior or catch a specific bug. Do not duplicate behavior already reliably covered by another test
  without a separate reason.
- Test a rule at the simplest suitable level. At higher levels, test only what those layers add, such as passing settings, handling errors,
  or formatting a response; do not repeat the same checks at every layer.
- Test observable behavior. Do not assert internal calls, their count, or their order unless those details are themselves a requirement.
- Assert properties relevant to the scenario's purpose. Do not check every unchanged field just in case.
- Use the simplest sufficient test infrastructure. Start a Worker, temporary database, or Wrangler only when the behavior requires that level.
- For behavior-preserving refactors, use existing tests first. Do not add tests that merely mirror the implementation of a new helper.
- Follow the rule "one aspect of functionality — one test". Multiple assertions about the results of one action are appropriate when they
  establish the same behavior, such as a changed amount and its confirmation. Do not turn every assertion into a separate test.
  Split independent behaviors instead of building long scenarios, and do not combine unrelated checks just to reduce execution time.
- Keep every test-created value that is asserted or drives the behavior under test inside that test, either inline or in a local variable.
  Helpers may provide only irrelevant boilerplate defaults; do not hide expected fixture values in factories or default arguments.
  Canonical application data supplied by production migrations or configuration is part of the system under test and does not need to be recreated inside the test.
- A value used only once in a test normally stays inline; it does not need a named variable just because it is test data.
  Introduce a variable when the value is used twice or more. Exceptions are allowed when naming the value improves readability,
  clarifies its meaning, or makes a complex expression easier to understand.
- In update tests, explicitly specify every initial value for the fields being changed, and make each initial value different from its expected final value
  so the test proves that the update occurred.

### Test refactoring

- Prioritize readable scenarios, less duplication, and preserved meaningful coverage. Fewer lines and tests are useful outcomes,
  not quotas. Do not combine unrelated behaviors or hide scenario details merely to make the suite smaller.
- Before changing affected tests, identify their distinct behaviors and run them to establish a baseline.
  Distinguish pre-existing failures from regressions introduced by the refactor.
- When deleting, merging, or moving tests, identify the surviving test or case that covers each distinct behavior.
  Include this mapping in the change description; explain any behavior intentionally no longer covered.
  Similar setup, execution paths, or assertions alone do not prove that two tests are redundant.
- Choose representative inputs by behavioral equivalence classes and boundaries. Preserve relevant success, rejection, failure,
  and state-transition scenarios. Cover combinations when their interaction changes behavior; avoid enumerating independent combinations.
- Preserve regression scenarios for known bugs unless a surviving test catches the same defect.
  Make the reason for unusual inputs clear in the test name or a short comment.
- Use table-driven cases when setup, action, and assertion structure are the same. Keep inputs and expected outcomes explicit,
  and identify each failing case clearly. Split cases that require conditional setup or different assertion logic.
  Reducing test declarations through parameterization does not remove the scenarios being executed.
- Name each test for its condition and observable outcome. Keep setup, action, and assertions easy to distinguish.
  Use only the actions needed to establish that scenario; keep multi-step workflows when the transitions themselves are under test.
- Extract repeated mechanical setup only when it improves readability. Prefer small helpers with explicit arguments;
  avoid deep fixture hierarchies, boolean mode flags, and helpers that perform hidden scenario actions.
  Keep behavior-driving values and expected results visible in the test, as required above.
- Determine expected outcomes independently of the production logic under test. Do not compute expectations with the same parser,
  formatter, calculation, or normalization function whose correctness the test is intended to establish.
- Preserve real boundary coverage when moving detailed rule checks to simpler tests. Mock-based tests do not replace checks of SQL
  constraints, migrations, Worker routing, or integration wiring. Keep each boundary test focused on what that boundary adds.
- For rejected operations, verify the relevant absence of side effects when that is part of the requirement.
  For idempotency and retry scenarios, verify the final observable state as well as the relevant response.
- Keep tests deterministic and independent. Control clocks, randomness, environment variables, and external responses when relevant.
  Restore mocks and release resources even after failures. Do not introduce arbitrary sleeps or dependencies on test execution order.
- Keep production behavior unchanged during test refactoring. Avoid unrelated production changes, new dependencies,
  runner migrations, or infrastructure optimization in the same change.
- Run affected tests during editing, then the complete suite and relevant project checks before completion.
  If fixture lifecycle or shared state changes, also verify tests individually and together and check for execution-order dependencies.
  Do not obtain passing results by skipping scenarios, weakening required assertions, or reducing default test discovery.
- Summarize removed duplication, preserved scenario coverage, and checks performed. Treat line and branch coverage as supporting evidence,
  not proof that behavior coverage is unchanged. Document any remaining coverage uncertainty.

## Code style

- Do not use nested ternary expressions. When conditional expressions become nested, replace them with `if`, `switch`, or another clear control flow.

- In new code, place the body of every `if` on the next line, even when it contains only one statement. Braces are optional for a single statement.
  Do not reformat existing code solely to apply this rule.
- Introduce a variable only when its value is used at least twice, or when inlining would make the expression cognitively complex, too long, or hard to read. Otherwise, inline values that are used once. Apply this rule to production and test code.
- Keep lines at 170 characters or fewer, except when wrapping would make the expression harder to read or otherwise be unreasonable.
