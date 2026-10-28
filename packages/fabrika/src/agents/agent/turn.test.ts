import {Effect, Exit, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {makeAgents} from "./core.ts";
import {fakeAdapter, saying} from "./fake.ts";
import {memorySessions} from "./sessions.ts";
import {NO_LIMITS, noReaper, System, type Turn} from "./turn.ts";

// A turn's system prompt: two cases and no third, a turn with none does not
// type, and the fake records the one each turn sent.

const Answer = Schema.Struct({note: Schema.String});

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
		expect([missing, third, bare]).toHaveLength(3);
	});

	it("reads only the two cases, and an own prompt only with some text", () => {
		const read = (value: unknown) => Exit.isSuccess(Schema.decodeUnknownExit(System)(value));
		expect(read({_tag: "maker", add: "One task."})).toBe(true);
		expect(read({_tag: "own", text: "Sort one ticket."})).toBe(true);
		expect(read({_tag: "own", text: ""})).toBe(false);
		expect(read({_tag: "none"})).toBe(false);
		expect(read(null)).toBe(false);
	});

	it("reaches the fake exactly as each turn gave it", async () => {
		const fake = fakeAdapter(() => saying('{"note":"ok"}'));
		const agents = makeAgents({adapters: {fake}, sessions: memorySessions(), reaper: noReaper});
		const sent: System[] = [
			{_tag: "own", text: "You sort one ticket. No tools."},
			{_tag: "maker", add: "You plan; you change no file; hand back one PlanDraft."},
			{_tag: "maker", add: ""},
		];
		for (const [n, system] of sent.entries())
			await Effect.runPromise(Stream.runDrain(agents.run(turn(`s-${n}`, system))));
		expect(fake.seen.started.map((t) => t.system)).toEqual(sent);
	});
});
