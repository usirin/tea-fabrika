// Experiment 168: the factory as one tsh line, and the loop `send` needs.
//
//   tracker | triage | plan | build | review | ship
//
// Four loop shapes, each a real tsh session in this process with its own program list
// (experiments/lib/factory-line.ts). The agents are fake: each run hands back a scripted outcome.
// No model, no network, no key, $0.
//
//   STEP=shapes (default)   every shape: the whole line, Ctrl-C and a start again, a line by hand
//   STEP=help               the program list and each `--describe`, as tsh prints them, into a file
//   STEP=agent              an agent writes lines for five tasks from that file (AGENT=scripted|codex)
//
// Ticket #7 is the stand-in from programs/tracker/src/seven.ts. #8 is skipped at triage, #9 gets
// stuck at build.
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent, type AnyProgram, type Entry, listed, Shell} from "@kampus/fabrika";
import {codexHomeOf} from "@kampus/fabrika/agents/acp";
import {codexAdapter, psReaper} from "@kampus/fabrika/agents/codex";
import type {AnyOutcome} from "@kampus/pipeline/stages/outcome";
import {counter} from "@tea-fabrika/counter";
import {map} from "@tea-fabrika/map";
import {ticket} from "@tea-fabrika/ticket";
import {trace} from "@tea-fabrika/trace";
import {SEVEN_TITLE} from "@tea-fabrika/tracker/seven";
import {Deferred, Duration, Effect, Exit, Layer, Schema, Stream} from "effect";
import {
	backWires,
	type Fact,
	listOf,
	lookOf,
	makeWorld,
	type ShapeName,
	type Step,
	session,
	type World,
	waitUntil,
} from "./lib/factory-line.ts";

// Node at the edge, said out loud: `node:fs`, `node:os` and `node:path` write the results and help
// files, and make and remove the empty folder Codex works in.
const RESULTS = join(import.meta.dirname, "results");

const done: Step = {outcome: {kind: "done", part: false}};
const step = (outcome: AnyOutcome, hold = false): Step => ({outcome, hold});

const FILED: readonly Fact[] = [
	{kind: "filed", ticket: 7, title: SEVEN_TITLE},
	{kind: "filed", ticket: 8, title: "Make the tracker's rows blink when a ticket changes"},
	{kind: "filed", ticket: 9, title: "The ledger's door keeps facts in a second store"},
];

/** The whole line's runs: #7 goes round once, #8 is skipped, #9 is stuck. */
const script = (holdSecondBuild: boolean): Readonly<Record<string, readonly Step[]>> => ({
	"triage#7": [done],
	"triage#8": [step({kind: "skip", why: "declined"})],
	"triage#9": [done],
	"plan#7": [step({kind: "ask", who: "owner", for: "approval"})],
	"plan#9": [done],
	"build#7": [done, holdSecondBuild ? step({kind: "done", part: false}, true) : done],
	"build#9": [step({kind: "stuck", why: "cannot_meet"})],
	"review#7": [step({kind: "send", to: "build", why: "checks_red"}), done],
	"ship#7": [done],
});

/** A line by hand starts past plan: #7 is triaged, planned and approved on the ledger. */
const PLANNED: readonly Fact[] = [
	FILED[0] as Fact,
	{kind: "outcome", ticket: 7, stage: "triage", outcome: {kind: "done", part: false}},
	{
		kind: "outcome",
		ticket: 7,
		stage: "plan",
		outcome: {kind: "ask", who: "owner", for: "approval"},
	},
	{kind: "answer", ticket: 7, stage: "plan", pick: "approve"},
];
const HAND_SCRIPT: Readonly<Record<string, readonly Step[]>> = {
	"build#7": [done, done],
	"review#7": [step({kind: "send", to: "build", why: "checks_red"}), done],
	"ship#7": [done],
};

interface Shape {
	readonly name: string;
	readonly list: ShapeName;
	/** What a person types for the whole factory, before the `&`. */
	readonly full: string;
	/** One ticket by hand, past plan. */
	readonly hand: string;
	/** Typed next, by hand, when the hand line ended with #7 not shipped. */
	readonly again?: string;
	/** Shape 2's `^build`: the back wire's pipe holds build's input open (Unix's rule) or not. */
	readonly holds?: boolean;
}

