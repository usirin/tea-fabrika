// How do lanes of today's fabrika really go? This reads the lane logs a repo's
// `.fabrika/` folder keeps (one `workflow.json` and one `events.jsonl` a
// lane), folds every log through its own machine (`src/lane-log.ts`), and
// counts: the shapes lanes take, the time each stage takes, how review goes,
// what parks and how it clears, what ship meets, and what the operator
// machine's tables know of it. Then it replays every lane under the operator
// machine (`src/lane-replay.ts`): the machine drives, and the lane's own
// recorded events are its world.
//
// Run with `LANES=<path to a .fabrika folder> node experiments/53-lane-logs.ts`.
// No Jev, no model, no key, no network: files only, and it writes nothing
// but `results/lane-logs.json` (counts and lane numbers, no raw lines).
//   ONLY=<section>,<section>   print only these: data, shapes, time, review,
//                              parks, ship, coverage, replay, spend, runs
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {hasRecipe, PARK_ROUTE, ParkCause, ROUTES, routeOf} from "../src/fabrika.ts";
import {NEXT} from "../src/fabrika-scripted.ts";
import {
	BOARD_TERMINALS,
	type CompiledLane,
	compileLane,
	isPark,
	type LogEntry,
	parseLog,
	type Step,
	stageOf,
	type Walk,
	walk,
} from "../src/lane-log.ts";
import {type Replay, replayLane} from "../src/lane-replay.ts";

const DATA = process.env.LANES;
if (DATA === undefined || DATA === "") {
	console.error("LANES is not set: point it at a repo's .fabrika folder");
	process.exit(1);
}
const only = process.env.ONLY?.split(",") ?? null;
const wants = (section: string) => only === null || only.includes(section);
const results: Record<string, unknown> = {};

// ---------------------------------------------------------------- small tools

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A length of time in the unit that reads best. */
function span(ms: number): string {
	if (ms < 90 * MIN) return `${(ms / MIN).toFixed(1)} min`;
	if (ms < 48 * HOUR) return `${(ms / HOUR).toFixed(1)} h`;
	return `${(ms / DAY).toFixed(1)} d`;
}
/** The value at a share of the way through a sorted list (nearest rank). */
function at(sorted: readonly number[], share: number): number {
	return sorted[
		Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))
	] as number;
}
const sortedOf = (values: readonly number[]) => [...values].sort((a, b) => a - b);
/** n, median, p75, p90, as cells. */
function spread(values: readonly number[]): string[] {
	if (values.length === 0) return ["0", "", "", ""];
	const s = sortedOf(values);
	return [String(s.length), span(at(s, 0.5)), span(at(s, 0.75)), span(at(s, 0.9))];
}
const spreadOf = (values: readonly number[]) => {
	const s = sortedOf(values);
	return s.length === 0
		? {n: 0}
		: {
				n: s.length,
				medianMin: +(at(s, 0.5) / MIN).toFixed(1),
				p75Min: +(at(s, 0.75) / MIN).toFixed(1),
				p90Min: +(at(s, 0.9) / MIN).toFixed(1),
			};
};
/** Where a value sits in a list: the share of the list at or below it. */
const rank = (values: readonly number[], value: number) =>
	values.length === 0 ? 0 : values.filter((v) => v <= value).length / values.length;
