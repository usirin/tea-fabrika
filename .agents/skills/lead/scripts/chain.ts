// chain.ts: run one lane's steps end to end in plain code, with no lead agent holding it. Today's
// lead tooling, run on our own laptop; it is not product. Run it in the background and read the
// last line only: one JSON object with how the lane ended.
//
//   node chain.ts <lane> <lane-brief.md> [--ticket <n>] [--branch fabrikalfa/<name>]
//                 [--plan <approved plan>] [--claude tests,build] [--electron tests,build]
//                 [--model sonnet|opus] [--start tests|build|mutation|review]
//
// The lane is a tea machine on the Effect engine. Each step runs drive.ts's pieces in this
// process (`prepare`, then `driveStep`: one box, one agent turn, the reads, the push, the row),
// and the machine reads the step's one line to pick the next move. Every agent, a step's and the
// judgment's, runs through today's fabrika agents package on its ACP rows (./agents.ts): the
// unmodified harness, in its own containment, with only its model login. A fresh, short
// read-only Codex agent is started only where judgment is needed: a step that asked a question or got stuck. It
// reads the lane's state file and the report, answers once, and is gone. The five verbs stay:
// done, send, ask, skip, stuck.
//
//   stepping   Act     drive's prepare and driveStep, the brief cut from the lane brief's section
//                      plus the lane's facts (heads, round, what the last step said)
//   judging    Draft   one read-only Codex turn in the main checkout, one typed answer: send a step
//                      again with a note, or park the lane for the lead
//   opening    Act     botpush the branch and open the pull request (or find the open one)
//   landing    Act     catchup.sh: merge main in, wait for CI, squash-land
//   over               done (landed), ask (parked for the lead, the why in `reason`) or stuck
//
// The moves, pure (`moveOf`): tests done -> build -> mutation -> review -> open -> land. A send goes
// to the step it names; a send to plan parks, since only the lead approves a plan. A lockfile ask
// parks too: the lead refreshes it outside the box. Any other ask, and any stuck, goes to the
// judgment agent. A start refusal for a full laptop (agent_cap, low_disk) is retried on one named
// Effect Schedule (`slotSchedule`); any other refusal parks. Every limit is a Context.Reference with
// an overridable default (the defaults: a step retried every 5 minutes, 6 times; 3 stucks in a row
// on one step; 16 steps a lane), and `CHAIN_WAIT_MINUTES`, `CHAIN_WAITS`, `CHAIN_STUCKS` and
// `CHAIN_STEPS` override them from outside. Running out of retries is a typed `RetriesExhausted`,
// reported as stuck (decided with the clanka walk, 2026-11-09). Exit codes: 0 landed, 20 parked
// (ask), 30 stuck, 2 usage.
//
// Each step's record is a Schema value (`StepRecord`) written to `state/<lane>-chain.json` before
// the step starts and again when it ends, so a resume (`--start <step>`) needs nothing in memory.
// The chain holds every right (the bot's push, the PR, catch-up, the commit and its signature); a
// box or the judgment agent holds only its model login
// (.decisions/0028-the-parent-holds-every-right.md). The steps run the unmodified harness
// (.decisions/0026-fabrika-never-owns-the-agent-loop.md).
//
// The lane brief is one Markdown file. Its text before the first `## ` heading goes to every step.
// Then one section per step, `## tests`, `## build`, `## mutation`, `## review`, and `## pr`, the
// pull request's description (its first line is the title). drive appends its own answer tail.

