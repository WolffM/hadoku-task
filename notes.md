## Steps to reproduce
1. Open a shell in `/home/runner/work/hadoku-task/hadoku-task`.
2. Run:
   `pnpm dlx tsx -e "import assert from 'node:assert/strict'; import { parseTaskInput } from './src/domain/utils/tags.ts'; const parsed = parseTaskInput(\"'Don't panic' #home\"); assert.equal(parsed.title, \"Don't panic\");"`
3. The command intentionally asserts expected behavior for quoted task titles containing an apostrophe.
4. Capture stderr/stdout output for evidence (saved as `crimson-kitty-trace.txt`).

## Observed
The assertion fails. `parseTaskInput()` returns title `Don` instead of `Don't panic` for input `'Don't panic' #home`. This indicates the quoted-title parsing regex terminates at the first apostrophe inside the title and effectively scrubs the rest of the text. The produced Node assertion stack trace confirms actual versus expected values and demonstrates reproducibility.

## Expected
Quoted task titles should preserve internal apostrophes and only treat the final matching quote as the delimiter. For input `'Don't panic' #home`, parsed output should keep the full title `Don't panic` and extract tag `home`. The parser should not truncate user content when contractions or apostrophes appear in quoted task text.
