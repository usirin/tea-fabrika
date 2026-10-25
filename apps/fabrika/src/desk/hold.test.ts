import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {type Hold, type HoldCmd, type HoldMsg, holdMachine, type Key} from "./hold.ts";

// The page's keys while the host decides, folded by hand: a key the desk takes is sent and the
// keys after it are held, then go on in order once the answer is in. Nothing here waits on a
// clock: a held key goes on at the answer, or when the link drops.

const key = (name: string, k = name): Key => ({
	name,
	press: {key: k, code: "", ctrl: name.startsWith("<c-"), alt: false, meta: false, shift: false},
});
const ctrlB = key("<c-b>", "b");

/** Fold Msgs through the hold, from a fresh one; answers each step's Cmds and the hold at the end. */
const fold = (msgs: readonly HoldMsg[]) => {
	let s: Hold = holdMachine.init(null, undefined)[0];
	const steps: (readonly HoldCmd[])[] = [];
	for (const msg of msgs) {
		const [next, cmds] = applyCell<Hold, HoldMsg, HoldCmd>(holdMachine, s, msg);
		s = next;
		steps.push(cmds);
	}
	return {s, steps};
};

const PREFIX_ONLY: HoldMsg = {type: "takes", takes: {all: false, keys: ["<c-b>"]}};
const ALL: HoldMsg = {type: "takes", takes: {all: true, keys: []}};

describe("the hold", () => {
	it("passes a key the desk does not take at once, as it is", () => {
		const {steps} = fold([PREFIX_ONLY, {type: "key", key: key("l")}]);
		expect(steps[1]).toEqual([{type: "pass", key: key("l"), held: false}]);
	});

	it("sends a key the desk takes, holds the keys after it, and sends them in order after the answer", () => {
		const {s, steps} = fold([
			PREFIX_ONLY,
			{type: "key", key: ctrlB},
			{type: "key", key: key("|")},
			{type: "key", key: key("l")},
			// The host's desk comes before its answer: the prefix is armed, so it takes every key.
			ALL,
			{type: "answer", id: 0, took: true},
			PREFIX_ONLY,
			{type: "answer", id: 1, took: true},
		]);
		expect(steps[1]).toEqual([{type: "press", id: 0, key: "<c-b>"}]);
		// Held, with nothing sent: the answer to Ctrl-B is not in yet.
		expect(steps[2]).toEqual([]);
		expect(steps[3]).toEqual([]);
		// The answer: `|` is the next key the desk takes, so it is sent, and `l` waits for its answer.
		expect(steps[5]).toEqual([{type: "press", id: 1, key: "|"}]);
		// The split is done and the prefix is not armed: `l` goes on to the tile, pressed again.
		expect(steps[7]).toEqual([{type: "pass", key: key("l"), held: true}]);
		expect(s.held).toEqual([]);
		expect(s.waiting).toBeNull();
	});

	it("passes on a key the host did not take, before the keys held after it", () => {
		const {steps} = fold([
			ALL,
			{type: "key", key: key("q")},
			{type: "key", key: key("w")},
			PREFIX_ONLY,
			{type: "answer", id: 0, took: false},
		]);
		expect(steps[4]).toEqual([
			{type: "pass", key: key("q"), held: true},
			{type: "pass", key: key("w"), held: true},
		]);
	});

	it("ignores an answer for another key", () => {
		const {s, steps} = fold([
			PREFIX_ONLY,
			{type: "key", key: ctrlB},
			{type: "key", key: key("a")},
			{type: "answer", id: 7, took: true},
		]);
		expect(steps[3]).toEqual([]);
		expect(s.held).toEqual([key("a")]);
	});

	it("lets every held key go on, in order, when the link drops, and sends nothing after", () => {
		const {s, steps} = fold([
			PREFIX_ONLY,
			{type: "key", key: ctrlB},
			{type: "key", key: key("a")},
			{type: "key", key: key("b")},
			{type: "down"},
			{type: "key", key: ctrlB},
		]);
		expect(steps[4]).toEqual([
			{type: "pass", key: key("a"), held: true},
			{type: "pass", key: key("b"), held: true},
		]);
		// With no host, Ctrl-B is the tile's, as if the desk were not there.
		expect(steps[5]).toEqual([{type: "pass", key: ctrlB, held: false}]);
		expect(s.up).toBe(false);
	});

	it("passes every key before the host's first desk: nothing answers yet", () => {
		const {steps} = fold([{type: "key", key: ctrlB}]);
		expect(steps[0]).toEqual([{type: "pass", key: ctrlB, held: false}]);
	});
});
