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
import {envOf, type Job, layerNone, type Room, Sandbox, type SandboxError} from "./sandbox.ts";

// The Sandbox service in both versions, on made-up keys only. What the box is
// handed, what it refuses to start, and, for `os`, what it can and cannot
// reach. The planted `env | curl` line over every stage's box is in the
// pipeline (packages/pipeline/src/boxes.test.ts).

const KEY = "fake-github-key-for-this-test";
const parent = {PATH: process.env.PATH, LANG: "C", GH_TOKEN: KEY, SECRET_THING: "kept-out"};

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sandbox-test-")));
const copy = join(scratch, "copy");
/** Stands for where gh keeps its login: outside every box. */
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
	holds: {_tag: "nothing"},
	login: {_tag: "none"},
	...more,
});

const BOXES = {
	none: layerNone({parent}).pipe(Layer.provide(nodeServices)),
	os: layerOs({parent}).pipe(Layer.provide(nodeServices)),
} as const;

/** Run a job in a box: what it printed and its exit code, or the refusal. */
const run = (box: keyof typeof BOXES, job: Job) =>
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
	}).pipe(Effect.scoped, Effect.provide(BOXES[box]), Effect.runPromiseExit);

const refusal = async (box: keyof typeof BOXES, job: Job) => {
	const exit = await run(box, job);
	if (Exit.isSuccess(exit)) throw new Error("the box started");
	const failed = exit.cause.reasons.find((r) => r._tag === "Fail");
	return (failed as {error: SandboxError} | undefined)?.error;
};

const osRuns = Exit.isSuccess(await run("os", sh("exit 0")));
if (process.env.CI !== undefined && !osRuns) throw new Error("sandbox-runtime cannot start on CI");

describe("the box's environment", () => {
	const room: Room = {root: "/b", home: "/b/home", tmp: "/b/tmp", work: "/b/work"};

	it("holds the run names, its own home and temp folder, and nothing else of the host's", () => {
		expect(envOf(sh(""), room, parent)).toEqual({
			PATH: parent.PATH,
			LANG: "C",
			HOME: "/b/home",
			TMPDIR: "/b/tmp",
		});
	});

	it("holds the login it is lent, and a job's own names cannot replace the box's", () => {
		const claude = sh("", {
			login: {_tag: "claude", token: Redacted.make("model-login")},
			env: {HOME: "/somewhere", MODE: "plan"},
		});
		expect(envOf(claude, room, parent)).toMatchObject({
			HOME: "/b/home",
			MODE: "plan",
			CLAUDE_CODE_OAUTH_TOKEN: "model-login",
		});
		const codex = sh("", {login: {_tag: "codex", auth: Redacted.make("{}")}});
		expect(envOf(codex, room, parent)).toMatchObject({CODEX_HOME: "/b/home/.codex"});
	});
});

describe.each(["none", "os"] as const)("the %s box", (box) => {
	const ready = box === "none" || osRuns;

	it.skipIf(!ready)("is handed no key the host holds, under any name", async () => {
		const exit = await run(box, sh("env"));
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		// The whole answer, so a box that fails says why.
		expect(exit.value).toMatchObject({code: 0, err: ""});
		expect(exit.value.out).not.toContain(KEY);
		expect(exit.value.out).not.toContain("kept-out");
		expect(exit.value.out).toMatch(/^HOME=.*box-.*home$/m);
	});

	it.skipIf(!ready)("refuses a job that names a GitHub key", async () => {
		const error = await refusal(box, sh("true", {env: {GH_TOKEN: "anything"}}));
		expect(error?.why).toBe("key_in_box");
		expect(error?.what).toBe("GH_TOKEN");
	});

	it.skipIf(!ready)(
		"refuses the host's key under another name, in an argument, or in a login",
		async () => {
			const named = await refusal(box, sh("true", {env: {HARMLESS: `x${KEY}x`}}));
			expect([named?.why, named?.what]).toEqual(["key_in_box", "HARMLESS"]);
			const arg = await refusal(box, sh(`echo ${KEY}`));
			expect(arg?.why).toBe("key_in_box");
			expect(arg?.what).toMatch(/^argument /);
			const login = await refusal(
				box,
				sh("true", {login: {_tag: "claude", token: Redacted.make(KEY)}}),
			);
			expect([login?.why, login?.what]).toEqual(["key_in_box", "CLAUDE_CODE_OAUTH_TOKEN"]);
			// The error names where, never the value.
			expect(JSON.stringify([named, arg, login])).not.toContain(KEY);
		},
	);

	it.skipIf(!ready)("lends a Codex login as a file, and takes it back with the box", async () => {
		const exit = await run(
			box,
			sh('cat "$CODEX_HOME/auth.json"; echo; echo "$HOME"', {
				login: {_tag: "codex", auth: Redacted.make('{"lent": true}')},
			}),
		);
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		const [auth, home = ""] = exit.value.out.trim().split("\n");
		expect(auth).toBe('{"lent": true}');
		expect(existsSync(home)).toBe(false);
	});
});

describe.skipIf(!osRuns)("the os box's fence", () => {
	it("reads and writes the copy it holds, and cannot read a file beside it", async () => {
		prepare();
		writeFileSync(join(copy, "code.txt"), "the code\n");
		writeFileSync(join(elsewhere, "hosts.yml"), `token: ${KEY}\n`);
		const exit = await run(
			"os",
			sh(`cat code.txt; echo changed > code.txt; cat ${join(elsewhere, "hosts.yml")}`, {
				holds: {_tag: "code", folder: copy},
			}),
		);
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		expect(exit.value.out).toBe("the code\n");
		// Seatbelt says "not permitted"; bubblewrap hides the folder, so "no such file".
		expect(exit.value.err).toMatch(/not permitted|denied|no such file/i);
		expect(exit.value.code).not.toBe(0);
		expect(readFileSync(join(copy, "code.txt"), "utf8")).toBe("changed\n");
	});

	it("reads a commit it holds and cannot change it", async () => {
		prepare();
		writeFileSync(join(copy, "code.txt"), "the commit\n");
		const exit = await run(
			"os",
			sh("cat code.txt; echo changed > code.txt", {holds: {_tag: "commit", folder: copy}}),
		);
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		expect(exit.value.out).toBe("the commit\n");
		expect(readFileSync(join(copy, "code.txt"), "utf8")).toBe("the commit\n");
	});

	it("holding nothing, reads no file under the home folder", async () => {
		const exit = await run("os", sh(`ls ${homedir()}`));
		if (!Exit.isSuccess(exit)) throw new Error("did not start");
		// Seatbelt refuses the listing; bubblewrap shows an empty folder. Either way, no name.
		expect(exit.value.out).toBe("");
	});

	it("refuses a job whose reads would open the home folder", async () => {
		const error = await refusal("os", sh("true", {reads: [homedir()]}));
		expect([error?.why, error?.what]).toEqual(["opens_home", homedir()]);
	});
});
