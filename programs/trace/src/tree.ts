import {ATTR, type JobTrace, type Span, type Step} from "@kampus/fabrika";

// A job's record as one tree, the way the tile opens it: the job, its spans nested by parent,
// each run's machine runs under the run's span, each machine run's steps under it, and an
// agent's turns folded into one row. Pure: the machine asks it which rows exist, the view asks it
// which rows show.
//
//   treeOf(TALLY)                      // seq --to 3 | tally
//   // job "seq --to 3 | tally"
//   //   run seq    seq-3f9a1c02
//   //   run tally  tally-5d02c7a1
//   //     machine "count total"        its span, with the msg events as dots
//   //       step "add 1", step "add 2", step "add 3"
//
// Nothing is left out. A span whose parent is not in the record hangs off the job; a run with no
// span (its exporter never sent one) gets a row of its own; a machine run's steps hang off its
// run's span, or off that run's row.

/** One row of the tree, whatever it holds. */
export type Kind = "job" | "span" | "run" | "turns" | "machine" | "step";

/** What a row stands for, so its detail can be drawn. */
export type Of =
	| {readonly kind: "span"; readonly span: Span}
	| {
			readonly kind: "machine";
			readonly run: string;
			readonly machine: string;
			readonly id: string;
			readonly steps: readonly Step[];
			readonly span: Span | null;
	  }
	| {readonly kind: "step"; readonly step: Step; readonly before: Step | null}
	| {readonly kind: "group"};

export interface Node {
	/** Unique in the tree: what the open rows and the chosen row name. The root's is `job`. */
	readonly key: string;
	readonly kind: Kind;
	readonly name: string;
	/** Said beside the name, fainter: a run's id, a step's number. */
	readonly note: string;
	/** Whose it is: one colour per service, as a trace viewer lists spans. */
	readonly service: string;
	/** Unix ms. A step is a moment: `from` is `to`. */
	readonly from: number;
	readonly to: number;
	/** It went wrong: a span with an error status, a failed run, a failed job. Drawn red. */
	readonly wrong: boolean;
	/** The moments inside it, drawn as dots: `told add`, `sent total`, `msg add`. */
	readonly events: readonly {readonly name: string; readonly at: number}[];
	readonly of: Of;
	readonly children: readonly Node[];
}

/** The root's key: the job's row, open when the trace is first read. */
export const JOB = "job";

/** OpenTelemetry's GenAI name for what an agent span did: `chat` is a turn. */
const OP = "gen_ai.operation.name";

const isTurn = (s: Span) => s.tags[OP] === "chat" || s.tags[OP] === "execute_tool";

const runOf = (s: Span): string | null => {
	const run = s.tags[ATTR.run];
	return typeof run === "string" ? run : null;
};

/** A run's program, from its id: `tally-5d02c7a1` is tally's. For a run no span names. */
const programOf = (run: string) => run.replace(/-[^-]*$/, "");

const byFrom = (a: Node, b: Node) => a.from - b.from;

const stepKey = (s: Step) => `step:${JSON.stringify([s.run, s.machine, s.id, s.n])}`;
const machineKey = (run: string, machine: string, id: string) =>
	`machine:${JSON.stringify([run, machine, id])}`;

/** How a Msg reads in one line: its type, then each plain field. `{type: "add", n: 2}` is `add 2`. */
export const msgName = (msg: unknown): string => {
	if (typeof msg !== "object" || msg === null) return JSON.stringify(msg) ?? String(msg);
	const {type, ...rest} = msg as {readonly type?: unknown; readonly [k: string]: unknown};
	const plain = Object.values(rest).map((v) =>
		typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "…",
	);
	return [typeof type === "string" ? type : "msg", ...plain].join(" ");
};

const leaf = (s: Span): Node => ({
	key: `span:${s.span}`,
	kind: "span",
	name: s.name,
	note: "",
	service: s.service,
	from: s.start,
	to: s.end,
	wrong: s.status === "error",
	events: s.events.map((e) => ({name: e.name, at: e.at})),
	of: {kind: "span", span: s},
	children: [],
});

