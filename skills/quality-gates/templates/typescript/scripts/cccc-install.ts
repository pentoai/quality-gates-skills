/**
 * Install the pinned cccc binary into `node_modules/.bin`.
 *
 * cccc (https://github.com/moznion/cccc) is a release binary, not an npm package.
 * `prepare` runs this on install. The checksum is the one published with the release.
 * On a platform with no release binary (Windows), it skips with a warning so the install
 * still succeeds; CI runs cccc on Linux.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const version = "1.8.4";

const triples: Record<string, string> = {
	"darwin-arm64": "aarch64-apple-darwin",
	"darwin-x64": "x86_64-apple-darwin",
	"linux-arm64": "aarch64-unknown-linux-musl",
	"linux-x64": "x86_64-unknown-linux-musl",
};

function installedVersion(bin: string): string | null {
	if (!existsSync(bin)) return null;
	const result = spawnSync(bin, ["--version"], { encoding: "utf8" });
	const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	return text.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

async function download(url: string, dest: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
	writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseChecksum(text: string): string {
	const hash = text.trim().split(/\s+/)[0] ?? "";
	if (!/^[a-f0-9]{64}$/i.test(hash)) {
		throw new Error("the cccc checksum file holds no SHA-256 hash");
	}
	return hash.toLowerCase();
}

function extract(archive: string, into: string): void {
	mkdirSync(into);
	const tar = spawnSync("tar", ["-xzf", archive, "-C", into], {
		encoding: "utf8",
	});
	if (tar.status !== 0) {
		throw new Error(tar.stderr || "could not extract the cccc archive");
	}
}

const bin = join("node_modules", ".bin", "cccc");
const triple = triples[`${process.platform}-${process.arch}`];
if (!triple) {
	console.warn(
		`cccc ${version} has no release binary for ${process.platform}-${process.arch}; skipped`,
	);
} else if (installedVersion(bin) !== version) {
	const stem = `cccc-v${version}-${triple}`;
	const base = `https://github.com/moznion/cccc/releases/download/v${version}`;
	const dir = mkdtempSync(join(tmpdir(), "cccc-"));
	try {
		const archive = join(dir, `${stem}.tar.gz`);
		const checksum = join(dir, `${stem}.sha256`);
		await download(`${base}/${stem}.tar.gz`, archive);
		await download(`${base}/${stem}.sha256`, checksum);
		if (sha256(archive) !== parseChecksum(readFileSync(checksum, "utf8"))) {
			throw new Error(`checksum mismatch for ${stem}.tar.gz`);
		}
		const extracted = join(dir, "out");
		extract(archive, extracted);
		mkdirSync(dirname(bin), { recursive: true });
		copyFileSync(join(extracted, "cccc"), bin);
		chmodSync(bin, 0o755);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	console.log(`installed cccc ${version}`);
}