import {spawn} from "node:child_process";
import {
	appendFileSync,
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import {join} from "node:path";
import {defineMachine} from "@demlik/tea";
import {Cmd, run} from "@demlik/tea/effect";
import {Context, Duration, Effect, Schedule, Schema} from "effect";
import {type Agents, Judgment, makeStepAgents, runTurn, stepRow} from "./agents.ts";
import {driveStep, type Env, loadEnv, prepare, sh} from "./drive.ts";
import {wipOf} from "./lane.ts";

const HERE = import.meta.dirname;
export const STEPS = ["tests", "build", "mutation", "review"] as const;
export type StepName = (typeof STEPS)[number];
const isStep = (s: string): s is StepName => (STEPS as readonly string[]).includes(s);

// ---------------------------------------------------------------- the limits

/** Minutes between two tries of a step drive refused for a full laptop. */
export const WaitMinutes = Context.Reference<number>("chain/WaitMinutes", {defaultValue: () => 5});
/** How many times such a step is tried again before `RetriesExhausted`. */
export const MaxWaits = Context.Reference<number>("chain/MaxWaits", {defaultValue: () => 6});
/** Stucks in a row on one step before the lane parks without asking. */
export const MaxStucks = Context.Reference<number>("chain/MaxStucks", {defaultValue: () => 3});
/** Steps a lane may run before it parks. */
export const MaxSteps = Context.Reference<number>("chain/MaxSteps", {defaultValue: () => 16});

/** The one schedule for a step drive refused for a slot: every `minutes`, `times` times. */
export const slotSchedule = (minutes: number) => Schedule.spaced(Duration.minutes(minutes));

/** drive refused the step for a full laptop (agent_cap or low_disk); retried on `slotSchedule`. */
export class SlotRefused extends Schema.TaggedError<SlotRefused>()("SlotRefused", {
	check: Schema.String,
	reason: Schema.String,
}) {}

/** A named schedule ran out; the lane reports it as stuck. */
export class RetriesExhausted extends Schema.TaggedError<RetriesExhausted>()("RetriesExhausted", {
	schedule: Schema.String,
	times: Schema.Number,
	reason: Schema.String,
}) {}

/** Whether a drive outcome is a slot refusal, the one kind the schedule retries. */
export const slotRefusal = (outcome: string): string | null => {
	const [verb, check = ""] = outcome.split(":");
	return verb === "refused" && (check === "agent_cap" || check === "low_disk") ? check : null;
};

// ---------------------------------------------------------------- what drive said

/** drive.ts's last line, the fields the chain reads. */
export type Line = {
	readonly outcome: string;
	readonly head: string;
	readonly reason: string;
	readonly report: string | null;
	readonly box: string;
	readonly exit: number;
};

const str = (v: unknown, or = ""): string => (typeof v === "string" ? v : or);

/** The last JSON line of drive's output, read loosely; `null` when there is none. */
export const lineOf = (out: string, exit: number): Line | null => {
	for (const raw of out.trim().split("\n").toReversed()) {
		let d: unknown;
		try {
			d = JSON.parse(raw);
		} catch {
			continue;
		}
		if (d === null || typeof d !== "object" || !("outcome" in d)) continue;
		const o = d as Record<string, unknown>;
		return {
			outcome: str(o.outcome),
			head: str(o.head),
			reason: str(o.reason),
			report: typeof o.report === "string" ? o.report : null,
			box: str(o.box),
			exit: typeof o.exit === "number" ? o.exit : exit,
		};
	}
	return null;
};

// ---------------------------------------------------------------- the moves

/** The next move after a step's outcome, as data. */
export type Move =
	| {readonly _tag: "step"; readonly step: StepName; readonly note: string}
	| {readonly _tag: "judge"}
	| {readonly _tag: "open"}
	| {readonly _tag: "park"; readonly reason: string};

/** The step a done answer hands to, or `null` at the end of the chain. */
const after: Record<StepName, StepName | null> = {
	tests: "build",
	build: "mutation",
	mutation: "review",
	review: null,
};

/**
 * The Check, pure: what drive's outcome means for the lane. `stucks` counts stucks in a row on
 * this step, against the `MaxStucks` limit. A slot refusal never reaches here: the step's Cmd
 * retries it on `slotSchedule`, and running out is a `RetriesExhausted` on the err channel.
 */
export const moveOf = (step: StepName, line: Line, stucks: number, maxStucks: number): Move => {
	const [verb, to = "", why = ""] = line.outcome.split(":");
	switch (verb) {
		case "done": {
			const next = after[step];
			return next === null ? {_tag: "open"} : {_tag: "step", step: next, note: ""};
		}
		case "skip":
			// Nothing here for this step: on to the next, with the why on record.
			return after[step] === null
				? {_tag: "open"}
				: {_tag: "step", step: after[step] ?? "review", note: ""};
		case "send":
			if (isStep(to))
				return {_tag: "step", step: to, note: `${step} answered ${line.outcome}: ${line.reason}`};
			return {_tag: "park", reason: `${step} sent the lane to ${to}: ${line.reason}`};
		case "ask":
			if (why === "lockfile") return {_tag: "park", reason: line.reason};
			return {_tag: "judge"};
		case "refused":
			return {_tag: "park", reason: `drive refused: ${line.outcome}: ${line.reason}`};
		default:
			return stucks >= maxStucks
				? {_tag: "park", reason: `${step} stuck ${maxStucks} times in a row: ${line.reason}`}
				: {_tag: "judge"};
	}
};

const JUDGED = /^[`*\s]*answer:\s*(send\s+(tests|build|mutation|review)|park)\b[`*\s]*(.*)$/i;

/** A judgment: a step to run again with a note, or a park for the lead. */
export type Judged = Extract<Move, {_tag: "step" | "park"}>;

/** A typed judgment (./agents.ts) as a move; a send that names no step is a park. */
export const movedOf = (j: Judgment): Judged =>
	j.answer === "send" && j.step !== null
		? {_tag: "step", step: j.step, note: `the lead's judgment: ${j.note}`}
		: {_tag: "park", reason: j.note || "the judgment agent parked the lane with no why"};

/** The judge Cmd's answer: the move it chose as JSON, or, for an older text, its `answer:` line. */
export const moveFrom = (text: string): Judged => {
	try {
		const d = JSON.parse(text) as Judged;
		if (d._tag === "step" && isStep(d.step))
			return {_tag: "step", step: d.step, note: String(d.note ?? "")};
		if (d._tag === "park") return {_tag: "park", reason: String(d.reason ?? "")};
	} catch {}
	return judgedOf(text);
};

/** What the judgment agent said on its last `answer:` line; none is a park. */
export const judgedOf = (text: string): Judged => {
	for (const line of text.split("\n").toReversed()) {
		const m = JUDGED.exec(line.trim());
		if (m === null) continue;
		const note = (m[3] ?? "").replace(/^[`*\s]+|[`*\s]+$/g, "");
		const to = m[2]?.toLowerCase() ?? "";
		if (isStep(to)) return {_tag: "step", step: to, note: `the lead's judgment: ${note}`};
		return {_tag: "park", reason: note || "the judgment agent parked the lane with no why"};
	}
	return {_tag: "park", reason: "the judgment agent gave no answer line"};
};

// ---------------------------------------------------------------- the brief

/** The lane brief, cut at its `## ` headings: the shared head and one body per section. */
export const sectionsOf = (text: string): {head: string; sections: Record<string, string>} => {
	const sections: Record<string, string> = {};
	let name: string | null = null;
	const head: string[] = [];
	const bodies: Record<string, string[]> = {};
	for (const line of text.split("\n")) {
		const m = /^## (\S+)\s*$/.exec(line);
		if (m) {
			name = (m[1] ?? "").toLowerCase();
			bodies[name] ??= [];
			continue;
		}
		if (name === null) head.push(line);
		else bodies[name]?.push(line);
	}
	for (const [k, v] of Object.entries(bodies)) sections[k] = v.join("\n").trim();
	return {head: head.join("\n").trim(), sections};
};

/** What one step is told about the lane: the brief's shared head, its section and the facts. */
export type Facts = {
	readonly ticket: string;
	readonly branch: string;
	readonly plan: string;
	readonly root: string;
	readonly head: string;
	readonly round: number;
	readonly heads: Partial<Record<StepName, string>>;
	readonly note: string;
};

export const briefOf = (lane: ReturnType<typeof sectionsOf>, step: StepName, f: Facts): string => {
	const short = (s: string) => s.slice(0, 8);
	const heads = STEPS.filter((s) => f.heads[s]).map((s) => `${s} ${short(f.heads[s] ?? "")}`);
	const lines = [
		lane.head,
		"",
		lane.sections[step] ?? "",
		"",
		"---",
		`Lane facts, written by chain.ts, round ${f.round}: ticket ${f.ticket}, branch ${f.branch}, approved plan ${f.plan}.`,
		`This step starts at ${short(f.head)}; the lane left main at ${short(f.root)}.`,
		heads.length > 0 ? `Heads so far: ${heads.join(", ")}.` : "No step has committed yet.",
		...(f.note ? [`Last round: ${f.note}`] : []),
	];
	if (step === "review")
		lines.push(
			`Parent base: origin/main at ${f.root}`,
			`Reviewed head: ${wipOf(f.branch)} at ${f.head}`,
		);
	if (step === "mutation")
		lines.push(
			`T=${f.ticket}, BUILD=${short(f.heads.tests ?? f.root)}..${short(f.heads.build ?? f.head)} (this round's build commits).`,
		);
	return `${lines.join("\n")}\n`;
};

// ---------------------------------------------------------------- the machine

const Run = Schema.Struct({
	step: Schema.Literals(STEPS),
	note: Schema.String,
	round: Schema.Number,
});

const LineS = Schema.Struct({
	outcome: Schema.String,
	head: Schema.String,
	reason: Schema.String,
	report: Schema.NullOr(Schema.String),
	box: Schema.String,
	exit: Schema.Number,
});

const Done = Schema.Struct({ok: Schema.Boolean, detail: Schema.String});

const stepRun = Cmd.make("step_run", {input: Run, ok: LineS, err: ["RetriesExhausted", "unknown"]});

/** One step's record, saved before it starts (`line` null) and again when it ends. */
export const StepRecord = Schema.Struct({
	round: Schema.Number,
	step: Schema.Literals(STEPS),
	note: Schema.String,
	startedAt: Schema.String,
	endedAt: Schema.NullOr(Schema.String),
	line: Schema.NullOr(LineS),
	/** The judgment agent's box and answer after this step, when one was asked. */
	judged: Schema.NullOr(Schema.Struct({box: Schema.String, answer: Schema.String})),
});
export type StepRecord = typeof StepRecord.Type;

/** The lane's chain record, `state/<lane>-chain.json`. */
export const ChainRecord = Schema.Struct({
	lane: Schema.String,
	pr: Schema.NullOr(Schema.Number),
	landed: Schema.NullOr(Schema.String),
	steps: Schema.Array(StepRecord),
});
export type ChainRecord = typeof ChainRecord.Type;

const judge = Cmd.make("judge", {
	input: Schema.Struct({step: Schema.Literals(STEPS), line: LineS, round: Schema.Number}),
	ok: Schema.Struct({text: Schema.String}),
	err: ["unknown"],
});

const prOpen = Cmd.make("pr_open", {
	input: Schema.Struct({head: Schema.String}),
	ok: Schema.Struct({pr: Schema.NullOr(Schema.Number), detail: Schema.String}),
	err: ["unknown"],
});

const land = Cmd.make("land", {
	input: Schema.Struct({pr: Schema.Number}),
	ok: Done,
	err: ["unknown"],
});

type Cmds =
	| ReturnType<typeof stepRun>
	| ReturnType<typeof judge>
	| ReturnType<typeof prOpen>
	| ReturnType<typeof land>;

/** How the lane ends: landed, parked for the lead, or stuck. */
export type End = {readonly kind: "done" | "ask" | "stuck"; readonly reason: string};
export const exitOf = (e: End): number => (e.kind === "done" ? 0 : e.kind === "ask" ? 20 : 30);

type Lane = {
	readonly round: number;
	readonly head: string;
	readonly heads: Partial<Record<StepName, string>>;
	readonly stucks: number;
};

/** The limits the machine reads, from the References, once at start. */
export type Limits = {readonly maxSteps: number; readonly maxStucks: number};

type Model =
	| {readonly phase: "idle"; readonly lane: Lane}
	| {
			readonly phase: "stepping";
			readonly lane: Lane;
			readonly step: StepName;
			readonly note: string;
	  }
	| {readonly phase: "judging"; readonly lane: Lane; readonly step: StepName; readonly line: Line}
	| {readonly phase: "opening"; readonly lane: Lane}
	| {readonly phase: "landing"; readonly lane: Lane; readonly pr: number}
	| {readonly phase: "over"; readonly lane: Lane; readonly end: End};

type Msg = {readonly type: "start"; readonly step: StepName};
type Step = readonly [Model, readonly Cmds[]];

const stay = (s: Model): Step => [s, []];
const over = (lane: Lane, end: End): Step => [{phase: "over", lane, end}, []];

const runStep = (lane: Lane, step: StepName, note: string): Step => {
	const round = lane.round + 1;
	const next = {...lane, round};
	const asked = stepRun({step, note, round});
	return [{phase: "stepping", lane: next, step, note}, [asked]];
};

/** Take a move: a step, the judgment agent, the pull request or a park. */
const take = (lane: Lane, step: StepName, line: Line, move: Move, max: number): Step => {
	if (move._tag === "step" && lane.round >= max)
		return over(lane, {kind: "ask", reason: `${max} steps ran (MaxSteps); the lane parks`});
	switch (move._tag) {
		case "step":
			return runStep(lane, move.step, move.note);
		case "judge":
			return [{phase: "judging", lane, step, line}, [judge({step, line, round: lane.round})]];
		case "open":
			return [{phase: "opening", lane}, [prOpen({head: lane.head})]];
		default:
			return over(lane, {kind: "ask", reason: move.reason});
	}
};

export const makeMachine = ({maxSteps, maxStucks}: Limits) =>
	defineMachine({
		types: {model: {} as Model, msg: {} as Msg, ctx: undefined},
		cmds: [stepRun, judge, prOpen, land],
		init: (): Step => [{phase: "idle", lane: {round: 0, head: "", heads: {}, stucks: 0}}, []],
		update: {
			start: (s, m): Step => (s.phase === "idle" ? runStep(s.lane, m.step, "") : stay(s)),
			step_run_ok: (s, m): Step => {
				if (s.phase !== "stepping") return stay(s);
				const line = m.value;
				const [verb] = line.outcome.split(":");
				const accepted = verb === "done" || verb === "send" || verb === "skip";
				const lane: Lane = {
					...s.lane,
					head: accepted && line.head ? line.head : s.lane.head,
					heads:
						verb === "done" && line.head ? {...s.lane.heads, [s.step]: line.head} : s.lane.heads,
					stucks: verb === "stuck" ? s.lane.stucks + 1 : 0,
				};
				return take(lane, s.step, line, moveOf(s.step, line, lane.stucks, maxStucks), maxSteps);
			},
			// A typed RetriesExhausted (the slot schedule ran out) or any other failure: stuck, with why.
			step_run_err: (s, m): Step =>
				s.phase === "stepping"
					? over(s.lane, {
							kind: "stuck",
							reason:
								m.error._tag === "RetriesExhausted"
									? `${s.step}: ${m.error.schedule} ran out after ${m.error.times} tries: ${m.error.reason}`
									: `drive.ts ${s.step} could not be started`,
						})
					: stay(s),
			judge_ok: (s, m): Step => {
				if (s.phase !== "judging") return stay(s);
				const move = moveFrom(m.value.text);
				return take(s.lane, s.step, s.line, move, maxSteps);
			},
			judge_err: (s): Step =>
				s.phase === "judging"
					? over(s.lane, {
							kind: "ask",
							reason: `${s.step} ${s.line.outcome}: ${s.line.reason} (the judgment agent failed)`,
						})
					: stay(s),
			pr_open_ok: (s, m): Step => {
				if (s.phase !== "opening") return stay(s);
				if (m.value.pr === null) return over(s.lane, {kind: "stuck", reason: m.value.detail});
				return [{phase: "landing", lane: s.lane, pr: m.value.pr}, [land({pr: m.value.pr})]];
			},
			pr_open_err: (s): Step =>
				s.phase === "opening"
					? over(s.lane, {kind: "stuck", reason: "opening the PR threw"})
					: stay(s),
			land_ok: (s, m): Step =>
				s.phase === "landing"
					? over(
							s.lane,
							m.value.ok
								? {kind: "done", reason: `PR ${s.pr} landed: ${m.value.detail}`}
								: {kind: "stuck", reason: `PR ${s.pr} did not land: ${m.value.detail}`},
						)
					: stay(s),
			land_err: (s): Step =>
				s.phase === "landing"
					? over(s.lane, {kind: "stuck", reason: `catchup.sh for PR ${s.pr} threw`})
					: stay(s),
		},
	});

// ---------------------------------------------------------------- the world

type Ran = {readonly code: number; readonly out: string};

/**
 * One child in its own process group, so a stop reaches every command it started. `stdin` is a
 * file to read, or nothing. Its stdout is kept; stderr goes to `errFile`.
 */
const spawnEffect = (
	cmd: string,
	args: readonly string[],
	opts: {cwd?: string; stdin?: string; errFile: string; env?: NodeJS.ProcessEnv},
) =>
	Effect.callback<Ran>((resume) => {
		const err = openSync(opts.errFile, "a");
		const input = opts.stdin === undefined ? "ignore" : openSync(opts.stdin, "r");
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			stdio: [input, "pipe", err],
			detached: true,
			env: opts.env,
		});
		const chunks: Buffer[] = [];
		child.stdout?.on("data", (c: Buffer) => chunks.push(c));
		const stopAll = () => {
			if (child.pid === undefined) return;
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch {}
		};
		child.on("exit", (code) => {
			closeSync(err);
			if (typeof input === "number") closeSync(input);
			resume(Effect.succeed({code: code ?? -1, out: Buffer.concat(chunks).toString("utf8")}));
		});
		return Effect.sync(stopAll);
	});

