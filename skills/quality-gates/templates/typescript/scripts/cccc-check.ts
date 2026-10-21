/**
 * Run cccc and print one summary line. cccc itself fails the run from `cccc.toml`.
 * When it does, name each function that scored above a maximum.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const installed = spawnSync(process.execPath, ["scripts/cccc-install.ts"], {
	stdio: "inherit",
});
if (installed.status !== 0) process.exit(installed.status ?? 1);

type FunctionScore = {
	name: string;
	line: number;
	cognitive: number;
	cyclomatic: number;
	children?: FunctionScore[];
};

type Distribution = { max: number; p95: number };

type Report = {
	files: { path: string; functions: FunctionScore[] }[];
	summary: {
		file_count: number;
		function_count: number;
		parse_error_count: number;
		parse_error_files?: string[];
		cognitive: Distribution;
		cyclomatic: Distribution;
	};
};

type Limits = { cognitive?: number; cyclomatic?: number };

type Offender = FunctionScore & { path: string };

function limits(): Limits {
	const text = readFileSync("cccc.toml", "utf8");
	const read = (key: string) => {
		const value = text.match(
			new RegExp(`^${key}\\s*=\\s*(\\d+)\\s*$`, "m"),
		)?.[1];
		return value === undefined ? undefined : Number(value);
	};
	return {
		cognitive: read("max-cognitive"),
		cyclomatic: read("max-cyclomatic"),
	};
}

function overLimit(score: number, max: number | undefined): boolean {
	return max !== undefined && score > max;
}

function offenders(report: Report, limit: Limits): Offender[] {
	const found: Offender[] = [];
	const walk = (path: string, fns: FunctionScore[]) => {
		for (const fn of fns) {
			if (
				overLimit(fn.cognitive, limit.cognitive) ||
				overLimit(fn.cyclomatic, limit.cyclomatic)
			) {
				found.push({ ...fn, path });
			}
			walk(path, fn.children ?? []);
		}
	};
	for (const file of report.files) walk(file.path, file.functions);
	return found;
}

function summaryLine(report: Report, limit: Limits): string {
	const { summary } = report;
	const cap = `${limit.cognitive ?? "none"}/${limit.cyclomatic ?? "none"}`;
	return [
		`cccc  ${summary.file_count} files, ${summary.function_count} functions`,
		`cognitive max ${summary.cognitive.max} (p95 ${summary.cognitive.p95})`,
		`cyclomatic max ${summary.cyclomatic.max} (p95 ${summary.cyclomatic.p95})`,
		`limits ${cap}`,
	].join("  ");
}

function reason(fn: Offender, limit: Limits): string {
	const parts: string[] = [];
	if (overLimit(fn.cognitive, limit.cognitive)) {
		parts.push(`cognitive ${fn.cognitive} > ${limit.cognitive}`);
	}
	if (overLimit(fn.cyclomatic, limit.cyclomatic)) {
		parts.push(`cyclomatic ${fn.cyclomatic} > ${limit.cyclomatic}`);
	}
	return parts.join(", ");
}

function reportFailures(report: Report, limit: Limits): void {
	const hits = offenders(report, limit);
	if (hits.length === 0) {
		console.error("cccc: a complexity threshold was exceeded");
		return;
	}
	for (const hit of hits) {
		console.error(
			`cccc: ${reason(hit, limit)}  ${hit.path}:${hit.line}  ${hit.name}`,
		);
	}
}

function isReport(value: unknown): value is Report {
	if (typeof value !== "object" || value === null) return false;
	const { files, summary } = value as Partial<Report>;
	return (
		Array.isArray(files) &&
		typeof summary?.function_count === "number" &&
		typeof summary.cognitive?.max === "number" &&
		typeof summary.cyclomatic?.max === "number"
	);
}

function parseReport(stdout: string): Report {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		console.error("cccc: output was not JSON");
		process.exit(2);
	}
	if (!isReport(parsed)) {
		console.error("cccc: output did not match the expected report");
		process.exit(2);
	}
	return parsed;
}

function warnParseErrors(report: Report): void {
	const { summary } = report;
	if (summary.parse_error_count === 0) return;
	console.error(
		`cccc: ${summary.parse_error_count} parse error(s); scores for those files may be incomplete`,
	);
	for (const path of summary.parse_error_files ?? []) {
		console.error(`cccc:   ${path}`);
	}
}

const bin = join("node_modules", ".bin", "cccc");
if (!existsSync(bin)) {
	console.warn("cccc: no binary for this platform; skipped (CI runs it)");
	process.exit(0);
}

const result = spawnSync(bin, ["."], {
	encoding: "utf8",
});
if (result.error) throw result.error;
const stderr = result.stderr ?? "";
if (stderr)
	process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
if (result.status === 2) process.exit(2);

const report = parseReport(result.stdout ?? "");
const limit = limits();
console.log(summaryLine(report, limit));
warnParseErrors(report);
if (result.status !== 0) {
	reportFailures(report, limit);
	process.exit(result.status ?? 1);
}
