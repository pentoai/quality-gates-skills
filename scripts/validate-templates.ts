/**
 * Parse every JSON, YAML and TOML file the skill ships, so a syntax error fails CI.
 * Walks `skills/quality-gates/templates/` and `.claude-plugin/`. `.jsonc` files may hold
 * comments, so they are left to Biome.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

const roots = ["skills/quality-gates/templates", ".claude-plugin"];

const parsers: Record<string, (text: string) => unknown> = {
	".json": (text) => JSON.parse(text),
	".yml": (text) => parseYaml(text, { prettyErrors: true, strict: true }),
	".yaml": (text) => parseYaml(text, { prettyErrors: true, strict: true }),
	".toml": (text) => parseToml(text),
};

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

let checked = 0;
let failed = 0;
for (const file of roots.flatMap(walk)) {
	const parse = parsers[extname(file)];
	if (!parse) continue;
	checked++;
	try {
		parse(readFileSync(file, "utf8"));
	} catch (error) {
		failed++;
		console.error(`${file}: ${error instanceof Error ? error.message : error}`);
	}
}

if (checked === 0) {
	console.error("No JSON, YAML or TOML files found: check the roots.");
	process.exit(2);
}
console.log(`Parsed ${checked} files, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
