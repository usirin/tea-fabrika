import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Exit, Layer, Redacted, Stream} from "effect";
import {afterAll, describe, expect, it} from "vitest";
import {layerOs} from "./os.ts";
import {envOf, type Job, layerNone, Sandbox, type SandboxError, type Workspace} from "./sandbox.ts";

// The Sandbox service in both versions, on made-up keys only. What the sandbox
// is handed, what it refuses to start, and, for `os`, what it can and cannot
// reach. The planted `env | curl` line over every stage's sandbox is in the
// pipeline (packages/pipeline/src/sandboxes.test.ts).

const KEY = "fake-github-key-for-this-test";
const parent = {PATH: process.env.PATH, LANG: "C", GH_TOKEN: KEY, SECRET_THING: "kept-out"};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-test-")));
const copy = join(scratch, "copy");
/** Stands for where gh keeps its login: outside every sandbox. */
const elsewhere = join(scratch, "elsewhere");
afterAll(() => rmSync(scratch, {recursive: true, force: true}));

const prepare = () => {
	for (const dir of [copy, elsewhere]) {
		rmSync(dir, {recursive: true, force: true});
		mkdirSync(dir);
	}
};

const sh = (script: string, more: Partial<Job> = {}): Job => ({
	command: "/bin/sh",
	args: ["-c", script],
	reads: [],
	env: {},
	mount: {_tag: "none"},
	credential: {_tag: "none"},
	...more,
});

const SANDBOXES = {
	none: layerNone({parent}).pipe(Layer.provide(nodeServices)),
	os: layerOs({parent}).pipe(Layer.provide(nodeServices)),
} as const;

/** Run a job in a sandbox: what it printed and its exit code, or the refusal. */
const run = (kind: keyof typeof SANDBOXES, job: Job) =>
	Effect.gen(function* () {
		const sandbox = yield* Sandbox;
		const handle = yield* sandbox.start(job);
		const [out, err] = yield* Effect.all(
			[
				handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
				handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
			],
			{concurrency: 2},
		);
		return {out, err, code: Number(yield* handle.exitCode)};
	}).pipe(Effect.scoped, Effect.provide(SANDBOXES[kind]), Effect.runPromiseExit);

const refusal = async (kind: keyof typeof SANDBOXES, job: Job) => {
	const exit = await run(kind, job);
	if (Exit.isSuccess(exit)) throw new Error("the sandbox started");
	const failed = exit.cause.reasons.find((r) => r._tag === "Fail");
	return (failed as {error: SandboxError} | undefined)?.error;
};

const osRuns = Exit.isSuccess(await run("os", sh("exit 0")));
if (process.env.CI !== undefined && !osRuns) throw new Error("sandbox-runtime cannot start on CI");

describe("the sandbox's environment", () => {
	const workspace: Workspace = {root: "/b", home: "/b/home", tmp: "/b/tmp", work: "/b/work"};

	it("holds the run names, its own home and temp folder, and nothing else of the host's", () => {
		expect(envOf(sh(""), workspace, {...parent, PATH: "/usr/bin:/bin"})).toEqual({
			PATH: "/usr/bin:/bin",
			LANG: "C",
			HOME: "/b/home",
			TMPDIR: "/b/tmp",
		});
	});

	// Under the box's own home a Volta shim finds no tools. It then looks along the PATH, finds itself,
	// and waits on each child it starts: thousands of processes, or "Could not download" in a repo
	// with a Volta pin. No box starts here: the environment is the whole fix.
	it("keeps where Volta holds the real tools, set or read from the PATH", () => {
		const shim = "/o/.volta/bin:/usr/bin:/bin";
		expect(envOf(sh(""), workspace, {PATH: shim, VOLTA_HOME: "/set/volta"})).toMatchObject({
			HOME: "/b/home",
			VOLTA_HOME: "/set/volta",
		});
		expect(envOf(sh(""), workspace, {PATH: shim})).toMatchObject({
			HOME: "/b/home",
			VOLTA_HOME: "/o/.volta",
		});
	});

	it("does not let a job's own names replace where Volta holds the tools", () => {
		const job = sh("", {env: {VOLTA_HOME: "/h"}});
		expect(envOf(job, workspace, {PATH: "/o/.volta/bin", VOLTA_HOME: "/o/.volta"})).toMatchObject({
			VOLTA_HOME: "/o/.volta",
		});
	});

	it("holds the credential it is lent, and a job's own names cannot replace the sandbox's", () => {
		const claude = sh("", {
			credential: {_tag: "claude", token: Redacted.make("model-login")},
			env: {HOME: "/somewhere", MODE: "plan"},
		});
		expect(envOf(claude, workspace, parent)).toMatchObject({
			HOME: "/b/home",
			MODE: "plan",
			CLAUDE_CODE_OAUTH_TOKEN: "model-login",
		});
		const codex = sh("", {credential: {_tag: "codex", auth: Redacted.make("{}")}});
		expect(envOf(codex, workspace, parent)).toMatchObject({CODEX_HOME: "/b/home/.codex"});
	});
});