const pct = (n: number, of: number) => (of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`);
const share = (n: number, of: number) => `${n} (${pct(n, of)})`;

class Tally {
	readonly counts = new Map<string, number>();
	readonly examples = new Map<string, string[]>();
	add(key: string, example?: string, by = 1): void {
		this.counts.set(key, (this.counts.get(key) ?? 0) + by);
		if (example === undefined) return;
		const list = this.examples.get(key) ?? [];
		if (list.length < 3 && !list.includes(example)) list.push(example);
		this.examples.set(key, list);
	}
	get(key: string): number {
		return this.counts.get(key) ?? 0;
	}
	get total(): number {
		return [...this.counts.values()].reduce((a, b) => a + b, 0);
	}
	/** Rows, most common first. */
	rows(): [string, number][] {
		return [...this.counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	}
	top(n: number): string {
		return this.rows()
			.slice(0, n)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ");
	}
	json(): Record<string, number> {
		return Object.fromEntries(this.rows());
	}
}

function table(
	title: string,
	head: readonly string[],
	rows: readonly (readonly (string | number)[])[],
): void {
	console.log(`\n${title}\n`);
	console.log(`| ${head.join(" | ")} |`);
	console.log(`|${head.map(() => "---").join("|")}|`);
	for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
const section = (title: string) => console.log(`\n\n## ${title}`);

// ---------------------------------------------------------------- the lanes

interface Dispatch {
	readonly task: string;
	readonly state: string;
	readonly at: number;
}
interface Lane {
	/** The folder's name. An archived lane's has a suffix after the issue number. */
	readonly name: string;
	readonly issue: number;
	readonly archived: boolean;
	readonly kind: "single" | "epic";
	readonly compiled: CompiledLane;
	readonly entries: readonly LogEntry[];
	readonly walk: Walk;
	/** Every line folds. */
	readonly folds: boolean;
	readonly dispatched: readonly Dispatch[];
	/** How the lane was opened, where a `facts.jsonl` says. */
	readonly origin: string | null;
}

const jsonl = (file: string): Record<string, unknown>[] =>
	existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.flatMap((line) => {
					try {
						return line.trim() === "" ? [] : [JSON.parse(line) as Record<string, unknown>];
					} catch {
						return [];
					}
				})
		: [];

const found = {
	folders: 0,
	noWorkflow: 0,
	noEvents: 0,
	uncompiled: 0,
	malformed: 0,
	sideFiles: new Tally(),
	shapes: new Tally(),
};
const lanes: Lane[] = [];
for (const root of ["lanes", "lanes-archived"]) {
	const dir = join(DATA, root);
	if (!existsSync(dir)) continue;
	for (const name of readdirSync(dir).sort()) {
		const folder = join(dir, name);
		found.folders += 1;
		for (const file of readdirSync(folder))
			found.sideFiles.add(file.replace(/^dispatch-.*\.(stdout|stderr)$/, "dispatch-*.$1"));
		if (!existsSync(join(folder, "workflow.json"))) {
			found.noWorkflow += 1;
			continue;
		}
		if (!existsSync(join(folder, "events.jsonl"))) {
			found.noEvents += 1;
			continue;
		}
		const compiled = compileLane(JSON.parse(readFileSync(join(folder, "workflow.json"), "utf8")));
		if (compiled === null) {
			found.uncompiled += 1;
			continue;
		}
		const {entries, malformed} = parseLog(readFileSync(join(folder, "events.jsonl"), "utf8"));
		found.malformed += malformed;
		const walked = walk(compiled, entries);
		const states = new Set(Object.values(compiled.tasks).flatMap((t) => t.states));
		found.shapes.add([...states].sort().join(" "));
		lanes.push({
			name,
			issue: Number.parseInt(name, 10),
			archived: root === "lanes-archived",
			kind: compiled.id === "coder" ? "single" : "epic",
			compiled,
			entries,
			walk: walked,
			folds: Object.values(walked.steps).every((steps) => steps.every((s) => !s.noCell)),
			dispatched: jsonl(join(folder, "in-flight.jsonl")).flatMap((r) =>
				r.kind === "dispatched" &&
				typeof r.task === "string" &&
				typeof r.state === "string" &&
				typeof r.at === "string"
					? [{task: r.task, state: r.state, at: Date.parse(r.at)}]
					: [],
			),
			origin:
				(jsonl(join(folder, "facts.jsonl")).find((r) => r.kind === "origin")?.origin as
					| string
					| undefined) ?? null,
		});
	}
}

const singles = lanes.filter((l) => l.kind === "single" && l.folds);
const epics = lanes.filter((l) => l.kind === "epic" && l.folds);
const allEntries = lanes.flatMap((l) => l.entries);
const dataEnd = Math.max(...allEntries.map((e) => e.at));
const dataStart = Math.min(...allEntries.map((e) => e.at));
/** A single lane's one task. */
const stepsOf = (l: Lane): readonly Step[] => Object.values(l.walk.steps)[0] ?? [];
const endOf = (l: Lane): string => Object.values(l.walk.states)[0]?.state ?? "";
const link = (l: Lane) => `#${l.issue}`;
/** Whether the lane's own flow finished the work. */
const finished = (l: Lane) => l.walk.status === "complete" || l.walk.status === "diagnosed";

// ---------------------------------------------------------------- segments: a task's stays in one state

interface Segment {
	readonly lane: Lane;
	readonly task: string;
	readonly state: string;
	/** The step that entered the state; `null` for the state a task starts in. */
	readonly entered: Step | null;
	/** The step that left it; `null` when the log ends there. */
	readonly left: Step | null;
	/** Events that arrived and did not move the task: a wait, a lap, a cleared round. */
	readonly inner: readonly Step[];
}

function segmentsOf(lane: Lane, task: string, steps: readonly Step[]): Segment[] {
	const out: Segment[] = [];
	let state = lane.compiled.tasks[task]?.initial.state ?? "queued";
	let entered: Step | null = null;
	let inner: Step[] = [];
	for (const step of steps) {
		if (step.to === state) {
			inner.push(step);
			continue;
		}
		out.push({lane, task, state, entered, left: step, inner});
		state = step.to;
		entered = step;
		inner = [];
	}
	out.push({lane, task, state, entered, left: null, inner});
	return out;
}
const lasted = (s: Segment): number | null =>
	s.entered === null || s.left === null ? null : s.left.entry.at - s.entered.entry.at;
const allSegments = (set: readonly Lane[]) =>
	set.flatMap((l) =>
		Object.entries(l.walk.steps).flatMap(([task, steps]) => segmentsOf(l, task, steps)),
	);
const singleSegments = allSegments(singles);

// ---------------------------------------------------------------- 0. the data

if (wants("data")) {
	section("The data");
	const types = new Tally();
	const months = new Tally();
	for (const e of allEntries) {
		types.add(e.event);
		months.add(new Date(e.at).toISOString().slice(0, 7));
	}
	const unfolded = lanes.flatMap((l) =>
		Object.values(l.walk.steps).flatMap((steps) => steps.filter((s) => s.noCell)),
	);
	console.log(
		`lane folders ${found.folders}; without a workflow ${found.noWorkflow}; without events ${found.noEvents}; not a lane machine ${found.uncompiled}`,
	);
	console.log(
		`lanes read ${lanes.length}: single ${lanes.filter((l) => l.kind === "single").length}, epic ${lanes.filter((l) => l.kind === "epic").length}; archived ${lanes.filter((l) => l.archived).length}`,
	);
	console.log(
		`events ${allEntries.length}; lines that are not an event ${found.malformed}; from ${new Date(dataStart).toISOString()} to ${new Date(dataEnd).toISOString()} (${((dataEnd - dataStart) / DAY).toFixed(0)} days)`,
	);
	console.log(
		`events by month: ${months
			.rows()
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	console.log(`events by type: ${types.top(20)}`);
	console.log(
		`lines that do not fold (the state has no arm for the event): ${unfolded.length}, in ${lanes.filter((l) => !l.folds).length} lanes (${lanes
			.filter((l) => !l.folds)
			.map(link)
			.join(", ")})`,
	);
	console.log(
		`lines about a task the machine no longer holds: ${lanes.reduce((n, l) => n + l.walk.strays, 0)}`,
	);
	console.log(`distinct sets of states across the workflows: ${found.shapes.counts.size}`);
	console.log(`files beside the log: ${found.sideFiles.top(12)}`);
	console.log(
		`epic lanes: tasks per lane ${sortedOf(epics.map((l) => Object.keys(l.compiled.tasks).length)).join(" ")}`,
	);

	const status = (set: readonly Lane[]) => {
		const t = new Tally();
		for (const l of set) t.add(l.walk.status);
		return t;
	};
	const s = status(singles);
	const e = status(epics);
	const kinds = ["complete", "diagnosed", "board:landed", "board:cancelled", "tripped", "active"];
	const what: Record<string, string> = {
		complete: "the lane shipped it",
		diagnosed: "an investigation, answered with no pull request",
		"board:landed": "shipped outside the lane; the lane was settled after",
		"board:cancelled": "the issue was closed unplanned",
		tripped: "the repair budget ran out and nobody cleared it",
		active: "still open when the data ends",
	};
	table(
		"How lanes ended",
		["End", "Single lanes", "Epic lanes", "What it means"],
		kinds.map((k) => [
			k,
			share(s.get(k), singles.length),
			share(e.get(k), epics.length),
			what[k] ?? "",
		]),
	);

	const open = singles.filter((l) => l.walk.status === "active");
	const where = new Tally();
	for (const l of open) where.add(endOf(l), link(l));
	const idle = sortedOf(open.map((l) => dataEnd - Math.max(...l.entries.map((x) => x.at), 0)));
	console.log(`\nopen single lanes stand at: ${where.top(12)}`);
	console.log(
		`time since their last event, against the last event in the data: median ${span(at(idle, 0.5))}, shortest ${span(idle[0] ?? 0)}, longest ${span(idle.at(-1) ?? 0)}; under a day ${idle.filter((x) => x < DAY).length}, over a week ${idle.filter((x) => x > 7 * DAY).length}`,
	);

	// What the lines carry, month by month: fields were added as fabrika grew.
	const fields: Record<string, Tally> = {};
	for (const en of allEntries) {
		const month = new Date(en.at).toISOString().slice(0, 7);
		const note = (name: string, has: boolean) => {
			fields[name] ??= new Tally();
			fields[name].add(`${month} all`);
			if (has) fields[name].add(`${month} has`);
		};
		if (en.event === "BLOCKED") note("a cause on BLOCKED", en.cause !== null);
		if (en.event === "PASS" || en.event === "FAIL")
			note("classes on PASS and FAIL", en.classes !== null);
		if (en.event === "UNBLOCKED")
			note("a rationale on UNBLOCKED", typeof en.raw.rationale === "string");
		if (en.event === "DONE") note("a pull request on DONE", en.pr !== null);
	}
	const monthsSeen = [...months.counts.keys()].sort();
	table(
		"What the lines carry, by month",
		["Field", ...monthsSeen],
		Object.entries(fields).map(([name, t]) => [
			name,
			...monthsSeen.map((m) => `${t.get(`${m} has`)} of ${t.get(`${m} all`)}`),
		]),
	);
	const origins = new Tally();
	for (const l of lanes) if (l.origin !== null) origins.add(l.origin);
	console.log(`\nlanes that say how they were opened: ${origins.total} (${origins.top(8)})`);
	console.log(
		`lanes with dispatch times (in-flight.jsonl): ${lanes.filter((l) => l.dispatched.length > 0).length}, ${lanes.reduce((n, l) => n + l.dispatched.length, 0)} dispatches`,
	);
	results.data = {
		folders: found.folders,
		lanes: lanes.length,
		single: lanes.filter((l) => l.kind === "single").length,
		epic: lanes.filter((l) => l.kind === "epic").length,
		archived: lanes.filter((l) => l.archived).length,
		events: allEntries.length,
		from: new Date(dataStart).toISOString(),
		to: new Date(dataEnd).toISOString(),
		eventsByType: types.json(),
		eventsByMonth: months.json(),
		linesThatDoNotFold: unfolded.length,
		lanesThatDoNotFold: lanes.filter((l) => !l.folds).map((l) => l.name),
		endsSingle: s.json(),
		endsEpic: e.json(),
		openSingleStandAt: where.json(),
		fieldsByMonth: Object.fromEntries(Object.entries(fields).map(([k, t]) => [k, t.json()])),
		origins: origins.json(),
	};
}

// ---------------------------------------------------------------- 1. lane shapes

interface Shape {
	readonly lane: Lane;
	readonly reviewFails: number;
	readonly shipFails: number;
	readonly parks: number;
	readonly budgetParks: number;
	readonly laps: number;
	readonly partials: number;
	readonly waits: number;
	readonly cleared: number;
}
const shapeOf = (lane: Lane): Shape => {
	const steps = stepsOf(lane);
	const count = (test: (s: Step) => boolean) => steps.filter(test).length;
	return {
		lane,
		reviewFails: count((s) => s.entry.event === "FAIL" && stageOf(s.from) === "review"),
		shipFails: count((s) => s.entry.event === "FAIL" && stageOf(s.from) === "ship"),
		parks: count((s) => s.entry.event === "BLOCKED"),
		budgetParks: count((s) => s.entry.event !== "BLOCKED" && isPark(s.to) && !isPark(s.from)),
		laps: count((s) => s.entry.event === "LAP"),
		partials: count((s) => s.entry.event === "DONE" && s.to === "queued"),
		waits: count((s) => s.entry.event === "WIP" && s.from === "ship:queued"),
		cleared: count((s) => s.entry.event === "CLEARED"),
	};
};
const shapes = singles.map(shapeOf);
const straight = (s: Shape) =>
	s.reviewFails + s.shipFails + s.parks + s.budgetParks + s.laps + s.partials === 0;

if (wants("shapes")) {
	section("1. Lane shapes (single-issue lanes)");
	const n = shapes.length;
	const shipped = shapes.filter((s) => s.lane.walk.status === "complete");
	const row = (label: string, test: (s: Shape) => boolean) => [
		label,
		share(shapes.filter(test).length, n),
		share(shipped.filter(test).length, shipped.length),
	];
	table(
		`What happened on the way: ${n} single lanes, ${shipped.length} of them shipped by the lane`,
		["", "All single lanes", "Lanes that shipped"],
		[
			row(
				"straight through: no failed review, no park, no lap, no second trip",
				(s) => straight(s) && finished(s.lane),
			),
			row("no failed review", (s) => s.reviewFails === 0),
			row("1 failed review", (s) => s.reviewFails === 1),
			row("2 failed reviews", (s) => s.reviewFails === 2),
			row("3 or more failed reviews", (s) => s.reviewFails >= 3),
			row("at least one park (a BLOCKED line)", (s) => s.parks > 0),
			row("the repair budget ran out at least once", (s) => s.budgetParks > 0),
			row("at least one lap (a machinery round)", (s) => s.laps > 0),
			row("sent back from ship at least once (a FAIL in ship)", (s) => s.shipFails > 0),
			row("merged with the issue left open, and went round again", (s) => s.partials > 0),
			row("waited in the merge queue long enough for a wait to be written", (s) => s.waits > 0),
			row("a person cleared a repair round", (s) => s.cleared > 0),
		],
	);
	const neverBuilt = shapes.filter((s) =>
		stepsOf(s.lane).every((x) => x.entry.event !== "DONE"),
	).length;
	console.log(`\nlanes with no DONE at all (no build ever reported): ${neverBuilt}`);
	const sequences = new Tally();
	for (const s of shapes)
		sequences.add(
			stepsOf(s.lane)
				.map((x) => x.entry.event)
				.join(" ") || "(no events)",
			link(s.lane),
		);
	table(
		`The most common whole-lane sequences (${sequences.counts.size} different ones)`,
		["#", "Lanes", "Share", "Events, in order", "Examples"],
		sequences
			.rows()
			.slice(0, 15)
			.map(([seq, c], i) => [
				i + 1,
				c,
				pct(c, n),
				`\`${seq}\``,
				(sequences.examples.get(seq) ?? []).join(" "),
			]),
	);
	const top15 = sequences
		.rows()
		.slice(0, 15)
		.reduce((a, [, c]) => a + c, 0);
	console.log(
		`\nthe top 15 cover ${share(top15, n)}; sequences seen once: ${sequences.rows().filter(([, c]) => c === 1).length}`,
	);
	// The same lanes by the month they started: fabrika changed under them.
	const monthOf = (s: Shape) =>
		new Date(stepsOf(s.lane)[0]?.entry.at ?? 0).toISOString().slice(0, 7);
	const started = [
		...new Set(shapes.filter((s) => stepsOf(s.lane).length > 0).map(monthOf)),
	].sort();
	const firstVerdict = (s: Shape) =>
		stepsOf(s.lane).find(
			(x) => x.from === "review" && (x.entry.event === "PASS" || x.entry.event === "FAIL"),
		)?.entry.event;
	table(
		"By the month a lane started",
		[
			"Month",
			"Lanes",
			"Shipped by the lane",
			"Straight through",
			"First review passed",
			"At least one park",
		],
		started.map((m) => {
			const mine = shapes.filter((s) => stepsOf(s.lane).length > 0 && monthOf(s) === m);
			const judged = mine.filter((s) => firstVerdict(s) !== undefined);
			return [
				m,
				mine.length,
				share(mine.filter((s) => s.lane.walk.status === "complete").length, mine.length),
				share(mine.filter((s) => straight(s) && finished(s.lane)).length, mine.length),
				share(judged.filter((s) => firstVerdict(s) === "PASS").length, judged.length),
				share(mine.filter((s) => s.parks > 0).length, mine.length),
			];
		}),
	);
	const lengths = sortedOf(shapes.map((s) => stepsOf(s.lane).length));
	console.log(
		`events per lane: median ${at(lengths, 0.5)}, p75 ${at(lengths, 0.75)}, p90 ${at(lengths, 0.9)}, most ${lengths.at(-1)}`,
	);
	results.shapes = {
		singleLanes: n,
		shipped: shipped.length,
		straightThrough: {
			all: shapes.filter((s) => straight(s) && finished(s.lane)).length,
			shipped: shipped.filter(straight).length,
		},
		reviewFailsAll: [0, 1, 2]
			.map((k) => shapes.filter((s) => s.reviewFails === k).length)
			.concat(shapes.filter((s) => s.reviewFails >= 3).length),
		reviewFailsShipped: [0, 1, 2]
			.map((k) => shipped.filter((s) => s.reviewFails === k).length)
			.concat(shipped.filter((s) => s.reviewFails >= 3).length),
		withPark: shapes.filter((s) => s.parks > 0).length,
		withBudgetPark: shapes.filter((s) => s.budgetParks > 0).length,
		withLap: shapes.filter((s) => s.laps > 0).length,
		withShipFail: shapes.filter((s) => s.shipFails > 0).length,
		withPartialMerge: shapes.filter((s) => s.partials > 0).length,
		topSequences: sequences
			.rows()
			.slice(0, 15)
			.map(([sequence, count]) => ({sequence, count, examples: sequences.examples.get(sequence)})),
		differentSequences: sequences.counts.size,
	};
}

