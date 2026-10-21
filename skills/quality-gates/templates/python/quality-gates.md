## Quality gates

Every commit runs the gates in `.pre-commit-config.yaml`; CI (`.github/workflows/verify.yml`)
runs the same hooks over the whole tree on every pull request and every push to `main`. Run
`uv run pre-commit run --all-files` before you say a change is done. After cloning, run
`uv sync && uv run pre-commit install` once.

| Gate | Command | Fails when |
| --- | --- | --- |
| Format, lint, import order | `uv run ruff check --fix` and `uv run ruff format` | any Ruff error |
| Types | `uv run mypy` (strict) | any mypy error |
| Tests and coverage | `uv run pytest` (pytest-cov) | a test fails, or coverage drops below `fail_under` in `pyproject.toml` |
| Function complexity | `uv run complexipy` (cognitive); Ruff `C901` and `PLR091x` (cyclomatic, size) | a function is above a limit |
| Duplication | `uv run pre-commit run jscpd --all-files` (`.jscpd.json`) | duplication is above `threshold` % |
| Dead code | `uv run vulture` | an unused function, class, variable or import |
| Dependencies | `uv run deptry .` | an unused, missing or transitive dependency |

When a gate fails, fix the code, not the gate:

- Complexity or size: split the function along its responsibilities; extract named helpers and
  replace branch ladders with lookup tables or early returns.
- Duplication: extract the shared logic once, or accept the copy only when the two copies are
  expected to diverge.
- vulture: delete the dead code. For a name a framework calls by reflection (a route, a
  fixture, a CLI command), add its decorator to `ignore_decorators` or the name to
  `ignore_names` in `[tool.vulture]`.
- deptry: remove the unused dependency, or add the missing one with `uv add`.
- Coverage: add tests for the code you changed, or list a file in `[tool.coverage.run] omit`
  only when it does nothing but drive an external service.

A threshold changes only on purpose, in its own commit that says why. Never bypass a hook with
`--no-verify` to land a change; it is for emergencies, and CI still runs.
