import {defineAgent, tool} from "@demlik/tea/agent";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {memoryTracing} from "../../shell/trace/otel.ts";
import {agentTrace, cutKeys, KEPT_OUT} from "./agent.ts";

// Record wide (docs/plan/pipeline-self-fix.md, PR 7, and
// docs/direction/an-agent-run-keeps-its-content.md): a lane's agent runs keep their content, the
// prompt, each reply and each tool's input and result, on their spans. Text shaped like a key is
// cut before it leaves the host. Every other run still keeps it all out (`KEPT_OUT`).
//
// The keys here are made up, and put together at run time so no key-shaped text sits in this file.

const MADE_UP_GITHUB = ["ghp", "NotARealToken".repeat(3).slice(0, 36)].join("_");
const MADE_UP_ANTHROPIC = ["sk", "ant", "api03", "made-up-not-a-key".repeat(3)].join("-");

const lookUp = tool(
	"look_up",
	{
		description: "Look a word up.",
		input: z.object({word: z.string()}),
		ok: z.object({meaning: z.string(), token: z.string()}),
		err: [],
	},
	async ({word}, _ctx, {ok}) => ok({meaning: `the meaning of ${word}`, token: MADE_UP_GITHUB}),
);

/** A model that asks for the tool once, then answers, echoing the key the tool read. */
const scripted = () => {
	let turn = 0;
	return async () => {
		turn += 1;
		return turn === 1
			? {content: "Let me look.", toolCalls: [{callId: "c1", name: "look_up", args: {word: "tea"}}]}
			: {content: `The word means tea. Your token is ${MADE_UP_GITHUB}.`, toolCalls: []};
	};
};

/** Every exported span's attributes, as text, of one scripted run with its content kept. */
const keptRun = async () => {
	const {spans, layer} = memoryTracing({raw: true});
	await Effect.runPromise(
		Effect.gen(function* () {
			const trace = yield* agentTrace("build", {content: "kept"});

			if (trace === null) {
				return yield* Effect.die("no agent trace with tracing on");
			}

			const agent = defineAgent({model: scripted(), tools: [lookUp], instructions: "Answer."});
			yield* Effect.tryPromise({
				try: () =>
					agent.run(`What is tea? My key is ${MADE_UP_ANTHROPIC}.`, {onEvent: trace.onEvent}),
				catch: () => ({_tag: "agent_failed" as const}),
			});
			trace.end();
		}).pipe(Effect.withSpan("lane_step build"), Effect.provide(layer)),
	);
	return JSON.stringify(spans.map((s) => s.attributes));
};

describe("a lane's agent run, traced with its content kept", () => {
	it("keeps the prompt, the reply of each turn and the tool's result, not `[not exported]`", async () => {
		const everything = await keptRun();
		expect(everything).toContain("What is tea?");
		expect(everything).toContain("Let me look.");
		expect(everything).toContain("The word means tea.");
		expect(everything).toContain("the meaning of tea");
		expect(everything).not.toContain(KEPT_OUT);
	});

	it("cuts a key-shaped string from a tool's result, a reply and the prompt before it is written", async () => {
		const everything = await keptRun();
		// The words around each key are kept: only the key is cut.
		expect(everything).toContain("Your token is");
		expect(everything).toContain("My key is");
		expect(everything).toContain("the meaning of tea");
		expect(everything).not.toContain("NotARealToken");
		expect(everything).not.toContain("made-up-not-a-key");
	});
});

describe("cutting key-shaped text", () => {
	const word = fc.stringMatching(/^[a-z]{1,8}$/);
	const words = fc.array(word, {minLength: 1, maxLength: 6}).map((w) => w.join(" "));
	const key = fc.oneof(
		fc.stringMatching(/^[A-Za-z0-9]{36}$/).map((rest) => ["ghp", rest].join("_")),
		fc
			.stringMatching(/^[A-Za-z0-9_-]{40,90}$/)
			.map((rest) => ["sk", "ant", "api03", rest].join("-")),
	);
	const OPTS = {numRuns: 300, seed: 119120};

	it("cuts each key from any text around it, and keeps the words around it", () => {
		fc.assert(
			fc.property(words, key, words, (before, cut, after) => {
				const out = cutKeys(`${before} ${cut} ${after}`);
				expect(out).not.toContain(cut.slice(-24));
				expect(out.startsWith(before)).toBe(true);
				expect(out.endsWith(after)).toBe(true);
			}),
			OPTS,
		);
	});

	it("leaves text with no key in it as it was", () => {
		fc.assert(
			fc.property(words, (text) => {
				expect(cutKeys(text)).toBe(text);
			}),
			OPTS,
		);
	});

	// A key's prefix inside a longer word is part of the word: `task-list…` holds `sk-`.
	it.each([
		"task-list-for-the-new-lane.md",
		"whisk-together-the-eggs-and-the-flour",
		["pnpm", "storepathforthisworkspaceandthenext1"].join("_"),
		["thighs", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_"),
		["EURASIA", "0123456789ABCDEF"].join(""),
		["desk", "test", "fixturesforthenewapp12"].join("_"),
	])("keeps %s whole", (text) => {
		expect(cutKeys(`see ${text} here`)).toBe(`see ${text} here`);
	});

	const alnum = "Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0UvWxYz";
	const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	it.each([
		["a GitHub classic token", ["ghp", alnum].join("_")],
		["a GitHub fine-grained token", ["github", "pat", alnum, alnum].join("_")],
		["an Anthropic key", ["sk", "ant", "api03", alnum].join("-")],
		["an OpenAI project key", ["sk", "proj", alnum].join("-")],
		["an AWS access key id", ["AKIA", "ABCDEFGHIJ234567"].join("")],
		["a Slack token", ["xoxb", "1234567890", alnum].join("-")],
		["a Google API key", ["AIza", alnum.slice(0, 32), "_-x"].join("")],
		["a Stripe secret key", ["sk", "live", alnum].join("_")],
		["an npm token", ["npm", alnum].join("_")],
		[
			"a JWT",
			[base64url({alg: "HS256", typ: "JWT"}), base64url({sub: "made-up"}), "c2lnbmF0dXJl_-x"].join(
				".",
			),
		],
	])("cuts %s, and keeps the words around it", (_what, key) => {
		expect(cutKeys(`token: ${key} end`)).toBe("token: [key cut] end");
		expect(cutKeys(`token=${key}`)).toBe("token=[key cut]");
		// The mask reads a value as JSON text: a key on its own line comes right after `\n`.
		expect(cutKeys(JSON.stringify(`a line\n${key}\tend`))).toBe(
			JSON.stringify("a line\n[key cut]\tend"),
		);
	});
});
