// The ship machine, run alone on one pull request.
//
//   node src/stages/ship/run.ts <pull request url> --own <account>[,<account>] [--reviewers <account>[,<account>]] [--write]
//
// Without `--write` it only reads. It prints, as JSON: the facts read from
// GitHub, what the machine answers, and the write it would send next (the
// enqueue, or a re-run of red checks). It sends nothing.
//
// With `--write` the machine runs to its end on a REAL pull request: it may
// put it in the merge queue, and it may start its red checks again. It prints
// the outcome. Stop it with Ctrl-C: a pull request already in the queue stays
// there, and is taken out by hand on GitHub.
//
// The first line it prints, on stderr, says which mode it is in.
//
// `--own` names the accounts the repo treats as its own: who may open a pull
// request this machine lands. `--reviewers` names the accounts whose review
// verdicts count; left out, they are the same accounts.
import {Effect} from "effect";
import {gitHubCodeHost, NOT_READ} from "../../code-host-github.ts";
import {gitHubCodeHostWrites} from "../../code-host-github-writes.ts";
import {alone, modeLine, planOf} from "./alone.ts";

const plan = planOf(process.argv.slice(2));
if (plan === null) {
	console.error(
		"usage: node src/stages/ship/run.ts <pull request url> --own <account>[,<account>] [--reviewers <account>[,<account>]] [--write]",
	);
	process.exit(1);
}
console.error(modeLine(plan));

const ran = await Effect.runPromise(
	alone(plan, {reads: () => gitHubCodeHost(plan), writes: () => gitHubCodeHostWrites()}),
);
if (ran.mode === "write") {
	console.log(JSON.stringify(ran, null, 2));
} else {
	const {found} = ran;
	const next =
		found.wouldSend?.type === "ship_enqueue"
			? "would enqueue: not sent, this run only reads"
			: found.wouldSend?.type === "ship_rerun_checks"
				? "would run the red checks again, once: not sent, this run only reads"
				: found.wouldWaitFor === "checks"
					? "would wait for the checks on this head, then read again: this run does not wait"
					: found.facts === null
						? "nothing: the pull request could not be read"
						: "nothing: the machine stops here with this outcome";
	console.log(JSON.stringify({...found, next, notRead: NOT_READ}, null, 2));
}
