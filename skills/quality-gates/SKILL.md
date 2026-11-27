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
- `references/calibration.md`: adopting the gates on a codebase that does not meet them yet,
  the measure command per gate, and the ratchet that the audit uses.

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
   it, try to commit, confirm the commit is refused, then revert the file. If the commit lands,
   the hook is not installed: `git reset HEAD~1`, revert the file, and fix the hook first.
4. The installed skill is not scanned as project code: when it lives in the repo
   (`.agents/`, `.claude/`, `skills-lock.json`), every tool's ignore list covers it (the
   templates already do).
5. `verify.yml` is valid YAML and names the repo's default branch.

### 6. Report

Tell the user, in short:

- What was added and which existing tools were kept, migrated or removed.
- Every threshold that differs from the defaults above, its measured value and its target.
- Every suppression added and why.
- That `verify` must be made a required status check on the default branch by a repo admin
  (GitHub → Settings → Rules), which the workflow cannot do itself.

Commit in reviewable steps when asked to commit: tooling and configs; the one-off formatting
pass; then calibration fixes.

## Audit an existing setup

Use this when the repo already has gates (or the user asks to audit, review or "bring it up
to the standard of" another repo). It changes nothing until the user agrees to the proposals.

1. **Detect what is installed.** TypeScript: `biome.json`, `vitest.config.ts`, `fta.json`,
   `cccc.toml`, `knip.json`, `.jscpd.json`, the `verify` and `metrics:*` scripts, `.husky/`,
   `.github/workflows/verify.yml`. Python: the `[tool.ruff]`, `[tool.mypy]`,
   `[tool.coverage]`, `[tool.complexipy]`, `[tool.vulture]` and `[tool.deptry]` tables,
   `.pre-commit-config.yaml`, `.jscpd.json`, `verify.yml`.
2. **Flag what is missing** against the template set in the language's reference (the
   "Template | Destination | Adapt" table) and the gate table above: for example no knip,
   no `verify.yml`, no hook, no coverage floor. Offer to add each through the normal
   workflow (steps 2 to 5); do not add it silently.
3. **Read the recorded targets.** Where a threshold was loosened, its target is in a comment
   in `cccc.toml` or `pyproject.toml`, or in the quality-gates section of `AGENTS.md` /
   `CLAUDE.md` for JSON configs. With no record, the target is the default in the table above.
4. **Measure each gate** with the commands in `references/calibration.md` §2. Run each
   measure on its own and read the number named in its "Read" column.
5. **Report one table per language**, one row per gate:

   | Gate | Configured | Target | Measured | Proposed |
   | --- | --- | --- | --- | --- |
   | cccc cognitive | 65 | 40 | 52 | 55 |

   Proposed follows `references/calibration.md` §3 and §4. Most gates are limits (a maximum:
   complexity, duplication %, FTA score, finding counts); coverage is a floor (a minimum).
   The two tighten in opposite directions:

   - **Limit:** propose the measured worst value rounded up to the next 5, never below the
     target. Write `keep` when that is not lower than the configured value, or when the
     configured value already equals the target. When the measured value is at or under the
     target, write `target met` and propose the target itself.
   - **Floor:** propose a few points under the measured value, never above the target. Write
     `keep` when that is not higher than the configured floor, or when the floor already
     equals the target. When the measured value is at or above the target, write `target met`
     and propose the target itself.
6. **Only ever tighten.** Tightening is down for a limit and up for a floor. Never loosen a
   threshold, even if the measure is worse than configured (a limit below the measured value,
   a floor above it): report that row as a regression and name the offending files or
   functions so the code can be fixed instead.

   | Gate | Configured | Target | Measured | Proposed |
   | --- | --- | --- | --- | --- |
   | Coverage lines (floor) | 80 | 85 | 92 | 85 (target met) |
   | Coverage lines (floor) | 80 | 85 | 75 | regression: keep 80, add tests |
   | Coverage lines (floor, target 95) | 80 | 95 | 92 | 89 |

7. **Apply only what the user approves,** one gate per commit, with the reason and the
   measured value in the message ("Lower cccc cognitive max from 65 to 55: worst is now 52", "Raise the lines floor from 80 to 89: measured 92").
   Re-run the one command before each commit.

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
