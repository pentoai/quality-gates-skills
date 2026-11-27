/**
 * Fail when the docs an agent reads drift from the files it copies. Checks that
 * 1. every template file is in the "Copy the templates" table of its reference, and every row
 *    names an existing file;
 * 2. the thresholds in the templates equal the Default column in SKILL.md and README.md;
 * 3. the jscpd and cccc versions agree wherever they are pinned;
 * 4. every tool's ignore list holds `.agents` and `.claude`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseToml } from "smol-toml";

const skill = "skills/quality-gates";
const templates = `${skill}/templates`;
const problems: string[] = [];

const read = (path: string): string => readFileSync(path, "utf8");
const json = (path: string): Record<string, unknown> => JSON.parse(read(path));
const toml = (path: string): Record<string, unknown> => parseToml(read(path));

function fail(message: string): void {
	problems.push(message);
}

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

/** Walk down nested objects; undefined when a key is missing. */
function dig(value: unknown, ...keys: string[]): unknown {
	let current = value;
	for (const key of keys) {
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function expectEqual(what: string, actual: unknown, expected: unknown): void {
	if (actual !== expected) {
		fail(
			`${what}: found ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
		);
	}
}

// 1. Template tables.

function tableFirstCells(markdown: string): string[] {
	const section = markdown
		.split("## Copy the templates")[1]
		?.split(/\n(?:Then:|## )/)[0];
	if (!section) return [];
	return section
		.split("\n")
		.filter((line) => line.startsWith("|"))
		.slice(2)
		.map((line) => line.split("|")[1] ?? "");
}

function checkTemplateTable(lang: string): void {
	const reference = `${skill}/references/${lang}.md`;
	const cells = tableFirstCells(read(reference));
	if (cells.length === 0)
		fail(`${reference}: no "Copy the templates" table found`);
	const listed = new Set(
		cells.flatMap((cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])),
	);
	const dir = `${templates}/${lang}`;
	const files = new Set(walk(dir).map((file) => relative(dir, file)));
	for (const file of files) {
		if (!listed.has(file))
			fail(`${reference}: template ${dir}/${file} is not in the table`);
	}
	for (const name of listed) {
		if (!files.has(name))
			fail(`${reference}: table row names ${name}, which is not in ${dir}`);
	}
}

// 2. Thresholds.

function numbers(text: string): number[] {
	return [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/** The cells of the gate-table row whose first cell starts with `gate`. */
function gateRow(path: string, gate: string): string[] {
	const line = read(path)
		.split("\n")
		.find((l) => l.startsWith(`| ${gate}`));
	if (!line) {
		fail(`${path}: no table row starting with "${gate}"`);
		return [];
	}
	return line
		.split("|")
		.slice(1, -1)
		.map((cell) => cell.trim());
}

function defaultOf(path: string, gate: string, column: number): number[] {
	return numbers(gateRow(path, gate)[column] ?? "");
}

function checkThresholds(): void {
	const skillMd = `${skill}/SKILL.md`;
	const readme = "README.md";
	const [TS, PY, DEFAULT] = [1, 2, 3];
	const cognitive = defaultOf(skillMd, "Cognitive", DEFAULT)[0];
	const coverage = defaultOf(skillMd, "Tests", DEFAULT)[0];
	const fta = defaultOf(skillMd, "File maintainability", DEFAULT)[0];
	const dup = defaultOf(skillMd, "Duplication", DEFAULT)[0];
	const [cccc, ccccCyclomatic] = numbers(
		gateRow(skillMd, "Cyclomatic")[TS] ?? "",
	);
	const [maxLines] = numbers(
		(gateRow(skillMd, "Cyclomatic")[TS] ?? "").split("Biome")[1] ?? "",
	);
	const ruff = Number(
		gateRow(skillMd, "Cyclomatic")[PY]?.match(/C901`? \((\d+)\)/)?.[1],
	);
	const vulture = numbers(gateRow(skillMd, "Dead code")[PY] ?? "")[0];

	// README mirrors SKILL.md.
	expectEqual(
		"README cognitive default",
		defaultOf(readme, "Cognitive", DEFAULT)[0],
		cognitive,
	);
	expectEqual(
		"README coverage default",
		defaultOf(readme, "Tests", DEFAULT)[0],
		coverage,
	);
	expectEqual(
		"README FTA default",
		defaultOf(readme, "File maintainability", DEFAULT)[0],
		fta,
	);
	expectEqual(
		"README duplication default",
		defaultOf(readme, "Duplication", DEFAULT)[0],
		dup,
	);
	const readmeCyclomatic = numbers(
		gateRow(readme, "Cyclomatic")[DEFAULT] ?? "",
	);
	expectEqual("README cccc default", readmeCyclomatic[0], cccc);
	expectEqual("README Python cyclomatic default", readmeCyclomatic[1], ruff);
	expectEqual("SKILL.md cccc cognitive and cyclomatic", ccccCyclomatic, cccc);

	const ts = `${templates}/typescript`;
	const py = `${templates}/python`;
	const biome = json(`${ts}/biome.json`);
	const rules = ["linter", "rules", "complexity"];
	expectEqual(
		"biome.json maxAllowedComplexity",
		dig(
			biome,
			...rules,
			"noExcessiveCognitiveComplexity",
			"options",
			"maxAllowedComplexity",
		),
		cognitive,
	);
	expectEqual(
		"biome.json maxLines",
		dig(biome, ...rules, "noExcessiveLinesPerFunction", "options", "maxLines"),
		maxLines,
	);
	const cfg = toml(`${ts}/cccc.toml`);
	expectEqual("cccc.toml max-cognitive", cfg["max-cognitive"], cccc);
	expectEqual("cccc.toml max-cyclomatic", cfg["max-cyclomatic"], cccc);
	expectEqual("fta.json score_cap", json(`${ts}/fta.json`).score_cap, fta);
	expectEqual(
		"typescript .jscpd.json threshold",
		json(`${ts}/.jscpd.json`).threshold,
		dup,
	);
	expectEqual(
		"python .jscpd.json threshold",
		json(`${py}/.jscpd.json`).threshold,
		dup,
	);

	const vitest = read(`${ts}/vitest.config.ts`);
	const lines = vitest.match(/lines:\s*(\d+)/)?.[1];
	const functions = vitest.match(/functions:\s*(\d+)/)?.[1];
	expectEqual("vitest.config.ts lines threshold", Number(lines), coverage);
	expectEqual(
		"vitest.config.ts functions threshold",
		Number(functions),
		coverage,
	);

	const pyproject = toml(`${py}/pyproject-fragment.toml`);
	expectEqual(
		"pyproject fail_under",
		dig(pyproject, "tool", "coverage", "report", "fail_under"),
		coverage,
	);
	expectEqual(
		"pyproject complexipy max-complexity-allowed",
		dig(pyproject, "tool", "complexipy", "max-complexity-allowed"),
		cognitive,
	);
	expectEqual(
		"pyproject ruff max-complexity",
		dig(pyproject, "tool", "ruff", "lint", "mccabe", "max-complexity"),
		ruff,
	);
	expectEqual(
		"pyproject vulture min_confidence",
		dig(pyproject, "tool", "vulture", "min_confidence"),
		vulture,
	);
}

// 3. Pinned versions.

function checkVersions(): void {
	const hook = read(`${templates}/python/.pre-commit-config.yaml`).match(
		/jscpd@(\d+\.\d+\.\d+)/g,
	);
	const ci = read(`${templates}/python/github/workflows/verify.yml`).match(
		/jscpd@(\d+\.\d+\.\d+)/g,
	);
	if (!hook || !ci) {
		fail("jscpd pin not found in .pre-commit-config.yaml or verify.yml");
		return;
	}
	const pins = new Set([...hook, ...ci]);
	if (pins.size !== 1) fail(`jscpd pins differ: ${[...pins].join(", ")}`);

	const cccc = read(`${templates}/typescript/scripts/cccc-install.ts`).match(
		/const version = "([^"]+)"/,
	)?.[1];
	if (!cccc) {
		fail("cccc-install.ts: version constant not found");
		return;
	}
	const docs = [
		`${skill}/SKILL.md`,
		"README.md",
		...walk(`${skill}/references`),
		...walk(templates),
	];
	for (const file of docs.filter((f) => /\.(md|ya?ml|json|toml|ts)$/.test(f))) {
		for (const m of read(file).matchAll(/cccc[ @v]+v?(\d+\.\d+\.\d+)/gi)) {
			if (m[1] !== cccc)
				fail(`${file}: cccc ${m[1]} differs from cccc-install.ts (${cccc})`);
		}
	}
}

