# TypeScript

The templates in `templates/typescript/` assume pnpm, Node 24, a single package at the repo
root, and GitHub Actions. The variants below cover the rest. Change only what the repo needs.

## Install

Pin exact versions (`-E`) so every machine and CI run the same tool versions:

```sh
pnpm add -D -E @biomejs/biome typescript vitest @vitest/coverage-v8 \
  fta-cli jscpd knip husky lint-staged @types/node
pnpm exec biome migrate --write   # aligns biome.json's $schema with the installed version
```

In a repo that already has `typescript`, keep its major version unless the user asks to
upgrade. Add `vite` if Vitest warns it is missing. Set `.nvmrc` to `24` when the repo has none:
the cccc scripts run as `node scripts/*.ts`, which needs Node's built-in type stripping (Node
22.18+ or 24).

## Copy the templates

| Template | Destination | Adapt |
| --- | --- | --- |
| `biome.json` | `biome.json` | ignore list (generated dirs), Next/React domains, Tailwind rules, filename case |
| `vitest.config.ts` | `vitest.config.ts` (merge if one exists) | `coverage.include` and `thresholds` to the repo's logic layers; test environment |
| `fta.json` | `fta.json` | `exclude_directories` |
| `.jscpd.json` | `.jscpd.json` | `ignore` |
| `cccc.toml` | `cccc.toml` | `exclude` |
| `knip.json` | `knip.json` | `entry` for files only a runtime loads (workers, CLIs) |
| `scripts/cccc-install.ts`, `scripts/cccc-check.ts` | `scripts/` | nothing |
| `husky/pre-commit`, `husky/pre-push` | `.husky/` | package manager |
| `github/workflows/verify.yml` | `.github/workflows/verify.yml` | package manager, build step, default branch |
| `package-fragment.json` | merge into `package.json` | `typecheck` per framework; keep existing scripts that do other jobs |
| `quality-gates.md` | append to `AGENTS.md` / `CLAUDE.md` | commands per package manager |

Then:

- Add `.cccc.cache` and `/coverage` to `.gitignore`.
- Run `pnpm run prepare` once. It installs the git hooks (husky) and the cccc binary. A plain
  `pnpm install` on an already installed tree can skip `prepare`; a fresh clone runs it.
- Merge these into `tsconfig.json` `compilerOptions` (on an existing codebase, check each with
  `calibration.md`): `"strict": true, "noUncheckedIndexedAccess": true,
  "noFallthroughCasesInSwitch": true, "noImplicitOverride": true, "isolatedModules": true,
  "verbatimModuleSyntax": true, "skipLibCheck": true`.
- If `tsconfig.json` has no `include`, make sure it does not pick up `node_modules`, build
  output or agent folders (`.claude`, `.agents`).
- Run `pnpm lint:fix` once, then `pnpm verify`.

cccc is a release binary for macOS and Linux. On Windows the install and the check skip with a
warning, and CI still runs it.

## Package manager

| | pnpm | npm | yarn (berry) | bun |
| --- | --- | --- | --- | --- |
| Add dev deps | `pnpm add -D` | `npm i -D` | `yarn add -D` | `bun add -d` |
| Run a script inside a script | `pnpm x` | `npm run x` | `yarn x` | `bun run x` |
| Run a bin | `pnpm exec x` | `npx x` | `yarn x` | `bunx x` |
| CI install | `pnpm install --frozen-lockfile` | `npm ci` | `yarn install --immutable` | `bun install --frozen-lockfile` |
| `setup-node` cache | `pnpm` | `npm` | `yarn` | none (use `oven-sh/setup-bun`) |

Rewrite every `pnpm` in `package.json` scripts, `.husky/*` and `verify.yml`. For npm, yarn
and bun, drop the `pnpm/action-setup` step from `verify.yml`.

pnpm 10 and later skip dependency build scripts by default. Biome ships its binary as an
optional dependency, so it needs no build script, but if `pnpm install` warns about ignored
builds for a tool you need, add it to `onlyBuiltDependencies` in `pnpm-workspace.yaml`.

## Framework

