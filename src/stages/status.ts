import type {Build} from "./build/machine.ts";
import type {Loop} from "./operate/machine.ts";
import type {AnyOutcome} from "./outcome.ts";
import type {Waiting} from "./queue.ts";
import type {Review} from "./review/machine.ts";
import type {Ship} from "./ship/machine.ts";
import {refOf} from "./traced.ts";

// Each stage machine's status line: where one copy stands, in a few plain
// words a person reads in `jobs`, read from its state alone. A program
// declares them on `defineProgram` (../program/program.ts), one per machine:
//
//   #597: waiting on checks          review, one copy per pull request
//   #596: done, passed
//   #6 round 1: reviewing PR #8      operate's loop, one copy per ticket
//   #6: done after 1 round
//
// The pull request or ticket comes first, so the copies of one machine read
// apart. Short on purpose: a line fits tsh's width beside its indent.

/** A url as `#n`; anything else as it is. */
const ref = (url: string): string => refOf(url) ?? url;

/** An outcome's word, with its underscores as spaces: `checks_red` reads `checks red`. */
const words = (word: string): string => word.replaceAll("_", " ");

/** How a copy ended, in words. `done`: what a whole `done` says for this stage. */
export const endedAs = (outcome: AnyOutcome, done: string): string => {
	switch (outcome.kind) {
		case "done":
			return outcome.part ? `${done}, in part` : done;
		case "send":
			return `sent to ${outcome.to}: ${words(outcome.why)}`;
		case "ask":
			return `asks ${outcome.who}: ${words(outcome.for)}`;
		case "skip":
			return `skipped (${words(outcome.why)})`;
		case "stuck":
			return `stuck: ${words(outcome.why)}`;
	}
};

/** A count with its noun: `1 round`, `2 rounds`. */
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The queue a stage works its values from: the one it works now, and how many wait behind it. */
export const queueLine = (s: Waiting): string => {
	const [first, ...rest] = s.items;
	if (first === undefined) return "nothing waiting";
	return `${ref(first)} now, ${rest.length === 0 ? "nothing else" : rest.length} waiting`;
};

/** One review of one pull request. */
export const reviewLine = (s: Review): string => {
	if (s.phase === "idle") return "not started";
	const at = ref(s.ask.pr);
	switch (s.phase) {
		case "gathering":
			return `${at}: reading the pull request`;
		case "waiting":
			return `${at}: waiting on checks`;
		case "reviewing":
			return `${at}: reviewer at work${s.run > 1 ? `, run ${s.run}` : ""}`;
		case "judging":
			return `${at}: filing notes`;
		case "over":
			return `${at}: ${endedAs(s.outcome, "done, passed")}`;
	}
};

/** One ship of one pull request. */
export const shipLine = (s: Ship): string => {
	if (s.phase === "idle") return "not started";
	const at = ref(s.pr);
	switch (s.phase) {
		case "reading":
			return `${at}: reading the pull request`;
		case "rerunning":
			return `${at}: starting red checks again`;
		case "waiting":
			return `${at}: waiting on checks`;
		case "enqueueing":
			return `${at}: putting it in the merge queue`;
		case "queued":
			return `${at}: in the merge queue`;
		case "finishing":
			return `${at}: merged, tidying up`;
		case "over":
			return `${at}: ${endedAs(s.outcome, "merged")}`;
	}
};

/** One build round of one ticket. */
export const buildLine = (s: Build): string => {
	if (s.phase === "idle") return "not started";
	const at = `${ref(s.ask.ticket)} round ${s.ask.round}`;
	switch (s.phase) {
		case "reading":
			return `${at}: reading the ticket`;
		case "copying":
			return `${at}: making a working copy`;
		case "building":
			return `${at}: builder at work${s.run > 1 ? `, run ${s.run}` : ""}`;
		case "pushing":
			return `${at}: pushing the branch`;
		case "opening":
			return `${at}: opening the pull request`;
		case "over":
			return `${at}: ${endedAs(s.outcome, s.outcome.kind === "done" ? `done, PR ${ref(s.outcome.pr)}` : "done")}`;
	}
};

/** One ticket's loop in operate: which stage of which round it is in, and how it ended. */
export const loopLine = (s: Loop): string => {
	if (s.phase === "idle") return "not started";
	const ticket = ref(s.ticket);
	switch (s.phase) {
		case "building":
			return `${ticket} round ${s.round}: building`;
		case "reviewing":
			return `${ticket} round ${s.round}: reviewing PR ${ref(s.pr)}`;
		case "posting":
			return `${ticket} round ${s.round}: posting the review on PR ${ref(s.pr)}`;
		case "shipping":
			return `${ticket}: shipping PR ${ref(s.pr)}`;
		case "over": {
			const rounds = s.rounds.length === 0 ? "" : ` after ${counted(s.rounds.length, "round")}`;
			return `${ticket}: ${endedAs(s.outcome, "done")}${rounds}`;
		}
	}
};
