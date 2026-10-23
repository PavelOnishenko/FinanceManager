# Project guidance

## Starting work

- Before editing files, read the `AGENTS.md` instructions applicable to their directories.
  Before adding, changing, or running tests, also read [tests/AGENTS.md](tests/AGENTS.md).
- Before starting work, pull the latest `master` from `origin` and create the task branch from that updated base.
  When resuming an existing task branch, fetch `origin/master` and check whether the branch needs updating before making changes.
  Preserve uncommitted work when updating; do not assume the initial checkout is current.

## Command permissions

- Local `test`, `build`, and `check` commands may be run without asking for approval. Run the relevant checks before handing changes back to the user.
- Commands that connect to remote Workers, databases, or other internet resources require explicit user approval before execution, including read-only commands.
  Tell the user what command is needed, which resource it accesses, and whether it changes anything. The user decides whether to run it themselves or authorize the agent.
- Permission for a local build does not authorize deployment or remote database operations. Local tests using temporary databases and simulated services are allowed.
- Keep local checks offline where possible; disable optional telemetry and update checks rather than treating permission for local checks as permission to access internet resources.

## Keep the MVP small

- Implement the agreed user journey with the fewest features and moving parts.
  Apply this to requirements, documentation, code, tests, and acceptance steps.
- Base decisions on the actual intended user and supported environment.
  Do not design for additional accounts, installations, platforms, or administrative workflows unless they are required.
- Distinguish what the recipient needs from what the developer needs.
  For example, a recipient who needs no developer tools does not require a build process that uses no developer tools.
- Before adding behavior beyond the agreed journey, identify the concrete problem it solves and how that problem can occur in this MVP.
  General usefulness, completeness, or possible future needs are not sufficient reasons.
- Prefer a clear limitation or manual support procedure for rare unsupported cases when that keeps the MVP substantially simpler.
  Explain the limitation and stop rather than guessing or silently creating replacement resources.
- Use existing tools and established libraries when they avoid maintaining unrelated infrastructure.
  Do not build a custom implementation merely to avoid a developer-side dependency.
- Keep ordinary error handling. Add special recovery mechanisms and defensive checks in proportion to the likelihood and consequences of failure.
  Preserve safeguards against lost or incorrect financial data, duplicate writes, and unauthorized access.
- Treat implementation details as choices, not new product requirements. Do not add tests, documentation, or acceptance steps
  for an optional property without first establishing that the property is needed.
- When reviewing a plan, look for requirements that can be removed or simplified, not only for missing requirements.
- If a written requirement appears unnecessary for the MVP, explain the simpler alternative before implementing it.
  Do not silently disregard agreed requirements.

## Telegram button compatibility

- For new work or changes to button formats, do not implement compatibility with previously sent buttons or old `callback_data` formats by default.
  Add backward compatibility only when the user explicitly requests it in their task.

## Directory structure

- Aim for 5–7 directly contained files per directory, with a maximum of 10. Count files, not child directories.
  Smaller directories are fine when they represent a clear responsibility; do not add filler files to meet the target.
- Before adding an eleventh file, split the directory into meaningful subdirectories. Apply the same target and limit to `docs/`,
  grouping documents by topic (`design`, `testing`, `deployment`), and to new or changed production directories.
- When moving files, update imports, paths resolved from `import.meta.url`, package scripts, documentation links, and examples together.
  Keep default test discovery recursive so new nested suites are included. Preserve test coverage and production behavior during directory-only refactors.

## Verification

- Avoid adding production logic solely to accommodate tests, including test-mode branches, fallback values, and optional build-time inputs.
  Keep required production inputs explicit. Adapt test setup to the production contract rather than weakening that contract for tests.
- During implementation iterations and PR review, run only tests directly related to the changes made. Select individual tests or
  the smallest relevant test files; do not run unrelated tests.
- Run the full regression suite only for final task verification or after substantial changes spanning multiple layers.
  A small review fix, a test-file edit, a commit, a push, or a reply to the user is not a reason to repeat the full suite.
  While the PR remains under review, use targeted tests for follow-up fixes rather than treating each fix as final task verification.
- For documentation-only changes, do not run application tests; review the diff and run appropriate document checks instead.
- Preserve reports of completed tasks and completed acceptance checklists as historical records, including their results,
  checked items and the procedure that was accepted.
  Put checks for a changed package in the current task or build instructions; do not rewrite a completed task report or acceptance record
  or require it to be repeated unless the user explicitly asks to revise that record.
- Keep the suite easy to read, small, and useful for this project's actual risks. Prioritize protection against lost or incorrect financial data,
  duplicate writes, and unauthorized access. Match testing effort to failure consequences and maintenance cost; avoid numerical test or coverage quotas.

## Language and naming

These rules apply to both English and Russian.

- Use plain, natural language in documentation, comments, and code names.
  Prefer familiar words and explicit actions over abstract labels or compressed shorthand.
- Do not compress a whole action or explanation into a single noun.
  For example, write “check which steps already succeeded before trying again”
  instead of “reconcile state before retry.”
- State who does what. Explain what happens and under which conditions rather than
  making the reader reconstruct the meaning from a label.
- Use full sentences in documentation and comments when they make the meaning clearer.
  Extra words are worthwhile when they reduce the effort needed to understand the text.
- Give variables and functions names that describe the value or action in context.
  For example, prefer `appliedMigrationNames` over `migrationState`, and
  `findDatabaseById` over `resolveResource`. Longer names are fine when they clarify intent.
- Use established technical terms when they are precise and familiar to the intended reader.
  Explain unfamiliar terms when needed; do not replace precise terms with vague everyday words.
- Avoid strings of nouns, invented terminology, and slash-separated shortcuts such as
  “binding/release readback.” Write out the separate actions.
- Use tables for information that benefits from comparison. Use paragraphs or lists
  when explaining behavior would otherwise require packing several actions into one cell.
- Keep explanations focused. Remove repetition and unnecessary detail, but do not shorten
  wording at the expense of clarity.

## Code style

- If a list of array elements, object or type fields, or similar items spans three or more lines, put each item on its own line.
  Do not group multiple items on the same line in such lists.
- Do not use nested ternary expressions. When conditional expressions become nested, replace them with `if`, `switch`, or another clear control flow.

- In new code, place the body of every `if` on the next line, even when it contains only one statement. Braces are optional for a single statement.
  Do not reformat existing code solely to apply this rule.
- Introduce a variable only when its value is used at least twice, or when inlining would make the expression cognitively complex, too long, or hard to read.
  Otherwise, inline values that are used once. Apply this rule to production and test code.
- Keep lines at 170 characters or fewer, except when wrapping would make the expression harder to read or otherwise be unreasonable.
