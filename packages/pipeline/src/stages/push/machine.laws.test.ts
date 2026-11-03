import {
	arbConstantMsg,
	arbMsg,
	arbRecordMsg,
	type MsgArbitraryTable,
	propertyInvariant,
	type Step,
} from "@demlik/tea/pbt";
import type {MsgOf} from "@kampus/fabrika-old";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	openPull,
	type Push,
	type PushAsk,
	type PushCmd,
	postReviews,
	push,
	pushHead,
} from "./machine.ts";

// The push step's laws on its real reducer, from its real `init`, each seen to fail on a planted
// mistake. Today's version.

type Machine = typeof push;
type Msg = MsgOf<Machine>;
type PushStep = Step<Push, Msg, PushCmd>;

const ASK: PushAsk = {ticket: "o/r#1", number: 1, head: "h1", title: "t", body: "b", posts: []};
const PUSH = pushHead({ticket: "o/r#1", number: 1, head: "h1", intent: "i"});
const OPEN = openPull({ticket: "o/r#1", number: 1, head: "h1", title: "t", body: "b", intent: "i"});
const POST = postReviews({pr: "P", head: "h1", posts: [], intent: "i"});

const arbs: MsgArbitraryTable<Msg> = {
	start: arbRecordMsg("start", {ask: fc.constant(ASK)}),
	resume: arbConstantMsg("resume"),
	push_head_ok: fc.constant(pushHead.ok(PUSH, null, 0)),
	push_head_err: fc.constant(pushHead.err(PUSH, {_tag: "unknown"}, 0)),
	push_open_ok: fc.constant(openPull.ok(OPEN, "P", 0)),
	push_open_err: fc.constant(openPull.err(OPEN, {_tag: "unknown"}, 0)),
	push_post_ok: fc.constant(postReviews.ok(POST, null, 0)),
	push_post_err: fc.constant(postReviews.err(POST, {_tag: "unknown"}, 0)),
};

const opening: readonly Msg[] = [{type: "start", ask: ASK}];
const lists = fc
	.tuple(fc.boolean(), fc.array(arbMsg(arbs), {minLength: 1, maxLength: 40}))
	.map(([open, rest]) => (open ? [...opening, ...rest] : rest));

const check = (machine: Machine, law: (t: PushStep) => void) =>
	propertyInvariant(
		machine,
		undefined,
		lists,
		(t: PushStep) => {
			law(t);
			return true;
		},
		{numRuns: 300, seed: 5},
	);

const plant = (update: Partial<Machine["update"]>): Machine =>
	({...push, update: {...push.update, ...update}}) as Machine;

/** A pull request opens only once the head is on the remote, and only on that answer. */
const opensAfterPush = ({prev, msg, cmds}: PushStep) => {
	if (msg.type === "resume") return;
	if (!cmds.some((c) => c.type === "push_open")) return;
	expect(prev.phase).toBe("pushing");
	expect(msg.type).toBe("push_head_ok");
};

/** Every failure ends the step in a stuck that names what failed. */
const failuresAreNamed = ({prev, msg, next}: PushStep) => {
	const named = {
		push_head_err: ["pushing", "push_failed"],
		push_open_err: ["opening", "open_failed"],
		push_post_err: ["posting", "post_failed"],
	} as const;
	if (!(msg.type in named)) return;
	const [phase, why] = named[msg.type as keyof typeof named];
	if (prev.phase !== phase) return;
	expect(next).toMatchObject({phase: "over", outcome: {kind: "stuck", why}});
};

/** It is `done` only after the reviews are posted, and it hands back the head the review passed. */
const doneOnThatHead = ({prev, next}: PushStep) => {
	if (next.phase !== "over" || next.outcome.kind !== "done" || prev.phase === "over") return;
	expect(prev.phase).toBe("posting");
	expect(next.outcome.head).toBe(next.ask.head);
};

/** Over stays over. */
const overStays = ({prev, next, cmds}: PushStep) => {
	if (prev.phase !== "over") return;
	expect(next).toEqual(prev);
	expect(cmds).toEqual([]);
};

describe("the push step's laws", () => {
	it("opens only after the push", () => check(push, opensAfterPush));
	it("names every failure", () => check(push, failuresAreNamed));
	it("is done only after posting, on the head the review passed", () =>
		check(push, doneOnThatHead));
	it("stays over", () => check(push, overStays));
});

describe("each law fails on a planted mistake", () => {
	it("opens on a failed push", () => {
		const planted = plant({
			push_head_err: (s, m) =>
				push.update.push_head_ok(s, {...m, type: "push_head_ok", value: null}),
		});
		expect(() => check(planted, opensAfterPush)).toThrow();
	});

	it("a failed post read as done", () => {
		const planted = plant({
			push_post_err: (s, m) =>
				push.update.push_post_ok(s, {...m, type: "push_post_ok", value: null}),
		});
		expect(() => check(planted, failuresAreNamed)).toThrow();
	});

	it("done with no post", () => {
		const planted = plant({
			push_open_ok: (s, m) =>
				s.phase === "opening"
					? [
							{
								phase: "over",
								ask: s.ask,
								outcome: {kind: "done", part: false, pr: m.value, head: s.ask.head},
							},
							[],
						]
					: [s, []],
		});
		expect(() => check(planted, doneOnThatHead)).toThrow();
	});

	it("a finished step that starts again", () => {
		const planted = plant({
			start: (s, m) => push.update.start(s.phase === "over" ? {phase: "idle"} : s, m),
		});
		expect(() => check(planted, overStays)).toThrow();
	});
});
