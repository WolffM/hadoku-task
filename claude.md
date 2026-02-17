# Agent Instructions

## Verification Rules

1. **Never ask the user to verify until you have verified yourself.** Use automated tests, terminal commands, or programmatic checks to confirm changes work before presenting them. If visual verification is needed, use tools like curl, DOM inspection scripts, or test pages — do not rely on the user to spot-check.

2. **Never suggest "caching issue" as a diagnosis.** If something appears stale, cache-bust yourself (e.g., append query params, restart the server, clear output) and re-verify programmatically. Do not ask the user to hard-refresh.

3. **Do not declare work complete without evidence.** Before marking a task done, run a concrete check (grep for old values, curl the served output, run a test) and include the result in your response.

## Development Server Testing

- When serving static files for testing, always serve from the correct root directory so relative paths resolve.
- Use cache-busting query parameters on every request when debugging served content.
- If a page relies on JS-rendered content, write a script or use curl + grep to verify the final DOM output — do not assume the template source is sufficient proof.
