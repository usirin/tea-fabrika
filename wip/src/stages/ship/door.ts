import {nameOf} from "../outcome.ts";
import type {ShipFacts} from "./facts.ts";
import {shipGate} from "./gate.ts";
import type {ReadyToMerge} from "./ready.ts";

// The door of a write: what ship checks between its Cmd and the code host
// (docs/direction/read-fresh-run-alone.md). The machine's read and its write
// are two steps, and anything can land between them: another review's fail
// on the same head, red checks, a new comment. So the handler of each write
// reads the facts again, puts them through the same gate, and writes the
// proof made from that read, never the one the Cmd carried:
//
//   const door = atTheDoor(cmd.ready, yield* readFacts(cmd.ready.pr));
//   if ("stale" in door) return "stale";        // the machine reads again
//   return yield* writes.enqueue(door.write);   // the proof made just now
//
// Pure, so the world model of experiment 91 answers its writes with it too.

/** What the door lets through: the proof made from the fresh read, or why the read the Cmd came from no longer holds. */
export type Door = {readonly write: ReadyToMerge} | {readonly stale: string};

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
