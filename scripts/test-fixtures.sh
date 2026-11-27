#!/usr/bin/env bash
# End-to-end check of SKILL.md step 5: apply the templates to a fixture repo the way the
# references describe, run the one command, and prove a bad commit is refused.
#
# Usage: scripts/test-fixtures.sh [typescript|python|mixed ...]   (default: all three)
# Each fixture is copied to a temp dir, so fixtures/ itself is never modified. KEEP=1 keeps
# the temp dirs. Needs network (npm, PyPI, and the GitHub release that cccc-install.ts reads),
# Node 24, pnpm and uv.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/skills/quality-gates/templates"
WORK="$(mktemp -d)"
trap '[ -n "${KEEP:-}" ] && echo "kept $WORK" || rm -rf "$WORK"' EXIT

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

new_repo() { # <fixture> -> prints the repo dir
	local dir="$WORK/$1"
	cp -r "$ROOT/fixtures/$1" "$dir"
	git -C "$dir" init -q -b main
	git -C "$dir" config user.email fixture@example.com
	git -C "$dir" config user.name Fixture
	echo "$dir"
}

# references/typescript.md
apply_typescript() { # <dir>
	cd "$1"
	cp "$TPL"/typescript/{biome.json,fta.json,.jscpd.json,cccc.toml,knip.json,vitest.config.ts} .
	cp -r "$TPL/typescript/scripts" scripts
	mkdir -p .husky .github/workflows
	cp "$TPL"/typescript/husky/* .husky/
	cp "$TPL/typescript/github/workflows/verify.yml" .github/workflows/
	echo 24 > .nvmrc
	printf '.cccc.cache\n/coverage\n' >> .gitignore
	node -e '
		const fs = require("node:fs");
		const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
		const frag = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
		Object.assign(pkg, { ...frag, scripts: { ...pkg.scripts, ...frag.scripts } });
		fs.writeFileSync("package.json", JSON.stringify(pkg, null, "\t") + "\n");
	' "$TPL/typescript/package-fragment.json"
	cat "$TPL/typescript/quality-gates.md" >> AGENTS.md
	pnpm add -D -E @biomejs/biome typescript vitest @vitest/coverage-v8 \
		fta-cli jscpd knip husky lint-staged @types/node
	pnpm exec biome migrate --write
	pnpm run prepare
	pnpm lint:fix
}

# references/python.md; <package> is the import package, <dir> the project directory
apply_python() { # <repo> <project dir> <package>
	local repo="$1" proj="$2" pkg="$3"
	cd "$proj"
	uv add --dev ruff mypy pytest pytest-cov complexipy vulture deptry pre-commit
	{ echo; sed "s/your_package/$pkg/g" "$TPL/python/pyproject-fragment.toml"; } >> pyproject.toml
	printf '.coverage\nhtmlcov/\n' >> "$repo/.gitignore"
	cp "$TPL/python/.pre-commit-config.yaml" "$repo/"
	cp "$TPL/python/.jscpd.json" "$repo/"
	cat "$TPL/python/quality-gates.md" >> "$repo/AGENTS.md"
	uv run ruff check --fix
	uv run ruff format
}

# SKILL.md "Both languages in one repo": husky owns the hook, jscpd runs once from the root,
# and every hook entry points into backend/ (references/python.md, "subdirectory").
merge_mixed_config() { # <repo>
	cd "$1"
	sed -E -i \
		-e 's|entry: uv run ruff|entry: uv run --project backend ruff|' \
		-e 's|entry: uv run (mypy\|pytest\|complexipy\|vulture\|deptry)|entry: uv run --directory backend \1|' \
		-e 's|^( +)types_or: \[python, pyi\]|&\n\1files: ^backend/|' \
		-e '/- id: jscpd/,$d' .pre-commit-config.yaml
	echo 'uv run --project backend pre-commit run' >> .husky/pre-commit
	cat > .jscpd.json <<'JSON'
{
	"threshold": 5,
	"minTokens": 50,
	"reporters": ["console"],
	"ignore": [
		"**/node_modules/**",
		"**/.venv/**",
		"**/__pycache__/**",
		"**/dist/**",
		"**/build/**",
		"**/coverage/**",
		"**/htmlcov/**",
		"**/*.test.ts",
		"backend/tests/**",
		".agents/**",
		".claude/**",
		"pnpm-lock.yaml",
		"uv.lock"
	],
	"format": ["typescript", "tsx", "javascript", "jsx", "python"]
}
JSON
	# Biome also formats the Markdown and YAML that the Python templates just added.
	pnpm lint:fix
}

