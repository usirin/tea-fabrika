// Does the review program answer what the old review piece answered, on the
// same real pull requests? Both read GitHub through the same reader; neither
// writes. The reviewer is scripted in both, with the same two forms worked
// out from the brief (`lib/scripted-forms.ts`), so the only thing that differs
// is the code around it: the old one-function piece, run from `main` in a
// temporary worktree, against the review machine and program of this branch.
//
//   RUBRICS=<folder with code.md, doc.md, skill.md> node experiments/65-review-old-vs-new.ts
//
// It needs `gh` signed in, for reads. No model, no key. It writes
// `results/65-review-old-vs-new.json`: per pull request and form, what each
// side answered, and a hash of the brief each handed its reviewer (the brief
// holds the rubric texts, which are not copied anywhere). The worktree is
// removed at the end, whatever happened.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {Effect, Layer} from "effect";
import {ear} from "../packages/tea-program/src/ear";
import {start, tell} from "../packages/tea-program/src/program";
import {memoryStorage} from "../packages/tea-program/src/storage";
import {gitHubCodeHost} from "../wip/src/code-host-github";
import {noSpend} from "../wip/src/draft";
import {createReview} from "../wip/src/stages/review/machine";
import {createReviewProgram, type Reviewed} from "../wip/src/stages/review/program";
import {scriptedReviewer} from "../wip/src/stages/review/scripted";
import {FORMS, type FormName} from "./lib/scripted-forms.ts";

const RUBRICS = process.env.RUBRICS;
if (RUBRICS === undefined || RUBRICS === "") {
	console.error("RUBRICS is not set: point it at a folder with code.md, doc.md and skill.md");
	process.exit(1);
}

const pr = (n: number) => `https://github.com/kamp-us/demlik/pull/${n}`;
/** Each pull request at the commit the old piece's `--head` named; `null`: its head now. */
const TARGETS: readonly {readonly pr: string; readonly head: string | null}[] = [
	{pr: pr(628), head: "6f4907a3ca552cf482652dd0f01b3aea3aa0853f"},
	{pr: pr(628), head: "b695a2af332423e6e7840236c65d31e670cb5947"},
	{pr: pr(634), head: "7c2dcc465a668d3c4c7099776dae6cc98d72f8f7"},
	{pr: pr(650), head: "4814280fbd4955f32d526b8b13d15b2e56bb981c"},
	{pr: pr(683), head: "48f1febdb7d9c1c58c59e8309f5f91adf76b467b"},
	{pr: pr(687), head: "ddfa24da42747ded10c758e177af51af4ba6c8cf"},
	{pr: pr(687), head: null},
	{pr: pr(675), head: null},
];
const NAMES: readonly FormName[] = ["pass", "fail"];

const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** What one side answered, in words both can say. `wait`: a required check is still running. */
interface Answer {
	readonly reached: "gate" | "wait" | "reviewed";
	readonly name: string | null;
	readonly head: string | null;
	readonly verdicts: unknown;
	readonly comments: string | null;
	readonly brief: string | null;
}

// ---------------------------------------------------------------- the old piece, from main

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const git = (...args: string[]) => execFileSync("git", ["-C", ROOT, ...args], {encoding: "utf8"});

/** The old side's driver: written into the worktree, run there, and gone with it. */
const DRIVER = `
import {createHash} from "node:crypto";
import {Effect, Layer} from "effect";
import {gitHubCodeHost} from "../src/code-host-github.ts";
import {alone} from "../src/stages/review/alone.ts";
import {scriptedReviewer} from "../src/stages/review/scripted.ts";
import {FORMS} from ${JSON.stringify(new URL("./lib/scripted-forms.ts", import.meta.url).href)};
const [targets, names, rubrics] = [JSON.parse(process.argv[2]), JSON.parse(process.argv[3]), process.argv[4]];
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const out = [];
for (const target of targets) for (const name of names) {
	const reviewer = scriptedReviewer((brief) => ({answer: "form", form: FORMS[name](brief), spend: {costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0}, tools: [], refused: [], links: 0}));
	const ran = await Effect.runPromise(alone({pr: target.pr, head: target.head, rubrics}).pipe(Effect.provide(Layer.mergeAll(gitHubCodeHost({own: [], reviewers: []}), reviewer.layer))));
	out.push({target, form: name, answer: {
		reached: ran.reached === "verdict" || ran.reached === "draft" ? "reviewed" : ran.reached === "read" ? "gate" : ran.reached,
		name: ran.name ?? null,
		head: ran.pack?.head ?? null,
		verdicts: ran.verdicts ?? [],
		comments: ran.comments === undefined ? null : hash(ran.comments),
		brief: reviewer.briefs[0] === undefined ? null : hash(reviewer.briefs[0]),
	}});
}
console.log(JSON.stringify(out));
`;

