import {applyCell, type Settled} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {
	attach,
	jitter,
	noteOf,
	POLICY,
	type Reconnect,
	type ReconnectCmd,
	type ReconnectMsg,
	reconnectMachine,
} from "./reconnect.ts";

// When the app attaches to the host again, folded by hand. No clock and no random number here:
// the time comes in on each Msg's `at`, and the wait comes back from `jitter` as the test says.
// Examples only; the machine's laws are a file of their own.

type Msg = ReconnectMsg | Settled<typeof attach> | Settled<typeof jitter>;

const start = (): Reconnect => reconnectMachine.init(null, undefined)[0];

/** Fold Msgs through the machine; answers each step's Cmds and the state at the end. */
const fold = (msgs: readonly Msg[], from: Reconnect = start()) => {
	let s = from;
	const steps: (readonly ReconnectCmd[])[] = [];
	for (const msg of msgs) {
		const [next, cmds] = applyCell<Reconnect, Msg, ReconnectCmd>(reconnectMachine, s, msg);
		s = next;
		steps.push(cmds);
	}
	return {s, steps};
};

const ENDED = "The link to the host ended: the other side closed.";
const up = (at = 0) => attach.ok(attach({}), {kind: "up"}, at);
const lost = (at: number) =>
	attach.ok(attach({}), {kind: "lost", why: "The host did not answer."}, at);
const ended = (at: number): Msg => ({type: "ended", why: ENDED, at});
const picked = (attempt: number, ms: number) => jitter.ok(jitter({attempt}), ms);
const due = (attempt: number): Msg => ({type: "due", attempt});

/** The timer the machine asks for now, or none. */
const timerOf = (s: Reconnect) =>
	reconnectMachine.subs?.find((sub) => sub.type === "timer")?.deps(s) ?? null;

describe("the reconnect machine", () => {
	it("starts with one try, and tells the window nothing on the app's first try", () => {
		const [s, cmds] = reconnectMachine.init(null, undefined);
		expect(s.at).toBe("attaching");
		expect(cmds).toEqual([attach({})]);
		expect(noteOf(s)).toBeNull();
	});

	it("is up once a try attached, and says nothing", () => {
		const {s, steps} = fold([up()]);
		expect(s).toEqual({at: "up"});
		expect(steps[0]).toEqual([]);
		expect(noteOf(s)).toBeNull();
	});

	it("when the link ends: picks a wait, waits it, then tries again", () => {
		const {s, steps} = fold([up(), ended(1000), picked(1, 312)]);
		expect(steps[1]).toEqual([jitter({attempt: 1})]);
		expect(s).toMatchObject({at: "waiting", wait: 312, why: ENDED});
		expect(timerOf(s)).toEqual({ms: 312, msg: {type: "due", attempt: 1}});
		expect(noteOf(s)).toEqual({type: "down", why: ENDED, now: "reconnecting"});
		const tried = fold([due(1)], s);
		expect(tried.s.at).toBe("attaching");
		expect(tried.steps[0]).toEqual([attach({})]);
	});

	it("asks for each wait with the next attempt, so the bound doubles up to 30 s", () => {
		const {steps} = fold([
			up(),
			ended(0),
			picked(1, 1),
			due(1),
			lost(10),
			picked(2, 1),
			due(2),
			lost(20),
		]);
		expect(steps[1]).toEqual([jitter({attempt: 1})]);
		expect(steps[4]).toEqual([jitter({attempt: 2})]);
		expect(steps[7]).toEqual([jitter({attempt: 3})]);
	});

	it("is up again after a try attached, and the next drop starts a fresh count", () => {
		const {s, steps} = fold([up(), ended(0), picked(1, 1), due(1), up(5), ended(9000)]);
		expect(s).toMatchObject({at: "waiting", retry: {attempt: 1}});
		expect(steps[5]).toEqual([jitter({attempt: 1})]);
	});

	it("stops five minutes after the link ended, and Try again starts over", () => {
		const five = POLICY.maxElapsedMs;
		const near = fold([up(), ended(0), picked(1, 1), due(1), lost(five - 1)]);
		expect(near.s.at).toBe("waiting");
		const {s, steps} = fold([picked(2, 1), due(2), lost(five + 1)], near.s);
		expect(s).toEqual({at: "stopped", why: "The host did not answer."});
		expect(steps[2]).toEqual([]);
		expect(timerOf(s)).toBeNull();
		expect(noteOf(s)).toEqual({type: "down", why: "The host did not answer.", now: "stopped"});
		const again = fold([{type: "again"}], s);
		expect(again.s).toMatchObject({at: "attaching", retry: {attempt: 0}});
		expect(again.steps[0]).toEqual([attach({})]);
		expect(noteOf(again.s)?.now).toBe("reconnecting");
	});

	it("never tries a host of another version again", () => {
		const refused = attach.ok(attach({}), {kind: "refused", theirs: 0, ours: 1}, 0);
		const {s, steps} = fold([refused, {type: "again"}, due(1), ended(5)]);
		expect(s).toEqual({at: "refused", theirs: 0, ours: 1});
		expect(steps.flat()).toEqual([]);
		expect(noteOf(s)).toMatchObject({now: "refused"});
		expect(noteOf(s)?.why).toContain("version 0");
	});

	it("changes nothing on an old wait's pick or timer, or Try again while it still tries", () => {
		const waiting = fold([up(), ended(0), picked(1, 1), due(1), lost(10)]).s;
		const {s, steps} = fold([picked(1, 7), due(1), {type: "again"}], waiting);
		expect(s).toEqual(waiting);
		expect(steps.flat()).toEqual([]);
	});

	it("waits the longest on a pick that did not read", () => {
		const bad: Msg = {
			type: "jitter_err",
			cmd: jitter({attempt: 1}),
			error: {_tag: "malformed_result", issues: []},
			at: 0,
		};
		const {s} = fold([up(), ended(0), bad]);
		expect(s).toMatchObject({at: "waiting", wait: POLICY.capMs});
	});
});