/** The job's record as one tree, with the job at its root. */
export const treeOf = (trace: JobTrace): Node => {
	const spans = trace.spans.toSorted((a, b) => a.start - b.start);
	const ids = new Set(spans.map((s) => s.span));
	/** Each span's children, by its id; `null` holds the roots and the spans whose parent is missing. */
	const kids = new Map<string | null, Span[]>();
	for (const s of spans) {
		const parent = s.parent !== null && ids.has(s.parent) ? s.parent : null;
		kids.set(parent, [...(kids.get(parent) ?? []), s]);
	}
	/** Each run's machine runs, in the order their first step came, with their steps. */
	const machines = new Map<string, Map<string, Step[]>>();
	for (const step of trace.steps.toSorted((a, b) => a.at - b.at || a.n - b.n)) {
		const of = machines.get(step.run) ?? new Map<string, Step[]>();
		const key = machineKey(step.run, step.machine, step.id);
		of.set(key, [...(of.get(key) ?? []), step]);
		machines.set(step.run, of);
	}
	const failed = new Set(trace.runs.filter((r) => r.status === "failed").map((r) => r.run));

	/** A run's machine runs, each with its steps, and the machine spans they took over. */
	const machinesOf = (run: string, service: string, under: readonly Span[]) => {
		const used = new Set<string>();
		const runs = [...(machines.get(run)?.values() ?? [])];
		const nodes = runs.map((steps): Node => {
			const first = steps[0] as Step;
			const last = steps.at(-1) as Step;
			// Its own span: the one child span of the run for this machine, while the run has one
			// copy of it. With two copies, nothing says which span is whose, so the steps stand alone.
			const own = under.filter((c) => c.tags[ATTR.machine] === first.machine);
			const copies = runs.filter((r) => r[0]?.machine === first.machine).length;
			const span = own.length === 1 && copies === 1 ? (own[0] as Span) : null;
			if (span !== null) used.add(span.span);
			const key = machineKey(run, first.machine, first.id);
			return {
				key,
				kind: "machine",
				name: `${first.machine} ${first.id}`,
				note: `${steps.length} ${steps.length === 1 ? "step" : "steps"}`,
				service,
				from: span?.start ?? first.at,
				to: span?.end ?? last.at,
				wrong: span?.status === "error",
				events: span?.events.map((e) => ({name: e.name, at: e.at})) ?? [],
				of: {kind: "machine", run, machine: first.machine, id: first.id, steps, span},
				children: steps.map(
					(step, i): Node => ({
						key: stepKey(step),
						kind: "step",
						name: msgName(step.msg),
						note: `step ${step.n}`,
						service,
						from: step.at,
						to: step.at,
						wrong: false,
						events: [],
						of: {kind: "step", step, before: steps[i - 1] ?? null},
						children: [],
					}),
				),
			};
		});
		return {nodes, used};
	};

	/** An agent's turns and tool calls, folded into one row under the span they ran in. */
	const turnsOf = (parent: Span, turns: readonly Span[]): Node => {
		const chats = turns.filter((t) => t.tags[OP] === "chat").length;
		const tools = turns.length - chats;
		return {
			key: `turns:${parent.span}`,
			kind: "turns",
			name: `${chats} ${chats === 1 ? "turn" : "turns"}`,
			note: tools === 0 ? "" : `${tools} tool ${tools === 1 ? "call" : "calls"}`,
			service: parent.service,
			from: Math.min(...turns.map((t) => t.start)),
			to: Math.max(...turns.map((t) => t.end)),
			wrong: turns.some((t) => t.status === "error"),
			events: [],
			of: {kind: "group"},
			children: turns.map(leaf),
		};
	};

	const spanNode = (s: Span): Node => {
		const children = kids.get(s.span) ?? [];
		const run = runOf(s);
		const owned =
			run === null ? {nodes: [], used: new Set<string>()} : machinesOf(run, s.service, children);
		const turns = children.filter(isTurn);
		const rest = children.filter((c) => !isTurn(c) && !owned.used.has(c.span));
		return {
			...leaf(s),
			kind: run === null ? "span" : "run",
			name: run === null ? s.name : s.service,
			note: run ?? "",
			wrong: s.status === "error" || (run !== null && failed.has(run)),
			children: [
				...owned.nodes,
				...rest.map(spanNode),
				...(turns.length === 0 ? [] : [turnsOf(s, turns)]),
			].toSorted(byFrom),
		};
	};

	// Runs that no span names: their record and steps still show, on a row of their own.
	const spanned = new Set(spans.flatMap((s) => runOf(s) ?? []));
	const alone = [...new Set([...trace.runs.map((r) => r.run), ...machines.keys()])]
		.filter((run) => !spanned.has(run))
		.map((run): Node => {
			const owned = machinesOf(run, programOf(run), []).nodes;
			const at = owned[0]?.from ?? trace.job?.started ?? spans[0]?.start ?? 0;
			return {
				key: `run:${run}`,
				kind: "run",
				name: programOf(run),
				note: `${run}, no span`,
				service: programOf(run),
				from: at,
				to: Math.max(at, ...owned.map((m) => m.to)),
				wrong: failed.has(run),
				events: [],
				of: {kind: "group"},
				children: owned,
			};
		});

	const roots = kids.get(null) ?? [];
	const jobWrong = trace.job?.ended?.how === "failed";
	const [only] = roots;
	if (roots.length === 1 && only !== undefined) {
		const node = spanNode(only);
		return {
			...node,
			key: JOB,
			kind: "job",
			wrong: node.wrong || jobWrong,
			children: [...node.children, ...alone].toSorted(byFrom),
		};
	}
	const children = [...roots.map(spanNode), ...alone].toSorted(byFrom);
	const from =
		trace.job?.started ?? (children.length === 0 ? 0 : Math.min(...children.map((c) => c.from)));
	return {
		key: JOB,
		kind: "job",
		name: trace.job?.text ?? "job",
		note: "",
		service: children[0]?.service ?? "tsh",
		from,
		to: Math.max(from, trace.job?.ended?.at ?? from, ...children.map((c) => c.to)),
		wrong: jobWrong || children.some((c) => c.wrong),
		events: [],
		of: {kind: "group"},
		children,
	};
};

/** Every row in the tree, the root first, depth first. */
export const nodesOf = (root: Node): readonly Node[] => [root, ...root.children.flatMap(nodesOf)];

/** The rows that group others: the only rows that open. */
export const groupsOf = (root: Node): ReadonlySet<string> =>
	new Set(nodesOf(root).flatMap((n) => (n.children.length > 0 ? [n.key] : [])));

/** The row with `key`, wherever it is. */
export const findOf = (root: Node, key: string): Node | undefined =>
	nodesOf(root).find((n) => n.key === key);
