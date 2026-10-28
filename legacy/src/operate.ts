// Drive one fabrika lane with the operator machine (src/operator.ts) instead
// of an operator agent. Real fabrika, real git, real GitHub, real shells:
// read experiments/48-operator-from-six-moves.md and
// experiments/49-operator-first-live-run.md before running it.
//
//   LANE=<issue number>      the lane to drive
//   REPO=<main checkout>     the repo's primary checkout, with fabrika installed
//   PLUGIN=<folder>          the fabrika plugin (its `agents/` and `skills/`)
//   TREES=<folder>           where the lane's working copy is made
//   RUN=<folder>             this run's state, its journal of writes, and its logs
//   WHO=<login>,<login>      whose replies answer a question the machine asks; anyone
//                            else's reply is passed over (OWNER=<login> still names one)
//   MODEL=opus  EFFORT=medium  MAX_SHELL_USD=6  MAX_RUN_USD=15
//   CI_WAIT_MIN=45           how long checks may take before a review; past it the run stops
//   ASK_WAIT_MIN=720         how long a question waits; past it the run ends parked,
//                            and a later run reads on from the same question
//   RECHECK_MIN=5            how long between two tries of a park's recipe. They go on
//                            while a question is open, so an approval needs no reply
//   TYPESAFE_API_KEY=...     only read when a person answers in words
//   SHIP=agent|machine|program
//                            what fills the ship stage. `agent`, the default: today's
//                            shipper shell, as always. `machine`: the ship machine
//                            (src/stages/ship/) runs as a child instead, and no shipper
//                            shell starts. The machine WRITES to GitHub itself: it puts
//                            the pull request in the merge queue and may start its red
//                            checks again. RUN LIVE ONCE, on one docs-only pull request
//                            that it merged (experiments/56-first-live-run-of-the-ship-machine.md).
//                            Every other ending is tested against scripted services
//                            only, and the re-run of red checks has never run for real:
//                            read docs/ship-machine.md, "Under the operator", first.
//                            WHO also names the accounts whose pull requests it may
//                            land and whose review verdicts count.
//                            `program`: the ship program (src/stages/ship/program.ts)
//                            is started once beside the operator, and the ship stage
//                            asks it and waits for its answer. It writes to GitHub as
//                            `machine` does, keeps each machine run in RUN/programs/,
//                            and HAS NEVER RUN LIVE: only against fakes, killed at
//                            each point of a ship (experiments/66-operate-starts-ship.md).
//
// Run it again with the same RUN to carry on after a stop, but not while a
// shell was running: a shell's conversation cannot be picked up again yet.

import {execFileSync} from "node:child_process";
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {basename, join} from "node:path";
import {run as runMachine} from "@demlik/tea/effect";
import {JEV_ENDPOINT} from "@demlik/tea/jev";
import {fileStore} from "@demlik/tea/node";
import {start} from "@kampus/fabrika";
import {fileStorage} from "@kampus/fabrika/storage/node";
import {gitHubCodeHost} from "@kampus/pipeline/code-host-github";
import {gitHubCodeHostWrites} from "@kampus/pipeline/code-host-github-writes";
import {memoryRecord} from "@kampus/pipeline/criteria/record";
import {Jev} from "@kampus/pipeline/services";
import {createShip} from "@kampus/pipeline/stages/ship/machine";
import {createShipProgram} from "@kampus/pipeline/stages/ship/program";
import {gitWorktrees, issueThread} from "@tea-fabrika/wip/operator-live";
import {Effect, Layer} from "effect";
import {cliFabrika} from "./fabrika-cli.ts";
import {jevKey, liveJev} from "./local.ts";
import {createOperator, defaultKnobs, type Operator} from "./operator.ts";
import {
	fieldRows,
	knobsOf,
	operatorInterpret,
	operatorProgramInterpret,
	operatorShipInterpret,
	operatorShipSubscribe,
	operatorSubscribe,
} from "./operator-host.ts";

const need = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set`);
	return value;
};

const LANE = need("LANE");
const REPO = need("REPO");
const PLUGIN = need("PLUGIN");
const TREES = need("TREES");
const RUN = need("RUN");
const model = process.env.MODEL ?? "opus";
const effort = (process.env.EFFORT ?? "medium") as "low" | "medium" | "high";
const maxShellUsd = Number(process.env.MAX_SHELL_USD ?? 6);
// Refused here, before anything is claimed, when nobody is named or a number is not one.
const knobs = knobsOf(process.env);
const SHIP = process.env.SHIP ?? "agent";
if (SHIP !== "agent" && SHIP !== "machine" && SHIP !== "program")
	throw new Error(`SHIP is "${SHIP}": it is \`agent\`, \`machine\` or \`program\``);

