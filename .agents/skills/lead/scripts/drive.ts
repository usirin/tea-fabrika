// drive.ts: run one step end to end in plain code, on a Codex box or a Claude agent, so no agent
// waits on it. Today's lead tooling, run on our own laptop; it is not product. Run it in the
// background and read the last line only: one JSON object with the outcome, the new head and the
// report's path.
//
//   node drive.ts <lane> <plan|tests|build|mutation|review> <brief-file> [--agent codex|claude]
//                 [--model sonnet|opus] [--electron] [--from <ref>] [--ticket <n>]
//                 [--branch fabrikalfa/<name>] [--plan <approved plan>] [--plan-only]
//
// Claude runs `claude -p` in the same kind of box, under sandbox-exec: it cannot read the step keys,
// the leak words or Codex's login, and it writes only its box. It commits with plain git; drive
// then signs its work as one commit through stepcommit, with main's own signer. Mutation runs on
// Claude only (it binds ports and starts Electron), one Electron step at a time. The box cannot
// write state/electron.lock, so drive holds it for the whole step, outside the box: for mutation,
// and for a Claude step started with --electron (a step whose laws or shots run the app).
//
// The step is a tea machine on the Effect engine, made of the pipeline's moves:
//
//   (before)           box.sh gc, then a refusal when the data volume has under 20 GB free, or
//                      when a worktree of the main checkout holds the lane's branch
//   starting   Act     box.sh new, at the lane's head
//   drafting   Draft   a Sub: Codex (box.sh run) or Claude (claude -p) in the box, waited on
//   reading    Gather  fetch (and sign Claude's work), then the commits, their step notes, exam
//                      paths, leaks and the report
//   (update)   Check   pure: what the step answered and what the reads found make one outcome
//                      (a manifest the lockfile must follow, changed with the lockfile left alone,
//                      is an ask: a box has no network, so the lead refreshes it outside)
//   pushing    Act     botpush the backup branch, <branch>-wip (a -wip branch as it is), when
//                      the step committed
//   recording  Act     the field row, state/<lane>.json and .md, and the box removed unless stuck
//                      or it still holds work no branch has (uncommitted files, commits off the
//                      step's branch); the outcome line's reason then says what was kept
//   over               the outcome
//
// Exit codes: 0 done, 10 send to tests, 11 send to build, 12 send to plan, 20 ask (a question for
// the lead, in `reason`), 30 stuck, 40 skip (nothing here for the step, such as a mutation step
// whose diff has no product lines; the why is in `reason`), 2 usage, 3 refused to start (8 agents running: Codex boxes plus
// Claude steps drive started, under 20 GB free after box.sh gc, or the lane's branch checked out in
// a worktree, which the fetch could not update). It never retries. A stuck step
// keeps its box for the lead to look at, and so does any step whose box still holds uncommitted
// files or commits off its branch. DRIVE_MINUTES (default 60) is how long the agent may run
// before it is stopped and the step is stuck.