# A commit with an unused import and a debug print must be refused and leave HEAD alone.
assert_bad_commit_refused() { # <repo> <file> <content>
	local repo="$1" file="$2" before
	cd "$repo"
	before="$(git rev-parse HEAD)"
	printf '%s\n' "$3" > "$file"
	git add "$file"
	if git commit -q -m "Add a file with an unused import and a debug print" > "$WORK/bad-commit.log" 2>&1; then
		cat "$WORK/bad-commit.log"
		fail "git commit accepted $file (unused import and debug print)"
	fi
	[ "$(git rev-parse HEAD)" = "$before" ] || fail "HEAD moved after the refused commit"
	echo "refused as expected: $file"
	git reset -q HEAD "$file"
	rm "$file"
}

TS_BAD='import { readFileSync } from "node:fs";

export function noisy(): void {
	console.log("debug");
}'
PY_BAD='import os


def noisy() -> None:
    print("debug")'

commit_clean() { # <repo>: a good commit must pass the hooks
	cd "$1"
	git add -A
	git commit -q -m "Apply the quality gates"
}

check_typescript_gates() { # <repo>
	cd "$1"
	step "pnpm verify"; pnpm verify
	step "pnpm build"; pnpm build
	[ "$(git config core.hooksPath)" = ".husky/_" ] || fail "core.hooksPath is not .husky/_"
}

check_python_gates() { # <repo> <project dir>
	cd "$1"
	git add -A
	step "pre-commit run --all-files"; uv run --project "$2" pre-commit run --all-files
}

test_typescript() {
	local repo; repo="$(new_repo typescript)"
	step "typescript: apply templates"; (apply_typescript "$repo")
	check_typescript_gates "$repo"
	step "typescript: good commit passes, bad commit is refused"
	commit_clean "$repo"
	assert_bad_commit_refused "$repo" src/lib/noisy.ts "$TS_BAD"
}

test_python() {
	local repo; repo="$(new_repo python)"
	step "python: apply templates"; (apply_python "$repo" "$repo" demo_app)
	cd "$repo"
	git add -A
	step "python: pre-commit install"; uv run pre-commit install
	grep -q pre-commit .git/hooks/pre-commit || fail ".git/hooks/pre-commit missing"
	check_python_gates "$repo" .
	step "python: good commit passes, bad commit is refused"
	commit_clean "$repo"
	assert_bad_commit_refused "$repo" src/demo_app/noisy.py "$PY_BAD"
}

test_mixed() {
	local repo; repo="$(new_repo mixed)"
	step "mixed: apply templates"
	(apply_typescript "$repo")
	(apply_python "$repo" "$repo/backend" demo_api)
	(merge_mixed_config "$repo")
	cd "$repo"
	git add -A
	check_typescript_gates "$repo"
	check_python_gates "$repo" backend
	step "mixed: good commit passes, bad TS and bad Python commits are refused"
	commit_clean "$repo"
	assert_bad_commit_refused "$repo" src/lib/noisy.ts "$TS_BAD"
	assert_bad_commit_refused "$repo" backend/src/demo_api/noisy.py "$PY_BAD"
}

TARGETS=("$@")
[ ${#TARGETS[@]} -gt 0 ] || TARGETS=(typescript python mixed)
for t in "${TARGETS[@]}"; do
	case "$t" in
		typescript|python|mixed) "test_$t" ;;
		*) fail "unknown fixture: $t" ;;
	esac
done
printf '\nAll fixtures passed: %s\n' "${TARGETS[*]}"
