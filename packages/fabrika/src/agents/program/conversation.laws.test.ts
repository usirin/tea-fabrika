import {isDeepStrictEqual} from "node:util";
import {
	arbMsg,
	arbMsgSequence,
	arbRecordMsg,
	foldEvents,
	type MsgArbitraryTable,
	stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import {Effect} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {memoryStorage} from "../../program/storage.ts";
import type {Update} from "../agent/turn.ts";
import {Conversation, type ConversationMsg, conversation, type End} from "./conversation.ts";

// Node at the edge: `isDeepStrictEqual`, to compare turns inside a property.

// The `conversation` machine of the `claude` and `codex` programs (experiment 169), driven by any
// list of its Msgs from its init:
//
//   kept      every state it reaches saves through `Conversation` and loads back equal, so a
//             start after a kill reads back what was there
//   final     a turn that ended never changes again: no late update, `began` or second `ended`
//             touches it, so what a person saw end stays as it ended
//
// Each law is seen to fail on a planted mistake.

type M = typeof conversation;
const ctx = stubCtxThrowingProxy<undefined>();

const n = fc.integer({min: 0, max: 5});
const text = fc.constantFrom("5", "", "é", "Read the ticket.");
const update: fc.Arbitrary<Update> = fc.oneof(
	fc.record({_tag: fc.constant("started" as const), session: fc.constantFrom("s1", "s2")}),
	fc.record({_tag: fc.constant("said" as const), text}),
	fc.record({
		_tag: fc.constant("tool" as const),
		id: fc.constantFrom("t1", "t2"),
		title: fc.constantFrom("Read", ""),
		status: fc.constantFrom("pending", "in_progress", "completed", "failed" as const),
	}),
	fc.record({_tag: fc.constant("asked" as const), id: fc.constantFrom("a1", "a2"), title: text}),
	fc.record({
		_tag: fc.constant("tokens" as const),
		tokens: fc.record({input: fc.nat(), cached: fc.nat(), output: fc.nat()}),
	}),
);
const count = fc.nat({max: 100_000});
const end: fc.Arbitrary<End> = fc.record({
	stop: fc.constantFrom("end_turn", "cancelled", "over_budget", "failed" as const),
	answer: fc.constantFrom(null, {sum: 5}, "text", [1, 2]),
	tokens: fc.record({input: count, cached: count, output: count}),
	counted: fc.constantFrom("turn", "requests", "last", "none" as const),
	usd: fc.option(fc.constantFrom(0, 0.012, 1.5), {nil: null}),
	requests: fc.option(fc.nat({max: 9}), {nil: null}),
	ms: count,
	error: fc.option(fc.constantFrom("cannot_limit: usd", "boom"), {nil: null}),
});

const table: MsgArbitraryTable<ConversationMsg> = {
	opened: arbRecordMsg("opened", {
		provider: fc.constantFrom("claude", "codex" as const),
		session: fc.constantFrom("claude/7", "codex/8"),
	}),
	told: arbRecordMsg("told", {prompt: text}),
	began: arbRecordMsg("began", {n}),
	heard: arbRecordMsg("heard", {n, update}),
	ended: arbRecordMsg("ended", {n, end}),
};
const lists = arbMsgSequence(arbMsg(table), {maxLength: 30});

const kept = (machine: M, runs = 150) =>
	fc.assert(
		fc.asyncProperty(lists, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("claude:r1", null));
			const store = handle.store("conversation", "one", Conversation);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
			}
		}),
		{numRuns: runs, seed: 169},
	);

const final = (machine: M, runs = 300) =>
	fc.assert(
		fc.property(lists, (list) => {
			const states = foldEvents(machine, ctx, null, list).states;
			const changed = states.slice(1).flatMap((after, i) =>
				(states[i]?.turns ?? [])
					.filter((t) => t.end !== null)
					.filter(
						(t) =>
							!isDeepStrictEqual(
								after.turns.find((x) => x.n === t.n),
								t,
							),
					)
					.map((t) => t.n),
			);
			expect(changed).toEqual([]);
		}),
		{numRuns: runs, seed: 169},
	);

describe("the agent programs' conversation", () => {
	it("kept: every state it reaches from its init saves and loads back equal", async () => {
		await kept(conversation);
	});

	it("final: a turn that ended never changes again", () => {
		final(conversation);
	});

	it("kept is seen to fail on a planted mistake: an end that keeps a time it never measured", async () => {
		const real = conversation;
		const unmeasured: M = {
			...real,
			update: {
				...real.update,
				// `ms` is a count; NaN is a number the schema refuses, so the save fails.
				ended: (s, m) => real.update.ended(s, {...m, end: {...m.end, ms: Number.NaN}}),
			},
		};
		await expect(kept(unmeasured, 50)).rejects.toThrow(/Counterexample/);
	});

	it("final is seen to fail on a planted mistake: an end told twice overwrites the first", () => {
		const real = conversation;
		const endsAgain: M = {
			...real,
			update: {
				...real.update,
				ended: (s, m) => [
					{...s, turns: s.turns.map((t) => (t.n === m.n ? {...t, end: m.end} : t))},
					[],
				],
			},
		};
		expect(() => final(endsAgain, 300)).toThrow(/Counterexample/);
	});
});