describe.each(["none", "os"] as const)("the %s sandbox", (kind) => {
	const ready = kind === "none" || osRuns;

	it.skipIf(!ready)("is handed no key the host holds, under any name", async () => {
		const exit = await run(kind, sh("env"));
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		// The whole answer, so a sandbox that fails says why.
		expect(exit.value).toMatchObject({code: 0, err: ""});
		expect(exit.value.out).not.toContain(KEY);
		expect(exit.value.out).not.toContain("kept-out");
		expect(exit.value.out).toMatch(/^HOME=.*sandbox-.*home$/m);
	});

	it.skipIf(!ready)("refuses a job that names a GitHub key", async () => {
		const error = await refusal(kind, sh("true", {env: {GH_TOKEN: "anything"}}));
		expect(error?.why).toBe("key_in_sandbox");
		expect(error?.what).toBe("GH_TOKEN");
	});

	it.skipIf(!ready)(
		"refuses the host's key under another name, in an argument, or in a credential",
		async () => {
			const named = await refusal(kind, sh("true", {env: {HARMLESS: `x${KEY}x`}}));
			expect([named?.why, named?.what]).toEqual(["key_in_sandbox", "HARMLESS"]);
			const arg = await refusal(kind, sh(`echo ${KEY}`));
			expect(arg?.why).toBe("key_in_sandbox");
			expect(arg?.what).toMatch(/^argument /);
			const credential = await refusal(
				kind,
				sh("true", {credential: {_tag: "claude", token: Redacted.make(KEY)}}),
			);
			expect([credential?.why, credential?.what]).toEqual([
				"key_in_sandbox",
				"CLAUDE_CODE_OAUTH_TOKEN",
			]);
			// The error names where, never the value.
			expect(JSON.stringify([named, arg, credential])).not.toContain(KEY);
		},
	);

	it.skipIf(!ready)(
		"lends a Codex credential as a file, and takes it back with the sandbox",
		async () => {
			const exit = await run(
				kind,
				sh('cat "$CODEX_HOME/auth.json"; echo; echo "$HOME"', {
					credential: {_tag: "codex", auth: Redacted.make('{"lent": true}')},
				}),
			);
			if (!Exit.isSuccess(exit)) throw new Error("did not start");
			const [auth, home = ""] = exit.value.out.trim().split("\n");
			expect(auth).toBe('{"lent": true}');
			expect(existsSync(home)).toBe(false);
		},
	);
});

describe.skipIf(!osRuns)("the os sandbox's fence", () => {
	it("reads and writes the worktree mounted in it, and cannot read a file beside it", async () => {
		prepare();
		writeFileSync(join(copy, "code.txt"), "the code\n");
		writeFileSync(join(elsewhere, "hosts.yml"), `token: ${KEY}\n`);
		const exit = await run(
			"os",
			sh(`cat code.txt; echo changed > code.txt; cat ${join(elsewhere, "hosts.yml")}`, {
				mount: {_tag: "worktree", folder: copy},
			}),
		);
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		expect(exit.value.out).toBe("the code\n");
		// Seatbelt says "not permitted"; bubblewrap hides the folder, so "no such file".
		expect(exit.value.err).toMatch(/not permitted|denied|no such file/i);
		expect(exit.value.code).not.toBe(0);
		expect(readFileSync(join(copy, "code.txt"), "utf8")).toBe("changed\n");
	});

	it("reads a commit mounted in it and cannot change it", async () => {
		prepare();
		writeFileSync(join(copy, "code.txt"), "the commit\n");
		const exit = await run(
			"os",
			sh("cat code.txt; echo changed > code.txt", {mount: {_tag: "commit", folder: copy}}),
		);
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		expect(exit.value.out).toBe("the commit\n");
		expect(readFileSync(join(copy, "code.txt"), "utf8")).toBe("the commit\n");
	});

	// The repository's own files are not the sandbox's. On CI, as on most laptops, it is under home.
	const file = join(import.meta.dirname, "..", "..", "..", "..", "package.json");
	it.skipIf(!file.startsWith(homedir()))("mounting nothing, reads no file under home", async () => {
		expect(existsSync(file)).toBe(true);
		const exit = await run("os", sh(`cat ${file}`));
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		expect(exit.value.out).toBe("");
		expect(exit.value.code).not.toBe(0);
	});

	it("refuses a job whose reads would open the home folder", async () => {
		const error = await refusal("os", sh("true", {reads: [homedir()]}));
		expect([error?.why, error?.what]).toEqual(["opens_home", homedir()]);
	});

	it("hands a Volta shim its home in the real box, so it does not chain", async () => {
		prepare();
		const bin = join(elsewhere, ".volta", "bin");
		mkdirSync(bin, {recursive: true});
		// Stands for Volta's shim, and stops itself: a chain shows as exit 99, never as a runaway.
		const shim = join(bin, "tool");
		writeFileSync(
			shim,
			[
				"#!/bin/sh",
				`[ "$VOLTA_HOME" = "${join(elsewhere, ".volta")}" ] && exit 0`,
				"HOPS=$((HOPS + 1))",
				'[ "$HOPS" -gt 3 ] && exit 99',
				"export HOPS; tool; exit $?",
			].join("\n"),
			{mode: 0o755},
		);
		const box = layerOs({parent: {PATH: `${bin}:/usr/bin:/bin`}}).pipe(Layer.provide(nodeServices));
		const code = await Effect.gen(function* () {
			const sandbox = yield* Sandbox;
			const handle = yield* sandbox.start(
				sh("tool", {reads: [elsewhere], mount: {_tag: "worktree", folder: copy}}),
			);
			return Number(yield* handle.exitCode);
		}).pipe(Effect.scoped, Effect.provide(box), Effect.runPromise);
		expect(code).toBe(0);
	});
});
