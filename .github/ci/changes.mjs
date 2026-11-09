// Today's CI for both versions. No installed dependencies: changes and field can
// decide what to run before pnpm setup or cache restoration.
import {spawnSync} from "node:child_process";
import {appendFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

/** @typedef {{check: boolean, test: boolean, next: boolean, e2e: boolean, field: boolean}} Flags */
/** @typedef {(args: string[]) => {status: number | null, stdout: string}} Runner */
const all = {check: true, test: true, next: true, e2e: true, field: true};
const today = ["apps/", "programs/", "packs/", "wip/", "legacy/", "packages/"];
const helper = "next/apps/fabrika/src/exam/plant.ts";
/** @param {string} path */
const rows = (path) => /^field\/[^/]+\.jsonl$/.test(path);
/** @param {string} path */
const markdown = (path) =>
	path.endsWith(".md") &&
	![".agents/skills/", ".claude/skills/"].some((tree) => path.startsWith(tree));
/** @param {string} path */
const safe = (path) => rows(path) || markdown(path);
/** @param {string} path */
const old = (path) =>
	today.some((tree) => path.startsWith(tree)) && !path.startsWith("packages/fabrika-design/");

/**
 * A PR skips a job only when every path is explicitly safe for that job.
 * Amendment 3: field's runner starts on every event; this flag gates its install
 * and row check, so Markdown in field/ alone does not install Effect.
 * @param {readonly string[] | null} paths
 * @param {string} event
 * @returns {Flags}
 */
export const classify = (paths, event) => {
	if (event !== "pull_request" || paths === null || paths.length === 0) return {...all};
	return {
		check: !paths.every(safe),
		test: !paths.every((path) => safe(path) || (path.startsWith("next/") && path !== helper)),
		next: !paths.every((path) => safe(path) || old(path)),
		e2e: !paths.every((path) => safe(path) || path.startsWith("next/")),
		field: paths.some(rows),
	};
};

/** @param {string} sha */
export const validSha = (sha) => /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha);
/** @type {Runner} */
const git = (args) => spawnSync("git", args, {encoding: "utf8", maxBuffer: 2 ** 28});

/**
 * No shell interpolation. PR paths start at the merge base; pushes use before.
 * A rename is a deletion and an addition. NUL preserves all legal Git names.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} [run]
 * @returns {string[] | null}
 */
export const readPaths = (base, head, event, run = git) => {
	if (!validSha(base) || !validSha(head)) return null;
	let from = base;
	if (event === "pull_request") {
		const merged = run(["merge-base", base, head]);
		from = merged.stdout.trim();
		if (merged.status !== 0 || !validSha(from)) return null;
	}
	const diff = run(["diff", "--no-renames", "--name-only", "-z", from, head, "--"]);
	if (diff.status !== 0 || (diff.stdout !== "" && !diff.stdout.endsWith("\0"))) return null;
	return diff.stdout === "" ? [] : diff.stdout.slice(0, -1).split("\0");
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const event = process.env["EVENT"] ?? "";
	const paths = readPaths(process.env["BASE"] ?? "", process.env["HEAD"] ?? "", event);
	const flags = classify(paths, event);
	const output = `${Object.entries(flags)
		.map(([job, enabled]) => `${job}=${enabled}`)
		.join("\n")}\n`;
	process.stdout.write(output);
	const file = process.env["GITHUB_OUTPUT"];
	if (file) appendFileSync(file, output);
	if (paths === null) {
		console.error("changes: history could not be read; every job is enabled");
		process.exitCode = 1;
	}
}