// ---------------------------------------------------------------- 2. time per stage

const first = (test: (s: Segment) => boolean) =>
	singleSegments.filter(test).flatMap((s) => lasted(s) ?? []);
const times = {
	buildFirst: first(
		(s) =>
			stageOf(s.state) === "build" &&
			s.entered?.entry.event === "WIP" &&
			s.left?.entry.event === "DONE",
	),
	buildRepair: first(
		(s) =>
			stageOf(s.state) === "build" &&
			s.entered?.entry.event === "FAIL" &&
			s.left?.entry.event === "DONE",
	),
	review: first(
		(s) =>
			s.state === "review" &&
			s.entered?.entry.event === "DONE" &&
			(s.left?.entry.event === "PASS" || s.left?.entry.event === "FAIL"),
	),
	reviewPass: first(
		(s) =>
			s.state === "review" && s.entered?.entry.event === "DONE" && s.left?.entry.event === "PASS",
	),
	reviewFail: first(
		(s) =>
			s.state === "review" && s.entered?.entry.event === "DONE" && s.left?.entry.event === "FAIL",
	),
	reviewUi: first(
		(s) =>
			s.state === "review:ui" &&
			s.entered?.entry.event === "PASS" &&
			(s.left?.entry.event === "PASS" || s.left?.entry.event === "FAIL"),
	),
	shipDirect: first(
		(s) =>
			s.state === "ship" &&
			s.entered?.entry.event === "PASS" &&
			s.left?.entry.event === "DONE" &&
			s.left.to === "shipped",
	),
	shipEnqueue: first(
		(s) => s.state === "ship" && s.entered?.entry.event === "PASS" && s.left?.entry.event === "WIP",
	),
	queue: first(
		(s) =>
			s.state === "ship:queued" &&
			s.entered?.entry.event === "WIP" &&
			s.left?.entry.event === "DONE" &&
			s.left.to === "shipped",
	),
	/** PASS to shipped with nothing between but the merge queue. */
	shipClean: [] as number[],
	/** A lane's first event to the event that shipped it. */
	lane: [] as number[],
	laneStraight: [] as number[],
	/** The same, less the time it stood parked. */
	laneUnparked: [] as number[],
};
for (const lane of singles) {
	const segs = segmentsOf(lane, "issue", stepsOf(lane));
	segs.forEach((s, i) => {
		if (s.state !== "ship" || s.entered?.entry.event !== "PASS" || s.left === null) return;
		const next = segs[i + 1];
		if (s.left.to === "shipped") times.shipClean.push(s.left.entry.at - s.entered.entry.at);
		else if (s.left.to === "ship:queued" && next?.left?.to === "shipped")
			times.shipClean.push(next.left.entry.at - s.entered.entry.at);
	});
	if (lane.walk.status !== "complete") continue;
	const steps = stepsOf(lane);
	const whole = (steps.at(-1) as Step).entry.at - (steps[0] as Step).entry.at;
	const parked = segs.filter((s) => isPark(s.state)).reduce((sum, s) => sum + (lasted(s) ?? 0), 0);
	times.lane.push(whole);
	times.laneUnparked.push(whole - parked);
	if (straight(shapeOf(lane))) times.laneStraight.push(whole);
}

/** Dispatch times, where a lane kept them: how long before a shell started, and how long it ran. */
const shells = {
	wait: {} as Record<string, number[]>,
	run: {} as Record<string, number[]>,
	again: new Tally(),
};
for (const lane of lanes.filter((l) => l.folds && l.dispatched.length > 0)) {
	for (const [task, steps] of Object.entries(lane.walk.steps)) {
		const mine = lane.dispatched.filter((d) => d.task === task).sort((a, b) => a.at - b.at);
		steps.forEach((step, i) => {
			const next = steps[i + 1];
			if (next === undefined || stageOf(step.to) === "park") return;
			const between = mine.filter(
				(d) => d.at >= step.entry.at && d.at < next.entry.at && d.state === step.to,
			);
			const [start] = between;
			const last = between.at(-1);
			if (start === undefined || last === undefined) return;
			const stage =
				stageOf(step.to) === "build"
					? step.entry.event === "FAIL"
						? "repair build"
						: "build"
					: step.to;
			const waits = shells.wait[stage] ?? [];
			shells.wait[stage] = waits;
			waits.push(start.at - step.entry.at);
			const runs = shells.run[stage] ?? [];
			shells.run[stage] = runs;
			runs.push(next.entry.at - last.at);
			if (between.length > 1) shells.again.add(stage, link(lane), between.length - 1);
		});
	}
}

