// The review program (./program.ts), started from a command line. Each url is
// told to its input `pr`, in order, and then the input is closed, like the
// end of stdin: the program answers the last one and ends on its own.
//
//   node src/stages/review/run.ts <pull request url>... --rubrics <folder> --repo <local clone>
//        [--model <name>] [--effort low|medium|high] [--budget <dollars>]
//
// It only reads. It never writes to GitHub: no comment, no label, no review,
// no issue. A url ending in `/commits/<the whole commit>` reviews that commit
// again: a merged pull request is reviewed that way.
//
// `--rubrics`  the folder the rubric texts are read from: `code.md`, `doc.md`,
//              `skill.md`. None is kept in this repo.
// `--repo`     a local clone that holds each commit. It is read with
//              `git archive`; nothing is fetched into it or checked out in it.
// `--budget`   what one reviewer run may cost, in dollars. 2 when left out.
//
// For each pull request it prints, as JSON, each note the reviewer filed as
// it filed it, then the verdict: the outcome and its name, each criterion met
// or open, the verdict of each kind, the comments it would post (it posts
// none), and the cost. A pull request that met every criterion is printed
// once more as `passed`. Each verdict is saved under `runs/review/`, which git
// does not track.
import {mkdirSync, writeFileSync} from "node:fs";
import {Effect} from "effect";
import {gitHubCodeHost, prOf} from "../../code-host-github.ts";
import {checked, launch, modeLine, planOf, USAGE} from "./launch.ts";
import type {Reviewed} from "./program.ts";
import {liveReviewer} from "./reviewer.ts";

const plan = planOf(process.argv.slice(2));
if (plan === null) {
	console.error(USAGE);
	process.exit(1);
}
const bad = checked(plan);
if (bad !== undefined) {
	console.error(`bad_shape: ${bad.name} does not fit. ${bad.why}`);
	process.exit(1);
}
console.error(modeLine(plan));

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const folder = new URL("../../../../../runs/review/", import.meta.url);
/** The verdict as data, kept. It holds no rubric text: the comments quote the sheet, not a rubric. */
const keep = (reviewed: Reviewed) => {
	const at = prOf(reviewed.pr);
	mkdirSync(folder, {recursive: true});
	const name = `${at?.owner}-${at?.name}-${at?.number}-${(reviewed.head ?? "unread").slice(0, 7)}-${Date.now()}.json`;
	writeFileSync(new URL(name, folder), `${JSON.stringify(reviewed, null, 2)}\n`);
	console.error(`saved: runs/review/${name}`);
};

await Effect.runPromise(
	launch(
		plan,
		// This program reads no account: the two lists are for the ship stage's facts.
		{reads: () => gitHubCodeHost({own: [], reviewers: []}), reviewer: () => liveReviewer(plan)},
		{
			note: (note) => print({note}),
			verdict: (reviewed) => {
				print({verdict: reviewed});
				keep(reviewed);
			},
			passed: (pr) => print({passed: pr}),
		},
	),
);