import {spawn, spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {defineMachine, type Sub} from "@demlik/tea";
import {run} from "@demlik/tea/effect";
import {act, gather, intentOf, listen} from "@kampus/pipeline/primitives";
import {nameOf, outcomesOf} from "@kampus/pipeline/stages/outcome";
import {Effect, Schema, Stream} from "effect";
import {
	checkHolds,
	laneRoot,
	lockfileBehind,
	startHead,
	stepOf,
	wipOf,
	workspaceGlobs,
} from "./lane.ts";

const HERE = import.meta.dirname;
const STEPS = ["plan", "tests", "build", "mutation", "review"] as const;
type StepName = (typeof STEPS)[number];
const AGENTS = ["codex", "claude"] as const;

// ---------------------------------------------------------------- the outcome

const drive = outcomesOf({
	done: {head: Schema.String},
	send: {
		tests: ["exam_paths", "step_said"],
		build: ["step_said"],
		plan: ["plancheck", "step_said"],
	},
	ask: {lead: ["question", "lockfile"]},
	skip: ["step_said"],
	stuck: [
		"box_failed",
		"agent_failed",
		"sign_failed",
		"timeout",
		"fetch_failed",
		"read_failed",
		"record_failed",
		"review_committed",
		"unsigned",
		"leak",
		"no_answer",
		"no_commit",
		"push_failed",
		"step_said",
	],
});
type Outcome = typeof drive.schema.Type;

const exitOf = (o: Outcome): number => {
	switch (o.kind) {
		case "done":
			return 0;
		case "send":
			return o.to === "tests" ? 10 : o.to === "build" ? 11 : 12;
		case "ask":
			return 20;
		case "skip":
			return 40;
		default:
			return 30;
	}
};

/** The field row's outcome word for a drive outcome's name (field/README.md, a `step` row). */
export const rowOf = (outcome: string): string =>
	({done: "pass", send: "fail", ask: "parked", skip: "skip"})[outcome.split(":")[0] ?? ""] ??
	"stopped";

// ---------------------------------------------------------------- the moves

const Ask = Schema.Struct({
	lane: Schema.String,
	step: Schema.Literals(STEPS),
	agent: Schema.Literals(AGENTS),
	/** Claude's model and session; Codex reads CODEX_MODEL and leaves both empty. */
	model: Schema.String,
	session: Schema.String,
	ticket: Schema.String,
	/** The approved plan box.sh checks at every start and step. */
	plan: Schema.String,
	branch: Schema.String,
	base: Schema.String,
	/** Where the lane left main. The commits check reads the whole lane from here, so the earlier
	 * steps' links are in its chain and the newest of each is not stale. */
	root: Schema.String,
	box: Schema.String,
	run: Schema.String,
	prompt: Schema.String,
	report: Schema.String,
	events: Schema.String,
	err: Schema.String,
	minutes: Schema.Number,
	/** When this run started, in ms: a report older than this is not this run's. */
	started: Schema.Number,
});
type Ask = typeof Ask.Type;

const Read = Schema.Struct({
	/** `null`: the fetch failed, with why in `problem`. */
	head: Schema.NullOr(Schema.String),
	commits: Schema.Number,
	unsigned: Schema.Array(Schema.String),
	exam: Schema.Array(Schema.String),
	/** `file:line` of each added line that leaks; never the text. */
	leaks: Schema.Array(Schema.String),
	/** Work the box holds that no branch has, as `N uncommitted files` or `N commits off <branch>`;
	 * a box with any is never removed. */
	left: Schema.Array(Schema.String),
	/** Manifests the step changed that pnpm-lock.yaml must follow, with the lockfile left alone. */
	manifests: Schema.Array(Schema.String),
	/** What `plancheck --draft` said when it failed; `null` when it passed or did not run. */
	plancheck: Schema.NullOr(Schema.String),
	report: Schema.String,
	problem: Schema.NullOr(Schema.String),
});
type Read = typeof Read.Type;

const Done = Schema.Struct({ok: Schema.Boolean, detail: Schema.String});

const boxNew = act("box_new", {input: Ask, ok: Done, err: ["unknown"]});
const stepRead = gather("step_read", {input: Ask, ok: Read, err: ["unknown"]});
const backupPush = act("backup_push", {
	input: Schema.Struct({ask: Ask, head: Schema.String}),
	ok: Done,
	err: ["unknown"],
});
const Entry = Schema.Struct({
	ask: Ask,
	outcome: Schema.String,
	why: Schema.String,
	head: Schema.String,
	exit: Schema.Number,
	keep: Schema.Boolean,
});
const record = act("record", {input: Entry, ok: Done, err: ["unknown"]});

type Cmds =
	| ReturnType<typeof boxNew>
	| ReturnType<typeof stepRead>
	| ReturnType<typeof backupPush>
	| ReturnType<typeof record>;

type DraftSub = Sub<"draft", Ask>;
type Drafted = {readonly type: "drafted"; readonly code: number | null; readonly timedOut: boolean};

type Model =
	| {readonly phase: "idle"}
	| {readonly phase: "starting" | "drafting"; readonly ask: Ask}
	| {readonly phase: "reading"; readonly ask: Ask}
	| {
			readonly phase: "pushing";
			readonly ask: Ask;
			readonly outcome: Outcome;
			readonly why: string;
			readonly head: string;
			readonly left: readonly string[];
	  }
	| {
			readonly phase: "recording" | "over";
			readonly ask: Ask;
			readonly outcome: Outcome;
			readonly why: string;
			readonly head: string;
			readonly kept: boolean;
	  };
type Msg = {readonly type: "start"; readonly ask: Ask} | Drafted;

// ---------------------------------------------------------------- the Check

const ANSWER = /^[`*\s]*answer:\s*(done|send\s+(tests|build|plan)|ask|skip|stuck)\b[`*\s]*(.*)$/i;

/** What the step said on its last `answer:` line; a review's verdict line counts without one. */
const answerOf = (step: StepName, report: string) => {
	const lines = report
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	for (const line of lines.toReversed()) {
		const m = ANSWER.exec(line);
		if (m) {
			const verb = (m[1] ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
			const why = (m[3] ?? "").replace(/^[`*\s]+|[`*\s]+$/g, "");
			return {verb, to: m[2]?.toLowerCase() ?? "", why};
		}
	}
	const first = (lines[0] ?? "").replace(/^[`*#\s]+/, "");
	if (step === "review" && /^merge-ready/i.test(first))
		return {verb: "done", to: "", why: "merge-ready"};
	if (step === "review" && /^changes/i.test(first)) return {verb: "send", to: "build", why: first};
	return null;
};

const GREEN = /^[`* \t]*laws:[ \t]*green\b[`* \t:]*(.*)$/im;

/** A build that changed nothing says which laws it ran green with a `laws: green <paths>` line.
 * The head is the tests step's, already checked, and the mutation step's baseline reruns them. */
const greenOf = (report: string) => {
	const m = GREEN.exec(report);
	if (m === null) return null;
	return (m[1] ?? "").replace(/[`*\s]+$/, "") || "laws named";
};

type Judged = {readonly outcome: Outcome; readonly why: string};
const stuck = (why: Extract<Outcome, {kind: "stuck"}>["why"], text: string): Judged => ({
	outcome: {kind: "stuck", why},
	why: text,
});

/** The Check, pure: what the reads found wins over what the step said. */
const decide = (ask: Ask, read: Read): Judged => {
	if (read.head === null) return stuck("fetch_failed", read.problem ?? "fetch failed");
	if (read.problem !== null) return stuck("read_failed", read.problem);
	if (ask.step === "review" && read.head !== ask.base)
		return stuck("review_committed", `the review moved the head to ${read.head.slice(0, 8)}`);
	if (read.unsigned.length > 0) return stuck("unsigned", read.unsigned.slice(0, 5).join("; "));
	if (read.leaks.length > 0)
		return stuck("leak", `added lines leak, nothing pushed: ${read.leaks.slice(0, 10).join(" ")}`);
	if (ask.step === "build" && read.exam.length > 0)
		return {
			outcome: {kind: "send", to: "tests", why: "exam_paths"},
			why: `the build touched exam paths: ${read.exam.join(" ")}`,
		};
	// A box has no network, so it cannot refresh the lockfile; the lead does, outside it (ticket 385).
	if (read.manifests.length > 0)
		return {
			outcome: {kind: "ask", who: "lead", for: "lockfile"},
			why:
				`pnpm-lock.yaml is behind ${read.manifests.join(" ")}, and a box has no network. ` +
				`Outside the box, on ${wipOf(ask.branch)} at ${read.head.slice(0, 8)}: ` +
				"pnpm install --lockfile-only, check each new version is exact and the plan names it, " +
				`commit pnpm-lock.yaml as a lead commit with stepcommit.sh, push it with botpush.mjs, ` +
				`then run ${ask.step} again`,
		};
	if (ask.step === "plan" && read.plancheck !== null)
		return {
			outcome: {kind: "send", to: "plan", why: "plancheck"},
			why: `plancheck --draft: ${read.plancheck}`,
		};
	const said = answerOf(ask.step, read.report);
	if (said === null) return stuck("no_answer", "no answer line in the report");
	switch (said.verb) {
		case "done":
			if (ask.step === "build" && read.commits === 0) {
				const green = greenOf(read.report);
				if (green === null) return stuck("no_commit", "answered done with no commit");
				return {
					outcome: {kind: "done", part: false, head: read.head},
					why: `no commit: every law already green at ${read.head.slice(0, 8)} (${green})`,
				};
			}
			if (ask.step === "tests" && read.commits === 0)
				return stuck("no_commit", "answered done with no commit");
			return {outcome: {kind: "done", part: false, head: read.head}, why: said.why};
		case "send": {
			const to = said.to === "tests" ? "tests" : said.to === "plan" ? "plan" : "build";
			return {outcome: {kind: "send", to, why: "step_said"}, why: said.why};
		}
		case "ask":
			return {outcome: {kind: "ask", who: "lead", for: "question"}, why: said.why};
		case "skip":
			return {outcome: {kind: "skip", why: "step_said"}, why: said.why};
		default:
			return stuck("step_said", said.why);
	}
};

/** Every file drive keeps for one box, by suffix. A box name is fresh only when none exists. */
const BOX_FILES = [
	"",
	"-gitdata",
	"-prompt.md",
	".md",
	".jsonl",
	".err",
	".log",
	"-plan.md",
	"-plan.jsonl",
];

/**
 * The first box `<lane>-<step><n>`, from `n` up, that no file of an older run holds. A refused run
 * once returned an older run's `<box>.md` as its report (p12 review5, 2026-11-09, ticket 383).
 */
export const freshBox = (
	lane: string,
	step: string,
	n: number,
	taken: (name: string) => boolean,
): string => {
	for (let i = n; ; i += 1) {
		const box = `${lane}-${step}${i}`;
		if (!BOX_FILES.some((suffix) => taken(`${box}${suffix}`))) return box;
	}
};

/**
 * The report's path when this run wrote it: the file exists (`mtime` is its mtime in ms) and is no
 * older than the run's start, read to the whole second for file systems that keep only seconds. A
 * run that wrote none, such as one box.sh refused before the agent started, gives no report.
 */
export const reportOf = (path: string, started: number, mtime: number | null): string | null =>
	mtime !== null && mtime >= Math.floor(started / 1000) * 1000 ? path : null;

// ---------------------------------------------------------------- the machine

type Step = readonly [Model, readonly Cmds[]];
const stay = (s: Model): Step => [s, []];
/** A stuck box stays for the lead to look at, and so does one holding work no branch has, whatever
 * the step answered (layers build2, 2026-11-09: a send back removed 10 uncommitted files). */
const recordIt = (ask: Ask, j: Judged, head: string, left: readonly string[] = []): Step => {
	const kept = j.outcome.kind === "stuck" || left.length > 0;
	const why = left.length > 0 ? `${j.why} (box kept: ${left.join(", ")})` : j.why;
	const entry = record({
		ask,
		outcome: nameOf(j.outcome),
		why,
		head,
		exit: exitOf(j.outcome),
		keep: kept,
		intent: intentOf("record", ask.box),
	});
	return [{phase: "recording", ask, outcome: j.outcome, why, head, kept}, [entry]];
};

const draft = listen("draft", (s: Model) => (s.phase === "drafting" ? s.ask : null));

export const machine = defineMachine({
	types: {model: {} as Model, msg: {} as Msg, sub: {} as DraftSub, ctx: undefined},
	cmds: [boxNew, stepRead, backupPush, record],
	init: (): Step => [{phase: "idle"}, []],
	subs: [draft],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			if (m.ask.step === "plan") return [{phase: "drafting", ask: m.ask}, []];
			const asked = boxNew({...m.ask, intent: intentOf("box_new", m.ask.box)});
			return [{phase: "starting", ask: m.ask}, [asked]];
		},
		box_new_ok: (s, m): Step => {
			if (s.phase !== "starting") return stay(s);
			if (!m.value.ok) return recordIt(s.ask, stuck("box_failed", m.value.detail), s.ask.base);
			return [{phase: "drafting", ask: s.ask}, []];
		},
		box_new_err: (s): Step =>
			s.phase === "starting"
				? recordIt(s.ask, stuck("box_failed", "box.sh new threw"), s.ask.base)
				: stay(s),
		drafted: (s, m): Step => {
			if (s.phase !== "drafting") return stay(s);
			if (m.timedOut)
				return recordIt(
					s.ask,
					stuck("timeout", `stopped after ${s.ask.minutes} minutes`),
					s.ask.base,
				);
			if (m.code !== 0)
				return recordIt(
					s.ask,
					stuck("agent_failed", `${s.ask.agent} exited ${m.code}; see ${s.ask.err}`),
					s.ask.base,
				);
			return [{phase: "reading", ask: s.ask}, [stepRead(s.ask)]];
		},
		step_read_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const j = decide(s.ask, m.value);
			const head = m.value.head ?? s.ask.base;
			if (j.outcome.kind !== "stuck" && m.value.commits > 0) {
				const asked = backupPush({ask: s.ask, head, intent: intentOf("push", s.ask.box)});
				const pushing = {outcome: j.outcome, why: j.why, head, left: m.value.left};
				return [{phase: "pushing", ask: s.ask, ...pushing}, [asked]];
			}
			return recordIt(s.ask, j, head, m.value.left);
		},
		step_read_err: (s): Step =>
			s.phase === "reading"
				? recordIt(s.ask, stuck("fetch_failed", "reading the step threw"), s.ask.base)
				: stay(s),
		backup_push_ok: (s, m): Step => {
			if (s.phase !== "pushing") return stay(s);
			if (!m.value.ok) return recordIt(s.ask, stuck("push_failed", m.value.detail), s.head, s.left);
			return recordIt(s.ask, {outcome: s.outcome, why: s.why}, s.head, s.left);
		},
		backup_push_err: (s): Step =>
			s.phase === "pushing"
				? recordIt(s.ask, stuck("push_failed", "botpush threw"), s.head, s.left)
				: stay(s),
		record_ok: (s, m): Step => {
			if (s.phase !== "recording") return stay(s);
			if (m.value.ok) return [{...s, phase: "over"}, []];
			const outcome: Outcome = {kind: "stuck", why: "record_failed"};
			return [{...s, phase: "over", outcome, why: `${s.why} (${m.value.detail})`, kept: true}, []];
		},
		record_err: (s): Step =>
			s.phase === "recording"
				? [
						{
							...s,
							phase: "over",
							outcome: {kind: "stuck", why: "record_failed"},
							why: `${s.why} (not recorded)`,
							kept: true,
						},
						[],
					]
				: stay(s),
	},
});