**Next.js.** `"typecheck": "next typegen && tsc --noEmit"` (Next 15.5 or later generates
route types; older versions: `tsc --noEmit`). Add `"!.next"` to Biome's ignore list (the
template has it) and enable the domains:

```json
"linter": { "domains": { "next": "recommended", "react": "recommended" } }
```

`next build` may need env vars. In CI, provide them as secrets, or drop the CI build step
when Vercel builds every pull request anyway.

**Vite (React, Vue, Svelte).** With project references (`tsconfig.app.json` +
`tsconfig.node.json`), use `"typecheck": "tsc -b"`; the Vite templates already set `noEmit`.
Vue: `"typecheck": "vue-tsc -b"`. Svelte: `"typecheck": "svelte-check --tsconfig ./tsconfig.json"`.
Biome lints `.vue`, `.svelte` and `.astro` only partly (script blocks); keep the framework's own
checker as the typecheck.

**Vitest environment.** Component tests need a DOM: add `happy-dom` (or `jsdom`) and set
`environment: "happy-dom"` in a per-file `// @vitest-environment happy-dom` comment or a
second Vitest project, so logic tests stay on the fast `node` environment.

**Vite older than 8 / Vitest older than 4.** `resolve.tsconfigPaths` does not exist there:
install `vite-tsconfig-paths` and use `plugins: [tsconfigPaths()]`.

**Tailwind.** Turn on class sorting and the Tailwind CSS parser:

```json
"css": { "parser": { "tailwindDirectives": true } },
"linter": { "rules": { "nursery": {
  "useSortedClasses": { "level": "error", "fix": "safe", "options": { "functions": ["cn", "cva", "clsx"] } }
} } }
```

## Existing ESLint or Prettier

Ask before replacing them. To migrate:

```sh
pnpm exec biome migrate eslint --write   # ports rules it can map, reports the rest
pnpm exec biome migrate prettier --write # ports formatter options
```

Then delete the ESLint/Prettier configs, their dependencies, and their scripts, and run
`pnpm lint:fix` once in its own commit (a formatting-only commit is easy to review and to add
to `.git-blame-ignore-revs`).

To keep them instead: skip `biome.json`, point `lint`/`lint:fix` at the existing commands
(`eslint . && prettier --check .`), and point lint-staged at `eslint --fix` and
`prettier --write`. Use `eslint-plugin-sonarjs`'s `cognitive-complexity` and ESLint's
`max-lines-per-function` for the complexity rules Biome would have given.

## Existing Jest

Ask before replacing it. Vitest runs most Jest suites after swapping `jest.fn` for `vi.fn`
and the `jest` globals for imports from `vitest`. To keep Jest, point `test` at
`jest --coverage` and move the coverage floors to `coverageThreshold` in the Jest config.

## Monorepo

Put the gates at the root and run them over the whole tree; Biome, FTA, jscpd and cccc scan
from `.`, and knip understands workspaces natively. Keep one `vitest.config.ts` with
`test.projects` pointing at each package, or one per package with the root `test` script
delegating (`pnpm -r test`, `turbo run test`). Run `typecheck` per package (`pnpm -r
typecheck` or `turbo run typecheck`) because each package has its own `tsconfig.json`.

## Hooks too slow

The template runs typecheck, the whole test suite and the metrics on every commit, which suits
repos where that takes under a minute. When it does not, move `pnpm test` and
`pnpm metrics:check` to `.husky/pre-push` (next to `pnpm build`) and leave `lint-staged` and
`pnpm typecheck` in pre-commit. CI still runs everything.

## End-to-end tests (optional)

For a web app with critical flows, add Playwright: `pnpm create playwright` (choose
`e2e/` as the folder). Add `"test:e2e": "playwright test"`, exclude `e2e/**` from Vitest, and
add a separate CI job that runs `pnpm exec playwright install --with-deps chromium` and
`pnpm test:e2e`. Keep it out of the commit hook.

## Other CI providers

The job is: checkout with full history, install Node from `.nvmrc`, frozen install,
`verify`, `build`, and on pull requests `jscpd . --baseline-from-ref origin/main
--fail-on-new-clones`. GitLab CI and others express the same steps; set `GIT_DEPTH: 0`
(GitLab) so `origin/main` exists for the jscpd baseline.