export const SHAPES: readonly Shape[] = [
	{
		name: "1 named pipe",
		list: "fifo",
		full: "mkfifo --name redo; tracker | triage | plan | build --from redo | review --to redo | ship",
		hand: "mkfifo --name redo; plan --ticket 7 | build --from redo | review --to redo | ship",
	},
	{
		name: "2 wire back (^build)",
		list: "back",
		full: "tracker | triage | plan | build | review ^build | ship",
		hand: "plan --ticket 7 | build | review ^build | ship",
		holds: true,
	},
	{
		name: "2b wire back, not a writer",
		list: "back",
		full: "tracker | triage | plan | build | review ^build | ship",
		hand: "plan --ticket 7 | build | review ^build | ship",
		holds: false,
	},
	{
		name: "3 parent (build-review)",
		list: "parent",
		full: "tracker | triage | plan | build-review | ship",
		hand: "plan --ticket 7 | build-review | ship",
	},
	{
		name: "4 through the tracker",
		list: "tracker",
		full: "tracker | triage | plan | build | review | ship",
		hand: "plan --ticket 7 | build | review | ship",
		again: "build --ticket 7 | review | ship",
	},
];

/** The line tsh is told: shape 2's `^build` made into its named pipe first. */
const told = (shape: Shape, world: World, text: string) =>
	Effect.gen(function* () {
		if (shape.list !== "back") return text;
		const wired = yield* backWires(world, text, shape.holds ?? true);
		if (wired.kind === "refused") return yield* Effect.die(wired.why);
		return wired.line;
	});

const shippedSeven = (world: World) => lookOf(world.facts, "ship", 7) === "pass";
const settled = (world: World) => shippedSeven(world) && lookOf(world.facts, "build", 9) === "stop";
const runsOf = (world: World) => world.runs.map((r) => `${r.stage}#${r.ticket}`);
const ANSWER = `answer '{"ticket":7,"pick":"approve"}'`;
/** A built-in's own rows, without what a background job printed meanwhile (`[1] plan said ...`). */
const rowsOf = (out: readonly string[]) =>
	out.filter((l) => !/^\[\d+\] \S+ (said|ticket) /.test(l));

/** What a map of the job could draw from the job's record alone, and from the ledger. */
function drawable(record: unknown, world: World) {
	const job = (
		record as {
			jobs?: readonly {
				stages: readonly {program: string; flags: Record<string, unknown>; wire: unknown}[];
			}[];
		}
	).jobs?.[0];
	if (job === undefined) return null;
	const boxes = job.stages.map((s) => s.program);
	const forward = job.stages.flatMap((s, i) =>
		s.wire === null ? [] : [`${s.program} -> ${job.stages[i + 1]?.program}`],
	);
	// A back edge in the record is only a pair of flags naming one pipe: a map must know the convention.
	const back = job.stages.flatMap((s) => {
		const to = s.flags.to;
		if (typeof to !== "string") return [];
		const reader = job.stages.find((r) => r.flags.from === to);
		return reader === undefined ? [] : [`${s.program} -> ${reader.program} (pipe ${to})`];
	});
	const sends = world.facts.filter((f) => f.kind === "outcome" && f.outcome.kind === "send").length;
	return {boxes, forward, back, sendsOnLedger: sends};
}

/** The whole line, in the background: answer the ask, wait for #7 to ship, look, stop it. */
const wholeLine = (shape: Shape) =>
	Effect.gen(function* () {
		const world = yield* makeWorld(FILED, script(false));
		const sh = yield* session(listOf(shape.list, world));
		const text = yield* told(shape, world, shape.full);
		const began = yield* sh.line(`${text} &`);
		const plan = sh.table()?.jobs[0]?.stages.find((s) => s.program === "plan")?.run;
		const asked = yield* waitUntil(() => lookOf(world.facts, "plan", 7) === "wait");
		const jobsAsking = rowsOf((yield* sh.line("jobs")).out);
		const answered = yield* sh.line(`tell ${plan} ${ANSWER}`);
		const ran = yield* waitUntil(() => settled(world));
		const jobsDone = rowsOf((yield* sh.line("jobs")).out);
		const ps = rowsOf((yield* sh.line("ps")).out);
		const map = drawable(sh.table(), world);
		const from = sh.mark();
		yield* sh.line("stop %1");
		yield* waitUntil(() => sh.since(from).some((l) => l.startsWith("[1] ended")), 2000);
		const stopped = sh.since(from);
		const jobsAfter = (yield* sh.line("jobs")).out;
		yield* sh.close();
		return {
			typed: text,
			began: began.out,
			asked,
			answered: answered.status,
			endToEnd: ran,
			shipped: shippedSeven(world),
			runs: runsOf(world),
			jobsAsking,
			jobsDone,
			ps,
			map,
			stopped,
			jobsAfter,
			dropped: world.dropped,
		};
	}).pipe(Effect.scoped);