// ---------------------------------------------------------------- the world

type Env = {readonly MAIN: string; readonly BOXES: string; readonly GH_REPO: string};

const sh = (cmd: string, args: readonly string[], cwd?: string) => {
	const r = spawnSync(cmd, args, {cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024});
	return {code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? ""};
};
const tail = (text: string, n = 3) => text.trim().split("\n").slice(-n).join(" | ");

/** This run's report, or `null` when it wrote none. */
const writtenReport = (ask: Ask) => {
	const mtime = existsSync(ask.report) ? statSync(ask.report).mtimeMs : null;
	return reportOf(ask.report, ask.started, mtime);
};

/** The paths env.sh gives every lead script. */
const loadEnv = (): Env => {
	const r = sh("sh", [
		"-c",
		'. "$0" && printf "%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO"',
		join(HERE, "env.sh"),
	]);
	const [MAIN = "", BOXES = "", GH_REPO = ""] = r.out.split("\n");
	if (r.code !== 0 || !MAIN) throw new Error(`env.sh failed: ${r.err}`);
	return {MAIN, BOXES, GH_REPO};
};

// Shapes that leak on any machine: home and temp folders, key prefixes, private keys, em dashes.
const SHAPES = [
	/\/Users\/[A-Za-z]/,
	/\/home\/[a-z]/,
	/\/private\/(tmp|var)\//,
	/\/var\/folders\/[a-z0-9_]{2}\//,
	/\bsk-[A-Za-z0-9_-]{16,}/,
	/\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{10,}/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY/,
	// An em dash, built from its code so this file has none.
	new RegExp(String.fromCharCode(0x2014)),
];

