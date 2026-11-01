// A toy repository a lane can run on, and a home that points at it, for tests and the end-to-end
// run. Everything lands under `dir`: a bare remote, a home with its `pipeline.json`, and a Codex home
// with a fake login that holds no secret. `nodeModules`: an install holding vitest and tsc.

import {execFileSync} from "node:child_process";
import {chmodSync, mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

const FAKE_CODEX = fileURLToPath(
	new URL("../../../../../fixtures/pipeline-lane/codex.mjs", import.meta.url),
);

/** The env a run needs so nothing reaches a real login: the fake's own home and Codex home. */
export const fakeEnv = (dir: string) => ({
	HOME: join(dir, "user"),
	CODEX_HOME: join(dir, "user", ".codex"),
});

export function makeLaneHome({
	dir,
	nodeModules,
	reads = [],
}: {
	readonly dir: string;
	readonly nodeModules: string;
	readonly reads?: readonly string[];
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
	put(".gitignore", "node_modules\n.done\n");
	put(".fabrika.jsonc", "{}\n");
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
	put(
		"fabrika.toml",
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
			"[review]",
			'rubrics = "docs/rubrics"',
			"",
			"[[checks.run]]",
			'name = "test"',
			`run = ["sh", "-c", ${JSON.stringify(`${link} && node_modules/.bin/vitest run`)}]`,
			"",
		].join("\n"),
	);
	git(seed, "add", "-A");
	git(seed, "commit", "--quiet", "-m", "first");
	git(seed, "remote", "add", "origin", remote);
	git(seed, "push", "--quiet", "origin", "main");

	writeFileSync(
		join(home, "pipeline.json"),
		JSON.stringify({repo: "example/lane", remote, host: "local", codex}),
	);
	return {home, remote};
}
