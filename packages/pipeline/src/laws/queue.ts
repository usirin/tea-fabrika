import {queue, type Waiting} from "../stages/queue.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The kept work queue under every order of messages: its world and its laws.
//
// It has no Cmds. Its world is the host's own code (`workQueue`, `drop`):
// a value told at any time, the first value's work ending, a value tidied
// after its work, and a value dropped by `drop`. Three values are enough to
// put one behind another.

export type AnyQueueMsg = MsgOf<typeof queue>;
type Msg = AnyQueueMsg;
type Cmd = never;
const queueUpdate = stepOf<Waiting, Msg, Cmd>(queue);

const VALUES = ["a", "b", "c"] as const;

export function queueWorld(): World<Waiting, Msg, Cmd> {
	return {
		outside: (s) => [
			...VALUES.flatMap((item): Msg[] => [
				{type: "told", item},
				{type: "dropped", item},
			]),
			// The worker ends only the first value's work, and tidies only what it ended.
			...(s.items[0] === undefined ? [] : [{type: "done" as const, item: s.items[0]}]),
			...s.clearing.map((item): Msg => ({type: "cleared", item})),
		],
		answers: () => [],
	};
}

const firstOf = (s: Waiting): string | null => s.items[0] ?? null;

export function queueLaws<S extends Waiting>(): readonly Law<S, Msg, Cmd>[] {
	return [
		law<S, Msg, Cmd>("a value is on the queue once", ({next}) => {
			const twice = next.items.find((item, i) => next.items.indexOf(item) !== i);
			return twice === undefined ? null : `${twice} is on the queue twice`;
		}),
		law<S, Msg, Cmd>(
			"the value being worked stays first until its work ends",
			({prev, msg, next}) => {
				const first = firstOf(prev);
				if (first === null || (msg.type === "done" && msg.item === first)) return null;
				return firstOf(next) === first
					? null
					: `${first} was being worked, and after ${msg.type} ${msg.item} the first is ${firstOf(next) ?? "nothing"}`;
			},
		),
		law<S, Msg, Cmd>("values are worked in the order told", ({prev, next}) => {
			const kept = prev.items.filter((item) => next.items.includes(item));
			const head = next.items.slice(0, kept.length);
			return kept.join(",") === head.join(",")
				? null
				: `the queue was ${prev.items.join(",")} and is now ${next.items.join(",")}`;
		}),
		watched<S, Msg, Cmd, readonly string[]>(
			"work that ended is tidied before it is forgotten",
			[],
			(owed, {msg, next}) => {
				const now =
					msg.type === "done"
						? [...new Set([...owed, msg.item])]
						: msg.type === "cleared"
							? owed.filter((item) => item !== msg.item)
							: owed;
				const lost = now.filter((item) => !next.clearing.includes(item));
				return lost.length === 0
					? [...now].sort()
					: broke(`${lost.join(", ")} ended and is no longer owed its tidy`);
			},
		),
	];
}

export const queueInit: Waiting = {items: [], clearing: []};
export const queueStep: Update<Waiting, Msg, Cmd> = queueUpdate;

export const showQueueMsg = (m: Msg): string => `${m.type} ${m.item}`;

// ---------------------------------------------------------------- planted mistakes

/** A value told again while it waits is queued again. */
export const queuesTwice: Update<Waiting, Msg, Cmd> = (s, m) =>
	m.type === "told" && s.items.includes(m.item)
		? [{...s, items: [...s.items, m.item]}, []]
		: queueUpdate(s, m);

/** `drop` takes the value being worked off the queue too. */
export const dropsTheWorked: Update<Waiting, Msg, Cmd> = (s, m) =>
	m.type === "dropped"
		? [{...s, items: s.items.filter((i) => i !== m.item)}, []]
		: queueUpdate(s, m);

/** A value told goes to the front, ahead of the ones waiting. */
export const jumpsTheQueue: Update<Waiting, Msg, Cmd> = (s, m) =>
	m.type === "told" && !s.items.includes(m.item)
		? [{...s, items: [...s.items.slice(0, 1), m.item, ...s.items.slice(1)]}, []]
		: queueUpdate(s, m);

/** A value whose work ended leaves the queue with nothing owed: its tidy is never run. */
export const forgetsTheTidy: Update<Waiting, Msg, Cmd> = (s, m) =>
	m.type === "done" ? [{...s, items: s.items.filter((i) => i !== m.item)}, []] : queueUpdate(s, m);
