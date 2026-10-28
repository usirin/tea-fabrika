import {mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {type AdapterTurn, NonBlank, type SystemPrompt} from "../agent/turn.ts";
import {acpAdapter, claudeMetaOf} from "./adapter.ts";
import {codexHomeOf, harnessOf, withSystem} from "./harness.ts";

// A turn's system prompt on each ACP row. ACP has no field for one, so each
// row is told in its own adapter's way. Claude's and Codex's rows are checked
// on what they are handed, with no adapter started; the fake row is run, and
// notes what came.

const APPEND: SystemPrompt = {_tag: "append", text: "You only find; you approve nothing."};
const TEXT = "You sort one ticket.\nNo tools.";
const REPLACE: SystemPrompt = {_tag: "replace", text: NonBlank.make(TEXT)};

describe("claude's row", () => {
	it("opens the preset with the stage's line appended, or the stage's text alone, never recorded", () => {
		const of = (system: SystemPrompt) =>
			claudeMetaOf({folder: "/work/copy", usd: null, system}).claudeCode.options.systemPrompt;
		expect(of(APPEND)).toEqual({
			type: "preset",
			preset: "claude_code",
			append: APPEND.text,
			snapshot: false,
		});
		expect(of(REPLACE)).toEqual({type: "custom", prompt: TEXT, snapshot: false});
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

	const told = (system: SystemPrompt) => {
		const {parent, folder, codex} = madeUp();
		const h = withSystem(harnessOf("codex", folder, null, parent), system, folder, parent);
		return {h, codex, config: JSON.parse(h.env.CODEX_CONFIG ?? "{}") as Record<string, unknown>};
	};

	it("merges the stage's line into CODEX_CONFIG as developer instructions, the fence kept", () => {
		const {config} = told(APPEND);
		expect(config.developer_instructions).toBe(APPEND.text);
		expect(config.model_instructions_file).toBeUndefined();
		expect(config.default_permissions).toBe("fenced");
	});

	it("names a file of the stage's own text as Codex's instructions, written before it starts", async () => {
		const {h, codex, config} = told(REPLACE);
		const file = String(config.model_instructions_file);
		expect(file.startsWith(`${codex}/system-`)).toBe(true);
		expect(config.developer_instructions).toBeUndefined();
		await Effect.runPromise((h.prepare ?? Effect.void).pipe(Effect.provide(nodeServices)));
		expect(readFileSync(file, "utf8")).toBe(TEXT);
	});

	it("keeps the first session's prompt when a second session on the same folder prepares", async () => {
		const {parent, folder} = madeUp();
		const tell = (text: string) =>
			withSystem(
				harnessOf("codex", folder, null, parent),
				{_tag: "replace", text: NonBlank.make(text)},
				folder,
				parent,
			);
		const prepare = (h: ReturnType<typeof tell>) =>
			Effect.runPromise((h.prepare ?? Effect.void).pipe(Effect.provide(nodeServices)));
		const reviewer = tell("You only review. Never edit.");
		const builder = tell("You build. Edit the code.");
		await prepare(reviewer);
		// The reviewer's Codex has started but not yet read its file.
		await prepare(builder);
		const fileOf = (h: ReturnType<typeof tell>) =>
			String(
				(JSON.parse(h.env.CODEX_CONFIG ?? "{}") as Record<string, unknown>).model_instructions_file,
			);
		expect(readFileSync(fileOf(reviewer), "utf8")).toBe("You only review. Never edit.");
		expect(readFileSync(fileOf(builder), "utf8")).toBe("You build. Edit the code.");
	});
});

describe("the fake row", () => {
	it("is handed exactly the turn's system prompt, on a new session and on the next", async () => {
		const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-fake-system-")));
		const turn = (system: SystemPrompt, resume: string | null): AdapterTurn => ({
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
		const first = await run(turn(REPLACE, null));
		const opened = [...first].find((r) => r._tag === "opened");
		if (opened?._tag !== "opened") throw new Error("the fake opened no session");
		await run(turn(APPEND, opened.own));
		const noted = readFileSync(join(folder, ".fake-acp", "log"), "utf8")
			.split("\n")
			.filter((line) => line.startsWith("system "));
		expect(noted).toEqual([
			`system ${opened.own} ${JSON.stringify(REPLACE)}`,
			`system ${opened.own} ${JSON.stringify(APPEND)}`,
		]);
	}, 20_000);
});