mkdirSync(RUN, {recursive: true});
const origin = execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], {
	encoding: "utf8",
}).trim();
const slug = /github\.com[:/]([^/]+\/[^/.]+)/.exec(origin)?.[1];
if (slug === undefined) throw new Error(`the origin of ${REPO} is not a GitHub repo`);

// The run's name and start, kept beside its state so a second start carries on under them.
const meta = join(RUN, "run.json");
if (!existsSync(meta))
	writeFileSync(meta, JSON.stringify({run: `${basename(RUN)}`, startedAt: Date.now()}));
const {run, startedAt} = JSON.parse(readFileSync(meta, "utf8")) as {run: string; startedAt: number};

const stamp = () => new Date().toISOString().slice(11, 19);
const say = (line: string) => console.log(`${stamp()}  ${line}`);
const keep = (file: string, record: unknown) =>
	appendFileSync(join(RUN, file), `${JSON.stringify(record)}\n`);
const cut = (text: string, n = 140) =>
	(text.length > n ? `${text.slice(0, n)}…` : text).replaceAll("\n", " ");

const fabrika = cliFabrika({
	repo: REPO,
	slug,
	session: run,
	journal: join(RUN, "intents.json"),
	ran: (verb, exit, stderr) => {
		keep("verbs.jsonl", {at: Date.now(), verb, exit, stderr: cut(stderr, 400)});
		say(`  fabrika ${cut(verb, 100)} -> ${exit}`);
	},
});

const key = jevKey();
const jev =
	key === undefined
		? Layer.succeed(Jev, {
				call: () =>
					Effect.fail({
						_tag: "jev_call_failed" as const,
						cause: "no key: a reply in words is set aside",
					}),
			})
		: liveJev(key, JEV_ENDPOINT);

const services = Layer.mergeAll(
	fabrika,
	gitWorktrees({
		repo: REPO,
		trees: TREES,
		install: ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
	}),
	issueThread({
		pollMs: 60_000,
		posted: (link, found) =>
			say(`  question ${found ? "found, asked by an earlier run" : "posted"}: ${link}`),
	}),
	jev,
	// Ship merges only on a passing verdict row per criterion, read from here.
	// The shell reviewer keeps none, so `machine` and `program` send each pull
	// request back to be reviewed rather than merge it.
	memoryRecord().layer,
);

const subscribe = operatorSubscribe({
	pollMs: 30_000,
	shell: {
		trees: TREES,
		plugin: PLUGIN,
		alsoWritable: [
			join(REPO, ".fabrika"),
			"/tmp",
			"/private/tmp",
			"/var/folders",
			"/private/var/folders",
		],
		model,
		effort,
		maxShellUsd,
		refused: (shell, tool, why) => {
			keep("refused.jsonl", {at: Date.now(), shell: shell.id, tool, why});
			say(`  REFUSED ${shell.agent} ${tool}: ${cut(why)}`);
		},
		seen: (shell, m) => {
			const file = `shell-${shell.id.replaceAll("/", "-")}.jsonl`;
			if (m.type === "assistant") {
				for (const block of m.message.content) {
					if (block.type === "text") keep(file, {at: Date.now(), says: block.text});
					if (block.type === "tool_use") {
						const input = (block.input ?? {}) as Record<string, unknown>;
						const ask = String(
							input.command ??
								input.file_path ??
								input.skill ??
								input.pattern ??
								input.description ??
								"",
						);
						keep(file, {
							at: Date.now(),
							sub: m.parent_tool_use_id !== null,
							calls: block.name,
							ask: cut(ask, 600),
						});
						if (m.parent_tool_use_id === null)
							say(`    ${shell.agent} ${block.name} ${cut(ask, 110)}`);
					}
				}
			} else if (m.type === "result") {
				keep(file, {
					at: Date.now(),
					end: m.subtype,
					cost_usd: m.total_cost_usd,
					turns: m.num_turns,
					ms: m.duration_ms,
					usage: m.usage,
					denials: m.permission_denials,
				});
				say(
					`    ${shell.agent} ended: ${m.subtype}, $${m.total_cost_usd.toFixed(2)}, ${m.num_turns} turns, ${(m.duration_ms / 60_000).toFixed(1)} min`,
				);
			} else if (m.type === "system" && m.subtype === "init") {
				keep(file, {
					at: Date.now(),
					init: {model: m.model, mode: m.permissionMode, tools: m.tools, session: m.session_id},
				});
			}
		},
	},
});

