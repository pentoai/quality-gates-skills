## Quality gates

Every commit runs the gates below through husky; CI (`.github/workflows/verify.yml`) runs
`pnpm verify` on every pull request and every push to `main`. Run `pnpm verify` before you
say a change is done.

| Gate | Command | Fails when |
| --- | --- | --- |
| Format, lint, import order | `pnpm lint` (Biome; `pnpm lint:fix` writes fixes) | any Biome error |
| Types | `pnpm typecheck` | any `tsc` error |
| Tests and coverage | `pnpm test` (Vitest, v8 coverage) | a test fails, or coverage drops below the floors in `vitest.config.ts` |
| File maintainability | `pnpm metrics:fta` (`fta.json`) | a file's FTA score is above `score_cap` |
| Duplication | `pnpm metrics:jscpd` (`.jscpd.json`) | duplication is above `threshold` % |
| Function complexity | `pnpm metrics:cccc` (`cccc.toml`); Biome cognitive complexity and function length | a function is above a limit |
| Dead code and dependencies | `pnpm lint:unused` (knip) | an unused file, export or dependency |
| Build | `pnpm build` (pre-push) | the build fails |

When a gate fails, fix the code, not the gate:

- Complexity, FTA or function length: split the function or file along its responsibilities;
  extract named helpers and replace branch ladders with lookup tables or early returns.
- Duplication: extract the shared logic once, or accept the copy only when the two copies are
  expected to diverge.
- knip: delete the unused export, file or dependency; add an entry or `ignore` to `knip.json`
  only for a real entry point knip cannot see.
- Coverage: add tests for the code you changed, or list a file in `EXTERNAL_SERVICE_DRIVERS`
  in `vitest.config.ts` only when it does nothing but drive an external service.

A threshold changes only on purpose, in its own commit that says why. Never bypass a hook with
`--no-verify` to land a change; it is for emergencies, and CI still runs.
