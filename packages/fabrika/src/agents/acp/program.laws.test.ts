import type {Cmd, Machine, Sub} from "@demlik/tea";
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
import type {MsgOf} from "../../program/program.ts";
import {memoryStorage, type StateSchema} from "../../program/storage.ts";
import {acpProgram} from "./program.ts";
import type {Seen} from "./transcript.ts";

// The acp program's two kinds, each kept through the schema the program declares for it: every
// state its machine reaches from its init, driven by any list of its Msgs, saves and loads back
// equal. The session is what a start after a kill reads back; the transcript is folded again at
// every start, so it is never saved today, but its schema is what it would be read through.

const {session, transcript} = acpProgram.machines;
const ctx = stubCtxThrowingProxy<undefined>();

/** Every state `machine` reaches from its init, saved through `state` and loaded back. */
const keepsEvery = <S, M extends {readonly type: string}, C extends Cmd, U extends Sub>(
	machine: Machine<S, M, C, U, undefined>,
	state: StateSchema<S>,
	msgs: fc.Arbitrary<readonly M[]>,
	runs = 150,
) =>
	fc.assert(
		fc.asyncProperty(msgs, async (list) => {
			const handle = await Effect.runPromise(memoryStorage().open("acp:r1", null));
			const store = handle.store("m", "one", state);
			for (const s of foldEvents(machine, ctx, null, list).states) {
				await store.save(s);
				expect(store.migrate(await store.load())).toEqual(s);
			}
		}),
		{numRuns: runs, seed: 1},
	);

// ---------------------------------------------------------------- the session

type SessionMsg = MsgOf<typeof session.machine>;
const sessionTable: MsgArbitraryTable<SessionMsg> = {
	opened: arbRecordMsg("opened", {
		agent: fc.constantFrom("claude", "codex"),
		id: fc.constantFrom("s-1", "s-2"),
	}),
	told: arbRecordMsg("told", {prompt: fc.constantFrom("read a.txt", "", "and é")}),
	ended: arbRecordMsg("ended", {n: fc.integer({min: 0, max: 6})}),
};
const sessionLists = arbMsgSequence(arbMsg(sessionTable), {maxLength: 30});

// ---------------------------------------------------------------- the transcript

type TranscriptMsg = MsgOf<typeof transcript.machine>;
const text = fc.constantFrom("The river", " is Kura.", "", "é");
const id = fc.constantFrom("t1", "t2", "t3");
const status = fc.constantFrom("pending", "in_progress", "completed", "failed" as const);
const count = fc.nat({max: 200_000});
/** Update kinds the fold does not use, as `seenOf` names them. */
const OTHER = ["available_commands_update", "agent_message_chunk:image", "config_option_update"];
const seen = (what: fc.Arbitrary<string>): fc.Arbitrary<Seen> =>
	fc.oneof(
		fc.record({
			kind: fc.constant("said" as const),
			who: fc.constantFrom("user", "agent" as const),
			text,
			id: fc.option(fc.constantFrom("m1", "m2"), {nil: null}),
		}),
		fc.constant({kind: "thought" as const}),
		fc.record({
			kind: fc.constant("tool" as const),
			id,
			name: fc.constantFrom("Read", "exec_command"),
			title: text,
			status,
		}),
		fc.record({
			kind: fc.constant("tool_update" as const),
			id,
			name: fc.option(fc.constantFrom("Read", "edit"), {nil: null}),
			title: fc.option(text, {nil: null}),
			status: fc.option(status, {nil: null}),
		}),
		fc.record({
			kind: fc.constant("plan" as const),
			entries: fc.array(fc.record({text, status: fc.constantFrom("pending", "completed")}), {
				maxLength: 3,
			}),
		}),
		fc.record({kind: fc.constant("mode" as const), id: fc.constantFrom("default", "plan")}),
		fc.record({kind: fc.constant("title" as const), title: text}),
		fc.record({
			kind: fc.constant("context" as const),
			used: count,
			size: count,
			cost: fc.option(fc.integer({min: 0, max: 50}), {nil: null}),
		}),
		fc.record({
			kind: fc.constant("notice" as const),
			severity: fc.constantFrom("info", "warning"),
			title: text,
		}),
		fc.record({kind: fc.constant("other" as const), what}),
	);
