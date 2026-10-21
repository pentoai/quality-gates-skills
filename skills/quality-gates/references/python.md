# Python

The templates in `templates/python/` assume uv, a `pyproject.toml` at the repo root, the src
layout (`src/<package>/`), tests in `tests/`, and GitHub Actions. The variants below cover the
rest. Change only what the repo needs.

## Install

```sh
uv add --dev ruff mypy pytest pytest-cov complexipy vulture deptry pre-commit
```

`uv.lock` pins the exact versions for every machine and CI. jscpd is not a Python package:
pre-commit installs it into its own Node environment from the `jscpd` hook (it uses the
system Node when there is one and downloads one otherwise).

## Copy the templates

| Template | Destination | Adapt |
| --- | --- | --- |
| `pyproject-fragment.toml` | merge into `pyproject.toml` | `your_package` (coverage `source`, deptry `known_first_party`) and `src/`; `[tool.mypy] files`; coverage `source` to the logic layers; vulture settings per framework (below) |
| `.pre-commit-config.yaml` | `.pre-commit-config.yaml` | nothing for the default layout |
| `.jscpd.json` | `.jscpd.json` | `ignore` |
| `github/workflows/verify.yml` | `.github/workflows/verify.yml` | default branch |
| `quality-gates.md` | append to `AGENTS.md` / `CLAUDE.md` | nothing |

Then:

- Add `.coverage` and `htmlcov/` to `.gitignore`. Ruff, mypy, pytest and complexipy write
  their caches with their own `.gitignore`.
- Run `uv run pre-commit install` once. Unlike husky, nothing installs the hook on clone, so
  the `quality-gates.md` block tells people and agents to run it after cloning.
- Run `uv run ruff check --fix && uv run ruff format`, then
  `uv run pre-commit run --all-files`.

pytest exits with code 5 when it collects no tests, which fails the hook. A repo with no tests
gets its first test for the package's core logic in this change.

Entry points named in `[project.scripts]` are called by the installer, not by code, so vulture
reports them: add their function names to `ignore_names` in `[tool.vulture]`.

## Framework notes

**FastAPI.** Route handlers are called by the framework: add the decorators,
`ignore_decorators = ["@pytest.fixture", "@app.*", "@router.*"]`. Fields of Pydantic models
that only serialization reads (response models) show up as unused variables: keep the models
in schema modules and add them to `exclude` in `[tool.vulture]` (`exclude =
["*/schemas.py", "*/schemas/*"]`). Add `plugins = ["pydantic.mypy"]` to `[tool.mypy]`.

**Django.** Install `django-stubs[compatible-mypy]` and set `plugins =
["mypy_django_plugin.main"]` with `[tool.django-stubs] django_settings_module = "..."`. Add
`migrations` to vulture's `exclude` and to complexipy's `exclude`. Views, admin classes and
model fields are found by reflection: generate a whitelist with `uv run vulture
--make-whitelist > vulture_whitelist.py`, review it, and add the file to vulture's `paths`
and to Ruff's `per-file-ignores` (`"vulture_whitelist.py" = ["B018", "F821"]`).

**Flask, Typer, Click.** Add the decorators that register handlers or commands to
`ignore_decorators` (`"@app.route"`, `"@bp.*"`, `"@cli.command"`).

## Python in a subdirectory, or next to TypeScript

pre-commit reads `.pre-commit-config.yaml` from the repo root and runs each hook from the root.
With the project in `backend/`:

- Ruff hooks: `entry: uv run --project backend ruff check --fix` (and `ruff format`) plus
  `files: ^backend/`. `--project` keeps the root as the working directory, so the staged paths
  pre-commit passes still resolve, and Ruff finds `backend/pyproject.toml` from each file.
- Repo-wide hooks: `entry: uv run --directory backend mypy` (and the same for pytest,
  complexipy, vulture, deptry), so each tool runs inside the project and reads its config.
- When a root `package.json` uses husky, `.husky/pre-commit` ends with
  `uv run --project backend pre-commit run`, and `pre-commit install` is not run. The root
  `.jscpd.json` covers both languages; drop the `jscpd` hook. See "Both languages in one repo"
  in `SKILL.md`.
- In CI: `working-directory: backend` for `uv sync --locked`, then
  `uv run --project backend pre-commit run --all-files` from the root.

## Without uv

Replace `uv run` with the project's runner in every hook entry and in the workflow:
`poetry run` (Poetry), `pdm run` (PDM), or `hatch run` (Hatch). With plain pip and a
virtualenv, use the tool names alone and activate the virtualenv first; in CI, install with
`pip install -e ".[dev]"` (or the requirements file) instead of `uv sync --locked`, and use
`actions/setup-python` instead of `astral-sh/setup-uv`.

## Existing tools

- **Black, isort, flake8, pyupgrade, autoflake.** Ruff covers all of them. Ask before
  replacing; to migrate, carry the line length and any per-file ignores into `[tool.ruff]`,
  remove the old hooks and dependencies, and run `uv run ruff format` once in its own commit.
- **pyright or basedpyright instead of mypy.** Keep it when the repo already uses it: set
  `typeCheckingMode = "strict"` in `[tool.pyright]` and use `uv run pyright` as the hook
  entry. (pyright's PyPI package needs Node and downloads one when it is missing;
  basedpyright bundles it.)
- **pylint.** Ruff implements most of its checks; keep pylint only for checks the user relies
  on that Ruff lacks.
- **An existing `.pre-commit-config.yaml`.** Merge the hooks above into it and keep the
  repo's own hooks (YAML checks, secret scanning, end-of-file fixers).

## prek

prek is a faster, drop-in reimplementation of pre-commit that reads the same
`.pre-commit-config.yaml`. To use it, `uv add --dev prek` instead of `pre-commit`, and
replace `pre-commit` with `prek` in the install command, the workflow and `quality-gates.md`.

## Hooks too slow

When the repo-wide hooks take over a minute, move pytest (and mypy if needed) to pre-push:
add `stages: [pre-push]` to those hooks and `default_install_hook_types: [pre-commit,
pre-push]` at the top of the config, then run `uv run pre-commit install` again. In CI and
in the one command, add `--hook-stage pre-push`: hooks without `stages` run in every stage, so
`uv run pre-commit run --all-files --hook-stage pre-push` runs all of them.

## Other CI providers

The job is: checkout with full history, install uv, `uv sync --locked`,
`uv run pre-commit run --all-files`, and on pull requests
`npx jscpd . --baseline-from-ref origin/main --fail-on-new-clones`. Set `GIT_DEPTH: 0`
(GitLab) so `origin/main` exists for the jscpd baseline.