if (wants("time")) {
	section("2. Time per stage (single-issue lanes)");
	table(
		"Time between two lines of the log",
		["Stage", "From, to", "n", "Median", "p75", "p90"],
		[
			[
				"First build",
				"WIP out of queued, to the DONE that leaves build",
				...spread(times.buildFirst),
			],
			[
				"Repair build",
				"a FAIL into build, to the DONE that leaves it",
				...spread(times.buildRepair),
			],
			[
				"Review, with the wait for CI",
				"DONE into review, to its PASS or FAIL",
				...spread(times.review),
			],
			["  that ended PASS", "", ...spread(times.reviewPass)],
			["  that ended FAIL", "", ...spread(times.reviewFail)],
			["Rendered review", "PASS into review:ui, to its PASS or FAIL", ...spread(times.reviewUi)],
			[
				"Ship, merged in the shipper's own run",
				"PASS into ship, to DONE",
				...spread(times.shipDirect),
			],
			["Ship, up to the merge queue", "PASS into ship, to WIP", ...spread(times.shipEnqueue)],
			["In the merge queue", "WIP into ship:queued, to DONE", ...spread(times.queue)],
			[
				"Ship, clean, either way",
				"PASS into ship, to shipped, nothing else between",
				...spread(times.shipClean),
			],
			["Whole lane, shipped", "first line to the line that shipped it", ...spread(times.lane)],
			[
				"Whole lane, straight through",
				"the same, lanes with no failure, park or lap",
				...spread(times.laneStraight),
			],
			[
				"Whole lane, less parked time",
				"the same, minus every stay in a park",
				...spread(times.laneUnparked),
			],
		],
	);
	const stages = Object.keys(shells.run).sort();
	table(
		`Where a lane kept dispatch times (${lanes.filter((l) => l.dispatched.length > 0).length} lanes): the wait before a shell starts, and the shell's run`,
		[
			"Stage",
			"n",
			"Before the shell: median",
			"p75",
			"p90",
			"The shell's run: median",
			"p75",
			"p90",
			"Started again",
		],
		stages.map((st) => [
			st,
			...spread(shells.wait[st] ?? []),
			...spread(shells.run[st] ?? []).slice(1),
			shells.again.get(st),
		]),
	);
	results.time = {
		...Object.fromEntries(Object.entries(times).map(([k, v]) => [k, spreadOf(v)])),
		dispatch: Object.fromEntries(
			stages.map((st) => [
				st,
				{
					beforeTheShell: spreadOf(shells.wait[st] ?? []),
					shellRun: spreadOf(shells.run[st] ?? []),
					startedAgain: shells.again.get(st),
				},
			]),
		),
	};
}

// ---------------------------------------------------------------- 3. review

if (wants("review")) {
	section("3. Review");
	const verdict = (s: Step) => s.entry.event === "PASS" || s.entry.event === "FAIL";
	// Rounds: the nth verdict a task got in `review`, counted per lane.
	const rounds: {pass: number; fail: number}[] = [];
	const uiRounds: {pass: number; fail: number}[] = [];
	const byClass = new Map<string, {pass: number; fail: number}>();
	const bySet = new Map<string, {pass: number; fail: number}>();
	let classed = 0;
	for (const lane of singles) {
		let round = 0;
		let uiRound = 0;
		for (const step of stepsOf(lane)) {
			if (!verdict(step) || stageOf(step.from) !== "review") continue;
			const list = step.from === "review" ? rounds : uiRounds;
			const r = step.from === "review" ? round++ : uiRound++;
			const cell = list[r] ?? {pass: 0, fail: 0};
			list[r] = cell;
			const passed = step.entry.event === "PASS";
			if (passed) cell.pass += 1;
			else cell.fail += 1;
			if (step.from !== "review") continue;
			const classes = step.after.classes;
			if (classes.length === 0) continue;
			classed += 1;
			const set = bySet.get([...classes].sort().join("+")) ?? {pass: 0, fail: 0};
			if (passed) set.pass += 1;
			else set.fail += 1;
			bySet.set([...classes].sort().join("+"), set);
			for (const c of classes) {
				const one = byClass.get(c) ?? {pass: 0, fail: 0};
				if (passed) one.pass += 1;
				else one.fail += 1;
				byClass.set(c, one);
			}
		}
	}
	const roundRow = (label: string, c: {pass: number; fail: number} | undefined) => {
		const p = c?.pass ?? 0;
		const f = c?.fail ?? 0;
		return [label, p + f, p, f, pct(p, p + f)];
	};
	const later = rounds
		.slice(4)
		.reduce((a, c) => ({pass: a.pass + c.pass, fail: a.fail + c.fail}), {pass: 0, fail: 0});
	table(
		"Pass rate by review round (the text review, single lanes)",
		["Round", "Verdicts", "PASS", "FAIL", "Pass rate"],
		[
			...rounds.slice(0, 4).map((c, i) => roundRow(String(i + 1), c)),
			roundRow("5 and later", later),
			roundRow("rendered review, round 1", uiRounds[0]),
			roundRow(
				"rendered review, later",
				uiRounds
					.slice(1)
					.reduce((a, c) => ({pass: a.pass + c.pass, fail: a.fail + c.fail}), {pass: 0, fail: 0}),
			),
		],
	);
	const needed = new Tally();
	for (const s of shapes.filter((x) => x.lane.walk.status === "complete"))
		needed.add(String(Math.min(s.reviewFails, 4)));
	const shippedN = shapes.filter((x) => x.lane.walk.status === "complete").length;
	console.log(
		`\nfailed reviews before a lane shipped: ${["0", "1", "2", "3", "4"].map((k) => `${k === "4" ? "4+" : k}: ${share(needed.get(k), shippedN)}`).join(", ")}`,
	);
	const failsAll = sortedOf(
		shapes.filter((x) => x.lane.walk.status === "complete").map((s) => s.reviewFails),
	);
	console.log(
		`mean failed reviews per shipped lane ${(failsAll.reduce((a, b) => a + b, 0) / failsAll.length).toFixed(2)}, most ${failsAll.at(-1)}`,
	);

	table(
		`Verdicts by the lane's classes, where a line or an earlier one says them (${classed} of ${rounds.reduce((a, c) => a + c.pass + c.fail, 0)} text verdicts)`,
		["Classes on the lane", "Verdicts", "FAIL", "Fail rate"],
		[...bySet]
			.sort((a, b) => b[1].pass + b[1].fail - (a[1].pass + a[1].fail))
			.map(([k, c]) => [k, c.pass + c.fail, c.fail, pct(c.fail, c.pass + c.fail)]),
	);
	table(
		"The same, by each class a lane carries (a lane with two classes counts in both)",
		["Class", "Verdicts", "FAIL", "Fail rate"],
		[...byClass]
			.sort((a, b) => b[1].pass + b[1].fail - (a[1].pass + a[1].fail))
			.map(([k, c]) => [k, c.pass + c.fail, c.fail, pct(c.fail, c.pass + c.fail)]),
	);

	// Every FAIL, by where it was written and where it sent the task.
	const fails = new Tally();
	const laps = new Tally();
	const cleared = new Tally();
	let corrected = 0;
	let rerouted = 0;
	for (const lane of lanes.filter((l) => l.folds)) {
		corrected += lane.walk.corrected;
		// A correction that changed where its DONE went: the raw line said one thing, the corrected one another.
		for (const c of lane.entries.filter((e) => e.event === "CORRECTED")) {
			const target = lane.entries.find((e) => e.task === c.task && e.stamp === c.corrects);
			if (target !== undefined && (target.partial === true) !== (c.partial === true)) rerouted += 1;
		}
		for (const steps of Object.values(lane.walk.steps)) {
			for (const s of steps) {
				if (s.entry.event === "FAIL") fails.add(`${s.from} to ${s.to}`, link(lane));
				if (s.entry.event === "LAP")
					laps.add(`${s.entry.cause ?? "(no cause)"}: ${s.from} to ${s.to}`, link(lane));
				if (s.entry.event === "CLEARED") cleared.add(s.from, link(lane));
			}
		}
	}
	table(
		"Every FAIL, by the state it was written in and where it sent the task (all lanes)",
		["From, to", "Count", "Examples"],
		fails.rows().map(([k, v]) => [k, v, (fails.examples.get(k) ?? []).join(" ")]),
	);
	table(
		"Every LAP, by cause (all lanes)",
		["Cause: from, to", "Count", "Examples"],
		laps.rows().map(([k, v]) => [k, v, (laps.examples.get(k) ?? []).join(" ")]),
	);
	console.log(
		`\nCORRECTED lines: ${corrected}; of them, ones that changed where a ship's DONE went: ${rerouted}`,
	);
	console.log(
		`CLEARED lines, by the state the task stood in: ${cleared.top(12)} (${cleared.total} in all)`,
	);
	const extras = new Tally();
	for (const e of allEntries) {
		if (e.event === "PASS" && Array.isArray(e.raw.deferred))
			extras.add("PASS with a rendered verdict deferred to the epic's end");
		if (e.event === "PASS" && Array.isArray(e.raw.routed))
			extras.add("PASS where the rendered review was routed away");
		if ((e.event === "PASS" || e.event === "FAIL") && typeof e.raw.comment === "string")
			extras.add(`${e.event} that names its comment`);
	}
	console.log(`also on verdict lines: ${extras.top(8)}`);
	results.review = {
		rounds: rounds.map((c, i) => ({round: i + 1, ...c})),
		renderedRounds: uiRounds.map((c, i) => ({round: i + 1, ...c})),
		failedReviewsBeforeShipping: needed.json(),
		byClasses: Object.fromEntries(bySet),
		byClass: Object.fromEntries(byClass),
		fails: fails.json(),
		laps: laps.json(),
		corrected,
		correctionsThatRerouted: rerouted,
		cleared: cleared.json(),
	};
}

