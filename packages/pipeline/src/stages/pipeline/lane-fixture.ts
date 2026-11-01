// A toy repository a lane can run on, and a home that points at it, for tests and the end-to-end
// run. Everything lands under `dir`: a bare remote, a home with its `pipeline.json`, and a Codex home
// with a fake login that holds no secret. `nodeModules`: an install holding vitest and tsc.

import {execFileSync} from "node:child_process";
import {chmodSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Schema} from "effect";

const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

const FAKE_CODEX = fileURLToPath(
	new URL("../../../../../fixtures/pipeline-lane/codex.mjs", import.meta.url),
);
const FAKE_GH = fileURLToPath(
	new URL("../../../../../fixtures/pipeline-lane/gh.mjs", import.meta.url),
);

/** The repository a toy lane names. Nothing reads this name on a real code host. */
export const LANE_REPO = "example/lane";

/** The env a run needs so nothing reaches a real login: the fake's own home and Codex home. */
export const fakeEnv = (dir: string) => ({
	HOME: join(dir, "user"),
	CODEX_HOME: join(dir, "user", ".codex"),
});

export function makeLaneHome({
	dir,
	nodeModules,
	reads = [],
	host = "local",
	rubrics = "docs/rubrics",
	github,
	mainFiles = [],
	alsoCheck,
}: {
	readonly dir: string;
	readonly nodeModules: string;
	readonly reads?: readonly string[];
	/** What `pipeline.json` says. `github`: put a stand-in `gh` on the path first (`makeFakeGh`). */
	readonly host?: "local" | "github";
	/** `[review] rubrics`. `null`: the file leaves the table out. */
	readonly rubrics?: string | null;
	/** `[checks] github`. Left out: the file does not say. */
	readonly github?: "every" | "required" | "none";
	/** More files on main from the first commit. */
	readonly mainFiles?: readonly {readonly path: string; readonly text: string}[];
	/** One more `[[checks.run]]`: `sh -c <this>`. */
	readonly alsoCheck?: string;
}) {
	const git = (cwd: string, ...args: readonly string[]) =>
		execFileSync("git", args, {cwd, env: {...process.env, ...IDENTITY}, stdio: "pipe"});
	const remote = join(dir, "remote.git");
	const seed = join(dir, "seed");
	const home = join(dir, "home");
	mkdirSync(remote, {recursive: true});
	mkdirSync(seed, {recursive: true});
	mkdirSync(home, {recursive: true});
	mkdirSync(join(dir, "user", ".codex"), {recursive: true});
	writeFileSync(join(dir, "user", ".codex", "auth.json"), '{"auth_mode": "chatgpt"}\n');
	chmodSync(FAKE_CODEX, 0o755);
	const codex = join(dir, "codex");
	writeFileSync(
		codex,
		`#!/bin/sh\nFAKE_CODEX_LOG=${JSON.stringify(join(dir, "codex.log"))} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_CODEX)} "$@"\n`,
	);
	chmodSync(codex, 0o755);

	git(remote, "init", "--quiet", "--bare", "--initial-branch=main");
	git(seed, "init", "--quiet", "--initial-branch=main");
	const put = (path: string, text: string) => {
		const to = join(seed, path);
		mkdirSync(join(to, ".."), {recursive: true});
		writeFileSync(to, text);
	};
	const link = `ln -s ${nodeModules} node_modules`;
	put(".gitignore", "node_modules\n");
	put(
		"tsconfig.json",
		`${JSON.stringify(
			{
				compilerOptions: {
					target: "es2024",
					module: "nodenext",
					moduleResolution: "nodenext",
					allowImportingTsExtensions: true,
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["src"],
			},
			null,
			2,
		)}\n`,
	);
	put(
		"src/slug.ts",
		'export function slug(name: string): string {\n\treturn name.replaceAll(" ", "-");\n}\n',
	);
	put(
		"src/slug.test.ts",
		'import {expect, it} from "vitest";\nimport {slug} from "./slug.ts";\n\nit("cuts on spaces", () => {\n\texpect(slug("a b")).toBe("a-b");\n});\n',
	);
	put("docs/rubrics/code.md", "Code that does what its ticket says.\n");
	put("docs/rubrics/doc.md", "Words that say what is true.\n");
	put("docs/rubrics/skill.md", "A skill that does one job.\n");
	for (const {path, text} of mainFiles) put(path, text);
	put(
		".fabrika/fabrika.toml",
		[
			"[agents.triage]",
			'harness = "codex"',
			'model = "gpt-6-astra"',
			'effort = "high"',
			"",
			"[build]",
			`install = ["ln", "-s", ${JSON.stringify(nodeModules)}, "node_modules"]`,
			'checks = [["node_modules/.bin/vitest", "run"]]',
			"",
			"[test_writer]",
			'includes = ["**/*.test.ts"]',
			'run = ["node_modules/.bin/vitest", "run", "--reporter=json", "--outputFile={out}"]',
			`reads = ${JSON.stringify([nodeModules, ...reads])}`,
			"",
			"[mutation]",
			'tests = ["node_modules/.bin/vitest", "run"]',
			'typecheck = ["node_modules/.bin/tsc", "--noEmit"]',
			"",
			...(rubrics === null ? [] : ["[review]", `rubrics = ${JSON.stringify(rubrics)}`, ""]),
			...(github === undefined ? [] : ["[checks]", `github = ${JSON.stringify(github)}`, ""]),
			"[[checks.run]]",
			'name = "test"',
			`run = ["sh", "-c", ${JSON.stringify(`${link} && node_modules/.bin/vitest run`)}]`,
			"",
			...(alsoCheck === undefined
				? []
				: [
						"[[checks.run]]",
						'name = "also"',
						`run = ["sh", "-c", ${JSON.stringify(alsoCheck)}]`,
						"",
					]),
		].join("\n"),
	);
	git(seed, "add", "-A");
	git(seed, "commit", "--quiet", "-m", "first");
	git(seed, "remote", "add", "origin", remote);
	git(seed, "push", "--quiet", "origin", "main");

	writeFileSync(
		join(home, "pipeline.json"),
		JSON.stringify({repo: LANE_REPO, remote, host, codex}),
	);
	return {home, remote, seed};
}