/** Ctrl-C while build works on #7's second lap, then the same line again. */
const ctrlCAndAgain = (shape: Shape) =>
	Effect.gen(function* () {
		const world = yield* makeWorld(FILED, script(true));
		const sh = yield* session(listOf(shape.list, world));
		const text = yield* told(shape, world, shape.full);
		yield* sh.line(`${text} &`);
		const plan = sh.table()?.jobs[0]?.stages.find((s) => s.program === "plan")?.run;
		yield* waitUntil(() => lookOf(world.facts, "plan", 7) === "wait");
		yield* sh.line(`tell ${plan} ${ANSWER}`);
		const held = yield* waitUntil(() => world.held > 0);
		const runsBefore = world.runs.length;
		const from = sh.mark();
		const attached = yield* sh.typeOnly("attach %1");
		yield* Effect.sleep(Duration.millis(30));
		yield* sh.ctrlC;
		const status = yield* attached.ended(3000);
		const printed = sh.since(from);
		const jobsAfter = (yield* sh.line("jobs")).out;
		// The run that was stopped is run again; nothing holds it this time.
		yield* Deferred.succeed(world.release, undefined);
		const again = yield* told(shape, world, shape.full);
		yield* sh.line(`${again} &`);
		const finished = yield* waitUntil(() => settled(world));
		const runsAgain = world.runs.slice(runsBefore).map((r) => `${r.stage}#${r.ticket}`);
		yield* sh.line("stop %1");
		yield* waitUntil(() => (sh.table()?.jobs.length ?? 0) === 0, 2000);
		yield* sh.close();
		return {
			held,
			status: status._tag === "Some" ? status.value : "still waiting",
			printed,
			jobsAfter,
			finished,
			runsAgain,
		};
	}).pipe(Effect.scoped);

/** One ticket by hand, in the foreground: does the line end by itself, and is #7 shipped? */
const byHand = (shape: Shape) =>
	Effect.gen(function* () {
		const world = yield* makeWorld(PLANNED, HAND_SCRIPT);
		const sh = yield* session(listOf(shape.list, world));
		const text = yield* told(shape, world, shape.hand);
		const from = sh.mark();
		const typed = yield* sh.typeOnly(text);
		yield* waitUntil(() => shippedSeven(world), 1500);
		const first = yield* typed.ended(700);
		let ended: "by itself" | "only by Ctrl-C" = "by itself";
		let status = first._tag === "Some" ? first.value : -1;
		if (first._tag === "None") {
			ended = "only by Ctrl-C";
			yield* sh.ctrlC;
			const after = yield* typed.ended(3000);
			status = after._tag === "Some" ? after.value : -1;
		}
		const printed = sh.since(from);
		const shipped = shippedSeven(world);
		const runs = runsOf(world);
		let again: {
			readonly typed: string;
			readonly status: number;
			readonly shipped: boolean;
			readonly runs: readonly string[];
		} | null = null;
		if (!shipped && shape.again !== undefined) {
			const second = yield* sh.line(shape.again);
			again = {
				typed: shape.again,
				status: second.status,
				shipped: shippedSeven(world),
				runs: runsOf(world).slice(runs.length),
			};
		}
		yield* sh.close();
		return {
			typed: shape.hand,
			told: text,
			ended,
			status,
			shipped,
			runs,
			dropped: world.dropped,
			printed,
			again,
		};
	}).pipe(Effect.scoped);