// ---------------------------------------------------------------- 4. parks

interface Park {
	readonly lane: Lane;
	readonly task: string;
	readonly from: string;
	readonly state: string;
	/** The cause on the line, or `null`. */
	readonly cause: string | null;
	/** The event that parked it: `BLOCKED`, or the `FAIL` or `WIP` that spent a budget. */
	readonly by: string;
	readonly at: number;
	readonly cleared:
		| "unblocked"
		| "unblocked, with a reason written"
		| "ended by the board"
		| "still parked";
	readonly granted: boolean;
	readonly backTo: string | null;
	readonly lasted: number | null;
}
const parksOf = (set: readonly Lane[]): Park[] =>
	allSegments(set)
		.filter((s) => isPark(s.state) && s.entered !== null)
		.map((s) => {
			const entered = s.entered as Step;
			const left = s.left;
			return {
				lane: s.lane,
				task: s.task,
				from: entered.from,
				state: s.state,
				cause: entered.entry.cause,
				by: entered.entry.event,
				at: entered.entry.at,
				cleared:
					left === null
						? ("still parked" as const)
						: Object.hasOwn(BOARD_TERMINALS, left.entry.event)
							? ("ended by the board" as const)
							: typeof left.entry.raw.rationale === "string"
								? ("unblocked, with a reason written" as const)
								: ("unblocked" as const),
				granted: s.inner.some((x) => x.entry.event === "CLEARED"),
				backTo: left?.to ?? null,
				lasted:
					left === null || Object.hasOwn(BOARD_TERMINALS, left.entry.event)
						? null
						: left.entry.at - entered.entry.at,
			};
		});
const parks = parksOf(lanes.filter((l) => l.folds));
/** A park's name for a table: its cause, or the state it stands in when the line gives none. */
const parkName = (p: Park) =>
	p.cause ??
	(p.by === "BLOCKED" ? `(no cause) at ${p.state}` : `(${p.by} spent a budget) at ${p.state}`);
/** What the operator machine's tables say of a park. */
function ruleFor(
	p: Park,
):
	| "code clears it"
	| "a person acts, then code clears it"
	| "a person must answer"
	| "no rule: asks a person"
	| "unknown word: asks a person"
	| "no cause on the line" {
	const cause = p.cause ?? (p.state === "human:budget-spent" ? "repair-budget-spent" : null);
	if (cause === null) return hasRecipe(p.state, null) ? "code clears it" : "no cause on the line";
	const known = ParkCause.safeParse(cause);
	if (!known.success) return "unknown word: asks a person";
	const recipe = hasRecipe(p.state, known.data);
	if (PARK_ROUTE[known.data] === "founder")
		return recipe ? "a person acts, then code clears it" : "a person must answer";
	return recipe ? "code clears it" : "no rule: asks a person";
}

if (wants("parks")) {
	section("4. Parks (all lanes)");
	const byName = new Map<string, Park[]>();
	for (const p of parks) byName.set(parkName(p), [...(byName.get(parkName(p)) ?? []), p]);
	const named = [...byName].sort((a, b) => b[1].length - a[1].length);
	const tally = (list: readonly Park[], key: (p: Park) => string) => {
		const t = new Tally();
		for (const p of list) t.add(key(p));
		return t.top(4);
	};
	console.log(
		`parks: ${parks.length} (${parks.filter((p) => p.by === "BLOCKED").length} by a BLOCKED line, ${parks.filter((p) => p.by !== "BLOCKED").length} by a spent budget); with a cause on the line ${parks.filter((p) => p.cause !== null).length}`,
	);
	table(
		"Parks by cause",
		[
			"Cause",
			"Parks",
			"Parked out of",
			"How it ended",
			"Time to clear: median",
			"p75",
			"p90",
			"Lane finished after",
			"Rule in the machine",
		],
		named.map(([name, list]) => {
			const done = list.filter(
				(p) =>
					p.lane.walk.status === "complete" ||
					p.lane.walk.status === "diagnosed" ||
					p.lane.walk.status === "board:landed",
			).length;
			return [
				name,
				list.length,
				tally(list, (p) => p.from),
				tally(list, (p) => p.cleared),
				...spread(list.flatMap((p) => p.lasted ?? [])).slice(1),
				share(done, list.length),
				ruleFor(list[0] as Park),
			];
		}),
	);
	const caused = parks.filter((p) => p.cause !== null || p.by !== "BLOCKED");
	const rules = new Map<string, Park[]>();
	for (const p of parks) rules.set(ruleFor(p), [...(rules.get(ruleFor(p)) ?? []), p]);
	table(
		`Parks by what the operator machine's tables say (${parks.length} parks; ${caused.length} name a cause or are a spent budget)`,
		["Rule", "Parks", "Causes", "Cleared in the log", "Median time to clear"],
		[...rules]
			.sort((a, b) => b[1].length - a[1].length)
			.map(([rule, list]) => {
				const causes = new Tally();
				for (const p of list)
					causes.add(p.cause ?? (p.by === "BLOCKED" ? "(none)" : "repair budget"));
				const clearedIn = list.filter((p) => p.cleared.startsWith("unblocked"));
				return [
					rule,
					share(list.length, parks.length),
					causes.top(12),
					share(clearedIn.length, list.length),
					spread(list.flatMap((p) => p.lasted ?? []))[1] ?? "",
				];
			}),
	);
	const words = new Tally();
	for (const p of parks) if (p.cause !== null) words.add(p.cause, link(p.lane));
	const unknown = words.rows().filter(([w]) => !ParkCause.safeParse(w).success);
	const unseen = ParkCause.options.filter((w) => words.get(w) === 0);
	console.log(
		`\ncauses in the logs that the machine's ParkCause does not have: ${unknown.map(([w, c]) => `${w} ${c} (${(words.examples.get(w) ?? []).join(" ")})`).join(", ")}`,
	);
	console.log(`causes the machine has that never appear in the logs: ${unseen.join(", ")}`);
	const longest = [...parks]
		.filter((p) => p.lasted !== null)
		.sort((a, b) => (b.lasted as number) - (a.lasted as number))
		.slice(0, 5);
	console.log(
		`longest parks that cleared: ${longest.map((p) => `${link(p.lane)} ${parkName(p)} ${span(p.lasted as number)}`).join("; ")}`,
	);
	const reasons = parks.filter((p) => p.cleared === "unblocked, with a reason written");
	const reasonCauses = new Tally();
	for (const p of reasons) reasonCauses.add(parkName(p));
	console.log(
		`parks the driver cleared with a reason written (${reasons.length}): ${reasonCauses.top(12)}`,
	);
	const granted = parks.filter((p) => p.granted);
	console.log(
		`parks during which a person cleared a repair round: ${granted.length} (${tally(granted, (p) => p.state)})`,
	);
	results.parks = {
		parks: parks.length,
		byCause: Object.fromEntries(
			named.map(([name, list]) => [
				name,
				{
					count: list.length,
					from: Object.fromEntries(
						new Map(list.map((p) => [p.from, list.filter((x) => x.from === p.from).length])),
					),
					ended: Object.fromEntries(
						new Map(
							list.map((p) => [p.cleared, list.filter((x) => x.cleared === p.cleared).length]),
						),
					),
					timeToClear: spreadOf(list.flatMap((p) => p.lasted ?? [])),
					laneFinishedAfter: list.filter(
						(p) =>
							p.lane.walk.status === "complete" ||
							p.lane.walk.status === "diagnosed" ||
							p.lane.walk.status === "board:landed",
					).length,
					rule: ruleFor(list[0] as Park),
				},
			]),
		),
		byRule: Object.fromEntries([...rules].map(([rule, list]) => [rule, list.length])),
		unknownCauses: Object.fromEntries(unknown),
		neverSeen: unseen,
	};
}

// ---------------------------------------------------------------- 5. ship in detail

interface ShipRun {
	readonly lane: Lane;
	/** What happened inside the run, in order, as short labels. */
	readonly inside: readonly string[];
	readonly outcome: string;
	readonly lasted: number | null;
}
const SHIP_STATES = new Set(["ship", "ship:queued"]);
function shipRunsOf(lane: Lane): ShipRun[] {
	const runs: ShipRun[] = [];
	let open: {inside: string[]; from: number} | null = null;
	for (const step of stepsOf(lane)) {
		if (open === null) {
			if (step.to === "ship" && !SHIP_STATES.has(step.from) && !isPark(step.from))
				open = {inside: [], from: step.entry.at};
			continue;
		}
		const e = step.entry;
		const inShip = SHIP_STATES.has(step.to) || isPark(step.to);
		const label =
			e.event === "WIP" && step.from === "ship"
				? "queued"
				: e.event === "WIP"
					? step.to === "ship:queued"
						? "wait"
						: "queue stall"
					: e.event === "BLOCKED"
						? `park: ${e.cause ?? "no cause"}`
						: e.event === "LAP"
							? `lap: ${e.cause ?? "no cause"}`
							: e.event === "FAIL"
								? isPark(step.to)
									? "FAIL, budget spent"
									: step.from === "ship:queued"
										? "FAIL out of the queue"
										: "FAIL"
								: e.event === "DONE" && step.to === "queued"
									? "merged, issue left open"
									: e.event;
		if (inShip) {
			open.inside.push(label);
			continue;
		}
		const outcome =
			step.to === "shipped"
				? "shipped"
				: Object.hasOwn(BOARD_TERMINALS, e.event)
					? "ended by the board"
					: e.event === "DONE"
						? "merged, issue left open: round again"
						: e.event === "UNBLOCKED"
							? `unparked back to ${step.to}`
							: `${label}: back to ${step.to}`;
		runs.push({lane, inside: open.inside, outcome, lasted: step.entry.at - open.from});
		open = null;
	}
	if (open !== null)
		runs.push({lane, inside: open.inside, outcome: "open when the data ends", lasted: null});
	return runs;
}
const shipRuns = singles.flatMap(shipRunsOf);