/** `file:line` of each added line that leaks. The private words are read here and never printed. */
const leaksIn = (diff: string, repo: string): string[] => {
	const file = join(homedir(), ".fabrika/leak-words");
	const words = existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.map((w) => w.trim().toLowerCase())
				.filter(Boolean)
		: [];
	const hits: string[] = [];
	let path: string | null = null;
	let line = 0;
	for (const raw of diff.split("\n")) {
		if (raw.startsWith("+++ ")) path = raw.startsWith("+++ b/") ? raw.slice(6) : null;
		else if (raw.startsWith("@@")) line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
		else if (raw.startsWith("+") && path !== null) {
			const text = raw.slice(1).replaceAll(repo, "");
			const low = text.toLowerCase();
			if (SHAPES.some((s) => s.test(text)) || words.some((w) => low.includes(w)))
				hits.push(`${path}:${line}`);
			line += 1;
		}
	}
	return hits;
};

const unsignedIn = (env: Env, ask: Ask, head: string): string[] => {
	// stepcommit signs mutation as tests for now.
	const expect = ask.step === "mutation" ? "tests" : ask.step;
	const shas = sh("git", ["-C", env.MAIN, "rev-list", `${ask.base}..${head}`])
		.out.split("\n")
		.filter(Boolean);
	return shas.flatMap((sha) => {
		const r = sh("git", ["-C", env.MAIN, "notes", "--ref=fabrika", "show", sha]);
		if (r.code !== 0) return [`${sha.slice(0, 8)} has no step note`];
		const note = JSON.parse(r.out) as {_tag?: string; step?: string; ticket?: string};
		if (note._tag !== "attested") return [`${sha.slice(0, 8)} note is not attested`];
		if (note.step !== expect) return [`${sha.slice(0, 8)} signed ${note.step}, not ${expect}`];
		if (String(note.ticket) !== ask.ticket)
			return [`${sha.slice(0, 8)} signed for ticket ${note.ticket}, not ${ask.ticket}`];
		return [];
	});
};

/** The steps signed on the lane's own commits, from where it left main. */
const stepsIn = (env: Env, root: string, head: string): Set<string> =>
	new Set(
		sh("git", ["-C", env.MAIN, "rev-list", `${root}..${head}`])
			.out.split("\n")
			.filter(Boolean)
			.flatMap((sha) => {
				const r = sh("git", ["-C", env.MAIN, "notes", "--ref=fabrika", "show", sha]);
				return r.code === 0 ? stepOf(r.out) : [];
			}),
	);

// Git with no hooks and no repo-set helpers, so nothing Claude wrote into a tree runs as drive.
const SAFE_GIT = {
	...process.env,
	GIT_CONFIG_COUNT: "2",
	GIT_CONFIG_KEY_0: "core.hooksPath",
	GIT_CONFIG_VALUE_0: "/dev/null",
	GIT_CONFIG_KEY_1: "core.fsmonitor",
	GIT_CONFIG_VALUE_1: "false",
};

/**
 * Claude commits with plain git and holds no key. Its commits are fetched to a side ref; their
 * tree goes into a fresh worktree of the main checkout at the base; stepcommit commits it as the
 * bot and signs it as the step, with main's own signer (never the box's, which Claude could edit).
 * The branch then points at that one signed commit.
 */