function runOld(): {target: (typeof TARGETS)[number]; form: FormName; answer: Answer}[] {
	const tree = mkdtempSync(join(tmpdir(), "review-old-"));
	try {
		git("worktree", "add", "--detach", tree, "main");
		symlinkSync(join(ROOT, "node_modules"), join(tree, "node_modules"));
		const driver = join(tree, "runs", "compare-old.ts");
		execFileSync("mkdir", ["-p", join(tree, "runs")]);
		writeFileSync(driver, DRIVER);
		const printed = execFileSync(
			"node",
			[driver, JSON.stringify(TARGETS), JSON.stringify(NAMES), RUBRICS as string],
			{cwd: tree, encoding: "utf8", maxBuffer: 64 * 1024 * 1024},
		);
		return JSON.parse(printed.trim().split("\n").at(-1) ?? "[]");
	} finally {
		git("worktree", "remove", "--force", tree);
		rmSync(tree, {recursive: true, force: true});
	}
}

// ---------------------------------------------------------------- the program, from this branch

/** A wait on the checks that gives up at once: the old piece did not wait, so a wait is said, not sat through. */
const program = createReviewProgram(createReview({waits: {checksMs: 1}}));

const reviewNew = (target: (typeof TARGETS)[number], name: FormName) =>
	Effect.gen(function* () {
		const reviewer = scriptedReviewer((brief) => ({
			answer: "form",
			form: FORMS[name](brief),
			spend: noSpend,
			tools: [],
			refused: [],
			links: 0,
		}));
		const verdicts = ear<Reviewed>();
		const answered = yield* Effect.gen(function* () {
			const started = yield* start(
				program,
				{rubrics: RUBRICS as string, model: "opus", effort: "medium", budget: 2},
				{verdict: verdicts.hear},
				{id: "review:experiment-65", storage: memoryStorage()},
			);
			if (started.kind !== "running") return yield* Effect.die("did not start");
			tell(
				started.run,
				"pr",
				target.head === null ? target.pr : `${target.pr}/commits/${target.head}`,
			);
			started.close("pr");
			yield* started.run.ended;
			const [verdict] = verdicts.values;
			if (verdict === undefined) return yield* Effect.die("no verdict");
			return verdict;
		}).pipe(
			Effect.scoped,
			Effect.provide(Layer.mergeAll(gitHubCodeHost({own: [], reviewers: []}), reviewer.layer)),
		);
		const waited = answered.name === "stuck:checks_stuck";
		return {
			reached: waited ? "wait" : answered.runs === 0 ? "gate" : "reviewed",
			name: waited ? null : answered.name,
			head: answered.head,
			verdicts: answered.verdicts,
			comments: answered.runs === 0 ? null : hash(answered.comments),
			brief: reviewer.briefs[0] === undefined ? null : hash(reviewer.briefs[0]),
		} satisfies Answer;
	});

// ---------------------------------------------------------------- side by side

const old = runOld();
const rows = [];
for (const {target, form, answer} of old) {
	const now = await Effect.runPromise(reviewNew(target, form));
	const same = JSON.stringify(answer) === JSON.stringify(now);
	rows.push({target, form, same, old: answer, new: now});
	console.log(
		`${target.pr.split("/").at(-1)} ${(target.head ?? "now").slice(0, 7)} ${form.padEnd(4)} ${same ? "same" : "DIFFERENT"}  old ${answer.reached} ${answer.name ?? "-"}  new ${now.reached} ${now.name ?? "-"}`,
	);
}
const out = new URL("./results/65-review-old-vs-new.json", import.meta.url);
writeFileSync(
	out,
	`${JSON.stringify({at: new Date().toISOString(), same: rows.filter((r) => r.same).length, of: rows.length, rows}, null, 2)}\n`,
);
console.log(
	`\n${rows.filter((r) => r.same).length} of ${rows.length} the same. Saved results/65-review-old-vs-new.json`,
);