// 4. Agent folders stay out of every gate.

function checkIgnores(): void {
	const ts = `${templates}/typescript`;
	const py = `${templates}/python`;
	const pyproject = toml(`${py}/pyproject-fragment.toml`);
	const lists: Record<string, string> = {
		"biome.json files.includes": JSON.stringify(
			dig(json(`${ts}/biome.json`), "files", "includes"),
		),
		"cccc.toml exclude": JSON.stringify(toml(`${ts}/cccc.toml`).exclude),
		"fta.json exclude_directories": JSON.stringify(
			json(`${ts}/fta.json`).exclude_directories,
		),
		"typescript .jscpd.json ignore": JSON.stringify(
			json(`${ts}/.jscpd.json`).ignore,
		),
		"python .jscpd.json ignore": JSON.stringify(
			json(`${py}/.jscpd.json`).ignore,
		),
		"knip.json ignore": JSON.stringify(json(`${ts}/knip.json`).ignore),
		"vitest.config.ts test.exclude": read(`${ts}/vitest.config.ts`),
		"pyproject ruff extend-exclude": JSON.stringify(
			dig(pyproject, "tool", "ruff", "extend-exclude"),
		),
		"pyproject deptry extend_exclude": JSON.stringify(
			dig(pyproject, "tool", "deptry", "extend_exclude"),
		),
	};
	for (const [name, list] of Object.entries(lists)) {
		for (const dir of [".agents", ".claude"]) {
			// knip packs both into one `{.agents,.claude}` glob; the match is on the name.
			if (!list.includes(dir)) fail(`${name} does not list ${dir}`);
		}
	}
}

checkTemplateTable("typescript");
checkTemplateTable("python");
checkThresholds();
checkVersions();
checkIgnores();

for (const problem of problems) console.error(problem);
console.log(`Consistency check: ${problems.length} problem(s).`);
process.exit(problems.length > 0 ? 1 : 0);
