// The first piece of the review stage, run alone on one pull request.
//
//   node src/stages/review/run.ts <pull request url> --rubrics <folder> --repo <local clone>
//        [--head <commit>] [--model <name>] [--effort low|medium|high] [--max-usd <dollars>]
//
// It only reads. It never writes to GitHub: no comment, no label, no review.
// It reads the pack, stops there when the gate says so (a red required check
// stops it before any agent starts), and otherwise runs one reviewer.
//
// `--rubrics`  the folder the rubric texts are read from: `code.md`, `doc.md`,
//              `skill.md`. A setting; none is kept in this repo.
// `--repo`     a local clone that holds the commit. It is read with
//              `git archive`; nothing is fetched into it or checked out in it.
// `--head`     review an older commit of the pull request again, named whole.
//              Left out: its head now.
// `--max-usd`  what the one reviewer run may cost. 2 when left out.
//
// It prints, in order: a short summary of the pack, the sheet as JSON, the
// verdict of each kind, the outcome and its name, the comments it would post
// (it posts none), then the cost in dollars, both token counts and the
// minutes. The whole run is saved as JSON under `runs/review/`, which git
// does not track.
import {mkdirSync, writeFileSync} from "node:fs";
import {Effect, Layer} from "effect";
import {gitHubCodeHost, prOf} from "../../code-host-github.ts";
import {type Alone, alone, planOf, USAGE} from "./alone.ts";
import {NOT_IN_THE_PACK, type Pack} from "./pack.ts";
import {liveReviewer} from "./reviewer.ts";

const plan = planOf(process.argv.slice(2));
if (plan === null) {
	console.error(USAGE);
	process.exit(1);
}
console.error(`mode: read only. Nothing on ${plan.pr} will be changed.`);

const started = Date.now();
// This piece reads no account: the two lists are for the ship stage's facts.
const layers = Layer.mergeAll(gitHubCodeHost({own: [], reviewers: []}), liveReviewer(plan));
const ran: Alone = await Effect.runPromise(alone(plan).pipe(Effect.provide(layers)));
const minutes = (Date.now() - started) / 60_000;

/** The pack without its long texts: what it holds, in a few lines. */
const summaryOf = (pack: Pack) => ({
	pr: pack.pr,
	head: pack.head,
	replay: pack.replay,
	state: pack.state,
	ticket: pack.ticket,
	criteria: pack.criteria === null ? null : pack.criteria.length,
	files: pack.files === null ? null : pack.files.length,
	kinds: pack.kinds,
	diffChars: pack.diff === null ? null : pack.diff.length,
	deviations: pack.deviations.state,
	checks: pack.checks,
	rubrics: pack.rubrics.map((rubric) => ({
		kind: rubric.kind,
		chars: rubric.text === null ? null : rubric.text.length,
	})),
});

const say = (title: string, body: unknown) =>
	console.log(
		`\n=== ${title} ===\n${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`,
	);

if (ran.reached !== "read") say("pack", summaryOf(ran.pack));
if (ran.reached === "wait")
	say(
		"next",
		"a required check is still running at this commit, or none has reported. A machine would wait and read again. This run does not wait, and started no reviewer.",
	);
if (ran.reached === "draft") say("the reviewer left no sheet", ran.problems);
if (ran.reached === "verdict") {
	say("sheet", ran.sheet);
	say("verdict per kind", ran.verdicts);
}
if (ran.reached !== "wait") say("outcome", {name: ran.name, outcome: ran.outcome});
if (ran.reached === "verdict")
	for (const comment of ran.comments) say(`comment for ${comment.kind} (not posted)`, comment.text);
if (ran.reached === "draft" || ran.reached === "verdict") {
	const {spend, tools, refused} = ran.ran;
	say("cost", {
		dollars: spend.costUsd,
		tokensBilled: spend.tokens,
		tokensContext: spend.context,
		turns: spend.turns,
		agentMinutes: Number(spend.minutes.toFixed(2)),
		toolCalls: tools.length,
		refused,
	});
} else {
	say("cost", "no agent was started: 0 dollars");
}
say("whole run, minutes", minutes.toFixed(2));

// The saved run: everything above as data. The rubric texts are left out, so a rubric is never copied anywhere by this.
const at = prOf(plan.pr);
const folder = new URL("../../../runs/review/", import.meta.url);
mkdirSync(folder, {recursive: true});
const head = ran.reached === "read" ? (plan.head ?? "unread") : ran.pack.head;
const file = new URL(
	`${at?.owner}-${at?.name}-${at?.number}-${head.slice(0, 7)}-${started}.json`,
	folder,
);
const kept =
	ran.reached === "read"
		? ran
		: {...ran, pack: {...ran.pack, rubrics: summaryOf(ran.pack).rubrics}};
const {repo: _clone, rubrics: _folder, ...asked} = plan;
writeFileSync(
	file,
	`${JSON.stringify({at: new Date(started).toISOString(), asked, minutes, notInThePack: NOT_IN_THE_PACK, ...kept}, null, 2)}\n`,
);
console.error(`saved: runs/review/${file.pathname.split("/").at(-1)}`);