if (wants("ship")) {
	section("5. Ship in detail (single-issue lanes)");
	const reached = singles.filter((l) => shipRunsOf(l).length > 0);
	const perLane = new Tally();
	for (const l of reached) perLane.add(String(Math.min(shipRunsOf(l).length, 4)));
	const clean = (r: ShipRun) => r.outcome === "shipped" && r.inside.every((x) => x === "queued");
	const firstRuns = reached.map((l) => shipRunsOf(l)[0] as ShipRun);
	console.log(
		`lanes that reached ship: ${reached.length}; ship runs (a pass into ship, until it leaves): ${shipRuns.length}`,
	);
	console.log(
		`ship runs per lane: ${["1", "2", "3", "4"].map((k) => `${k === "4" ? "4+" : k}: ${perLane.get(k)}`).join(", ")}`,
	);
	console.log(
		`first ship run landed with nothing in between: ${share(firstRuns.filter(clean).length, reached.length)} of lanes`,
	);
	const kinds = new Tally();
	for (const r of shipRuns) {
		const unhappy = r.inside.filter((x) => x !== "queued");
		if (r.outcome === "shipped" && unhappy.length === 0)
			kinds.add(
				r.inside.length === 0 ? "landed in the shipper's own run" : "queued, then landed",
				link(r.lane),
			);
		else if (r.outcome === "shipped" && unhappy.every((x) => x === "wait"))
			kinds.add("queued, waited, landed", link(r.lane));
		else kinds.add("something else happened", link(r.lane));
	}
	table(
		"Ship runs, by how they went",
		["How", "Runs", "Share"],
		kinds.rows().map(([k, v]) => [k, v, pct(v, shipRuns.length)]),
	);

	// One shipper, one line: what each stay in `ship` ended in.
	const words = new Tally();
	for (const s of singleSegments.filter((x) => x.state === "ship" && x.left !== null)) {
		const left = (s.left as Step).entry;
		words.add(
			left.event === "DONE"
				? (s.left as Step).to === "shipped"
					? "merged, in its own run"
					: "merged, with the issue left open"
				: left.event === "WIP"
					? "queued the pull request and ended"
					: left.event === "BLOCKED"
						? "parked the lane"
						: left.event === "FAIL"
							? "sent it back for repair"
							: left.event === "LAP"
								? `a lap (${left.cause ?? "no cause"})`
								: "the board ended the lane",
		);
	}
	table(
		`What a stay in \`ship\` ended in: one shipper's run each (${words.total})`,
		["The shipper", "Runs", "Share"],
		words.rows().map(([k, v]) => [k, v, pct(v, words.total)]),
	);
	results.shipperRuns = words.json();

	// Each unhappy thing, counted once per run it happened in, with how those runs ended.
	const things = new Map<string, ShipRun[]>();
	for (const r of shipRuns) {
		const seen = new Set<string>([
			...r.inside.filter((x) => x !== "queued" && x !== "UNBLOCKED" && x !== "CLEARED"),
			...(r.outcome.includes(": back to") ? [r.outcome.split(": back to")[0] as string] : []),
			...(r.outcome.startsWith("merged, issue left open") ? ["merged, issue left open"] : []),
			...(r.outcome === "ended by the board" ? ["ended by the board"] : []),
		]);
		for (const thing of seen) things.set(thing, [...(things.get(thing) ?? []), r]);
	}
	table(
		`What a ship run met, and how those runs ended (${shipRuns.length} runs)`,
		[
			"It met",
			"Runs",
			"Share of runs",
			"How those runs ended",
			"Lane shipped in the end",
			"Examples",
		],
		[...things]
			.sort((a, b) => b[1].length - a[1].length)
			.map(([thing, list]) => {
				const ends = new Tally();
				for (const r of list) ends.add(r.outcome);
				const lanesSeen = [...new Set(list.map((r) => r.lane))];
				return [
					thing,
					list.length,
					pct(list.length, shipRuns.length),
					ends.top(4),
					share(lanesSeen.filter((l) => l.walk.status === "complete").length, lanesSeen.length),
					lanesSeen.slice(0, 3).map(link).join(" "),
				];
			}),
	);
	// A merge that left its issue open sends the lane back to `queued`. What the real lane did next.
	const afterPartial = new Tally();
	for (const lane of singles) {
		const steps = stepsOf(lane);
		steps.forEach((s, i) => {
			if (s.entry.event !== "DONE" || s.to !== "queued") return;
			const next = steps[i + 1];
			afterPartial.add(
				next === undefined
					? "nothing: the log ends there"
					: next.entry.event === "WIP"
						? "a new build started"
						: next.entry.event === "BLOCKED"
							? `parked (${next.entry.cause ?? "no cause"})`
							: "the board ended the lane",
				link(lane),
			);
		});
	}
	console.log(
		`\nafter a merge that left the issue open (${afterPartial.total}), the lane's next line: ${afterPartial.top(8)}`,
	);
	results.afterPartialMerge = afterPartial.json();

	// The causes the brief names, wherever they were written.
	const causeAt = new Map<string, Tally>();
	for (const lane of lanes.filter((l) => l.folds)) {
		for (const steps of Object.values(lane.walk.steps)) {
			for (const s of steps) {
				if ((s.entry.event !== "BLOCKED" && s.entry.event !== "LAP") || s.entry.cause === null)
					continue;
				const t = causeAt.get(s.entry.cause) ?? new Tally();
				t.add(`${s.entry.event} in ${s.from}`);
				causeAt.set(s.entry.cause, t);
			}
		}
	}
	table(
		"Where each cause was written: the event and the state (all lanes)",
		["Cause", "Lines", "Event and state"],
		[...causeAt]
			.sort((a, b) => b[1].total - a[1].total)
			.map(([cause, t]) => [cause, t.total, t.top(6)]),
	);
	results.ship = {
		lanesThatReachedShip: reached.length,
		runs: shipRuns.length,
		firstRunClean: firstRuns.filter(clean).length,
		runsPerLane: perLane.json(),
		kinds: kinds.json(),
		met: Object.fromEntries(
			[...things].map(([thing, list]) => [
				thing,
				{runs: list.length, examples: [...new Set(list.map((r) => r.lane.name))].slice(0, 5)},
			]),
		),
		causeAt: Object.fromEntries([...causeAt].map(([cause, t]) => [cause, t.json()])),
	};
}

// ---------------------------------------------------------------- 6. what the operator machine's tables cover

if (wants("coverage")) {
	section("6. Coverage of the operator machine's tables");
	const declared = new Tally();
	const entered = new Tally();
	const stoodAtEnd = new Tally();
	for (const lane of lanes) {
		for (const state of new Set(Object.values(lane.compiled.tasks).flatMap((t) => t.states)))
			declared.add(state);
		for (const [task, steps] of Object.entries(lane.walk.steps)) {
			for (const s of steps) if (s.to !== s.from) entered.add(s.to);
			stoodAtEnd.add(lane.walk.states[task]?.state ?? "");
		}
	}
	const names = [...new Set([...declared.counts.keys(), ...entered.counts.keys()])].sort(
		(a, b) => entered.get(b) - entered.get(a),
	);
	const routeName = (state: string) => {
		const route = routeOf(state);
		if (route === null) return "NO ROUTE";
		if (route.kind === "shell") return `shell: ${route.shell}`;
		return route.kind === "unbuilt" ? "known, not built" : route.kind;
	};
	table(
		"Every state name in the workflows and the logs, and the machine's route for it",
		["State", "Lanes that declare it", "Times entered", "Tasks standing there at the end", "Route"],
		names.map((state) => [
			state,
			declared.get(state),
			entered.get(state),
			stoodAtEnd.get(state),
			routeName(state),
		]),
	);
	console.log(
		`\nroutes in the table that no workflow declares: ${
			Object.keys(ROUTES)
				.filter((s) => declared.get(s) === 0 && entered.get(s) === 0)
				.join(", ") || "none"
		}`,
	);

	// Every arm the logs took, against the scripted fake's small copy of the lane.
	const fakeEvent = (from: string, event: string) =>
		from === "ship" && event === "WIP"
			? "QUEUED"
			: from === "ship:queued"
				? ({DONE: "LANDED", WIP: "UNRESOLVED", FAIL: "EJECTED", LAP: "EJECTED"}[event] ?? event)
				: event;
	const fakeHas = (s: Step): boolean => {
		const e = s.entry.event;
		if (e === "BLOCKED") return s.to === "blocked" || s.to === "human:cp-approval";
		if (e === "UNBLOCKED" || e === "CANCELLED")
			return NEXT[s.to] !== undefined || s.to === "board:cancelled";
		if (s.from === "ship:queued" && e === "WIP" && s.to === "human:queue-stall") return true;
		return NEXT[s.from]?.[fakeEvent(s.from, e)] === s.to;
	};
	const arms = new Tally();
	const missing = new Tally();
	const singleSteps = {all: 0, missing: 0, lanesWhole: 0};
	for (const lane of lanes.filter((l) => l.folds)) {
		let whole = true;
		for (const steps of Object.values(lane.walk.steps)) {
			for (const s of steps) {
				const arm = `${s.from} + ${s.entry.event} to ${s.to}`;
				arms.add(arm);
				if (lane.kind === "single") singleSteps.all += 1;
				if (fakeHas(s)) continue;
				missing.add(arm, link(lane));
				whole = false;
				if (lane.kind === "single") singleSteps.missing += 1;
			}
		}
		if (lane.kind === "single" && whole) singleSteps.lanesWhole += 1;
	}
	console.log(
		`arms the logs took: ${arms.counts.size} different ones, ${arms.total} steps; the scripted fake folds ${arms.total - missing.total} of the steps (${pct(arms.total - missing.total, arms.total)}) and lacks ${missing.counts.size} arms`,
	);
	console.log(
		`single lanes only: the fake folds ${singleSteps.all - singleSteps.missing} of ${singleSteps.all} steps (${pct(singleSteps.all - singleSteps.missing, singleSteps.all)}), and every step of ${share(singleSteps.lanesWhole, singles.length)} lanes`,
	);
	table(
		"Arms the scripted fake's lane does not have",
		["From + event to", "Steps", "Examples"],
		missing.rows().map(([k, v]) => [k, v, (missing.examples.get(k) ?? []).join(" ")]),
	);
	const events = new Tally();
	for (const e of allEntries) events.add(e.event);
	results.coverage = {
		states: Object.fromEntries(
			names.map((state) => [
				state,
				{declaredBy: declared.get(state), entered: entered.get(state), route: routeName(state)},
			]),
		),
		armsTaken: arms.counts.size,
		steps: arms.total,
		stepsTheFakeFolds: arms.total - missing.total,
		armsTheFakeLacks: missing.json(),
	};
}

