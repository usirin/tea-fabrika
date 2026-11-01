import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Stream} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {formOf} from "../agent/core.ts";
import type {AdapterTurn} from "../agent/turn.ts";
import {codexAdapter, codexFolders, rawOfLine} from "./adapter.ts";

// A real `codex exec --json` says `error` while it reconnects, and goes on to finish the turn.
describe("what ends a Codex turn", () => {
	it("a mid-stream error event is a note, and only turn.failed ends the turn", () => {
		const line = (value: unknown) => rawOfLine(JSON.stringify(value));
		expect(line({type: "error", message: "Reconnecting... 1/5"})).toEqual([]);
		expect(line({type: "turn.failed", error: {message: "over the limit"}})).toMatchObject({
			broke: expect.stringContaining("over the limit"),
		});
	});
});

// The lane starts Codex by the bare name `codex`. Its folders must come from the PATH, as the
// system finds it, or the box closes the binary its own tools run from.
describe("the folders Codex's own binary runs from", () => {
	let owner: string;

	beforeEach(() => {
		owner = realpathSync(mkdtempSync(join(tmpdir(), "codex-folders-")));
	});
	afterEach(() => {
		rmSync(owner, {recursive: true, force: true});
	});

	const program = (path: string) => {
		mkdirSync(join(path, ".."), {recursive: true});
		writeFileSync(path, "");
		chmodSync(path, 0o755);
	};

	it("finds a bare name on the PATH, through its link", () => {
		const target = join(owner, ".codex/packages/standalone/1/codex");
		program(target);
		const bin = join(owner, ".local/bin");
		mkdirSync(bin, {recursive: true});
		symlinkSync(target, join(bin, "codex"));
		expect(codexFolders("codex", owner, {PATH: `/nowhere:${bin}`})).toEqual([
			bin,
			join(owner, ".codex/packages"),
		]);
	});

	it("never opens the folder this process runs in", () => {
		const folders = codexFolders("codex", owner, {PATH: "/nowhere"});
		expect(folders).not.toContain(".");
		expect(folders).toEqual([]);
	});

	it("takes the first match on the PATH", () => {
		const first = join(owner, "first/bin");
		const second = join(owner, "second/bin");
		program(join(first, "codex"));
		program(join(second, "codex"));
		expect(codexFolders("codex", owner, {PATH: `${first}:${second}`})).toEqual([
			first,
			join(owner, "first"),
		]);
	});

	it("skips a PATH entry that is not absolute, which would mean this process's folder", () => {
		expect(codexFolders("codex", owner, {PATH: ".:bin"})).toEqual([]);
	});

	it("keeps a path it is given", () => {
		const given = join(owner, "tools/bin/codex");
		program(given);
		expect(codexFolders(given, owner, {PATH: ""})).toEqual([
			join(owner, "tools/bin"),
			join(owner, "tools"),
		]);
	});
});