const shapes = Effect.gen(function* () {
	const rows = [];
	for (const shape of SHAPES) {
		const whole = yield* wholeLine(shape);
		const ctrlC = yield* ctrlCAndAgain(shape);
		const hand = yield* byHand(shape);
		rows.push({shape: shape.name, full: shape.full, hand: shape.hand, whole, ctrlC, byHand: hand});
	}
	return rows;
});

const STEP = process.env.STEP ?? "shapes";
if (STEP === "shapes") {
	const rows = await Effect.runPromise(shapes);
	mkdirSync(RESULTS, {recursive: true});
	writeFileSync(join(RESULTS, "168-shapes.json"), `${JSON.stringify(rows, null, "\t")}\n`);
	for (const r of rows) {
		const statements = r.full.split(";").length;
		console.log(`\n## ${r.shape}`);
		console.log(`typed: ${r.full}`);
		console.log(
			`  ${r.full.length} characters, ${statements} statement${statements === 1 ? "" : "s"}`,
		);
		console.log(
			`whole line: end to end ${r.whole.endToEnd}, #7 shipped ${r.whole.shipped}, ${r.whole.runs.length} agent runs`,
		);
		console.log(`  runs: ${r.whole.runs.join(" ")}`);
		console.log("  jobs while #7 waits on its ask:");
		for (const l of r.whole.jobsAsking) console.log(`    ${l}`);
		console.log("  jobs once #7 shipped:");
		for (const l of r.whole.jobsDone) console.log(`    ${l}`);
		console.log(`  map from the record: ${JSON.stringify(r.whole.map)}`);
		console.log(`  stop %1: ${r.whole.stopped.join(" / ")}`);
		console.log(
			`Ctrl-C mid build lap 2: status ${r.ctrlC.status}; jobs after: ${r.ctrlC.jobsAfter.length === 0 ? "none" : r.ctrlC.jobsAfter.join(" / ")}`,
		);
		console.log(`  printed: ${r.ctrlC.printed.join(" / ")}`);
		console.log(
			`  same line again: finished ${r.ctrlC.finished}; runs again: ${r.ctrlC.runsAgain.join(" ")}`,
		);
		console.log(`by hand: ${r.byHand.typed}`);
		console.log(
			`  ${r.hand.length} characters; ended ${r.byHand.ended} (status ${r.byHand.status}); #7 shipped ${r.byHand.shipped}; runs ${r.byHand.runs.join(" ")}; dropped ${JSON.stringify(r.byHand.dropped)}`,
		);
		if (r.byHand.again !== null)
			console.log(
				`  then by hand: ${r.byHand.again.typed} -> status ${r.byHand.again.status}, #7 shipped ${r.byHand.again.shipped}, runs ${r.byHand.again.runs.join(" ")}`,
			);
	}
}

// ---------------------------------------------------------------- can an agent write the line?

/** The shape whose programs the agent is shown: shape 4's, plain stage names and no new syntax. */
const AGENT_SHAPE: ShapeName = "tracker";
/** The help text the agent reads: a file, so it can be made again from a new `--help` and the test run again. */
const HELP_FILE = process.env.HELP_FILE ?? join(RESULTS, "168-help.txt");

/**
 * A program listed for its declaration only: `programs`, `--describe` and tsh's check read it,
 * and starting it fails. ticket, map and trace need the app's ledger to run.
 */
const declaredOnly = (program: AnyProgram): Entry => {
	const no = Effect.die(`${program.name} is listed for its help only in experiment 168`);
	return {program, start: () => no, pipe: () => no, call: () => no};
};

/** The app's list as a tile's tsh has it (apps/fabrika/src/tsh.ts), with shape 4's factory. */
const agentList = (world: World) => {
	const small = new Set(Shell.SMALL.map((s) => s.program.name));
	const factory = [...listOf(AGENT_SHAPE, world).values()].filter(
		(e) => !small.has(e.program.name),
	);
	return Shell.programList([
		...Shell.SMALL,
		listed(counter, Layer.empty),
		declaredOnly(ticket),
		declaredOnly(map),
		declaredOnly(trace),
		...factory,
	]);
};

