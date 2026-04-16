## Steps to reproduce
1. Open the repository at `/home/runner/work/hadoku-task/hadoku-task`.
2. Run this exact reproduction command:
   `node --experimental-strip-types <<'EOF'`
   `import assert from 'node:assert/strict'`
   `import { parseTaskInput } from './src/domain/utils/tags.ts'`
   `const input = '"Crimson kitty\'s scrubbed task" #alpha'`
   `const parsed = parseTaskInput(input)`
   `console.log(parsed)`
   `assert.equal(parsed.title, "Crimson kitty's scrubbed task")`
   `EOF`
3. Observe the assertion failure and compare actual vs expected parsed title.
4. Save terminal output as trace evidence.

## Observed
The parser truncates the title at the apostrophe and returns `Crimson kitty` instead of the full quoted title. The generated trace shows `Parsed: { title: 'Crimson kitty', tag: 'alpha' }` followed by an assertion failure. Evidence is stored in `/home/runner/work/hadoku-task/hadoku-task/crimson-kitty-trace.txt`.

## Expected
Quoted task titles should preserve apostrophes and all text inside the matching quote pair. For the same input, parsing should return the full title `Crimson kitty's scrubbed task` and keep `alpha` as the tag, without truncating the quoted text.
