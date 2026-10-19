import {nameOf} from "../outcome.ts";
import type {Main, ShipFacts} from "./facts.ts";
import {shipGate} from "./gate.ts";
import {type OnMain, ReadyToMerge} from "./ready.ts";

// The door of a write: what ship checks between its Cmd and the code host
// (docs/direction/read-fresh-run-alone.md). The machine's read and its write
// are two steps, and anything can land between them: another review's fail
// on the same head, red checks, a new comment, a merge onto main. So the
// handler of each write reads the facts again, puts them through the same
// gate, and writes the proof made from that read, never the one the Cmd
// carried:
//
//   const door = atTheDoor(cmd.ready, yield* readFacts(cmd.ready.pr));
//   if ("stale" in door) return "stale";        // the machine reads again
//   return yield* writes.enqueue(door.write);   // the proof made just now
//
// A straight merge, with no merge queue, has one more check: the head must
// have been tested on main as main is now (`atTheMergeDoor`). A queue tests
// the head on top of main itself, so an enqueue needs no such check.
//
// Pure, so the world model of experiment 91 answers its writes with it too.

/** What the door lets through: the proof made from the fresh read, or why the read the Cmd came from no longer holds. */
export type Door = {readonly write: ReadyToMerge} | {readonly stale: string};

/** The same for a straight merge: a proof tested on the main tip, or why not. `behind`: main moved on since the head left it. */
export type MergeDoor =
	| {readonly write: OnMain}
	| {readonly stale: string}
	| {readonly behind: Main};

/**
 * The write the machine asked for, against the facts as they are now. It goes
 * through only when the gate says go at the same head; the proof it writes is
 * the one the gate made from these facts, from every row the record holds now.
 */
export function atTheDoor(asked: ReadyToMerge, fresh: ShipFacts): Door {
	const gate = shipGate(asked.pr, fresh);
	switch (gate.answer) {
		case "stop":
			return {stale: nameOf(gate.outcome)};
		case "wait_for_checks":
			return {stale: `the checks at ${gate.head} are running`};
		case "go":
			return gate.ready.head === asked.head
				? {write: gate.ready}
				: {stale: `the head is ${gate.ready.head}, not ${asked.head}`};
	}
}

/**
 * The door of a straight merge: the door of every write, and then main. A
 * head built on a main that has moved on since was never tested with what
 * landed in between, so it does not merge: it goes back to the builder, to
 * take main in and be tested again.
 */
export function atTheMergeDoor(asked: ReadyToMerge, fresh: ShipFacts): MergeDoor {
	const door = atTheDoor(asked, fresh);
	if ("stale" in door) return door;
	const onMain = ReadyToMerge.onMain(door.write, fresh.main.tip);
	return onMain === null ? {behind: fresh.main} : {write: onMain};
}
