# Husky Git Hooks

Pre-commit gates: typecheck, lint-staged (ESLint + Prettier on staged files),
and the CSS/theme-token gate.

## Versions

No commit carries a version number, and nobody edits one by hand. publish.yml
sets each package's version at publish time with
`WolffM/hadoku-actions/next-version` — one patch above the newest on the
registry, written into the runner's workspace only. A committed version ABOVE
the registry's newest is published as it stands, which is how a deliberate
minor or major bump still works.

## Troubleshooting

```bash
# Hook not running?
pnpm run prepare

# Skip hook (not recommended)
git commit --no-verify -m "message"
```