/** How a program is asked for its help: `--describe` today, `--help` once ticket 82 lands. */
const HELP_FLAG = process.env.HELP_FLAG ?? "--describe";

/** The help text, as tsh prints it: `programs`, then each program's help. */
const helpText = Effect.gen(function* () {
	const world = yield* makeWorld([], {});
	const list = agentList(world);
	const sh = yield* session(list);
	const out = ["tsh$ programs", ...(yield* sh.line("programs")).out];
	for (const name of list.keys()) {
		const asked = `${name} ${HELP_FLAG}`;
		out.push("", `tsh$ ${asked}`, ...(yield* sh.line(asked)).out);
	}
	yield* sh.close();
	return out.join("\n");
}).pipe(Effect.scoped);

interface Task {
	readonly id: string;
	readonly ask: string;
	/** Right answers, any one of them. Compared by programs, flags and values, not by spacing. */
	readonly right: readonly string[];
}

const TASKS: readonly Task[] = [
	{
		id: "show",
		ask: "Show me ticket 7, and the trace of its plan run.",
		right: ["ticket --ticket 7; trace --ticket 7"],
	},
	// A stage's `--ticket 7` and its input told `ticket=7` do the same: both count.
	{
		id: "two",
		ask: "Run just build and review on ticket 7.",
		right: ["build --ticket 7 | review", "build ticket=7 | review"],
	},
	{
		id: "all",
		ask: "Run the whole factory on every open ticket, from the tracker to ship.",
		right: ["tracker | triage | plan | build | review | ship"],
	},
	{
		id: "one",
		ask: "Triage ticket 8 only. Do not plan or build it.",
		right: ["triage --ticket 8", "triage ticket=8"],
	},
	{
		id: "plan",
		ask: "Plan ticket 7, and if its plan is approved, build it, and stop there.",
		right: ["plan --ticket 7 | build", "plan ticket=7 | build"],
	},
	// Three harder ones, added once the five above came back all right: a stage left off, a job no
	// program here does (the right answer is no line), and the loop this experiment is about.
	{
		id: "noship",
		ask: "Run the factory on every open ticket, but do not ship anything.",
		right: ["tracker | triage | plan | build | review"],
	},
	{id: "cannot", ask: "Merge pull request 12 by hand, now.", right: [""]},
	{
		id: "again",
		ask: "Ticket 7 failed review. Send it through build and review again, and ship it once review passes.",
		right: ["build --ticket 7 | review | ship", "build ticket=7 | review | ship"],
	},
];

const Reply = Schema.Struct({line: Schema.String, why: Schema.String});
type Reply = typeof Reply.Type;

const NO_TOOLS =
	"Everything you need is in this message. Do not run any command or read any file: answer from the text alone.";

const SYSTEM =
	"You write one line for tsh, a shell for typed programs, from the help text you are given. You run nothing.";

const promptOf = (help: string, task: Task) =>
	[
		NO_TOOLS,
		"tsh is a shell that runs only typed programs. A line is statements parted by ; or &. A | pipes one program's output into the next one's input, matched by their types. Here is what tsh prints for `programs` and for each program's `--describe`:",
		help,
		`The task: ${task.ask}`,
		"Answer with the one tsh line that does it, in `line`, and one short sentence in `why`. If these programs cannot do it, leave `line` empty and say why in `why`.",
	].join("\n\n");

const givenText = (g: {readonly value: {readonly kind: string; readonly text?: string}}) =>
	g.value.kind === "text" ? (g.value.text ?? "") : "$()";

/**
 * A line as tsh reads it, as text that ignores spacing: each pipeline's programs with their flags
 * and told values, sorted. A trailing `&` and the order of statements do not count.
 */
const shapeOfLine = (text: string): string | null => {
	const parsed = Shell.parse(text);
	if (parsed.kind === "refused") return null;
	const statements = parsed.statements.map((st) =>
		st.kind === "builtin"
			? [st.name, ...st.args.map((a) => a.name)].join(" ")
			: st.pipeline.commands
					.map((c) =>
						[
							c.program.name,
							...c.flags.map((f) => `--${f.name} ${givenText(f)}`).sort(),
							...c.told.map((t) => `${t.name}=${givenText(t)}`).sort(),
						].join(" "),
					)
					.join(" | "),
	);
	return statements.sort().join("; ");
};