type Setup = {
	readonly env: Env;
	readonly agents: Agents;
	readonly lane: string;
	readonly ticket: string;
	readonly branch: string;
	readonly plan: string;
	readonly brief: ReturnType<typeof sectionsOf>;
	readonly claude: ReadonlySet<StepName>;
	readonly electron: ReadonlySet<StepName>;
	readonly model: string;
};

/** The last `n` lines of a file, or a line saying it is not there. */
const lastLines = (path: string | null, n: number): string =>
	path !== null && existsSync(path)
		? readFileSync(path, "utf8").trim().split("\n").slice(-n).join("\n")
		: "(none)";

const JUDGE_TAIL = (lane: string, step: StepName, line: Line, state: string, report: string) => `
You are the lead's judgment for lane ${lane}, started by chain.ts because the ${step} step
answered ${line.outcome}: ${line.reason}
You read; you change no file and start nothing. Your row only reads this repo and nothing beside
it, so the lane's state file and the step's report follow below. Read what you need in this repo.
Before you park a question, search .decisions/, .glossary/ and docs/direction/ for its answer. Then
answer with one JSON object (its schema follows): answer "send" with the step to run again (tests, build, mutation
or review) and a note of one or two sentences for that step, or answer "park" with step null and
why the lead has to look, in one sentence.
Send a step again when the fix is clear and that step owns it (a tests step owns test files, a
build step product code). Park when a plan would change, a decision is needed, a secret or a
person is involved, or the same step already failed the same way.

---
The lane's state file, its last lines:

${state}

---
The ${step} step's report:

${report}
`;

