import {Effect, Stream} from "effect";
import type {Adapter, AdapterTurn, Raw} from "./turn.ts";

// The fake adapter: no model, no process. Each turn plays a script of what a
// maker would have said, so a stage, and the interface's own laws, run in a
// test with no key and no network.

/** What one fake turn says. `hang`: it never ends on its own, as an agent stuck in a command. */
export interface FakeScript {
	readonly raws: readonly Raw[];
	readonly hang?: boolean;
}

/** What the fake saw, for a test to hold the interface to. */
export interface FakeSeen {
	readonly started: AdapterTurn[];
	/** Gentle stops asked of it. */
	stopped: number;
	/** Scopes closed: its process killed, had it one. */
	closed: number;
}

export const fakeAdapter = (
	script: (turn: AdapterTurn, n: number) => FakeScript,
	holds: Adapter["holds"] = {usd: false, schema: false},
): Adapter & {readonly seen: FakeSeen} => {
	const seen: FakeSeen = {started: [], stopped: 0, closed: 0};
	return {
		name: "fake",
		holds,
		seen,
		start: (turn) =>
			Effect.gen(function* () {
				seen.started.push(turn);
				const n = seen.started.length;
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						seen.closed += 1;
					}),
				);
				const {raws, hang = false} = script(turn, n);
				const opened: Raw = {_tag: "opened", own: turn.resume ?? `fake-own-${n}`};
				return {
					updates: Stream.concat(
						Stream.fromIterable([opened, ...raws]),
						hang ? Stream.never : Stream.empty,
					),
					pid: null,
					stop: Effect.sync(() => {
						seen.stopped += 1;
					}),
				};
			}),
	};
};

/** A turn that does the plain thing: says `text` and ends. */
export const saying = (text: string): FakeScript => ({
	raws: [
		{_tag: "said", text},
		{_tag: "ended", stop: "end_turn", structured: undefined, usd: null, requests: 1},
	],
});
