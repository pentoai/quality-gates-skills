/**
 * Tests for the shipped cccc scripts. Both are top-level scripts, so each test copies them
 * into a temp project and runs them as a child process, the way `node scripts/*.ts` does.
 * A fake `cccc` binary stands in for the release, and a preload stubs `fetch` and the
 * platform, so nothing touches the network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

const scriptsDir = join(
	import.meta.dirname,
	"../skills/quality-gates/templates/typescript/scripts",
);
const roots: string[] = [];

after(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempProject(): string {
	const root = mkdtempSync(join(tmpdir(), "cccc-test-"));
	roots.push(root);
	mkdirSync(join(root, "scripts"));
	for (const name of ["cccc-check.ts", "cccc-install.ts"]) {
		copyFileSync(join(scriptsDir, name), join(root, "scripts", name));
	}
	return root;
}

type Fn = {
	name: string;
	line: number;
	cognitive: number;
	cyclomatic: number;
	children?: Fn[];
};

function fn(
	name: string,
	cognitive: number,
	cyclomatic = 1,
	children?: Fn[],
): Fn {
	return { name, line: 1, cognitive, cyclomatic, children };
}

function report(files: { path: string; functions: Fn[] }[]) {
	return {
		files,
		summary: {
			file_count: files.length,
			function_count: 3,
			parse_error_count: 0,
			cognitive: { max: 70, p95: 10 },
			cyclomatic: { max: 5, p95: 2 },
		},
	};
}

/** A fake cccc: answers --version with the pinned one, otherwise prints `stdout`. */
function fakeBin(root: string, stdout: string, status = 0): void {
	mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
	writeFileSync(join(root, "report.json"), stdout);
	const bin = join(root, "node_modules/.bin/cccc");
	writeFileSync(
		bin,
		`#!/bin/sh\n[ "$1" = "--version" ] && { echo "cccc 1.8.4"; exit 0; }\ncat "${join(root, "report.json")}"\nexit ${status}\n`,
	);
	chmodSync(bin, 0o755);
}

function runCheck(root: string, toml: string, stdout: string, status = 0) {
	writeFileSync(join(root, "cccc.toml"), toml);
	fakeBin(root, stdout, status);
	return spawnSync(process.execPath, ["scripts/cccc-check.ts"], {
		cwd: root,
		encoding: "utf8",
	});
}

const nested = report([
	{
		path: "src/a.ts",
		functions: [fn("outer", 3, 1, [fn("inner", 70, 1)])],
	},
]);

describe("limits() through the summary line", () => {
	const limitsOf = (toml: string) => {
		const run = runCheck(tempProject(), toml, JSON.stringify(nested));
		assert.equal(run.status, 0, run.stderr);
		return run.stdout.match(/limits (\S+)/)?.[1];
	};

	test("reads both keys", () => {
		assert.equal(
			limitsOf("max-cognitive = 40\nmax-cyclomatic = 30\n"),
			"40/30",
		);
	});

	test("reports a missing key as none", () => {
		assert.equal(limitsOf("max-cognitive = 40\n"), "40/none");
		assert.equal(limitsOf("max-cyclomatic = 30\n"), "none/30");
	});

	test("accepts a trailing comment, as calibration.md recommends", () => {
		assert.equal(
			limitsOf("max-cognitive = 65  # target 40\nmax-cyclomatic=30 # x\n"),
			"65/30",
		);
	});
});

describe("offender detection", () => {
	test("names an over-limit function nested in children", () => {
		const run = runCheck(
			tempProject(),
			"max-cognitive = 40\n",
			JSON.stringify(nested),
			1,
		);
		assert.equal(run.status, 1);
		assert.match(run.stderr, /cognitive 70 > 40 {2}src\/a\.ts:1 {2}inner/);
		assert.doesNotMatch(run.stderr, /outer/);
	});

	test("falls back to a generic message when nothing is over the limit", () => {
		const run = runCheck(
			tempProject(),
			"max-cognitive = 99\n",
			JSON.stringify(nested),
			1,
		);
		assert.equal(run.status, 1);
		assert.match(run.stderr, /a complexity threshold was exceeded/);
	});

	test("flags a cyclomatic offender with both reasons", () => {
		const bad = report([{ path: "b.ts", functions: [fn("f", 50, 50)] }]);
		const run = runCheck(
			tempProject(),
			"max-cognitive = 40\nmax-cyclomatic = 40\n",
			JSON.stringify(bad),
			1,
		);
		assert.match(run.stderr, /cognitive 50 > 40, cyclomatic 50 > 40/);
	});
});