const APP_ONLY = new Set(["ticket", "map", "trace"]);

interface Ran {
	readonly status: number;
	readonly ctrlC: boolean;
	readonly runs: readonly string[];
}
interface Judged {
	readonly parses: boolean;
	readonly checks: boolean;
	readonly right: boolean;
	readonly why: string;
	readonly ran: Ran | null;
}

/** What tsh makes of one written line: parsed, checked against the list, run when it can be. */
const judge = (task: Task, line: string): Effect.Effect<Judged> =>
	Effect.gen(function* () {
		if (line.trim() === "")
			return {
				parses: false,
				checks: false,
				right: task.right.includes(""),
				why: "no line",
				ran: null,
			};
		const parsed = Shell.parse(line);
		if (parsed.kind === "refused")
			return {parses: false, checks: false, right: false, why: parsed.why, ran: null};
		const world = yield* makeWorld(FILED, script(false));
		const list = agentList(world);
		const problems = parsed.statements.flatMap((st) => {
			if (st.kind === "builtin") return [];
			const checked = Shell.check(st.pipeline, list, line);
			return checked.kind === "refused" ? [checked.why] : [];
		});
		const shape = shapeOfLine(line);
		const right = task.right.some((r) => shapeOfLine(r) === shape);
		if (problems.length > 0)
			return {parses: true, checks: false, right, why: problems.join("; "), ran: null};
		const usesApp = parsed.statements.some(
			(st) => st.kind === "run" && st.pipeline.commands.some((c) => APP_ONLY.has(c.program.name)),
		);
		if (usesApp)
			return {
				parses: true,
				checks: true,
				right,
				why: "checked, not run: ticket, map and trace need the app's ledger",
				ran: null,
			};
		// Only the fake factory: run it in the foreground. A line still going after 1.5 s gets Ctrl-C.
		const ran = yield* Effect.gen(function* () {
			const sh = yield* session(list);
			const typed = yield* sh.typeOnly(line);
			const first = yield* typed.ended(1500);
			if (first._tag === "Some") {
				yield* sh.close();
				return {status: first.value, ctrlC: false, runs: runsOf(world)};
			}
			yield* sh.ctrlC;
			const after = yield* typed.ended(3000);
			yield* sh.close();
			return {status: after._tag === "Some" ? after.value : -1, ctrlC: true, runs: runsOf(world)};
		}).pipe(Effect.scoped);
		return {parses: true, checks: true, right, why: "", ran};
	});

/** A stand-in, NOT an agent: fixed answers, some wrong on purpose, to show the harness reads both kinds. */
const SCRIPTED: Readonly<Record<string, readonly string[]>> = {
	show: ["ticket --ticket 7; trace --ticket 7", "trace --ticket 7 --run plan", "ticket 7 | trace"],
	two: ["build --ticket 7 | review", "build ticket=7 | review", "build --ticket 7 | review | ship"],
	all: [
		"tracker | triage | plan | build | review | ship &",
		"tracker | triage | plan | build | review | ship",
		"triage | plan | build | review | ship",
	],
	one: ["triage --ticket 8", "triage --ticket 8 | plan", "triage --ticket #8"],
	plan: [
		"plan --ticket 7 | build",
		"plan --ticket 7 && build --ticket 7",
		"plan --ticket 7 | build | review",
	],
	noship: [
		"tracker | triage | plan | build | review",
		"tracker | triage | plan | build | review | ship",
		"",
	],
	cannot: ["", "ship --ticket 12", "ship --pr 12"],
	again: [
		"build --ticket 7 | review | ship",
		"build --ticket 7 | review ^build | ship",
		"review --ticket 7 | build | ship",
	],
};

const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");
/** GPT sol, as experiments 159 and 162 ran it. */
const MODEL = "gpt-6.1-sol";

const agentService = Effect.gen(function* () {
	return Agent.makeAgents({
		adapters: {codex: yield* codexAdapter({codex: CODEX})},
		sessions: Agent.memorySessions(),
		reaper: psReaper,
	});
}).pipe(Effect.provide(nodeServices));