const signClaude = (env: Env, ask: Ask) => {
	const git = (...args: string[]) => {
		const r = spawnSync("git", ["-C", env.MAIN, ...args], {encoding: "utf8", env: SAFE_GIT});
		return {code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? ""};
	};
	const side = `refs/drive/${ask.box}`;
	const f = git("fetch", "-q", "-f", join(env.BOXES, ask.box), `refs/heads/${ask.branch}:${side}`);
	if (f.code !== 0) return f;
	const made = git("rev-parse", side).out.trim();
	git("update-ref", "-d", side);
	const paths = git("diff", "--name-only", "--no-renames", ask.base, made)
		.out.split("\n")
		.filter(Boolean);
	if (paths.length === 0) return git("update-ref", `refs/heads/${ask.branch}`, ask.base);
	const said = git("log", "-1", "--format=%s", made).out.trim();
	const prefix = `T${ask.ticket} ${ask.step}:`;
	const subject = said.startsWith(prefix) ? said : `${prefix} ${said || "the step's work"}`;
	const wt = join(env.BOXES, `${ask.box}-sign`);
	const add = git("worktree", "add", "-q", "--detach", wt, ask.base);
	if (add.code !== 0) return add;
	try {
		const restore = sh("git", ["-C", wt, "restore", `--source=${made}`, "--worktree", "--", "."]);
		if (restore.code !== 0) return restore;
		const r = spawnSync(
			"sh",
			[
				join(HERE, "../../step-commit/scripts/stepcommit.sh"),
				ask.step,
				ask.ticket,
				subject,
				...paths,
			],
			{
				cwd: wt,
				encoding: "utf8",
				env: {
					...SAFE_GIT,
					// The fresh worktree has no node_modules, so stepcommit's format check finds
					// oxfmt in the main checkout's, where the signer comes from too.
					PATH: `${join(env.MAIN, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
					STEPCOMMIT_SIGNER: `node ${join(env.MAIN, "next/apps/fabrika/src/exam/commits.ts")}`,
					// The sign worktree is not the box: name the box whose facts stepcommit checks.
					STEPCOMMIT_BOX: ask.box,
				},
			},
		);
		if (r.status !== 0)
			return {code: r.status ?? -1, out: "", err: `stepcommit: ${r.stdout}${r.stderr}`};
		const head = sh("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
		return git("update-ref", `refs/heads/${ask.branch}`, head);
	} finally {
		git("worktree", "remove", "--force", wt);
	}
};

/** How a Claude run was paid, from its init line: no API key means the subscription. */
const billingOf = (events: string) => {
	const first = readFileSync(events, "utf8").split("\n", 1)[0] ?? "";
	try {
		return (JSON.parse(first) as {apiKeySource?: string}).apiKeySource === "none"
			? "subscription"
			: "key";
	} catch {
		return "subscription";
	}
};

/**
 * Work a box holds that no branch has: uncommitted or untracked files, and commits on its HEAD or
 * other branches that neither the step's branch nor a remote branch has. Read with no hooks and no fsmonitor, so nothing the
 * agent wrote runs as drive. A box git cannot read counts as holding work.
 */
export const leftIn = (box: string, branch: string): string[] => {
	if (!existsSync(box)) return [];
	const git = (...args: string[]) => {
		const r = spawnSync("git", ["-C", box, ...args], {encoding: "utf8", env: SAFE_GIT});
		return {code: r.status ?? -1, out: r.stdout ?? ""};
	};
	// No rename pairs, so each NUL-ended entry is one file.
	const status = git(
		"-c",
		"status.renames=false",
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	);
	// A clone's own `main` (or any branch a remote already holds) is not the box's work (themes
	// build5, 2026-11-09: a box kept for "21 commits off" that were only its local main).
	const off = git(
		"rev-list",
		"--count",
		"HEAD",
		"--branches",
		"--not",
		`refs/heads/${branch}`,
		"--remotes",
	);
	if (status.code !== 0 || off.code !== 0) return ["a git state drive could not read"];
	const files = status.out.split("\0").filter(Boolean).length;
	const commits = Number(off.out.trim());
	return [
		...(files > 0 ? [`${files} uncommitted files`] : []),
		...(commits > 0 ? [`${commits} commits off ${branch}`] : []),
	];
};

const handlers = (env: Env) => {
	const box = (...args: string[]) => sh("sh", [join(HERE, "box.sh"), ...args]);
	const git = (...args: string[]) =>
		sh("git", ["-C", env.MAIN, "-c", "core.hooksPath=/dev/null", ...args]);
	return {
		box_new: (cmd: Ask) =>
			Effect.sync(() => {
				const r = box(
					"new",
					cmd.box,
					cmd.base,
					cmd.branch,
					"--ticket",
					cmd.ticket,
					"--plan",
					cmd.plan,
					"--root",
					cmd.root,
					"--lane",
					cmd.lane,
				);
				writeFileSync(join(env.BOXES, `${cmd.box}.log`), r.out + r.err);
				return {ok: r.code === 0, detail: r.code === 0 ? "" : `box.sh new: ${tail(r.err)}`};
			}),
		step_read: (ask: Ask) =>
			Effect.sync((): Read => {
				const written = writtenReport(ask);
				const report = written === null ? "" : readFileSync(written, "utf8");
				const left = ask.step === "plan" ? [] : leftIn(join(env.BOXES, ask.box), ask.branch);
				const empty = {
					commits: 0,
					unsigned: [],
					exam: [],
					leaks: [],
					left,
					manifests: [],
					plancheck: null,
					report,
				};
				if (ask.step === "plan") {
					const r = sh(
						"sh",
						[join(HERE, "../../plan/scripts/plancheck.sh"), "--draft", ask.report],
						env.MAIN,
					);
					return {
						...empty,
						head: ask.base,
						plancheck: r.code === 0 ? null : tail(r.out + r.err),
						problem: null,
					};
				}
				// A review commits nothing: its branch lands on a side ref and the lane's branch is left alone.
				const ref = ask.step === "review" ? `refs/drive/${ask.box}` : `refs/heads/${ask.branch}`;
				const f =
					ask.step === "review"
						? git("fetch", "-q", "-f", join(env.BOXES, ask.box), `refs/heads/${ask.branch}:${ref}`)
						: ask.agent === "claude"
							? signClaude(env, ask)
							: box("fetch", ask.box, ask.branch, "--sign", ask.step, "--ticket", ask.ticket);
				if (f.code !== 0)
					return {
						...empty,
						head: null,
						problem: `fetch: ${tail(f.err)}`,
					};
				const head = git("rev-parse", ref).out.trim();
				if (ask.step === "review") git("update-ref", "-d", ref);
				const failed = (what: string, r: {code: number; err: string}) => ({
					...empty,
					head,
					problem: `${what}: ${tail(r.err)}`,
				});
				const count = git("rev-list", "--count", `${ask.base}..${head}`);
				if (count.code !== 0) return failed("rev-list", count);
				const commits = Number(count.out.trim());
				// Every path any commit touched, so a change undone by a later commit still counts.
				const touched = git("log", "--format=", "--name-only", `${ask.base}..${head}`);
				if (touched.code !== 0) return failed("git log", touched);
				const names = [...new Set(touched.out.split("\n").filter(Boolean))];
				const at = (rev: string, path: string) => {
					const r = git("show", `${rev}:${path}`);
					return r.code === 0 ? r.out : null;
				};
				const manifests = lockfileBehind(
					names
						.filter((n) => n === "pnpm-workspace.yaml" || /(^|\/)package\.json$/.test(n))
						.map((path) => ({path, before: at(ask.base, path), after: at(head, path)})),
					workspaceGlobs(at(head, "pnpm-workspace.yaml") ?? ""),
					names.includes("pnpm-lock.yaml"),
				);
				const examRun =
					names.length === 0
						? {code: 0, out: "", err: ""}
						: sh("python3", [
								"-I",
								join(HERE, "../../step-commit/scripts/exam.py"),
								join(env.MAIN, "exam-paths.json"),
								...names,
							]);
				if (examRun.code > 1) return failed("exam.py", examRun);
				const exam = examRun.out
					.split("\n")
					.filter(Boolean)
					.map((l) => l.split("\t")[0] ?? l);
				// Each commit's own added lines, so nothing a later commit removed slips past.
				const diff = git("log", "-p", "-U0", "--no-color", "--format=", `${ask.base}..${head}`);
				if (diff.code !== 0) return failed("git log -p", diff);
				// The repo's own commit check verifies the signatures; this step's name is checked here.
				const check =
					commits === 0
						? {code: 0, out: "", err: ""}
						: sh(
								"node",
								[
									join(env.MAIN, "next/apps/fabrika/src/exam/commits.ts"),
									"check",
									"--base",
									ask.root,
									"--head",
									head,
								],
								env.MAIN,
							);
				if (check.code > 1) return failed("commits check", check);
				// Exit 1 holds the step unless every stuck answer it gave was a waived stale link.
				const holds = checkHolds(check.code, check.out, stepsIn(env, ask.root, head));
				const unsigned = [
					...(holds ? [`commits check: ${tail(check.out + check.err)}`] : []),
					...unsignedIn(env, ask, head),
				];
				return {
					head,
					commits,
					unsigned,
					exam,
					leaks: leaksIn(diff.out, env.GH_REPO),
					left,
					manifests,
					plancheck: null,
					report,
					problem: null,
				};
			}),
		backup_push: (cmd: {ask: Ask; head: string}) =>
			Effect.sync(() => {
				const r = sh("node", [
					join(HERE, "botpush.mjs"),
					env.MAIN,
					wipOf(cmd.ask.branch),
					cmd.head,
				]);
				return {
					ok: r.code === 0,
					detail: r.code === 0 ? tail(r.out, 1) : `botpush: ${tail(r.out + r.err, 1)}`,
				};
			}),
		record: (e: typeof Entry.Type) =>
			Effect.sync(() => {
				const {ask} = e;
				const notes: string[] = [];
				const ended = new Date().toISOString();
				// The field row, held beside the boxes until a field PR lands it.
				if (existsSync(ask.events)) {
					const row = rowOf(e.outcome);
					const why = `drive.ts ${ask.step} in box ${ask.box} at ${ask.base.slice(0, 8)}: ${e.outcome}. ${e.why}`;
					const r =
						ask.agent === "claude"
							? sh("python3", [
									"-I",
									join(HERE, "clauderow.py"),
									"--run",
									ask.run,
									"--ticket",
									ask.ticket,
									"--outcome",
									row,
									"--step",
									ask.step,
									"--billing",
									billingOf(ask.events),
									ask.events,
									why,
								])
							: sh("python3", [
									"-I",
									join(HERE, "fieldrow.py"),
									"--step",
									ask.step,
									ask.events,
									ask.run,
									ask.ticket,
									row,
									why,
								]);
					if (r.code === 0) appendFileSync(join(env.BOXES, `${ask.lane}-rows.jsonl`), r.out);
					else notes.push(`no field row: ${tail(r.err, 1)}`);
				}
				const ok = notes.length === 0;
				const outcome = ok ? e.outcome : "stuck:record_failed";
				const keep = e.keep || !ok;
				// A stuck step, or a build sent back for exam paths, does not move the lane's head.
				const accepted = !outcome.startsWith("stuck") && outcome !== "send:tests:exam_paths";
				const state = join(env.BOXES, "state", `${ask.lane}.json`);
				const saved = existsSync(state)
					? (JSON.parse(readFileSync(state, "utf8")) as Lane)
					: {lane: ask.lane, steps: []};
				const entry = {
					step: ask.step,
					box: ask.box,
					run: ask.run,
					from: ask.base,
					head: e.head,
					outcome,
					why: ok ? e.why : `${e.why} (${notes.join("; ")})`,
					exit: ok ? e.exit : 30,
					report: writtenReport(ask),
					kept: keep,
					ended,
				};
				const lane: Lane = {
					...saved,
					ticket: ask.ticket,
					plan: ask.plan,
					branch: ask.branch,
					root: ask.root,
					head: accepted ? e.head : (saved.head ?? ask.base),
					steps: [...saved.steps, entry],
				};
				writeFileSync(`${state}.tmp`, `${JSON.stringify(lane, null, "\t")}\n`);
				renameSync(`${state}.tmp`, state);
				appendFileSync(
					join(env.BOXES, "state", `${ask.lane}.md`),
					`- ${ended} drive.ts ${ask.step} in box ${ask.box}: ${outcome}, head ${e.head.slice(0, 8)}. ${e.why}\n`,
				);
				if (!keep && ask.step !== "plan" && ask.box) {
					rmSync(join(env.BOXES, ask.box), {recursive: true, force: true});
					rmSync(join(env.BOXES, `${ask.box}-gitdata`), {recursive: true, force: true});
					// Its facts go with it, so no later stepcommit reads a dead box's plan hash.
					rmSync(join(env.BOXES, "state", `${ask.box}.box`), {force: true});
				}
				return {ok, detail: notes.join("; ")};
			}),
	};
};

// The tools each Claude step gets. `--tools` is what limits it; `--allowedTools` only pre-approves.
const CLAUDE_TOOLS: Record<StepName, string> = {
	plan: "Read,Glob,Grep",
	review: "Read,Glob,Grep,Bash",
	tests: "Read,Edit,Write,Glob,Grep,Bash",
	build: "Read,Edit,Write,Glob,Grep,Bash",
	mutation: "Read,Edit,Write,Glob,Grep,Bash",
};

/**
 * Claude's walls, written beside the box: a sandbox-exec profile the OS enforces on Claude and
 * every command it starts (no reading the step keys, leak words or Codex's login; writes only in
 * its box and the caches it needs), and settings that say the same to Claude's own tools.
 */
export const claudeProfile = (home: string, boxes: string, box: string, step: StepName) => {
	const work = join(boxes, box);
	const writable = step === "plan" ? [] : [work, join(boxes, `${box}-gitdata`)];
	const allow = [...writable, ".claude", ".cache", ".local", ".npm", "Library"].map(
		(p) => `(subpath "${p.startsWith("/") ? p : join(home, p)}")`,
	);
	return `(version 1)
(allow default)
(deny file-read* file-write* (subpath "${home}/.fabrika/step-keys") (literal "${home}/.fabrika/leak-words") (subpath "${home}/.codex"))
(deny file-write* (subpath "${home}"))
(allow file-write* ${allow.join(" ")} (regex #"^${home}/\\.claude\\.json"))
`;
};

const claudeArgs = (env: Env, ask: Ask) => {
	const home = homedir();
	const work = join(env.BOXES, ask.box);
	const profile = claudeProfile(home, env.BOXES, ask.box, ask.step);
	const sb = join(env.BOXES, `${ask.box}.sb`);
	writeFileSync(sb, profile);
	// The file's name is how the cap counts Claude steps drive started (pgrep -f).
	const settings = join(env.BOXES, `${ask.box}.drive-claude-settings.json`);
	const deny = [
		"Read(~/.fabrika/**)",
		"Read(~/.codex/**)",
		"Bash(security *)",
		"Bash(*/security *)",
	];
	writeFileSync(settings, JSON.stringify({permissions: {deny}}));
	const tools = CLAUDE_TOOLS[ask.step];
	return {
		cwd: ask.step === "plan" ? env.MAIN : work,
		args: [
			"-n",
			"15",
			"sandbox-exec",
			"-f",
			sb,
			"claude",
			"-p",
			"--session-id",
			ask.session,
			"--model",
			ask.model,
			"--tools",
			tools,
			"--allowedTools",
			tools,
			// No setting source: a box's project settings are the agent's own hooks (experiment 155).
			"--setting-sources",
			"",
			"--strict-mcp-config",
			"--settings",
			settings,
			"--output-format",
			"stream-json",
			"--verbose",
		],
	};
};

/** Claude's report is the `result` of its last stream-json line. */
const saveClaudeReport = (ask: Ask) => {
	const lines = existsSync(ask.events) ? readFileSync(ask.events, "utf8").split("\n") : [];
	for (const line of lines.toReversed()) {
		try {
			const d = JSON.parse(line) as {type?: string; result?: string};
			if (d.type === "result") return writeFileSync(ask.report, d.result ?? "");
		} catch {}
	}
};

/** The Draft: Codex or Claude in the box (or the read-only plan writer), as a Sub that answers once. */
const draftRunner = (env: Env) => (sub: DraftSub) =>
	Stream.fromEffect(
		Effect.callback<Drafted>((resume) => {
			const ask = sub.deps;
			const claude = ask.agent === "claude";
			const out = openSync(ask.step === "plan" && !claude ? ask.err : ask.events, "a");
			const err = openSync(ask.err, "a");
			const input = claude ? openSync(ask.prompt, "r") : "ignore";
			const how = claude
				? {cmd: "nice", ...claudeArgs(env, ask)}
				: {
						cmd: "sh",
						cwd: undefined,
						args:
							ask.step === "plan"
								? [join(HERE, "runplan.sh"), ask.box, ask.prompt]
								: [
										join(HERE, "box.sh"),
										"run",
										ask.box,
										ask.prompt,
										ask.report,
										"--step",
										ask.step,
									],
					};
			// Its own process group, so a stop reaches every command the agent started too.
			const child = spawn(how.cmd, how.args, {
				cwd: how.cwd,
				stdio: [input, out, err],
				detached: true,
			});
			let timedOut = false;
			let force: ReturnType<typeof setTimeout> | undefined;
			const stopAll = () => {
				const group = child.pid === undefined ? undefined : -child.pid;
				if (group === undefined) return;
				try {
					process.kill(group, "SIGTERM");
					force = setTimeout(() => {
						try {
							process.kill(group, "SIGKILL");
						} catch {}
					}, 10_000);
				} catch {}
			};
			const timer = setTimeout(() => {
				timedOut = true;
				stopAll();
			}, ask.minutes * 60_000);
			child.on("exit", (code) => {
				clearTimeout(timer);
				clearTimeout(force);
				closeSync(out);
				closeSync(err);
				if (typeof input === "number") closeSync(input);
				if (claude) saveClaudeReport(ask);
				resume(Effect.succeed({type: "drafted", code, timedOut}));
			});
			return Effect.sync(() => {
				clearTimeout(timer);
				stopAll();
			});
		}),
	);

type Lane = {
	readonly lane: string;
	readonly ticket?: string;
	readonly plan?: string;
	readonly branch?: string;
	readonly root?: string;
	readonly head?: string;
	readonly steps: readonly {readonly step: string}[];
};

// ---------------------------------------------------------------- the command

const TAIL = `

---
drive.ts reads your report. End it with exactly one of these lines, as its last line:
answer: done
answer: send tests <why>
answer: send build <why>
answer: ask <the one question for the lead>
answer: skip <why there is nothing here for this step>
answer: stuck <why>

A build that needs no commit, because every law is already green at its start, puts this line
just before \`answer: done\`: laws: green <the narrow test paths you ran>
`;

const MIN_FREE_GB = 20;

/** Whole GB free on the volume that holds `path`, from `df -k`; `null` when df says nothing usable. */
const freeGb = (path: string): number | null => {
	const r = sh("df", ["-k", path]);
	const kb = Number(r.out.trim().split("\n").at(-1)?.trim().split(/\s+/)[3]);
	return r.code === 0 && Number.isFinite(kb) ? Math.floor(kb / 1024 / 1024) : null;
};

/**
 * The worktree that has `branch` checked out, from `git worktree list --porcelain`; `null` when none.
 * The fetch at the end of a step updates `refs/heads/<branch>`, which git refuses while a worktree
 * holds it, so a step that started anyway would lose its fetch after the agent's whole run.
 */
const holderOf = (porcelain: string, branch: string): string | null => {
	for (const block of porcelain.split("\n\n")) {
		const lines = block.split("\n");
		if (lines.includes(`branch refs/heads/${branch}`))
			return lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length) ?? "";
	}
	return null;
};

/**
 * Whether drive holds `BOXES/state/electron.lock` for the whole step. The box cannot write the
 * lock (its sandbox writes only the box and caches), so drive takes it outside, before the agent
 * starts: always for mutation, and for any Claude step started with `--electron`.
 */
export const holdsElectron = (step: StepName, flagged: boolean) => step === "mutation" || flagged;

/** What a Claude step is told on top of the brief: its skill, and how its work is committed. */
export const claudeTail = (ask: Pick<Ask, "step" | "ticket">, electron: boolean) => {
	const skill = `You are the ${ask.step} step for ticket ${ask.ticket}, run by drive.ts. Use the ${ask.step} skill: read .agents/skills/${ask.step}/SKILL.md first and follow it.\n`;
	const commit =
		ask.step === "plan"
			? "Change no file. Your final message is the plan.\n"
			: ask.step === "review"
				? "Commit nothing and change no file.\n"
				: `Commit your work here with plain git: \`git add <paths>\`, then \`git commit -m "T${ask.ticket} ${ask.step}: <subject>"\`. Do not run stepcommit or pnpm commits sign: you hold no step key, and drive.ts signs your commits as one commit after you answer. Never push, never rewrite history.\n`;
	const lock = holdsElectron(ask.step, electron)
		? "drive.ts holds the laptop's Electron lock (state/electron.lock) for you for this whole step, so do not take it or wait on it. Start at most one Electron app at a time, and close it before you answer.\n"
		: "";
	return `\n\n---\n${skill}${commit}${lock}`;
};

const usage = () => {
	console.error(
		"usage: node drive.ts <lane> <plan|tests|build|mutation|review> <brief-file> [--agent codex|claude] [--model sonnet|opus] [--electron] [--from <ref>] [--ticket <n>] [--branch fabrikalfa/<name>] [--plan <approved plan>] [--plan-only]",
	);
	process.exit(2);
};

const flag = (args: string[], name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/** One Electron step at a time: a lock file holding the owner's pid, taken over when it is dead. */
const takeElectron = (env: Env) =>
	Effect.gen(function* () {
		const lock = join(env.BOXES, "state", "electron.lock");
		for (;;) {
			try {
				writeFileSync(lock, String(process.pid), {flag: "wx"});
				process.on("exit", () => rmSync(lock, {force: true}));
				return;
			} catch {
				const owner = Number(readFileSync(lock, "utf8").trim());
				if (alive(owner)) yield* Effect.sleep("20 seconds");
				else rmSync(lock, {force: true});
			}
		}
	});

const main = () => {
	const args = process.argv.slice(2);
	const [lane = "", step = "", brief = ""] = args;
	const agent = flag(args, "--agent") ?? "codex";
	if (
		!/^[a-z0-9][a-z0-9-]*$/.test(lane) ||
		!(STEPS as readonly string[]).includes(step) ||
		!(AGENTS as readonly string[]).includes(agent) ||
		!existsSync(brief)
	)
		usage();
	if (step === "mutation" && agent !== "claude") {
		console.error("drive.ts: mutation binds ports and starts Electron; run it with --agent claude");
		process.exit(2);
	}
	const electron = args.includes("--electron");
	if (electron && agent !== "claude") {
		console.error("drive.ts: --electron is for --agent claude; a Codex box cannot start Electron");
		process.exit(2);
	}
	if (agent === "codex" && flag(args, "--model") !== undefined) {
		console.error("drive.ts: --model is for --agent claude; a Codex box reads CODEX_MODEL");
		process.exit(2);
	}
	const env = loadEnv();
	mkdirSync(join(env.BOXES, "state"), {recursive: true});
	const statePath = join(env.BOXES, "state", `${lane}.json`);
	const saved: Lane | null = existsSync(statePath)
		? (JSON.parse(readFileSync(statePath, "utf8")) as Lane)
		: null;
	const ticket = flag(args, "--ticket") ?? saved?.ticket;
	if (!ticket) {
		console.error(`drive.ts: no ticket for lane ${lane} yet; pass --ticket`);
		process.exit(2);
	}
	const branch = flag(args, "--branch") ?? saved?.branch ?? `fabrikalfa/${lane}`;
	const plan = flag(args, "--plan") ?? saved?.plan ?? join(env.BOXES, `${lane}-PLAN.md`);
	if (!branch.startsWith("fabrikalfa/")) usage();
	sh("git", ["-C", env.MAIN, "fetch", "-q", "origin"]);
	// A plan writer reads the main checkout as it stands, so its base is that checkout's HEAD.
	if (step === "plan" && flag(args, "--from") !== undefined) {
		console.error("drive.ts: a plan reads the main checkout; it takes no --from");
		process.exit(2);
	}
	// With no --from, a lane whose branch or -wip backup is on origin continues from the newest
	// tip, unless the saved head has moved past it (`startHead`). A box started at main on a
	// branch that has work drops that work (2026-11-09), so a saved head off the branch loses.
	const pushed = [branch, wipOf(branch)]
		.map((ref) =>
			sh("git", [
				"-C",
				env.MAIN,
				"rev-parse",
				"-q",
				"--verify",
				`refs/remotes/origin/${ref}^{commit}`,
			]).out.trim(),
		)
		.filter(Boolean);
	const isAncestor = (a: string, b: string) =>
		sh("git", ["-C", env.MAIN, "merge-base", "--is-ancestor", a, b]).code === 0;
	const lastHead = startHead(pushed, saved?.head, isAncestor);
	const from = step === "plan" ? "HEAD" : (flag(args, "--from") ?? lastHead ?? "origin/main");
	const base = sh("git", [
		"-C",
		env.MAIN,
		"rev-parse",
		"-q",
		"--verify",
		`${from}^{commit}`,
	]).out.trim();
	if (!base) {
		console.error(`drive.ts: ${from} is not a commit in the main checkout`);
		process.exit(2);
	}
	// The lane's root: where its base left main, moved up past a caught-up main (lane.ts).
	const root = laneRoot(
		saved?.root,
		sh("git", ["-C", env.MAIN, "merge-base", "origin/main", base]).out.trim(),
		base,
		isAncestor,
	);
	if (!root) {
		console.error(`drive.ts: ${base.slice(0, 8)} shares no history with origin/main`);
		process.exit(2);
	}
	const s = step as StepName;
	const box = freshBox(
		lane,
		s,
		(saved?.steps.filter((e) => e.step === s).length ?? 0) + 1,
		(name) => existsSync(join(env.BOXES, name)),
	);
	const n = Number(box.slice(`${lane}-${s}`.length));
	const at = (suffix: string) => join(env.BOXES, `${box}${suffix}`);
	const claude = agent === "claude";
	const ask: Ask = {
		lane,
		step: s,
		agent: claude ? "claude" : "codex",
		model: claude ? (flag(args, "--model") ?? "sonnet") : "",
		session: claude ? randomUUID() : "",
		ticket,
		plan,
		branch,
		base,
		root,
		box,
		run: `t${ticket}-${s}${n === 1 ? "" : n}`,
		prompt: at("-prompt.md"),
		report: s === "plan" ? at("-plan.md") : at(".md"),
		events: s === "plan" ? at("-plan.jsonl") : at(".jsonl"),
		err: at(".err"),
		minutes: Number(process.env.DRIVE_MINUTES ?? 60),
		started: Date.now(),
	};
	const count = (pattern: string) =>
		sh("pgrep", ["-f", pattern]).out.split("\n").filter(Boolean).length;
	const agents = count("^codex exec") + count("drive-claude-settings");
	if (args.includes("--plan-only")) {
		console.log(
			JSON.stringify({outcome: "plan-only", ...ask, agents, electron: holdsElectron(s, electron)}),
		);
		return;
	}
	if (agents >= 8) {
		console.log(
			JSON.stringify({
				outcome: "refused",
				reason: `${agents} agents running (Codex boxes and drive's Claude steps); the cap is 8`,
			}),
		);
		process.exit(3);
	}
	// Dead boxes filled the disk once (2026-11-09): sweep them, then refuse on a nearly full disk,
	// naming what gc kept and why, so the lead fixes the cause and never asks the owner for space.
	const gc = spawnSync("sh", [join(HERE, "box.sh"), "gc"], {
		stdio: ["ignore", "pipe", 2],
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	process.stderr.write(gc.stdout ?? "");
	const free = freeGb(env.BOXES);
	if (free === null || free < MIN_FREE_GB) {
		const said = free === null ? "df could not read the free space" : `${free} GB free`;
		const keeps = (gc.stdout ?? "").split("\n").filter((l) => l.startsWith("keep "));
		console.log(
			JSON.stringify({
				outcome: "refused",
				reason: `${said} on the boxes' volume after box.sh gc; drive needs ${MIN_FREE_GB}; gc kept ${keeps.length}: ${keeps.map((l) => l.slice(5)).join("; ") || "nothing"}`,
			}),
		);
		process.exit(3);
	}
	// A plan reads the main checkout and a review fetches to a side ref; every other step fetches the
	// lane's branch at the end. Refuse now, not after the agent ran (themes tests, 2026-11-09).
	if (s !== "plan" && s !== "review") {
		const list = sh("git", ["-C", env.MAIN, "worktree", "list", "--porcelain"]);
		const holder = list.code === 0 ? holderOf(list.out, branch) : "";
		if (holder !== null) {
			const said =
				list.code === 0
					? `${branch} is checked out in ${holder}; detach it there (git switch --detach) first`
					: `git worktree list failed: ${tail(list.err)}`;
			console.log(JSON.stringify({outcome: "refused", reason: said}));
			process.exit(3);
		}
	}
	const verdict =
		s === "review"
			? "Keep your verdict line, merge-ready or changes: <n>, as the report's first line.\n"
			: "";
	writeFileSync(
		ask.prompt,
		readFileSync(brief, "utf8") + (claude ? claudeTail(ask, electron) : "") + TAIL + verdict,
	);

	const program = Effect.gen(function* () {
		if (holdsElectron(s, electron)) yield* takeElectron(env);
		// One typecheck at a time across all agents: a step that typechecks waits for a free tsgo.
		if (s === "tests" || s === "build" || s === "mutation")
			while (sh("pgrep", ["-x", "tsgo"]).code === 0) yield* Effect.sleep("20 seconds");
		const h = handlers(env);
		const handle = yield* run(machine, {
			ctx: undefined,
			interpret: h,
			subscribe: {draft: draftRunner(env)},
			terminal: (m) => m.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({type: "start", ask});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`drive stopped in ${end.phase}`);
		const line = {
			outcome: nameOf(end.outcome),
			lane,
			step: s,
			agent: ask.agent,
			box,
			from: base,
			head: end.head,
			reason: end.why,
			report: writtenReport(ask),
			kept: end.kept,
			exit: exitOf(end.outcome),
			...(claude ? {model: ask.model, session: ask.session} : {}),
		};
		console.log(JSON.stringify(line));
		process.exitCode = line.exit;
	});
	Effect.runPromise(Effect.scoped(program)).catch((e: unknown) => {
		console.log(
			JSON.stringify({
				outcome: "stuck:crash",
				lane,
				step: s,
				box,
				reason: String(e),
				kept: true,
				exit: 30,
			}),
		);
		process.exitCode = 30;
	});
};

if (import.meta.main) main();