/** One check on GitHub, as the stand-in `gh` tells it. `ends`: how it ends once the checks settle. */
export interface FakeCheck {
	readonly name: string;
	readonly ends: "SUCCESS" | "FAILURE";
}

/** What the stand-in `gh` plays. Everything left out is a plain repository with no CI and no rules. */
export interface GhStory {
	/** Left out, or none: no check has reported, and GraphQL's rollup is `null`. */
	readonly checks?: readonly FakeCheck[];
	/** How many times the checks wait must ask before they finish. 0: finished from the start. */
	readonly settleAfter?: number;
	/** The base branch's rule. `refuses`: GitHub refuses the merge. `allows`: it merges by GitHub's own merge. */
	readonly rule?: "none" | "refuses" | "allows";
	/** A person pushes one more commit: at the first facts read, or just as the merge is about to be written. */
	readonly moveHeadAt?: "facts" | "merge_read";
	/**
	 * A person merges by hand, on a new head of theirs when `newHead`. `next_read`: after the lane first
	 * read the facts, before its next read. `merge_read`: just as the merge is about to be written.
	 */
	readonly mergedByAPerson?: {readonly newHead: boolean; readonly at: "next_read" | "merge_read"};
	/** The merge's ref moves, and GitHub has not marked the pull request merged by the end of the run. */
	readonly marksLate?: boolean;
	/** A fork has a pull request open from a branch of this name, into this repository. */
	readonly forkOn?: string;
	/** What `gh pr create` prints, in place of the new pull request's url. */
	readonly createSays?: string;
}

const GhCall = Schema.Struct({
	/** Which call it was: `pr_create`, `facts`, `ref_move` and so on. `unknown`: it was not known. */
	kind: Schema.String,
	/** Its arguments, with a query's text left out. */
	args: Schema.Array(Schema.String),
	/** GraphQL's rollup as the call left it. `null`: none reported. */
	rollup: Schema.NullOr(Schema.String),
	refused: Schema.Boolean,
	says: Schema.optional(Schema.String),
});
export type GhCall = typeof GhCall.Type;
const readCall = Schema.decodeUnknownSync(Schema.fromJsonString(GhCall));

const GhPull = Schema.Struct({
	number: Schema.Number,
	branch: Schema.String,
	state: Schema.Literals(["OPEN", "MERGED"]),
	mergedHead: Schema.NullOr(Schema.String),
	mergeCommit: Schema.NullOr(Schema.String),
	comments: Schema.Array(Schema.Struct({body: Schema.String})),
});
const readPulls = Schema.decodeUnknownSync(
	Schema.fromJsonString(Schema.Struct({pulls: Schema.Array(GhPull)})),
);

/**
 * A stand-in `gh` over the bare remote, in a folder of its own. `env` is what a test must stub: its
 * folder first on the path, and no login in reach, so a call that somehow found a real `gh` would
 * still have nothing to sign in with. Nothing here touches GitHub.
 */
export function makeFakeGh({
	dir,
	remote,
	story = {},
}: {
	readonly dir: string;
	readonly remote: string;
	readonly story?: GhStory;
}) {
	const folder = join(dir, "gh");
	const bin = join(dir, "bin");
	mkdirSync(folder, {recursive: true});
	mkdirSync(bin, {recursive: true});
	const state = join(folder, "state.json");
	const calls = join(folder, "calls.jsonl");
	const gh = join(bin, "gh");
	writeFileSync(
		state,
		JSON.stringify({
			repo: LANE_REPO,
			remote,
			story,
			pulls: [],
			checkReads: 0,
			factsReads: 0,
			attempt: 1,
			moved: false,
			handMerged: false,
		}),
	);
	writeFileSync(calls, "");
	writeFileSync(
		gh,
		`#!/bin/sh\nFAKE_GH_DIR=${JSON.stringify(folder)} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE_GH)} "$@"\n`,
	);
	chmodSync(gh, 0o755);
	return {
		gh,
		env: {
			PATH: `${bin}:${process.env.PATH ?? ""}`,
			GH_CONFIG_DIR: folder,
			GH_TOKEN: "",
			GITHUB_TOKEN: "",
		},
		/** Every call so far, in order. */
		calls: (): readonly GhCall[] =>
			readFileSync(calls, "utf8")
				.split("\n")
				.filter((row) => row !== "")
				.map((row) => readCall(row)),
		pulls: () => readPulls(readFileSync(state, "utf8")).pulls,
	};
}
