## Steps to reproduce
1. Open the repository at `/home/runner/work/hadoku-task/hadoku-task`.
2. Run a direct TypeScript reproduction with Node strip-types support:
   `node --experimental-strip-types` and import `parseTaskInput` from `src/domain/utils/tags.ts`.
3. Use this exact input: `"Crimson kitty's scrubbed task" #alpha`.
4. Assert that the parsed title should remain `Crimson kitty's scrubbed task`.
5. Capture the failing assertion output as a trace file.

## Observed
The parser truncates the title at the apostrophe and returns `Crimson kitty` instead of the full quoted title. The generated trace shows `Parsed: { title: 'Crimson kitty', tag: 'alpha' }` followed by an assertion failure. Evidence is stored in `/home/runner/work/hadoku-task/hadoku-task/crimson-kitty-trace.txt`.

## Expected
Quoted task titles should preserve apostrophes and all text inside the matching quote pair. For the same input, parsing should return the full title `Crimson kitty's scrubbed task` and keep `alpha` as the tag, without truncating the quoted text.
