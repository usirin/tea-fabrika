import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {
	createDraft,
	type DraftRun,
	extraTools,
	noSpend,
	sdkRunner,
} from "@kampus/fabrika/agents/claude";
import {Effect, Schema, Stream} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {initOf, resultOf, scriptedOpen, turnOf} from "./draft-scripted.ts";

// The runner on a scripted query: no agent is started, so no test here needs
// a key or the network. What is held in place is the check of the tool list
// the SDK reports against the list the run's options named.

const READS = ["Read", "Grep", "Glob"];
/** Made-up names, in the shape of a tool that comes from a server of tools. */
const EXTRA = ["mcp__one__read", "mcp__one__send", "mcp__two__fetch"];

describe("the tools the SDK lists, against the ones the options named", () => {
	it("is clean when the list is the named tools, in any order, with the SDK's own answer tool", () => {
		expect(extraTools(READS, ["Glob", "Grep", "Read", "StructuredOutput"])).toBe(0);
		expect(extraTools(READS, ["Read"])).toBe(0);
		expect(extraTools([], ["StructuredOutput"])).toBe(0);
	});

	it("counts every tool the options did not name, whatever it is called", () => {
		expect(extraTools(READS, [...READS, ...EXTRA])).toBe(3);
		expect(extraTools(READS, [...READS, "Bash"])).toBe(1);
		expect(extraTools([], ["Read"])).toBe(1);
	});

	it("has nothing to compare when the options name no list", () => {
		expect(extraTools(undefined, [...READS, ...EXTRA])).toBe(0);
		expect(extraTools({type: "preset", preset: "claude_code"}, ["Bash", ...EXTRA])).toBe(0);
	});
});

describe("the runner", () => {
	const draft = createDraft({name: "note", output: Schema.Struct({text: Schema.String})});
	const RUN: DraftRun = {
		key: "k",
		id: "k/1",
		prompt: "p",
		session: {id: "s", continues: false},
		agent: null,
		folder: null,
	};
	const OPTIONS: Options = {tools: [...READS], allowedTools: [...READS]};

	/** One run on a script, to its last Msg. */
	function runOn(messages: readonly SDKMessage[], options: Options = OPTIONS) {
		const query = scriptedOpen(messages);
		const shown: SDKMessage[] = [];
		const runner = sdkRunner(draft, () => options, {
			open: query.open,
			seen: (_run, message) => shown.push(message),
		});
		const msgs = runner({id: "note", type: "note", deps: RUN} as Sub<"note", DraftRun>);
		const ran = Effect.runPromise(
			Stream.runCollect(msgs.pipe(Stream.takeUntil((msg) => !draft.is.tool(msg)))).pipe(
				Effect.map((all) => [...all]),
			),
		);
		return {ran, seen: query.seen, shown, asked: query.asked};
	}

	it("runs to its answer when the SDK lists only the tools the options named", async () => {
		const script = [
			initOf(["Glob", "Grep", "Read", "StructuredOutput"]),
			turnOf("Read", "Grep"),
			resultOf({text: "done"}),
		];
		const {ran, seen} = runOn(script);

		expect(await ran).toMatchObject([
			{type: "note_tool", tool: "Read"},
			{type: "note_tool", tool: "Grep"},
			{type: "note_finished", key: "k", id: "k/1", output: {text: "done"}},
		]);
		expect(seen.read).toBe(3);
	});

	it("ends the run as failed when the SDK lists more, and reads no message after that one", async () => {
		const script = [
			initOf([...READS, "StructuredOutput", ...EXTRA]),
			turnOf("Read"),
			resultOf({text: "done"}),
		];
		const {ran, seen, shown} = runOn(script);

		expect(await ran).toEqual([
			{
				type: "note_failed",
				key: "k",
				id: "k/1",
				error:
					"the SDK listed 3 tools the run's options do not name, so the run was ended at its start",
				spend: noSpend,
			},
		]);
		// The list's message was the last one taken from the query, and the query was closed.
		expect(seen.read).toBe(1);
		expect(shown).toHaveLength(1);
		expect(seen.closed).toBeGreaterThan(0);
	});

	it("says a count and never a name", async () => {
		const {ran} = runOn([initOf([...READS, EXTRA[0] ?? ""]), resultOf({text: "done"})]);
		const [end] = await ran;

		expect(end).toMatchObject({type: "note_failed"});
		expect(JSON.stringify(end)).toContain("listed 1 tool the run's options");
		expect(JSON.stringify(end)).not.toContain("mcp__");
	});

	it("leaves a run alone whose options name no list of tools", async () => {
		const {ran, seen} = runOn([initOf(["Bash", ...EXTRA]), resultOf({text: "done"})], {
			allowedTools: ["Bash"],
		});

		expect(await ran).toMatchObject([{type: "note_finished", output: {text: "done"}}]);
		expect(seen.read).toBe(2);
	});

	describe("the environment the agent's process is handed", () => {
		afterEach(() => {
			vi.unstubAllEnvs();
		});

		it("is a short one when the options name none: a variable set on this machine is not in it", async () => {
			vi.stubEnv("TEA_FABRIKA_MARKER", "set");
			vi.stubEnv("TYPESAFE_API_KEY", "not-a-key");
			const {ran, asked} = runOn([initOf(READS), resultOf({text: "done"})]);
			await ran;

			const env = asked[0]?.env ?? {};
			expect(Object.keys(env)).toContain("PATH");
			expect(env).not.toHaveProperty("TEA_FABRIKA_MARKER");
			expect(env).not.toHaveProperty("TYPESAFE_API_KEY");
		});

		it("is the options' own when they name one", async () => {
			const {ran, asked} = runOn([initOf(READS), resultOf({text: "done"})], {
				...OPTIONS,
				env: {PATH: "/bin"},
			});
			await ran;

			expect(asked[0]?.env).toEqual({PATH: "/bin"});
		});
	});
});
