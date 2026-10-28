import {mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Stream} from "effect";
import {describe, expect, it} from "vitest";
import type {AdapterTurn, System} from "../agent/turn.ts";
import {acpAdapter, claudeMetaOf} from "./adapter.ts";
import {codexHomeOf, harnessOf, withSystem} from "./harness.ts";

// A turn's system prompt on each ACP row. ACP has no field for one, so each
// row is told in its own adapter's way. Claude's and Codex's rows are checked
// on what they are handed, with no adapter started; the fake row is run, and
// notes what came.

const MAKER: System = {_tag: "maker", add: "You only find; you approve nothing."};
const TEXT = "You sort one ticket.\nNo tools.";
const OWN: System = {_tag: "own", text: TEXT};

describe("claude's row", () => {
	it("opens the preset with the stage's line appended, or the stage's text alone", () => {
		const of = (system: System) =>
			claudeMetaOf({folder: "/work/copy", usd: null, system}).claudeCode.options.systemPrompt;
		expect(of(MAKER)).toEqual({type: "preset", preset: "claude_code", append: MAKER.add});
		expect(of(OWN)).toBe(TEXT);
	});
});

describe("codex's row", () => {
	/** A made-up home with a plan login in the shape Codex writes: no key, no real token. */
	const madeUp = () => {
		const home = realpathSync(mkdtempSync(join(tmpdir(), "acp-system-")));
		mkdirSync(join(home, ".codex"));
		writeFileSync(
			join(home, ".codex", "auth.json"),
			JSON.stringify({auth_mode: "chatgpt", OPENAI_API_KEY: null, tokens: {id_token: "x"}}),
		);
		const parent = {PATH: "/usr/bin:/bin", HOME: home, USER: "someone", TMPDIR: tmpdir()};
		const folder = join(home, "copy");
		return {parent, folder, codex: codexHomeOf(folder, parent)};
	};

	const told = (system: System) => {
		const {parent, folder, codex} = madeUp();
		const h = withSystem(harnessOf("codex", folder, null, parent), system, folder, parent);
		return {h, codex, config: JSON.parse(h.env.CODEX_CONFIG ?? "{}") as Record<string, unknown>};
	};

	it("merges the stage's line into CODEX_CONFIG as developer instructions, the fence kept", () => {
		const {config} = told(MAKER);
		expect(config.developer_instructions).toBe(MAKER.add);
		expect(config.model_instructions_file).toBeUndefined();
		expect(config.default_permissions).toBe("fenced");
	});

	it("names a file of the stage's own text as Codex's instructions, written before it starts", async () => {
		const {h, codex, config} = told(OWN);
		expect(config.model_instructions_file).toBe(`${codex}/system.md`);
		expect(config.developer_instructions).toBeUndefined();
		await Effect.runPromise((h.prepare ?? Effect.void).pipe(Effect.provide(nodeServices)));
		expect(readFileSync(`${codex}/system.md`, "utf8")).toBe(TEXT);
	});
});

describe("the fake row", () => {
	it("is handed exactly the turn's system prompt, on a new session and on the next", async () => {
		const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-fake-system-")));
		const turn = (system: System, resume: string | null): AdapterTurn => ({
			folder,
			prompt: "hello",
			system,
			schema: {},
			resume,
			session: "s",
			model: null,
			effort: null,
			usd: null,
		});
		const run = (t: AdapterTurn) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const adapter = yield* acpAdapter("fake", {PATH: process.env.PATH ?? ""});
					const running = yield* adapter.start(t);
					return yield* Stream.runCollect(running.updates);
				}).pipe(Effect.scoped, Effect.provide(nodeServices)),
			);
		const first = await run(turn(OWN, null));
		const opened = [...first].find((r) => r._tag === "opened");
		if (opened?._tag !== "opened") throw new Error("the fake opened no session");
		await run(turn(MAKER, opened.own));
		const noted = readFileSync(join(folder, ".fake-acp", "log"), "utf8")
			.split("\n")
			.filter((line) => line.startsWith("system "));
		expect(noted).toEqual([
			`system ${opened.own} ${JSON.stringify(OWN)}`,
			`system ${opened.own} ${JSON.stringify(MAKER)}`,
		]);
	}, 20_000);
});
