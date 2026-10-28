import {Effect, Exit, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {makeAgents} from "./core.ts";
import {fakeAdapter, saying} from "./fake.ts";
import {memorySessions} from "./sessions.ts";
import {NO_LIMITS, noReaper, System, type Turn, Words} from "./turn.ts";

// A turn's system prompt: two cases and no third, a turn with none does not
// type, and the fake records the one each turn sent.

const Answer = Schema.Struct({note: Schema.String});

/** Text with nothing in it: empty, spaces only, line ends only. */
const BLANK = ["", "   ", "\n", " \n\t\n "];

const turn = (session: string, system: System): Turn<typeof Answer.Type> => ({
	provider: "fake",
	session,
	folder: "/nowhere",
	prompt: "do the job",
	system,
	answer: Answer,
	model: null,
	effort: null,
	limits: NO_LIMITS,
});

describe("a turn's system prompt", () => {
	it("cannot be left out, or be a third case: neither types", () => {
		const {system: _, ...none} = turn("s", {_tag: "maker", add: ""});
		// @ts-expect-error a turn with no system prompt is not a Turn
		const missing: Turn<typeof Answer.Type> = none;
		// @ts-expect-error "none" is not one of the two cases
		const third: System = {_tag: "none"};
		// @ts-expect-error a maker prompt with nothing said about what to add
		const bare: System = {_tag: "maker"};
		// @ts-expect-error an own prompt's text is made through its schema, never a plain string
		const empty: System = {_tag: "own", text: ""};
		expect([missing, third, bare, empty]).toHaveLength(4);
	});

	it("reads only the two cases, and an own prompt only with some text", () => {
		const read = (value: unknown) => Exit.isSuccess(Schema.decodeUnknownExit(System)(value));
		expect(read({_tag: "maker", add: "One task."})).toBe(true);
		expect(read({_tag: "own", text: "Sort one ticket."})).toBe(true);
		for (const text of BLANK) expect(read({_tag: "own", text})).toBe(false);
		expect(read({_tag: "none"})).toBe(false);
		expect(read(null)).toBe(false);
	});

	it("makes no own prompt's text from blank words", () => {
		for (const text of BLANK) expect(() => Words.make(text)).toThrow();
		expect(Words.make(" Sort one ticket.\n")).toBe(" Sort one ticket.\n");
	});

	it("sends no own prompt with blank text to an adapter, even past its type", async () => {
		const fake = fakeAdapter(() => saying('{"note":"ok"}'));
		const agents = makeAgents({adapters: {fake}, sessions: memorySessions(), reaper: noReaper});
		for (const [n, text] of BLANK.entries()) {
			// biome-ignore lint/plugin: a planted mistake, as JavaScript or a cast could send it; the type refuses it
			const system = {_tag: "own", text} as unknown as System;
			const error = await Effect.runPromise(
				Effect.flip(Stream.runDrain(agents.run(turn(`b-${n}`, system)))),
			);
			expect(error).toMatchObject({_tag: "AgentFailed", why: "system"});
		}
		expect(fake.seen.started).toHaveLength(0);
	});

	it("reaches the fake exactly as each turn gave it", async () => {
		const fake = fakeAdapter(() => saying('{"note":"ok"}'));
		const agents = makeAgents({adapters: {fake}, sessions: memorySessions(), reaper: noReaper});
		const sent: System[] = [
			{_tag: "own", text: Words.make("You sort one ticket. No tools.")},
			{_tag: "maker", add: "You plan; you change no file; hand back one PlanDraft."},
			{_tag: "maker", add: ""},
		];
		for (const [n, system] of sent.entries())
			await Effect.runPromise(Stream.runDrain(agents.run(turn(`s-${n}`, system))));
		expect(fake.seen.started.map((t) => t.system)).toEqual(sent);
	});
});