const transcriptTable = (what: fc.Arbitrary<string>): MsgArbitraryTable<TranscriptMsg> => ({
	opening: arbRecordMsg("opening", {
		how: fc.constantFrom("new", "load", "resume"),
		earlier: fc.nat({max: 9}),
	}),
	opened: arbRecordMsg("opened", {
		mode: fc.option(fc.constantFrom("default", "plan"), {nil: null}),
	}),
	seen: arbRecordMsg("seen", {events: fc.array(seen(what), {maxLength: 4})}),
	turn: arbRecordMsg("turn", {n: fc.integer({min: 1, max: 4}), prompt: text}),
	ended: arbRecordMsg("ended", {
		ended: fc.record({
			n: fc.integer({min: 1, max: 4}),
			stop: fc.constantFrom("end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"),
			usage: fc.option(fc.record({input: count, output: count, cached: count, total: count}), {
				nil: null,
			}),
		}),
	}),
	asked: arbRecordMsg("asked", {
		ask: fc.record({
			id: fc.constantFrom("a1", "a2"),
			tool: id,
			title: text,
			kind: fc.constantFrom("edit", "execute"),
			options: fc.array(fc.constantFrom("allow_once", "reject_once"), {maxLength: 2}),
		}),
	}),
	answered: arbRecordMsg("answered", {
		ask: fc.constantFrom("a1", "a2", "a3"),
		answer: fc.constantFrom("allowed", "refused", "cancelled"),
	}),
	cancelling: fc.constant({type: "cancelling"} as const),
});
const transcriptLists = (what: fc.Arbitrary<string>) =>
	arbMsgSequence(arbMsg(transcriptTable(what)), {maxLength: 30});

describe("the acp program's kinds are kept", () => {
	it("every session it reaches from its init saves and loads back equal", async () => {
		await keepsEvery(session.machine, session.state, sessionLists);
	});

	it("every transcript it reaches from its init saves and loads back equal", async () => {
		await keepsEvery(
			transcript.machine,
			transcript.state,
			transcriptLists(fc.constantFrom(...OTHER)),
		);
	});

	// Known bug, found by this law: an update kind named as one of a plain object's own names
	// (`constructor`, `__proto__`, `toString`) is counted from what the object inherits under that
	// name, not from 0, so its count is text and the transcript leaves its own schema. It is never
	// saved today, but its counts are wrong where they are shown. Pinned: this test fails the day the
	// count starts at 0.
	it.each(["constructor", "__proto__"])(
		"known bug: an update kind named %s is counted as text, and the transcript leaves its schema",
		async (what) => {
			await expect(
				keepsEvery(transcript.machine, transcript.state, transcriptLists(fc.constant(what)), 100),
			).rejects.toThrow(
				`Counterexample: [[{"type":"seen","events":[{"kind":"other","what":"${what}"}]}]]`,
			);
			const once = foldEvents(transcript.machine, ctx, null, [
				{type: "seen", events: [{kind: "other", what}]},
			]).finalState;
			expect(typeof Object.getOwnPropertyDescriptor(once.other, what)?.value).toBe("string");
		},
	);

	it("the law is seen to fail on a planted mistake: a session that keeps the whole Msg it was told dies at its first save", async () => {
		const real = session.machine;
		const keepsTheMsg: typeof real = {
			...real,
			update: {
				...real.update,
				told: (s, m) => [
					{...s, told: s.told + 1, waiting: [...s.waiting, {...m, n: s.told + 1}]},
					[],
				],
			},
		};
		await expect(keepsEvery(keepsTheMsg, session.state, sessionLists, 20)).rejects.toThrow(
			/Counterexample/,
		);
	});
});
