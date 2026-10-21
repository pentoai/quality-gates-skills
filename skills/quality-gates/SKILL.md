---
name: quality-gates
description: Set up or audit pre-commit hooks and CI quality gates for a TypeScript or Python repo. Covers format, lint and import order (Biome / Ruff), strict type checking (tsc / mypy), tests with coverage floors (Vitest / pytest-cov), per-function complexity (Biome and cccc / Ruff and complexipy), file maintainability (FTA), duplication (jscpd), dead code and unused dependencies (knip / vulture and deptry), git hooks (husky + lint-staged / pre-commit) and a GitHub Actions verify workflow. Use when asked to add linting, formatting, type checking, tests, coverage, static checks, quality gates, pre-commit hooks or CI to a TS/JS or Python project, to bring a repo up to the same standard as another, or when one of these gates fails and needs fixing.
---

# Quality gates

One recipe per language: the same gates run on each commit (git hooks) and in CI, so a change
that breaks formatting, types, tests, complexity, duplication or dead-code rules never lands.

| Gate | TypeScript | Python | Default |
| --- | --- | --- | --- |
| Format, lint, import order | Biome | Ruff | errors fail |
| Cognitive complexity per function | Biome `noExcessiveCognitiveComplexity` | complexipy | 15 |
| Cyclomatic complexity and size per function | cccc (40 / 40), Biome function length (120 lines) | Ruff `C901` (15), `PLR0911`–`PLR0915` | as listed |
| Types | `tsc --noEmit`, strict flags | mypy `strict = true` | 0 errors |
| Tests and coverage | Vitest + `@vitest/coverage-v8` | pytest + pytest-cov | 85% in logic layers |
| File maintainability | FTA (`fta-cli`) | (covered per function) | score 60 |
| Duplication | jscpd | jscpd | 5%, plus new clones on PRs (warning) |
| Dead code | knip (files, exports) | vulture (60% confidence) | 0 findings |
| Dependencies | knip | deptry | 0 findings |
| Git hooks | husky + lint-staged | pre-commit | every commit |
| CI | `.github/workflows/verify.yml` | `.github/workflows/verify.yml` | every PR and push to `main` |
| Everything, one command | `pnpm verify` | `uv run pre-commit run --all-files` | must exit 0 |

Everything to copy is in `templates/typescript/` and `templates/python/` next to this file.
Read the reference for each language the repo uses before you change anything:

- `references/typescript.md`: install, templates, tsconfig flags, and variants (npm/yarn/bun,
  Next.js, Vite, monorepos, existing ESLint/Prettier or Jest, slow hooks, other CI).
- `references/python.md`: install, templates, framework notes, and variants (no uv, pyright,
  prek, a Python project in a subdirectory, slow hooks).
- `references/calibration.md`: adopting the gates on a codebase that does not meet them yet.

## Workflow

### 1. Survey the repo (read only)

Find out, before changing anything:

- Which languages: `package.json` / `tsconfig.json` mean TypeScript; `pyproject.toml`,
  `setup.py` or `requirements*.txt` mean Python. Both means both recipes (see below).
- TypeScript: package manager (lockfile), Node version, monorepo or not, framework, Tailwind.
- Python: uv or not (`uv.lock`), src layout or flat, the import package name, Python version,
  framework (FastAPI, Django, Flask) and how it finds handlers.
- What already exists: ESLint, Prettier, Biome, Jest, Vitest, husky, lefthook, lint-staged;
  Black, isort, flake8, pylint, mypy, pyright, pre-commit; `.github/workflows/*`; tsconfig
  strictness.
- Generated or vendored folders every tool must skip (`_generated`, `generated`, `dist`,
  `.next`, `migrations`, `public/vendor`).
- Whether the repo has agent instructions (`AGENTS.md`, `CLAUDE.md`).

If a different tool already covers a gate (ESLint/Prettier, Jest, Black/flake8, pyright,
Poetry), ask whether to migrate or keep it; the variants in each reference cover both. Do not
remove a tool the user did not agree to remove. Everything else has a default here; do not
ask about it.

### 2. Install and 3. Copy the templates

Follow the reference for the language: it lists the install command with pinned versions, every
template with its destination and what to adapt, and the one-time hook installation. Merge into
existing files (`package.json`, `pyproject.toml`, `.gitignore`, `vitest.config.ts`) rather than
overwriting them. Append the language's `quality-gates.md` to `AGENTS.md` or `CLAUDE.md`
(create `AGENTS.md` if neither exists).

### 4. Calibrate

Run the one command for the language. On a new or small repo it should pass after the
formatter's fix pass. On an existing codebase, follow `references/calibration.md`: fix what is
cheap, suppress single offenders in place with a reason, and where violations are broad set the
threshold to the measured worst value with the target recorded. Never lower a gate below what
the code already achieves.

### 5. Verify end to end

All must be shown, not assumed:

1. The one command exits 0 (`pnpm verify`, `uv run pre-commit run --all-files`). TypeScript:
   `pnpm build` exits 0 too.
2. The hooks are installed: `git config core.hooksPath` prints `.husky/_` (husky), or
   `.git/hooks/pre-commit` exists and mentions pre-commit.
3. A gate bites: add an unused import and a `console.log` / `print()` to a source file, stage
   it, try to commit, confirm the commit is refused, then revert the file.
4. `verify.yml` is valid YAML and names the repo's default branch.

### 6. Report

Tell the user, in short:

- What was added and which existing tools were kept, migrated or removed.
- Every threshold that differs from the defaults above, its measured value and its target.
- Every suppression added and why.
- That `verify` must be made a required status check on the default branch by a repo admin
  (GitHub → Settings → Rules), which the workflow cannot do itself.

Commit in reviewable steps when asked to commit: tooling and configs; the one-off formatting
pass; then calibration fixes.

## Both languages in one repo

- Git runs one pre-commit hook, so one manager owns it. With a `package.json` at the root,
  husky does: append `uv run --project <python dir> pre-commit run` to `.husky/pre-commit`
  and do not run `pre-commit install` (it refuses while `core.hooksPath` is set).
- Keep one `.jscpd.json` at the root with both formats (`"format": ["typescript", "tsx",
  "javascript", "jsx", "python"]`), run it from `pnpm metrics:jscpd`, and drop the `jscpd`
  hook from `.pre-commit-config.yaml`.
- One `verify.yml` with two jobs, `typescript` and `python`, each taken from its template.
  Keep the jscpd new-clones step in one job only.
- A Python project in a subdirectory needs the hook entries adjusted: see
  `references/python.md`.

## When a gate fails later

Fix the code, not the gate. The rules are in the language's `quality-gates.md` (which step 3
copies into the repo's agent instructions): split complex functions and files, extract
duplicated logic, delete dead code, and add tests for changed logic. Raise a threshold only when
the user asks, in its own commit, with the reason.
