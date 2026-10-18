import type {Env} from "@tea-fabrika/tsh/launch";
import {type ProgramList, programList} from "@tea-fabrika/tsh/programs";
import {SMALL} from "@tea-fabrika/tsh/small";
import {acpEntry} from "../agents/acp/program.ts";
import {fabrikaEntries} from "./fabrika.ts";
import {scriptedBuildEntry} from "./scripted-build.ts";

// The programs fabrika's tsh lists (./fabrika-main.ts starts tsh with them).
// tsh itself lists nothing: it is handed this list. Read from the
// environment, like tsh's own settings (./launch.ts):
//
//   TSH_OWN        the accounts the repos treat as their own, for ship's facts: a,b
//   TSH_REVIEWERS  the accounts whose review verdicts count. TSH_OWN when left out.
//   TSH_CLONE      a local clone the live reviewer reads code from. Left out: no live review.
//   TSH_WORK       the folder build and operate keep their clones and working copies in,
//                  one folder per repository. Left out: neither is listed.
//   TSH_SCRIPTED   a folder: `build-scripted` is listed, a build that writes nowhere and
//                  notes what it does there (./scripted-build.ts). For a test. Left out: not listed.

const accounts = (text: string | undefined): readonly string[] =>
	(text ?? "").split(",").filter((login) => login.trim() !== "");

/** Every program fabrika's tsh lists, from the environment: the small ones, acp (an ACP client), ship, review, and build and operate given a folder to work in. */
export function programsOf(env: Env): ProgramList {
	const own = accounts(env.TSH_OWN);
	const reviewers = accounts(env.TSH_REVIEWERS);
	const clone = env.TSH_CLONE;
	const work = env.TSH_WORK;
	const scripted = env.TSH_SCRIPTED;
	return programList([
		...SMALL,
		acpEntry,
		...(scripted === undefined || scripted === "" ? [] : [scriptedBuildEntry(scripted)]),
		...fabrikaEntries({
			own,
			reviewers: reviewers.length === 0 ? own : reviewers,
			...(clone === undefined || clone === "" ? {} : {clone}),
			...(work === undefined || work === "" ? {} : {work}),
		}),
	]);
}