describe("exit codes", () => {
	test("0 when cccc passes", () => {
		const run = runCheck(
			tempProject(),
			"max-cognitive = 80\n",
			JSON.stringify(nested),
		);
		assert.equal(run.status, 0);
		assert.match(run.stdout, /^cccc {2}1 files, 3 functions/);
	});

	test("2 on malformed JSON", () => {
		const run = runCheck(tempProject(), "", "{not json");
		assert.equal(run.status, 2);
		assert.match(run.stderr, /output was not JSON/);
	});

	test("2 on JSON that is not a report", () => {
		const run = runCheck(tempProject(), "", JSON.stringify({ files: [] }));
		assert.equal(run.status, 2);
		assert.match(run.stderr, /did not match the expected report/);
	});

	test("2 when cccc itself exits 2", () => {
		const run = runCheck(tempProject(), "", "", 2);
		assert.equal(run.status, 2);
	});

	test("skips with exit 0 when there is no binary", () => {
		const root = tempProject();
		writeFileSync(join(root, "cccc.toml"), "");
		// An installer that installs nothing, as on an unsupported platform.
		writeFileSync(join(root, "scripts/cccc-install.ts"), "");
		const run = spawnSync(process.execPath, ["scripts/cccc-check.ts"], {
			cwd: root,
			encoding: "utf8",
		});
		assert.equal(run.status, 0);
		assert.match(run.stderr, /no binary for this platform; skipped/);
	});
});

describe("cccc-install", () => {
	const preload = (platform: string, arch: string, body: string) => `
Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
Object.defineProperty(process, "arch", { value: ${JSON.stringify(arch)} });
globalThis.fetch = async (url) => {
	const body = (${body})(String(url));
	return body === undefined
		? new Response("", { status: 404 })
		: new Response(body);
};
`;

	function runInstall(
		root: string,
		platform: string,
		arch: string,
		body: string,
	) {
		writeFileSync(join(root, "preload.mjs"), preload(platform, arch, body));
		return spawnSync(
			process.execPath,
			["--import", "./preload.mjs", "scripts/cccc-install.ts"],
			{ cwd: root, encoding: "utf8" },
		);
	}

	test("skips an unsupported platform with a warning and exit 0", () => {
		const root = tempProject();
		// fetch answers 404, so reaching it would fail the run.
		const run = runInstall(root, "win32", "x64", "() => undefined");
		assert.equal(run.status, 0, run.stderr);
		assert.match(run.stderr, /no release binary for win32-x64; skipped/);
		assert.equal(existsSync(join(root, "node_modules/.bin/cccc")), false);
	});

	test("downloads the triple for each supported platform", () => {
		for (const [platform, arch, triple] of [
			["darwin", "arm64", "aarch64-apple-darwin"],
			["darwin", "x64", "x86_64-apple-darwin"],
			["linux", "arm64", "aarch64-unknown-linux-musl"],
			["linux", "x64", "x86_64-unknown-linux-musl"],
		]) {
			const root = tempProject();
			const run = runInstall(
				root,
				platform,
				arch,
				"(url) => { console.error('GET ' + url); }",
			);
			assert.equal(run.status, 1);
			assert.ok(
				run.stderr.includes(
					`releases/download/v1.8.4/cccc-v1.8.4-${triple}.tar.gz`,
				),
				run.stderr,
			);
		}
	});

	test("fails on a checksum mismatch and installs nothing", () => {
		const root = tempProject();
		const wrong = "0".repeat(64);
		const run = runInstall(
			root,
			"linux",
			"x64",
			`(url) => url.endsWith(".sha256") ? "${wrong}  file\\n" : "archive bytes"`,
		);
		assert.notEqual(run.status, 0);
		assert.match(
			run.stderr,
			/checksum mismatch for cccc-v1\.8\.4-x86_64-unknown-linux-musl\.tar\.gz/,
		);
		assert.equal(existsSync(join(root, "node_modules/.bin/cccc")), false);
	});

	test("fails when the checksum file holds no hash", () => {
		const run = runInstall(
			tempProject(),
			"linux",
			"x64",
			`(url) => url.endsWith(".sha256") ? "not a hash" : "archive bytes"`,
		);
		assert.notEqual(run.status, 0);
		assert.match(run.stderr, /holds no SHA-256 hash/);
	});

	test("installs the binary when the checksum matches", () => {
		const root = tempProject();
		const src = mkdtempSync(join(tmpdir(), "cccc-src-"));
		roots.push(src);
		writeFileSync(join(src, "cccc"), "#!/bin/sh\necho cccc 1.8.4\n");
		const archive = join(src, "a.tar.gz");
		const tar = spawnSync("tar", ["-czf", archive, "-C", src, "cccc"]);
		assert.equal(tar.status, 0);
		const bytes = spawnSync("base64", ["-w0", archive], {
			encoding: "utf8",
		}).stdout;
		const hash = createHash("sha256")
			.update(Buffer.from(bytes, "base64"))
			.digest("hex");
		const run = runInstall(
			root,
			"linux",
			"x64",
			`(url) => url.endsWith(".sha256") ? "${hash}  a\\n" : Buffer.from("${bytes}", "base64")`,
		);
		assert.equal(run.status, 0, run.stderr);
		assert.match(run.stdout, /installed cccc 1\.8\.4/);
		assert.ok(existsSync(join(root, "node_modules/.bin/cccc")));
	});
});
