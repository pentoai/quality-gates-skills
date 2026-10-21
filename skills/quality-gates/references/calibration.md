# Calibrating the gates on an existing codebase

The template thresholds are the target. A codebase that predates the gates usually exceeds
some of them. The aim is a green run on the day the gates land, with no gate weaker than the
code already is, so that nothing gets worse from then on (a ratchet).

Measure every gate before choosing a number. Never pick a threshold without the measurement
in front of you.

## 1. Mechanical fixes first

| | TypeScript | Python |
| --- | --- | --- |
| Safe fixes | `pnpm exec biome check --write` | `uv run ruff check --fix && uv run ruff format` |
| Unsafe fixes (only if the user agrees; review the diff) | `pnpm exec biome check --write --unsafe` | `uv run ruff check --fix --unsafe-fixes` |
| What remains, by rule | `pnpm exec biome check --max-diagnostics=none 2>&1 \| grep -oE 'lint/[a-zA-Z]+/[a-zA-Z]+' \| sort \| uniq -c \| sort -rn` | `uv run ruff check --statistics --exit-zero` |

Commit the formatting pass on its own, then list what remains.

## 2. Measure each gate

TypeScript:

| Gate | Measure with | Read |
| --- | --- | --- |
| Biome cognitive complexity | `pnpm exec biome lint --only=complexity/noExcessiveCognitiveComplexity --max-diagnostics=none` | the highest score reported |
| Biome function length | `pnpm exec biome lint --only=complexity/noExcessiveLinesPerFunction --max-diagnostics=none` | the longest function |
| FTA | `pnpm exec fta . --config-path fta.json --json` | the highest `fta_score` |
| jscpd | `pnpm exec jscpd .` | the "Total" duplication % |
| cccc | `node scripts/cccc-check.ts` | `cognitive max`, `cyclomatic max` in the summary line |
| Coverage | `pnpm exec vitest run --coverage` with `thresholds` removed | lines and functions % per area |
| knip | `pnpm lint:unused` | each finding |
| tsc strict flags | `pnpm typecheck` after each added flag | error count per flag |

Python:

| Gate | Measure with | Read |
| --- | --- | --- |
| Cognitive complexity | `uv run complexipy --sort desc --top 10 --plain` | the highest score |
| Cyclomatic complexity and size | `uv run ruff check --select C901,PLR0911,PLR0912,PLR0913,PLR0915 --exit-zero --output-format concise` | the highest value in each `(n > limit)` |
| jscpd | `uv run pre-commit run jscpd --all-files` | the "Total" duplication % |
| Coverage | `uv run pytest --cov-fail-under=0` | total and per-file % |
| vulture | `uv run vulture` | each finding |
| deptry | `uv run deptry .` | each finding |
| mypy strict | `uv run mypy` with `strict = true`, then without | the error count in the last line |

## 3. Choose thresholds

- **At or under the template target:** keep the target.
- **Over the target, a handful of offenders (≲5):** keep the target and fix or split those
  functions/files now if the change is small and tests cover them. Otherwise suppress each
  one where it is, with a reason, and keep the target:

  | Gate | TypeScript | Python |
  | --- | --- | --- |
  | Lint rule or complexity | `// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: legacy parser, split tracked in #123` | `# noqa: C901  legacy parser, split tracked in #123` |
  | complexipy | | `# complexipy: ignore (legacy parser, #123)` on the `def` line |
  | FTA | add the file to `exclude_filenames` in `fta.json` | |
  | Duplication | `// jscpd:ignore-start` / `// jscpd:ignore-end` | `# jscpd:ignore-start` / `# jscpd:ignore-end` |
  | Types | `// @ts-expect-error reason` | `# type: ignore[code]  # reason` |

- **Over the target broadly:** set the threshold to the measured worst value (rounded up to
  the next 5), write the target next to it, and tell the user. TOML holds comments:
  `max-cognitive = 65  # target 40; lower as the parser is split` in `cccc.toml`, or
  `max-complexity-allowed = 30  # target 15` in `[tool.complexipy]`. JSON configs cannot
  hold comments: record the target in the quality-gates section of the repo's agent
  instructions instead.
- **Coverage:** set each floor a few points under the measured value, so the next commit
  cannot lower it. Gate only the logic layers (domain, utils, data access): `coverage.include`
  and `thresholds` in Vitest, `[tool.coverage.run] source` in Python. A codebase with no tests
  starts with the include pointing at the folder the user wants tested first and a floor of 0,
  raised as tests land; do not gate UI components by unit coverage.
- **knip, vulture:** fix real dead code. For a false positive (a file loaded by a framework, a
  handler registered by a decorator, a name called by reflection), add it to knip's `entry` or
  `ignore`, or to vulture's `ignore_decorators`, `ignore_names` or `exclude`. Unused
  dependencies that the build really needs go in knip's `ignoreDependencies` or deptry's
  `per_rule_ignores`, with the reason in the commit message.
- **tsc strict flags:** add `strict` first. Add `noUncheckedIndexedAccess` only if its error
  count is small enough to fix now or the user agrees to fix them; it is the most valuable and
  the noisiest. The rest (`noFallthroughCasesInSwitch`, `noImplicitOverride`,
  `verbatimModuleSyntax`, `isolatedModules`) are cheap.
- **mypy strict:** `strict` is global. When a few legacy modules hold most of the errors,
  keep `strict = true` and relax only those modules in a `[[tool.mypy.overrides]]` block
  (`disallow_untyped_defs = false`, or `ignore_errors = true` as a last resort), with the
  target recorded in a comment.
- **Filename convention (TypeScript):** match what the repo already does (`git ls-files
  'src/**' | head -50`). React repos often use PascalCase components: `"filenameCases":
  ["kebab-case", "PascalCase"]`, or drop the rule. Renaming files is a separate change the
  user must approve.

## 4. Ratchet

Whatever was loosened is recorded with its target. Each later change that brings the worst
value down may lower the threshold in the same commit. A threshold never goes up to let a new
change through.