/** One Codex turn: a new session each time, in an empty folder; its Codex home removed after. */
async function codexTurn(prompt: string, n: number) {
	const agents = await Effect.runPromise(agentService);
	const folder = realpathSync(mkdtempSync(join(tmpdir(), "exp-168-")));
	const session = `exp-168/${process.pid}/${n}`;
	const started = Date.now();
	const exit = await Effect.runPromise(
		Effect.exit(
			Stream.runCollect(
				agents.run({
					provider: "codex",
					session,
					folder,
					prompt,
					// A turn with no tools: our text in place of the maker's own coding prompt.
					system: {_tag: "replace", text: SYSTEM},
					answer: Reply,
					model: MODEL,
					effort: "medium",
					limits: {...Agent.NO_LIMITS, seconds: 300},
				}),
			),
		),
	);
	rmSync(codexHomeOf(`session:${session}`), {recursive: true, force: true});
	rmSync(folder, {recursive: true, force: true});
	const heard = Exit.isSuccess(exit) ? [...exit.value] : [];
	const end = heard.find((h): h is Agent.Ended<Reply> => h._tag === "ended") ?? null;
	const tools = new Set(heard.flatMap((h) => (h._tag === "tool" ? [h.id] : []))).size;
	return {
		reply: end?.answer ?? null,
		ms: Date.now() - started,
		tokens: end?.tokens ?? {input: 0, cached: 0, output: 0},
		tools,
		error: Exit.isFailure(exit)
			? String(exit.cause).replaceAll(homedir(), "~").slice(0, 300)
			: null,
	};
}

if (STEP === "help") {
	const text = await Effect.runPromise(helpText);
	mkdirSync(RESULTS, {recursive: true});
	writeFileSync(HELP_FILE, `${text}\n`);
	console.log(
		`wrote the help text: ${text.length} characters, about ${Math.round(text.length / 4)} tokens`,
	);
}

if (STEP === "agent") {
	const who = process.env.AGENT ?? "scripted";
	if (who !== "scripted" && who !== "codex") throw new Error("AGENT is scripted or codex");
	const tries = Number(process.env.TRIES ?? 3);
	const only = process.env.ONLY?.split(",");
	const help = readFileSync(HELP_FILE, "utf8");
	const rows = [];
	let turn = 0;
	for (const task of TASKS.filter((t) => only === undefined || only.includes(t.id))) {
		for (let i = 0; i < tries; i++) {
			turn += 1;
			const got =
				who === "scripted"
					? {
							reply: {line: SCRIPTED[task.id]?.[i] ?? "", why: "scripted"},
							ms: 0,
							tokens: null,
							tools: 0,
							error: null,
						}
					: await codexTurn(promptOf(help, task), turn);
			const line = got.reply?.line ?? "";
			const judged = await Effect.runPromise(judge(task, line));
			rows.push({
				task: task.id,
				ask: task.ask,
				try: i + 1,
				line,
				said: got.reply?.why ?? null,
				...got,
				reply: undefined,
				...judged,
			});
			const ran =
				judged.ran === null
					? ""
					: `  ran: status ${judged.ran.status}${judged.ran.ctrlC ? " after Ctrl-C" : ""}, runs ${judged.ran.runs.join(" ")}`;
			console.log(
				`${task.id} ${i + 1}: ${JSON.stringify(line)}  parses ${judged.parses}, checks ${judged.checks}, right ${judged.right}${judged.why === "" ? "" : `  (${judged.why})`}${ran}`,
			);
		}
	}
	mkdirSync(RESULTS, {recursive: true});
	const file =
		only === undefined ? `168-agent-${who}.json` : `168-agent-${who}-${only.join("-")}.json`;
	writeFileSync(
		join(RESULTS, file),
		`${JSON.stringify({agent: who, real: who !== "scripted", model: who === "codex" ? MODEL : null, rows}, null, "\t")}\n`,
	);
	const n = rows.length;
	console.log(
		`\n${who}${who === "scripted" ? " (a stand-in, NOT an agent)" : ""}: ${rows.filter((r) => r.parses).length}/${n} parse, ${rows.filter((r) => r.checks).length}/${n} pass tsh's check, ${rows.filter((r) => r.right).length}/${n} right`,
	);
}
