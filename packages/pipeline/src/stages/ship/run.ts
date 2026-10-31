// The ship program (./program.ts), started from a command line. Each url is
// told to its input `pr`, in order, and then the input is closed, like the
// end of stdin: the program answers the last one and ends on its own.
//
//   node src/stages/ship/run.ts <pull request url>... --own <account>[,<account>] [--reviewers <account>[,<account>]] [--write]
//
// Without `--write` it only reads. It prints, as JSON, for each pull request:
// the facts read from GitHub, what the machine answers, and the write it would
// send next (the enqueue, or a re-run of red checks). It sends nothing.
//
// With `--write` the machine runs to its end on each REAL pull request, one
// after another: it may put it in the merge queue, and it may start its red
// checks again. It prints each outcome. Stop it with Ctrl-C: a pull request
// already in the queue stays there, and is taken out by hand on GitHub.
//
// A url that is not a pull request's is refused before anything runs, as
// `bad_shape`. Otherwise the first line it prints, on stderr, says which mode
// it is in.
//
// It merges nothing yet: the verdict rows a merge needs are kept by the review
// that made them, and a run started here has none, so each pull request is
// sent back to the reviewer.
//
// `--own` names the accounts the repo treats as its own: who may open a pull
// request this machine lands. `--reviewers` names the accounts whose review
// verdicts count; left out, they are the same accounts.
import {Effect} from "effect";
import {gitHubCodeHostWrites} from "../../code-host-github-writes.ts";
import {gitHubCodeHost} from "../../code-host-github.ts";
import {memoryRecord} from "../../criteria/record.ts";
import {checked, launch, modeLine, planOf, shown} from "./launch.ts";

const plan = planOf(process.argv.slice(2));
if (plan === null) {
	console.error(
		"usage: node src/stages/ship/run.ts <pull request url>... --own <account>[,<account>] [--reviewers <account>[,<account>]] [--write]",
	);
	process.exit(1);
}
const bad = checked(plan);
if (bad !== undefined) {
	console.error(`bad_shape: the input ${bad.name} does not fit. ${bad.why}`);
	process.exit(1);
}
console.error(modeLine(plan));

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
await Effect.runPromise(
	launch(
		plan,
		{
			reads: () => gitHubCodeHost(plan),
			writes: () => gitHubCodeHostWrites(),
			// No review ran in this process, so no ticket has verdict rows here.
			record: () => memoryRecord().layer,
		},
		{
			found: (found) => print(shown(found)),
			outcome: (shipped) => print({mode: "write", ...shipped}),
		},
	),
);
