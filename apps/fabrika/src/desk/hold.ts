import {defineMachine, noop} from "@demlik/tea";
import {Cmd} from "@demlik/tea/effect";
import {Schema} from "effect";
import type {Takes} from "./desk.ts";

// The page's keys while the host decides: a tea machine, pure, stepped by the page
// (window/desk.tsx) on every key. The desk runs in the host (host/serve.ts), so the page cannot
// ask it at once whether it takes a key, as it could when the desk ran in the page. tmux's client
// is the model: it sends every key to the server and draws what comes back. Here only the keys
// the desk takes go to the host (`takes`, sent with each desk); every other key stays in the page
// and goes straight to the focused tile, so typing in tsh or in a view costs no round trip.
//
//   [hold] = init(null)                                     {takes: {all: false, keys: []}, up: false, ...}
//   update(hold, {type: "takes", takes: {all: false, keys: ["<c-b>"]}})   up: the host answers keys
//   update(hold, {type: "key", key: ctrlB})                 press {id: 0, key: "<c-b>"}: sent, waiting
//   update(hold, {type: "key", key: pipe})                  held: the answer is not in yet
//   update(hold, {type: "key", key: l})                     held, after `|`
//   update(hold, {type: "takes", takes: {all: true, keys: []}})           the prefix is armed
//   update(hold, {type: "answer", id: 0, took: true})       press {id: 1, key: "|"}: the next held key the desk takes
//   update(hold, {type: "takes", takes: {all: false, keys: ["<c-b>"]}})   the split is done
//   update(hold, {type: "answer", id: 1, took: true})       pass {key: l, held: true}: `l` goes to the new tile
//
// No timer anywhere: a key waits for the answer to the key before it, or for the link to drop
// (`down`), when every key held goes on to the tile, in order. Only one key is out at a time, so
// the keys reach the desk and the tiles in the order they were pressed.

/** A key press as the page read it off the keyboard: enough to make the same press again. */
export const KeyPress = Schema.Struct({
	key: Schema.String,
	code: Schema.String,
	ctrl: Schema.Boolean,
	alt: Schema.Boolean,
	meta: Schema.Boolean,
	shift: Schema.Boolean,
});
export type KeyPress = typeof KeyPress.Type;

/** A key: its name, as `keyName` spells it (keys.ts), and the press itself. */
export const Key = Schema.Struct({name: Schema.String, press: KeyPress});
export type Key = typeof Key.Type;

/** The page's keys, while the host decides. */
export interface Hold {
	/** Which keys the desk takes now, as the host said last. */
	readonly takes: Takes;
	/** The key out at the host, by the id it was sent with, or none. */
	readonly waiting: {readonly id: number; readonly key: Key} | null;
	/** The keys pressed while one was out, in order. */
	readonly held: readonly Key[];
	/** The id the next key sent goes with. */
	readonly next: number;
	/** Whether the host answers: its desk came, and the link has not dropped since. */
	readonly up: boolean;
}

export type HoldMsg =
	/** The host sent its desk, with the keys the desk takes now: the link is up. */
	| {readonly type: "takes"; readonly takes: Takes}
	/** A key was pressed. */
	| {readonly type: "key"; readonly key: Key}
	/** The host's answer for the key sent with `id`: did the desk take it? */
	| {readonly type: "answer"; readonly id: number; readonly took: boolean}
	/** The link to the host dropped: nothing more will be answered. */
	| {readonly type: "down"};

const Done = Schema.Null;

/** Send the key to the host, with its id. */
export const press = Cmd.define("press", {
	input: Schema.Struct({id: Schema.Int, key: Schema.String}),
	ok: Done,
	err: [],
});
/**
 * The key goes on to the tile, as if the desk were not there. `held: false` is the key pressed
 * this instant, which the page lets go on as it is; `held: true` is one held back, which the
 * page presses again.
 */
export const pass = Cmd.define("pass", {
	input: Schema.Struct({key: Key, held: Schema.Boolean}),
	ok: Done,
	err: [],
});

export type HoldCmd = ReturnType<typeof press> | ReturnType<typeof pass>;

type Step = readonly [Hold, readonly HoldCmd[]];

/** Does the desk take this key, as the host said last? Only while the host answers. */
const taken = (s: Hold, key: Key): boolean =>
	s.up && (s.takes.all || s.takes.keys.includes(key.name));

/** Send the keys held, in order, until one is sent to the host: the rest wait for its answer. */
const release = (s: Hold, cmds: readonly HoldCmd[]): Step => {
	const out: HoldCmd[] = [...cmds];
	for (const [at, key] of s.held.entries()) {
		if (taken(s, key)) {
			const sent: Hold = {
				...s,
				waiting: {id: s.next, key},
				held: s.held.slice(at + 1),
				next: s.next + 1,
			};
			return [sent, [...out, press({id: s.next, key: key.name})]];
		}
		out.push(pass({key, held: true}));
	}
	return [{...s, held: []}, out];
};

export const holdMachine = defineMachine({
	types: {model: {} as Hold, msg: {} as HoldMsg},
	cmds: [press, pass],
	init: () => [{takes: {all: false, keys: []}, waiting: null, held: [], next: 0, up: false}, []],
	update: {
		takes: (s, m) => [{...s, takes: m.takes, up: true}, []],
		key: (s, m): Step => {
			if (s.waiting !== null) return [{...s, held: [...s.held, m.key]}, []];
			if (!taken(s, m.key)) return [s, [pass({key: m.key, held: false})]];
			return [
				{...s, waiting: {id: s.next, key: m.key}, next: s.next + 1},
				[press({id: s.next, key: m.key.name})],
			];
		},
		answer: (s, m): Step => {
			if (s.waiting === null || s.waiting.id !== m.id) return [s, []];
			const back = m.took ? [] : [pass({key: s.waiting.key, held: true})];
			return release({...s, waiting: null}, back);
		},
		// The key out is dropped: the host may have taken it. What was held goes on, in order.
		down: (s): Step => release({...s, waiting: null, up: false}, []),
		press_ok: noop,
		press_err: noop,
		pass_ok: noop,
		pass_err: noop,
	},
});