// ---------------------------------------------------------------- 7. the replay

if (wants("replay")) {
	section("7. Every lane, replayed under the operator machine");
	const replays: {lane: Lane; replay: Replay}[] = [];
	for (const lane of lanes.filter((l) => l.folds))
		replays.push({lane, replay: await replayLane(lane.name, lane.compiled, lane.entries)});
	const outcomes = ["same", "board", "ran_out", "stopped", "diverged", "hung"] as const;
	const means: Record<string, string> = {
		same: "walked the whole log and ended where the lane ended",
		board: "the same, and the lane's end came from the board",
		ran_out: "the log ends mid-lane; agreed as far as it goes",
		stopped: "the machine stopped by its own rule",
		diverged: "the machine's move does not fit the lane's next real event",
		hung: "the replay did not end",
	};
	const count = (kind: string, o: string) =>
		replays.filter((r) => r.lane.kind === kind && r.replay.outcome === o).length;
	const nSingle = replays.filter((r) => r.lane.kind === "single").length;
	const nEpic = replays.filter((r) => r.lane.kind === "epic").length;
	table(
		`Replay outcomes (${replays.length} lanes that fold)`,
		["Outcome", "Single lanes", "Epic lanes", "Meaning"],
		outcomes.map((o) => [
			o,
			share(count("single", o), nSingle),
			share(count("epic", o), nEpic),
			means[o] ?? "",
		]),
	);
	const whys = new Tally();
	for (const {lane, replay} of replays) {
		if (
			replay.outcome !== "stopped" &&
			replay.outcome !== "diverged" &&
			replay.outcome !== "ran_out"
		)
			continue;
		// A lane with several tasks stops once for each; the first reason stands for the lane.
		const why =
			replay.outcome === "ran_out"
				? "the log ends here"
				: ((replay.why ?? "").split(/; \w+: /)[0] ?? "");
		whys.add(`${lane.kind} | ${replay.outcome} | ${replay.state ?? ""} | ${why}`, link(lane));
	}
	table(
		"Where and why a replay did not reach the end",
		["Lanes", "Kind", "Outcome", "State", "Why", "Examples"],
		whys.rows().map(([k, v]) => [v, ...k.split(" | "), (whys.examples.get(k) ?? []).join(" ")]),
	);

	const single = replays.filter((r) => r.lane.kind === "single");
	const by = new Tally();
	let landed = 0;
	let total = 0;
	for (const {replay} of single) {
		landed += replay.landed;
		total += replay.total;
		for (const [how, n] of Object.entries(replay.by)) by.add(how, undefined, n);
	}
	const epicLanded = replays
		.filter((r) => r.lane.kind === "epic")
		.reduce((n, r) => n + r.replay.landed, 0);
	const epicTotal = replays
		.filter((r) => r.lane.kind === "epic")
		.reduce((n, r) => n + r.replay.total, 0);
	console.log(
		`\nsingle lanes: events the replay landed ${landed} of ${total} (${pct(landed, total)}); epic lanes ${epicLanded} of ${epicTotal} (${pct(epicLanded, epicTotal)})`,
	);
	const whose: Record<string, string> = {
		shell: "a shell's own report (tests nothing of the machine)",
		start: "the machine wrote the start of a build",
		queue: "the machine wrote what the merge queue did",
		wait: "a wait in the merge queue the machine listened through",
		recipe: "the machine cleared a park by its recipe",
		person: "the machine cleared a park on a person's answer",
		dead_shell: "the machine wrote a dead shell",
		conflict: "the machine wrote a conflict before review",
		rewind: "the machine rewound a review",
		outside: "came from outside the lane: a cleared round, the board",
	};
	table(
		"Single lanes: whose move landed each event in the replay",
		["Move", "Events", "Share"],
		by.rows().map(([k, v]) => [whose[k] ?? k, v, pct(v, landed)]),
	);
	const shellsRun = new Tally();
	for (const {replay} of single) for (const shell of replay.shells) shellsRun.add(shell);
	const cmds = sortedOf(single.map((r) => r.replay.cmds));
	console.log(
		`\nsingle lanes: shells the machine started ${shellsRun.total} (${shellsRun.top(8)})`,
	);
	console.log(
		`Cmds the machine sent: ${cmds.reduce((a, b) => a + b, 0)} in all; per lane median ${at(cmds, 0.5)}, p90 ${at(cmds, 0.9)}, most ${cmds.at(-1)}; passes ${single.reduce((n, r) => n + r.replay.passes, 0)}`,
	);

	// Each park the machine met, beside the same park in the log: the nth park of a task is the nth in both.
	const met = single.flatMap((r) => {
		const logged = parks.filter((p) => p.lane === r.lane).sort((a, b) => a.at - b.at);
		return r.replay.parks.map((p, i) => ({
			...p,
			lane: r.lane,
			logged: logged[i]?.state === p.state ? (logged[i] as Park) : null,
		}));
	});
	const how = (p: (typeof met)[number]) =>
		p.cleared === "recipe"
			? "code cleared it (a recipe)"
			: p.cleared === "person"
				? "asked a person, who answered"
				: p.asked
					? "asked a person, no answer in the log"
					: "left parked";
	const parkRows = new Map<string, Tally>();
	for (const p of met) {
		const name = p.cause ?? `(no cause) at ${p.state}`;
		const t = parkRows.get(name) ?? new Tally();
		t.add(how(p));
		if (p.asked && p.logged?.cleared === "unblocked, with a reason written") t.add("driver");
		parkRows.set(name, t);
	}
	const hows = [
		"code cleared it (a recipe)",
		"asked a person, who answered",
		"asked a person, no answer in the log",
	];
	const totals = new Tally();
	for (const t of parkRows.values()) for (const [k, v] of t.counts) totals.add(k, undefined, v);
	const parkRow = (name: string, t: Tally) => [
		name,
		hows.reduce((n, h) => n + t.get(h), 0),
		...hows.map((h) => t.get(h)),
		t.get("driver"),
	];
	table(
		`Single lanes: parks the machine met in replay (${met.length}), and what it did`,
		[
			"Cause",
			"Parks",
			...hows,
			"Of those asked: today's driver cleared it itself, with a reason written",
		],
		[
			...[...parkRows]
				.map(([name, t]) => parkRow(name, t))
				.sort((a, b) => (b[1] as number) - (a[1] as number)),
			parkRow("all", totals),
		],
	);
	// Lanes that started once every park named its cause: what a run of today's fabrika would ask.
	const fromOctober = single.filter(
		(r) => (stepsOf(r.lane)[0]?.entry.at ?? 0) >= Date.parse("2026-10-01T00:00:00Z"),
	);
	const octoberParks = fromOctober.flatMap((r) => r.replay.parks);
	console.log(
		`\nlanes started in October 2026, when every park names its cause: ${fromOctober.length}; with a park ${fromOctober.filter((r) => r.replay.parks.length > 0).length}; with a question ${fromOctober.filter((r) => r.replay.parks.some((p) => p.asked)).length}; parks ${octoberParks.length}, cleared by code ${octoberParks.filter((p) => p.cleared === "recipe").length}, asked ${octoberParks.filter((p) => p.asked).length}`,
	);
	const asked = met.filter((p) => p.asked);
	const lanesAsked = new Set(asked.map((p) => p.lane.name));
	const named = met.filter((p) => p.cause !== null);
	const namedAsked = named.filter((p) => p.asked);
	console.log(
		`\nquestions to a person: ${asked.length}, on ${lanesAsked.size} single lanes (${pct(lanesAsked.size, single.length)})`,
	);
	console.log(
		`parks that name a cause: ${named.length}; code cleared ${named.filter((p) => p.cleared === "recipe").length}, a person was asked ${namedAsked.length}, on ${new Set(namedAsked.map((p) => p.lane.name)).size} lanes`,
	);
	console.log(
		`of those ${namedAsked.length} questions, today's driver had cleared the park itself, with its reason written: ${namedAsked.filter((p) => p.logged?.cleared === "unblocked, with a reason written").length}`,
	);
	results.replay = {
		lanes: replays.length,
		outcomes: Object.fromEntries(
			outcomes.map((o) => [o, {single: count("single", o), epic: count("epic", o)}]),
		),
		notToTheEnd: whys
			.rows()
			.map(([k, v]) => ({lanes: v, where: k, examples: whys.examples.get(k)})),
		singleEventsLanded: landed,
		singleEvents: total,
		epicEventsLanded: epicLanded,
		epicEvents: epicTotal,
		byWhoseMove: by.json(),
		shells: shellsRun.json(),
		cmdsPerLane: {median: at(cmds, 0.5), p90: at(cmds, 0.9), most: cmds.at(-1)},
		parksMet: met.length,
		parks: Object.fromEntries([...parkRows].map(([name, t]) => [name, t.json()])),
		questions: asked.length,
		lanesWithAQuestion: lanesAsked.size,
	};
}