// `codex exec ... -` and `codex exec resume ... <id> -` read the prompt from stdin (real Codex 0.165.0,
// a 200 KB prompt too). An argument has a limit a prompt can pass: 128 KB for one on Linux, about 1 MB
// for all of them on a Mac. So the size here is over both, and a test holds on either system.
describe("how a prompt reaches Codex", () => {
	const OVER_EVERY_LIMIT = "Read names in one form, ß and ł too.\n".repeat(60_000);
	const ENDS_A_TURN = [
		`echo '{"type":"thread.started","thread_id":"t-1"}'`,
		`echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'`,
	].join("\n");

	let owner: string;

	beforeEach(() => {
		owner = realpathSync(mkdtempSync(join(tmpdir(), "codex-stdin-")));
		mkdirSync(join(owner, "copy"));
		mkdirSync(join(owner, ".codex"));
		writeFileSync(join(owner, ".codex", "auth.json"), '{"auth_mode": "chatgpt"}\n');
	});
	afterEach(() => {
		rmSync(owner, {recursive: true, force: true});
	});

	/** A stand-in Codex in a shell script. By default it keeps its arguments and stdin, then ends a turn. */
	const standIn = (script = `${KEEPS}\n${ENDS_A_TURN}`) => {
		const path = join(owner, "bin/codex");
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, `#!/bin/sh\n${script}\n`);
		chmodSync(path, 0o755);
		return path;
	};
	const KEEPS = `for arg in "$@"; do printf '%s\\0' "$arg"; done > "$0.args"\ncat > "$0.stdin"`;
	const argsOf = (codex: string) => readFileSync(`${codex}.args`, "utf8").split("\0").slice(0, -1);
	const stdinOf = (codex: string) => readFileSync(`${codex}.stdin`, "utf8");

	/** One turn on the real adapter, run through what Codex prints to the turn's end. */
	const turnOn = (codex: string, turn: Partial<AdapterTurn>) =>
		Effect.gen(function* () {
			const adapter = yield* codexAdapter({
				codex,
				parent: {PATH: "/usr/bin:/bin", HOME: owner, USER: "someone", TMPDIR: tmpdir()},
				access: "write",
			});
			const running = yield* adapter.start({
				folder: join(owner, "copy"),
				prompt: "Read names in one form.",
				system: {_tag: "append", text: ""},
				schema: {},
				resume: null,
				session: "s",
				model: null,
				effort: null,
				usd: null,
				...turn,
			});
			return yield* running.updates.pipe(
				Stream.takeUntil((raw) => raw._tag === "ended"),
				Stream.runCollect,
			);
		}).pipe(Effect.scoped, Effect.provide(nodeServices));

	it("a fresh turn: the prompt comes on stdin, and the arguments end in `-`", async () => {
		const codex = standIn();
		const prompt = "Read names in one form, ß too.";
		await Effect.runPromise(turnOn(codex, {prompt}));
		expect(stdinOf(codex)).toBe(prompt);
		const args = argsOf(codex);
		expect(args.at(-1)).toBe("-");
		expect(args).not.toContain("resume");
		expect(args.filter((arg) => arg.includes(prompt))).toEqual([]);
	});

	it("a resumed turn: the prompt comes on stdin, and the arguments end in the thread and `-`", async () => {
		const codex = standIn();
		const prompt = "What the last try got wrong.";
		await Effect.runPromise(turnOn(codex, {prompt, resume: "t-1"}));
		expect(stdinOf(codex)).toBe(prompt);
		const args = argsOf(codex);
		expect(args.slice(-3)).toEqual(["resume", "t-1", "-"]);
		expect(args.filter((arg) => arg.includes(prompt))).toEqual([]);
	});

	it("a schema strict mode refuses: its form comes on stdin with the prompt", async () => {
		const codex = standIn();
		const prompt = "Read names in one form.";
		const schema = {type: "object", properties: {note: {type: "string"}}};
		await Effect.runPromise(turnOn(codex, {prompt, schema}));
		expect(stdinOf(codex)).toBe(`${prompt}\n${formOf(schema)}`);
		const args = argsOf(codex);
		expect(args.at(-1)).toBe("-");
		expect(args).not.toContain("--output-schema");
	});

	it.each<[string, string | null]>([
		["fresh", null],
		["resumed", "t-1"],
	])("a prompt over every system's argument limit reaches a %s turn whole", async (_, resume) => {
		const codex = standIn();
		await Effect.runPromise(turnOn(codex, {prompt: OVER_EVERY_LIMIT, resume}));
		const seen = stdinOf(codex);
		// Not `toBe`: on a miss it would print a diff of two megabytes.
		expect(Buffer.byteLength(seen)).toBe(Buffer.byteLength(OVER_EVERY_LIMIT));
		expect(seen === OVER_EVERY_LIMIT).toBe(true);
	});

	// Both pipes full, each side waiting on the other, if the adapter wrote the whole prompt before it
	// read a line. More than any pipe holds, each way.
	it("a Codex that prints a lot before it reads a word still gets the prompt and ends its turn", async () => {
		const codex = standIn(
			`head -c 1000000 /dev/zero | tr '\\0' 'x'\necho\n${KEEPS}\n${ENDS_A_TURN}`,
		);
		const raws = await Effect.runPromise(turnOn(codex, {prompt: OVER_EVERY_LIMIT}));
		expect(stdinOf(codex) === OVER_EVERY_LIMIT).toBe(true);
		expect([...raws].at(-1)).toMatchObject({_tag: "ended"});
	});

	// A Codex that dies at the start, on a bad login or a bad flag, closes stdin with the prompt half
	// written. That is the same failure as any Codex that exits with no turn's end, not a broken pipe.
	it("a Codex that exits without reading fails the turn in words, and kills nothing", async () => {
		const codex = standIn("exit 3");
		const why = await Effect.runPromise(Effect.flip(turnOn(codex, {prompt: OVER_EVERY_LIMIT})));
		expect(why).toMatchObject({why: "broke", message: expect.stringContaining("exited (3)")});
	});
});