const handlers = (s: Setup) => {
	const {env} = s;
	const state = join(env.BOXES, "state", `${s.lane}.json`);
	const md = join(env.BOXES, "state", `${s.lane}.md`);
	const chainState = join(env.BOXES, "state", `${s.lane}-chain.json`);
	const errFile = join(env.BOXES, `${s.lane}-chain.err`);
	const note = (text: string) =>
		appendFileSync(md, `- ${new Date().toISOString()} chain: ${text}\n`);
	const saved = (): {
		head?: string;
		root?: string;
		steps: {step: string; outcome: string; head: string}[];
	} => (existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : {steps: []});
	// The chain record, a Schema value read and written whole: what a resume needs is on disk.
	const readRecord = (): ChainRecord =>
		existsSync(chainState)
			? Schema.decodeUnknownSync(ChainRecord)(JSON.parse(readFileSync(chainState, "utf8")))
			: {lane: s.lane, pr: null, landed: null, steps: []};
	const writeRecord = (r: ChainRecord) => {
		const text = JSON.stringify(Schema.encodeSync(ChainRecord)(r), null, "\t");
		writeFileSync(`${chainState}.tmp`, `${text}\n`);
		renameSync(`${chainState}.tmp`, chainState);
	};
	/** Replace this round's record (one per round), or add it. */
	const saveStep = (entry: StepRecord) => {
		const r = readRecord();
		const steps = r.steps.some((e) => e.round === entry.round)
			? r.steps.map((e) => (e.round === entry.round ? entry : e))
			: [...r.steps, entry];
		writeRecord({...r, steps});
	};
	const headsOf = () => {
		const heads: Partial<Record<StepName, string>> = {};
		for (const e of saved().steps)
			if (isStep(e.step) && e.outcome === "done") heads[e.step] = e.head;
		return heads;
	};
	return {
		step_run: (cmd: typeof Run.Type) =>
			Effect.gen(function* () {
				const lane = saved();
				const facts: Facts = {
					ticket: s.ticket,
					branch: s.branch,
					plan: s.plan,
					root: lane.root ?? "",
					head: lane.head ?? "",
					round: cmd.round,
					heads: headsOf(),
					note: cmd.note,
				};
				const brief = join(env.BOXES, `${s.lane}-chain${cmd.round}-${cmd.step}-brief.md`);
				writeFileSync(brief, briefOf(s.brief, cmd.step, facts));
				const claude = cmd.step === "mutation" || s.claude.has(cmd.step);
				const entry: StepRecord = {
					round: cmd.round,
					step: cmd.step,
					note: cmd.note,
					startedAt: new Date().toISOString(),
					endedAt: null,
					line: null,
					judged: null,
				};
				saveStep(entry);
				note(
					`round ${cmd.round}: starting ${cmd.step} on ${claude ? "claude" : "codex"}${cmd.note ? ` (${cmd.note})` : ""}`,
				);
				const minutes = yield* WaitMinutes;
				const times = yield* MaxWaits;
				// One drive run, in this process: prepare (the start checks) and, when they pass, the step.
				// A slot refusal is a typed failure the schedule retries.
				const once = Effect.gen(function* () {
					const prepared = prepare(env, {
						lane: s.lane,
						step: cmd.step,
						brief,
						agent: claude ? "claude" : "codex",
						model: claude ? s.model : undefined,
						electron: claude && s.electron.has(cmd.step),
						ticket: s.ticket,
						branch: s.branch,
						plan: s.plan,
					});
					if (prepared._tag === "refused") {
						const check = slotRefusal(prepared.outcome);
						if (check !== null) {
							note(`drive refused ${cmd.step} (${check}); trying again in ${minutes} minutes`);
							return yield* Effect.fail(new SlotRefused({check, reason: prepared.reason}));
						}
						return {
							outcome: prepared.outcome,
							head: "",
							reason: prepared.reason,
							report: null,
							box: "",
							exit: prepared.exit,
						} satisfies Line;
					}
					const ran = yield* driveStep(env, s.agents, prepared);
					return {
						outcome: ran.outcome,
						head: ran.head,
						reason: ran.reason,
						report: ran.report,
						box: ran.box,
						exit: ran.exit,
					} satisfies Line;
				});
				const line = yield* once.pipe(
					Effect.retry({schedule: slotSchedule(minutes), times}),
					Effect.catchTag("SlotRefused", (e) =>
						Effect.fail(
							new RetriesExhausted({
								schedule: `slotSchedule(${minutes} minutes)`,
								times: times + 1,
								reason: `${e.check}: ${e.reason}`,
							}),
						),
					),
					Effect.tapError((e) =>
						Effect.sync(() => {
							saveStep({
								...entry,
								endedAt: new Date().toISOString(),
								line: {
									outcome: `stuck:${e._tag}`,
									head: "",
									reason: e.reason,
									report: null,
									box: "",
									exit: 30,
								},
							});
							note(`round ${cmd.round}: ${cmd.step} ${e._tag}: ${e.reason.slice(0, 200)}`);
						}),
					),
					// tea's err channel takes a plain tagged record; the class stays inside the handler.
					Effect.mapError((e) => ({
						_tag: "RetriesExhausted" as const,
						schedule: e.schedule,
						times: e.times,
						reason: e.reason,
					})),
				);
				saveStep({...entry, endedAt: new Date().toISOString(), line});
				return line;
			}),
		judge: (cmd: {step: StepName; line: Line; round: number}) =>
			Effect.gen(function* () {
				const box = `${s.lane}-judge${cmd.round}`;
				const at = (suffix: string) => join(env.BOXES, `${box}${suffix}`);
				note(
					`round ${cmd.round}: ${cmd.step} ${cmd.line.outcome}; asking a judgment agent (${box})`,
				);
				const started = new Date();
				// One turn in the main checkout on the row that only reads (Codex's read-only profile):
				// the judgment cannot change the checkout, by the harness and not by a promise. That row
				// reads nothing beside the checkout, so the state file and the report ride in the prompt.
				const turned = yield* runTurn(s.agents, {
					provider: "codex-read",
					session: box,
					folder: env.MAIN,
					prompt: JUDGE_TAIL(
						s.lane,
						cmd.step,
						cmd.line,
						lastLines(md, 40),
						lastLines(cmd.line.report, 200),
					),
					system: `You are the lead's judgment for lane ${s.lane}, run by chain.ts. You read and change no file.`,
					answer: Judgment,
					model: env.CODEX_MODEL,
					effort: env.CODEX_EFFORT,
					minutes: 20,
					events: at(".jsonl"),
					report: at(".md"),
				});
				const text = turned._tag === "ended" ? turned.said : `${turned.why}: ${turned.message}`;
				const move =
					turned._tag === "ended" && turned.answer !== null
						? movedOf(turned.answer)
						: judgedOf(text);
				// Its field row, beside the steps' rows (record wide).
				const scrubbed = sh("sh", [join(HERE, "redact.sh"), at(".md"), at(".jsonl")]);
				appendFileSync(
					join(env.BOXES, `${s.lane}-rows.jsonl`),
					stepRow({
						run: `t${s.ticket}-judge${cmd.round}`,
						ticket: s.ticket,
						step: cmd.step,
						provider: "codex-read",
						model: env.CODEX_MODEL,
						effort: env.CODEX_EFFORT,
						outcome: move._tag === "step" ? "pass" : "parked",
						why: `chain.ts judgment for ${s.lane} after ${cmd.step} ${cmd.line.outcome}: ${move._tag === "step" ? `send ${move.step}` : "park"}`,
						started,
						ended: new Date(),
						spent: turned.spent,
						redacted: scrubbed.code === 0 ? Number(scrubbed.out.trim()) : null,
					}),
				);
				const answer =
					move._tag === "step" ? `send ${move.step}: ${move.note}` : `park: ${move.reason}`;
				note(`judgment: ${answer}`);
				const r = readRecord();
				const last = r.steps.find((e) => e.round === cmd.round);
				if (last) saveStep({...last, judged: {box, answer}});
				return {text: JSON.stringify(move)};
			}),
		pr_open: (cmd: {head: string}) =>
			Effect.gen(function* () {
				const title = (s.brief.sections.pr ?? "")
					.split("\n")[0]
					?.replace(/^#+\s*/, "")
					.trim();
				if (!title)
					return {pr: null, detail: "the lane brief has no `## pr` section with a title line"};
				note(
					`review said merge-ready at ${cmd.head.slice(0, 8)}; pushing ${s.branch} and opening the PR`,
				);
				const push = yield* spawnEffect(
					"node",
					[join(HERE, "botpush.mjs"), env.MAIN, s.branch, cmd.head],
					{errFile},
				);
				if (push.code !== 0)
					return {pr: null, detail: `botpush ${s.branch} failed; see ${errFile}`};
				const listed = sh("gh", [
					"pr",
					"list",
					"-R",
					env.GH_REPO,
					"--head",
					s.branch,
					"--json",
					"number",
					"-q",
					".[0].number",
				]);
				const existing = Number(listed.out.trim());
				if (listed.code === 0 && Number.isInteger(existing) && existing > 0) {
					note(`PR ${existing} already open on ${s.branch}`);
					writeRecord({...readRecord(), pr: existing});
					return {pr: existing, detail: "existing"};
				}
				const body = [
					(s.brief.sections.pr ?? "").split("\n").slice(1).join("\n").trim(),
					"",
					"## Steps",
					"",
					`Ran end to end by \`chain.ts ${s.lane}\`: no lead agent held the lane. Each step was its own agent through the fabrika agents package on ACP (Codex in a box, or Claude for ${["mutation", ...s.claude].join(", ")}); the lead agent wrote no step's work. Steps and dollars:`,
					"",
					...stepsTable(join(env.BOXES, `${s.lane}-rows.jsonl`), saved().steps),
				].join("\n");
				const bodyFile = join(env.BOXES, `${s.lane}-pr-body.md`);
				writeFileSync(bodyFile, `${body}\n`);
				const made = sh("gh", [
					"pr",
					"create",
					"-R",
					env.GH_REPO,
					"--head",
					s.branch,
					"--title",
					title,
					"--body-file",
					bodyFile,
				]);
				const pr = Number(/\/pull\/(\d+)/.exec(made.out)?.[1]);
				if (made.code !== 0 || !Number.isInteger(pr))
					return {
						pr: null,
						detail: `gh pr create failed: ${made.out.trim().split("\n").at(-1) ?? ""}`,
					};
				note(`opened https://github.com/${env.GH_REPO}/pull/${pr}`);
				writeRecord({...readRecord(), pr});
				return {pr, detail: "opened"};
			}),
		land: (cmd: {pr: number}) =>
			Effect.gen(function* () {
				note(`catchup.sh ${cmd.pr} ${s.ticket}`);
				const ran = yield* spawnEffect("sh", [join(HERE, "catchup.sh"), String(cmd.pr), s.ticket], {
					errFile,
				});
				const last = ran.out.trim().split("\n").at(-1) ?? "";
				note(`catchup.sh exited ${ran.code}: ${last}`);
				writeRecord({...readRecord(), landed: ran.code === 0 ? new Date().toISOString() : null});
				return {ok: ran.code === 0, detail: last || `exit ${ran.code}; see ${errFile}`};
			}),
	};
};

/** One table row per step the lane ran, with its list-price dollars from the rows file. */
export const stepsTable = (
	rowsFile: string,
	steps: readonly {step: string; outcome: string; box?: string; run?: string}[],
): string[] => {
	const dollars = new Map<string, number>();
	if (existsSync(rowsFile))
		for (const raw of readFileSync(rowsFile, "utf8").split("\n")) {
			try {
				const r = JSON.parse(raw) as {run?: string; listUsd?: number};
				if (r.run && typeof r.listUsd === "number") dollars.set(r.run, r.listUsd);
			} catch {}
		}
	const total = steps.reduce((sum, e) => sum + (dollars.get(e.run ?? "") ?? 0), 0);
	return [
		"| Step | Box | Outcome | List $ |",
		"|---|---|---|---|",
		...steps.map(
			(e) =>
				`| ${e.step} | ${e.box ?? ""} | ${e.outcome} | ${dollars.has(e.run ?? "") ? (dollars.get(e.run ?? "") ?? 0).toFixed(2) : ""} |`,
		),
		`| total | | | ${total.toFixed(2)} |`,
	];
};

// ---------------------------------------------------------------- the command

const flag = (args: string[], name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};

const stepSet = (text: string | undefined): Set<StepName> =>
	new Set(
		(text ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(isStep),
	);

export const chainMain = (args: string[], env: Env) =>
	Effect.gen(function* () {
		const [lane = "", briefPath = ""] = args;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(lane) || !existsSync(briefPath)) {
			console.error(
				"usage: node chain.ts <lane> <lane-brief.md> [--ticket <n>] [--branch fabrikalfa/<name>] [--plan <path>] [--claude tests,build] [--electron tests,build] [--model sonnet|opus] [--start tests|build|mutation|review]",
			);
			process.exit(2);
		}
		mkdirSync(join(env.BOXES, "state"), {recursive: true});
		const statePath = join(env.BOXES, "state", `${lane}.json`);
		const saved: {ticket?: string; branch?: string; plan?: string} = existsSync(statePath)
			? JSON.parse(readFileSync(statePath, "utf8"))
			: {};
		const ticket = flag(args, "--ticket") ?? saved.ticket;
		if (!ticket) {
			console.error(`chain.ts: no ticket for lane ${lane} yet; pass --ticket`);
			process.exit(2);
		}
		const branch = flag(args, "--branch") ?? saved.branch ?? `fabrikalfa/${lane}`;
		const plan = flag(args, "--plan") ?? saved.plan ?? join(env.BOXES, `${lane}-PLAN.md`);
		const start = flag(args, "--start") ?? "tests";
		if (!isStep(start)) {
			console.error(`chain.ts: --start takes one of ${STEPS.join(", ")}`);
			process.exit(2);
		}
		const brief = sectionsOf(readFileSync(briefPath, "utf8"));
		const missing = [...STEPS, "pr"].filter((k) => !brief.sections[k]);
		if (missing.length > 0) {
			console.error(
				`chain.ts: the lane brief lacks sections: ${missing.map((m) => `## ${m}`).join(", ")}`,
			);
			process.exit(2);
		}
		const setup: Omit<Setup, "agents"> = {
			env,
			lane,
			ticket,
			branch,
			plan,
			brief,
			claude: stepSet(flag(args, "--claude")),
			electron: stepSet(flag(args, "--electron")),
			model: flag(args, "--model") ?? "sonnet",
		};
		const limits: Limits = {maxSteps: yield* MaxSteps, maxStucks: yield* MaxStucks};
		const machine = makeMachine(limits);
		const agents = yield* makeStepAgents(join(env.BOXES, "state", "sessions"));
		const handle = yield* run(machine, {
			ctx: undefined,
			interpret: handlers({...setup, agents}),
			terminal: (m) => m.phase === "over",
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch({type: "start", step: start});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`chain stopped in ${end.phase}`);
		console.log(
			JSON.stringify({
				outcome: end.end.kind,
				lane,
				rounds: end.lane.round,
				head: end.lane.head,
				reason: end.end.reason,
				exit: exitOf(end.end),
			}),
		);
		return end.end;
	});

/** A limit's override from the environment, when set and a number. */
const overridden =
	(ref: Context.Reference<number>, name: string) =>
	<E>(self: Effect.Effect<void, E, never>): Effect.Effect<void, E, never> => {
		const v = Number(process.env[name]);
		return process.env[name] !== undefined && Number.isFinite(v)
			? Effect.provideService(self, ref, v)
			: self;
	};

const main = () => {
	const env = loadEnv();
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const end = yield* chainMain(process.argv.slice(2), env);
				process.exitCode = exitOf(end);
			}),
		).pipe(
			overridden(WaitMinutes, "CHAIN_WAIT_MINUTES"),
			overridden(MaxWaits, "CHAIN_WAITS"),
			overridden(MaxStucks, "CHAIN_STUCKS"),
			overridden(MaxSteps, "CHAIN_STEPS"),
		),
	).catch((e: unknown) => {
		console.log(JSON.stringify({outcome: "stuck", reason: String(e), exit: 30}));
		process.exitCode = 30;
	});
};

if (import.meta.main) main();