// ---------------------------------------------------------------- 8. spend

if (wants("spend")) {
	section("8. Spend");
	const ledger = jsonl(join(DATA, "spend-ledger.jsonl"));
	const reap = jsonl(join(DATA, "reap.jsonl"));
	const get = (row: Record<string, unknown>, ...path: string[]): unknown =>
		path.reduce<unknown>(
			(v, k) =>
				typeof v === "object" && v !== null ? (v as Record<string, unknown>)[k] : undefined,
			row,
		);
	const kinds = new Tally();
	const hosts = new Tally();
	const models = new Tally();
	const issues = new Set<unknown>();
	const sessions = new Set<unknown>();
	const measured = new Map<string, Record<string, number>>();
	const fieldsSeen = new Set<string>();
	for (const row of ledger) {
		kinds.add(`${String(row.kind)}${row.state === undefined ? "" : `: ${String(row.state)}`}`);
		hosts.add(String(get(row, "source", "host")));
		issues.add(get(row, "work", "issue"));
		sessions.add(get(row, "agent", "session"));
		for (const k of Object.keys(row)) fieldsSeen.add(k);
		if (row.kind !== "measurement") continue;
		models.add(`${String(row.provider)}/${String(row.model)}`);
		// The session's running total is the one row that needs no adding up: keep the largest seen.
		if (get(row, "basis", "kind") !== "cumulative" || get(row, "basis", "scope") !== "session")
			continue;
		const session = String(get(row, "agent", "session"));
		const totals = measured.get(session) ?? {};
		for (const c of (row.counters as {field: string; value: {tokens?: number}}[]) ?? []) {
			if (typeof c.value.tokens === "number")
				totals[c.field] = Math.max(totals[c.field] ?? 0, c.value.tokens);
		}
		measured.set(session, totals);
	}
	const sum = (field: string) => [...measured.values()].reduce((n, t) => n + (t[field] ?? 0), 0);
	console.log(`spend-ledger.jsonl: ${ledger.length} rows; kinds: ${kinds.top(8)}`);
	console.log(
		`hosts: ${hosts.top(4)}; models: ${models.top(4)}; lanes it covers: ${issues.size} of ${lanes.length}; sessions named ${sessions.size}, with a measured total ${measured.size}`,
	);
	console.log(`fields on a row: ${[...fieldsSeen].sort().join(", ")}`);
	console.log(
		`tokens of the measured sessions: input ${sum("input_tokens")} (of it read from cache ${sum("cached_input_tokens")}), output ${sum("output_tokens")}, total ${sum("total_tokens")}`,
	);
	console.log(
		`a role on any row: ${ledger.some((r) => JSON.stringify(r).includes('"role"')) ? "yes" : "no"}; dollars on any row: ${ledger.some((r) => /cost|usd|dollar/i.test(JSON.stringify(r))) ? "yes" : "no"}; a time on any row: ${ledger.some((r) => /"at"|timestamp|"time"/i.test(JSON.stringify(r))) ? "yes" : "no"}`,
	);
	const licenses = new Tally();
	for (const row of reap) licenses.add(String(row.license));
	const runs = new Set(reap.map((r) => r.run));
	console.log(
		`reap.jsonl: ${reap.length} rows, fields ${[...new Set(reap.flatMap((r) => Object.keys(r)))].join(", ")}; ${runs.size} sweeps from ${[...runs].sort()[0]} to ${[...runs].sort().at(-1)}; by licence: ${licenses.top(4)}`,
	);
	results.spend = {
		ledgerRows: ledger.length,
		kinds: kinds.json(),
		hosts: hosts.json(),
		models: models.json(),
		lanesCovered: issues.size,
		sessionsNamed: sessions.size,
		sessionsMeasured: measured.size,
		tokens: {
			input: sum("input_tokens"),
			cachedInput: sum("cached_input_tokens"),
			output: sum("output_tokens"),
			total: sum("total_tokens"),
		},
		reapRows: reap.length,
		reapSweeps: runs.size,
		reapLicences: licenses.json(),
	};
}

// ---------------------------------------------------------------- 9. the three machine runs

if (wants("runs")) {
	section("9. Where the three machine runs sit");
	// From experiments 49, 50 and 52: minutes between the same two lane events the table above bounds.
	const runs = [
		{
			run: "kamp-us/demlik#559 (exp. 49)",
			build: 3.6,
			review: 8.2,
			repair: null,
			ship: 6.6,
			park: null,
			lane: 18.4,
			fails: 0,
			parks: 0,
			laps: 0,
		},
		{
			run: "kamp-us/demlik#625 (exp. 50)",
			build: 5.1,
			review: 7.9,
			repair: 17.7,
			ship: 6.1,
			park: null,
			lane: 39.7,
			fails: 1,
			parks: 0,
			laps: 3,
		},
		{
			run: "kamp-us/demlik#623 (exp. 52)",
			build: 9.4,
			review: 7.7,
			repair: null,
			ship: 9.4,
			park: 17.2,
			lane: 44.7,
			fails: 0,
			parks: 1,
			laps: 0,
		},
	];
	const approvals = parks
		.filter((p) => p.cause === "awaiting-cp-approval")
		.flatMap((p) => p.lasted ?? []);
	const place = (values: readonly number[], minutes: number | null) =>
		minutes === null
			? ""
			: `${minutes} min, at ${pct(Math.round(rank(values, minutes * MIN) * 1000), 1000)}`;
	table(
		"Each run's minutes, and the share of this data's lanes at or under it",
		[
			"Run",
			"First build",
			"Review with CI",
			"Repair build",
			"Ship, PASS to landed",
			"Approval park",
			"Whole lane",
		],
		runs.map((r) => [
			r.run,
			place(times.buildFirst, r.build),
			place(times.review, r.review),
			place(times.buildRepair, r.repair),
			place(times.shipClean, r.ship),
			place(approvals, r.park),
			place(times.lane, r.lane),
		]),
	);
	const shipped = shapes.filter((s) => s.lane.walk.status === "complete");
	const like = (test: (s: Shape) => boolean) => share(shipped.filter(test).length, shipped.length);
	console.log(`\nshipped lanes shaped like #559 (straight through): ${like(straight)}`);
	console.log(
		`like #625 (exactly one failed review, no park): ${like((s) => s.reviewFails === 1 && s.parks === 0 && s.budgetParks === 0)}; with a lap: ${like((s) => s.laps > 0)}`,
	);
	console.log(
		`like #623 (no failed review, parked once, for an approval in ship): ${like((s) => s.reviewFails === 0 && s.parks === 1 && stepsOf(s.lane).some((x) => x.entry.event === "BLOCKED" && x.to === "human:cp-approval"))}`,
	);
	console.log(`approval parks that cleared: ${spread(approvals).join(", ")}`);
	results.runs = runs.map((r) => ({
		run: r.run,
		firstBuildAt: rank(times.buildFirst, r.build * MIN),
		reviewAt: rank(times.review, r.review * MIN),
		repairAt: r.repair === null ? null : rank(times.buildRepair, r.repair * MIN),
		shipAt: rank(times.shipClean, r.ship * MIN),
		parkAt: r.park === null ? null : rank(approvals, r.park * MIN),
		laneAt: rank(times.lane, r.lane * MIN),
	}));
}

if (only === null) {
	const file = join(import.meta.dirname, "results", "lane-logs.json");
	writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
	console.log(`\nwrote ${file.replace(`${import.meta.dirname}/`, "experiments/")}`);
}