/** Where the run stands, in a line. */
function where(s: Operator): string {
	if (s.phase === "driving") {
		const turns = Object.values(s.turns).map(({state: t}) => {
			// An open question shows how far it is, and each try of the park's recipe: a new try is a new line in the log.
			const ask =
				t.phase !== "asking"
					? ""
					: `/${t.ask.phase}${t.recheck === null ? "" : `, recipe try ${t.recheck.tries}`}`;
			return `${t.task}@${t.state}:${t.phase}${ask}`;
		});
		return `pass ${s.pass} [${turns.join(", ")}]`;
	}
	if (s.phase === "ended") return `ended: ${JSON.stringify(s.end)}`;
	if (s.phase === "closing") return `closing (${s.asked.type}) toward ${s.end.kind}`;
	return s.phase;
}

const common = {
	ctx: undefined,
	store: fileStore<Operator>(join(RUN, "state.json"), (raw) => raw as Operator | null),
	terminal: (s: Operator) => s.phase === "ended",
	disposeTimeoutMs: 60_000,
};
/** The operator as it always was: its ship stage is the shipper shell. */
const withShipper = runMachine(createOperator(defaultKnobs.slots), {
	...common,
	interpret: operatorInterpret("jev-latest"),
	subscribe,
});
/**
 * The operator with the ship machine in its ship stage. The code host's two
 * services are made here and nowhere else, so a run with `SHIP=agent` holds
 * no way to write to a pull request from this process.
 */
const withShipMachine = () =>
	runMachine(createOperator(defaultKnobs.slots, {ship: "machine"}), {
		...common,
		interpret: operatorShipInterpret("jev-latest"),
		subscribe: {...subscribe, ...operatorShipSubscribe},
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				gitHubCodeHost({own: knobs.who, reviewers: knobs.who, pollMs: 30_000}),
				gitHubCodeHostWrites(),
			),
		),
	);

/**
 * The operator with the ship program beside it, started once, under an id
 * made from this run's name, on a storage in RUN. Started again with the same
 * RUN, the program takes on the machine runs it left, and answers again an
 * ask it already answered. The operator tells it to forget an answer once
 * that answer is in its own saved state. The code host's two services are
 * the program's; the operator holds none.
 */
const withShipProgram = () =>
	Effect.gen(function* () {
		const ship = yield* start(
			createShipProgram(
				createShip({waits: {checksMs: knobs.ciWaitMs, queueMs: knobs.queueStallMs}}),
			),
			{mode: "write"},
			{outcome: (o) => say(`  the ship program: ${o.name} on ${o.pr}`)},
			{id: `ship:${run}`, storage: fileStorage(join(RUN, "programs"))},
		);
		if (ship.kind !== "running")
			return yield* Effect.die(`the ship program did not start: ${ship.why}`);
		return yield* runMachine(createOperator(defaultKnobs.slots, {ship: "program"}), {
			...common,
			interpret: operatorProgramInterpret("jev-latest", ship.run),
			subscribe,
		});
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				gitHubCodeHost({own: knobs.who, reviewers: knobs.who, pollMs: 30_000}),
				gitHubCodeHostWrites(),
			),
		),
	);

const program = Effect.gen(function* () {
	const handle = yield* SHIP === "machine"
		? withShipMachine()
		: SHIP === "program"
			? withShipProgram()
			: withShipper;
	const runtime = yield* handle.ready;
	let last = "";
	runtime.observe((msg, state) => {
		keep("msgs.jsonl", {at: Date.now(), type: msg.type, where: where(state)});
		const now = where(state);
		if (msg.type.startsWith("shell_tool")) return;
		if (now !== last) say(`${msg.type} -> ${now}`);
		last = now;
	});
	const booted = runtime.getState();
	if (booted.phase === "idle") {
		say(`starting run ${run} on lane ${LANE} (${slug})`);
		say(
			SHIP === "machine"
				? "  the ship stage is the ship machine: it will write to GitHub itself, and no shipper shell starts"
				: SHIP === "program"
					? "  the ship stage is the ship program, asked: it will write to GitHub itself, and no shipper shell starts"
					: "  the ship stage is the shipper shell",
		);
		say(
			`  replies count from ${knobs.who.join(", ")}; a question waits ${knobs.askWaitMs / 60_000} minutes, and a park's recipe is tried every ${knobs.recheckMs / 60_000}`,
		);
		yield* runtime.dispatch({type: "start", run, lane: LANE, knobs});
	} else {
		say(`carrying on run ${run}: ${where(booted)}`);
		yield* runtime.dispatch({type: "resume"});
	}
	return yield* runtime.done();
});

const end = await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(services)));
const rows = fieldRows(end, {
	date: new Date(startedAt).toISOString().slice(0, 10),
	repo: slug,
	minutes: (Date.now() - startedAt) / 60_000,
	model,
	effort,
});
writeFileSync(join(RUN, "rows.jsonl"), `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
say(where(end));
for (const row of rows) console.log(JSON.stringify(row));
