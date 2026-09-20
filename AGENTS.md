# Project guidance

## Tests

- Declare every test-created value that is asserted or drives the behavior under test inside that test. Helpers may provide only irrelevant boilerplate defaults; do not hide expected fixture values in factories or default arguments. Canonical application data supplied by production migrations or configuration is part of the system under test and does not need to be recreated inside the test.
- In update tests, explicitly declare every initial value for the fields being changed, and make each initial value different from its expected final value so the test proves that the update occurred.

## Code style

- In new code, place the body of every `if` on the next line, even when it contains only one statement. Braces are optional for a single statement.
  Do not reformat existing code solely to apply this rule.
- Introduce a variable only when its value is used at least twice, or when inlining would make the expression cognitively complex, too long, or hard to read. Otherwise, inline values that are used once. Apply this rule to production and test code.
- Keep lines at 170 characters or fewer, except when wrapping would make the expression harder to read or otherwise be unreasonable.
