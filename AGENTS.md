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

- Follow the rule "one aspect of functionality — one test". Split tests that cover independent behaviors instead of building long scenarios.
  Do not combine unrelated checks to reduce execution time; optimize test infrastructure later if needed. Longer local test runs are acceptable.
- Keep every test-created value that is asserted or drives the behavior under test inside that test, either inline or in a local variable.
  Helpers may provide only irrelevant boilerplate defaults; do not hide expected fixture values in factories or default arguments.
  Canonical application data supplied by production migrations or configuration is part of the system under test and does not need to be recreated inside the test.
- A value used only once in a test normally stays inline; it does not need a named variable just because it is test data.
  Introduce a variable when the value is used twice or more. Exceptions are allowed when naming the value improves readability,
  clarifies its meaning, or makes a complex expression easier to understand.
- In update tests, explicitly specify every initial value for the fields being changed, and make each initial value different from its expected final value
  so the test proves that the update occurred.

## Code style

- Do not use nested ternary expressions. When conditional expressions become nested, replace them with `if`, `switch`, or another clear control flow.

- In new code, place the body of every `if` on the next line, even when it contains only one statement. Braces are optional for a single statement.
  Do not reformat existing code solely to apply this rule.
- Introduce a variable only when its value is used at least twice, or when inlining would make the expression cognitively complex, too long, or hard to read. Otherwise, inline values that are used once. Apply this rule to production and test code.
- Keep lines at 170 characters or fewer, except when wrapping would make the expression harder to read or otherwise be unreasonable.
