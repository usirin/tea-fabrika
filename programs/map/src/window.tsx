import type {WindowProps} from "@kampus/fabrika";
import type {Ticket} from "@kampus/pipeline/tickets/ticket";
import {
	headOf,
	lineOf,
	type OpenAsk,
	openAsksOf,
	type StepNow,
	stepsOf,
	stepWords,
} from "@tea-fabrika/tracker";
import {
	BaseEdge,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	getStraightPath,
	Handle,
	type Node,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import {type ReactNode, type RefObject, useEffect, useRef} from "react";
import type {map} from "./index.ts";
import {
	type Family,
	familyOf,
	LEDGER_CALLS,
	PROGRAMS,
	type ProgramName,
	type ProgramNode,
	SPOTS,
	type Where,
	WIRES,
} from "./map.ts";

// The map's window: today's programs as boxes on a canvas (React Flow), each input on its left
// and each output on its right, shaped by what it carries. A typed wire is a curve from an
// output to an input; a `Ledger` call is a dotted line, since nothing is piped. The operate box
// holds the plan's nine spots, each lit by the ticket's facts: done, running, waiting on you,
// stuck, not run yet. Dashed means only that nothing does the step yet; a step that lives outside
// operate is solid, with a tag naming where.
// Boxes sit at fixed spots; the canvas pans and zooms, and fits the tile when the tile resizes.

type View = WindowProps<typeof map>["view"];

const SHAPES: {readonly [F in Family]: ReactNode} = {
	fact: <circle cx="5" cy="5" r="4" />,
	turn: <rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1.2" />,
	step: <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" />,
	checks: <path d="M5 0.9 9.3 8.9H0.7Z" />,
};

const FAMILY_WORDS: readonly (readonly [Family, string])[] = [
	["fact", "ticket"],
	["turn", "plan and ask"],
	["checks", "pull request"],
	["step", "run"],
];

function Shape({family}: {readonly family: Family}) {
	return (
		<svg className={`shape f-${family}`} viewBox="0 0 10 10" aria-hidden="true">
			{SHAPES[family]}
		</svg>
	);
}

const SPARK = (
	<svg viewBox="0 0 10 10" aria-hidden="true">
		<path d="M5 0.8 6.1 3.9 9.2 5 6.1 6.1 5 9.2 3.9 6.1 0.8 5 3.9 3.9Z" fill="currentColor" />
	</svg>
);

/** Where each box sits, and how wide it is: the round 6 layout. */
const AT: {readonly [N in ProgramName | "ledger"]: {x: number; y: number; w: number}} = {
	tracker: {x: 24, y: 24, w: 240},
	plan: {x: 24, y: 290, w: 240},
	deliver: {x: 24, y: 440, w: 240},
	asks: {x: 380, y: 24, w: 240},
	ledger: {x: 380, y: 452, w: 240},
	agent: {x: 380, y: 640, w: 240},
	operate: {x: 650, y: 24, w: 760},
	build: {x: 650, y: 500, w: 160},
	review: {x: 940, y: 500, w: 165},
	ship: {x: 1235, y: 500, w: 175},
};

/** Inputs fed by no wire, with where they come from instead. */
const FED: Partial<Record<string, string>> = {"tracker.do": "its window", "agent.inbox": "deliver"};

const fromOf = (program: ProgramName, port: string): string | null =>
	WIRES.find((w) => w.into[0] === program && w.into[1] === port)?.from[0] ??
	FED[`${program}.${port}`] ??
	null;

/** What one ticket's facts say, for the boxes. */
interface Lit {
	readonly number: number | null;
	readonly ticket: Ticket | null;
	readonly steps: readonly StepNow[];
	readonly asks: readonly OpenAsk[];
	readonly line: string;
}

const litOf = (view: View): Lit => {
	const ticket = view.ticket;
	if (ticket === null)
		return {
			number: view.number,
			ticket: null,
			steps: stepsOf([]),
			asks: [],
			line: view.ready ? `no ticket #${view.number ?? "?"}` : "reading the ledger",
		};
	const head = headOf(ticket.timeline, view.now);
	return {
		number: ticket.number,
		ticket,
		steps: stepsOf(ticket.timeline),
		asks: openAsksOf(ticket.timeline),
		line: lineOf(head, () => "a while ago"),
	};
};

interface ProgramData extends Record<string, unknown> {
	readonly program: ProgramNode;
	readonly body: ReactNode;
	readonly lit: boolean;
	readonly calls: boolean;
}

function In({program, name, type}: {program: ProgramName; name: string; type: string}) {
	const from = fromOf(program, name);
	const family = familyOf(type);
	return (
		<div className={`in f-${family}${from === null ? " nil" : ""}`}>
			<Handle type="target" position={Position.Left} id={`in-${name}`} className="port">
				<Shape family={family} />
			</Handle>
			<span className="trunc">
				{name}: {type}
			</span>
			{from === null ? null : <span className="from">from {from}</span>}
		</div>
	);
}

function Out({name, type}: {name: string; type: string}) {
	const family = familyOf(type);
	return (
		<div className={`outr f-${family}`}>
			{name}: {type}
			<Handle type="source" position={Position.Right} id={`out-${name}`} className="port">
				<Shape family={family} />
			</Handle>
		</div>
	);
}

/** The dotted line's end: where a box calls the ledger from. */
function CallHandle({at}: {at: Position}) {
	return <Handle type="source" position={at} id="call" className="call-h" isConnectable={false} />;
}

const CALL_FROM: Partial<Record<ProgramName, Position>> = {
	tracker: Position.Right,
	asks: Position.Bottom,
	operate: Position.Bottom,
	deliver: Position.Right,
	agent: Position.Top,
};

function ProgramBox({data}: NodeProps<Node<ProgramData>>) {
	const {program, body, lit, calls} = data;
	const call = CALL_FROM[program.name];
	// The asks box lists its outputs on one line: six would make it as tall as the canvas.
	const outsInline = program.name === "asks" || program.name === "ship";
	return (
		<section className={`node${lit ? " lit" : ""}`} aria-label={program.name}>
			<div className="node-h">
				<span className="n">{program.name}</span>
				<span className="sig">
					{program.at.replace(/^packages\/pipeline\/src\/|\/[^/]+$/g, "")}
				</span>
			</div>
			{program.ins.length > 0 ? (
				<div className="ins">
					{program.ins.map((p) => (
						<In key={p.name} program={program.name} name={p.name} type={p.type} />
					))}
				</div>
			) : null}
			<div className="node-b">{body}</div>
			{program.outs.length > 0 && !outsInline ? (
				<div className="outs">
					{program.outs.map((p) => (
						<Out key={p.name} name={p.name} type={p.type} />
					))}
				</div>
			) : null}
			{outsInline ? (
				<div className="outl">out: {program.outs.map((p) => p.name).join(", ")}</div>
			) : null}
			{calls && call !== undefined ? <CallHandle at={call} /> : null}
		</section>
	);
}

interface LedgerData extends Record<string, unknown> {
	readonly lit: Lit;
}

function LedgerBox({data}: NodeProps<Node<LedgerData>>) {
	const {lit} = data;
	const timeline = lit.ticket?.timeline ?? [];
	return (
		<section className="node store" aria-label="ledger">
			<Handle type="target" position={Position.Left} id="left" className="call-h" />
			<Handle type="target" position={Position.Top} id="top" className="call-h" />
			<Handle type="target" position={Position.Right} id="right" className="call-h" />
			<Handle type="target" position={Position.Bottom} id="bottom" className="call-h" />
			<div className="node-h">
				<span className="n">ledger</span>
				<span className="sig">a service, not a program</span>
			</div>
			<div className="node-b">
				<span className="mono trunc">
					{lit.number === null ? "tracker/ticket/…" : `tracker/ticket/${lit.number}/inbox`}
				</span>
				<span className="faint">
					{timeline.length} entries, last pos {timeline.at(-1)?.pos ?? "none"}
				</span>
				<span className="faint">asks keeps its facts here too</span>
			</div>
		</section>
	);
}

const whereWords = (where: Where): string => {
	switch (where.kind) {
		case "stepped":
			return `stepped by hand: ${where.by}`;
		case "apart":
			return `a ${where.as}, not in operate yet`;
		case "missing":
			return `not built: ${where.note}`;
	}
};

const usd = (n: number) => `$${n.toFixed(2)}`;

function Spot({step}: {readonly step: StepNow}) {
	const where = SPOTS[step.step];
	const cls = [
		"spot",
		where.kind === "missing" ? "nb nob" : "",
		step.state === "running" ? "run" : "",
		step.state === "you" ? "you" : "",
		step.state === "stuck" ? "stuck" : "",
	]
		.filter((c) => c !== "")
		.join(" ");
	return (
		<div className={cls} data-step={step.step}>
			<span className="n">
				{stepWords(step.step)}
				{where.kind === "apart" ? <span className="tag">in {where.in}</span> : null}
				{step.state === "done" ? (
					<span className="w-done" role="img" aria-label="done">
						✓
					</span>
				) : step.state === "you" ? (
					<span className="w-you">you</span>
				) : step.state === "running" ? (
					<span className="dot run live" role="img" aria-label="running" />
				) : step.state === "stuck" ? (
					<span className="w-stuck">stuck</span>
				) : null}
			</span>
			<span className="m2">{whereWords(where)}</span>
			<span className="m2">
				{step.runs === 0
					? step.step === "approval"
						? "a person answers"
						: "no run yet"
					: step.step === "approval"
						? `${step.runs} ${step.runs === 1 ? "ask" : "asks"}`
						: `${step.runs} ${step.runs === 1 ? "run" : "runs"}, ${usd(step.usd)}`}
			</span>
			<span className="st trunc">{step.last ?? ""}</span>
		</div>
	);
}

interface OperateData extends Record<string, unknown> {
	readonly lit: Lit;
}

function OperateFrame({data}: NodeProps<Node<OperateData>>) {
	const op = PROGRAMS.operate;
	return (
		<section className="frame" aria-label="operate">
			<Handle type="target" position={Position.Left} id="in-ticket" className="call-h" />
			<div className="frame-h">
				<span className="n">operate</span>
				<span className="sig">
					stages/operate · in {op.ins.map((p) => `${p.name}: ${p.type}`).join(", ")} · out{" "}
					{op.outs.map((p) => `${p.name}: ${p.type}`).join(", ")}
				</span>
				<span className="how">
					Holds each child's state and steps it by hand, as a library. No wires inside. A dashed
					spot is a step nothing does yet. A tag like "in plan" names where a step lives today,
					outside operate.
					{data.lit.number === null ? "" : ` Lit by #${data.lit.number}'s facts.`}
				</span>
			</div>
			<div className="spots">
				{data.lit.steps.map((s) => (
					<Spot key={s.step} step={s} />
				))}
			</div>
			<CallHandle at={Position.Bottom} />
		</section>
	);
}

function DeliverFrame() {
	const d = PROGRAMS.deliver;
	return (
		<section className="frame" aria-label="deliver">
			<div className="frame-h">
				<span className="n">deliver</span>
				<span className="sig">hosted</span>
				{d.ins.map((p) => (
					<span key={p.name} className="sig port-line">
						in {p.name}: {p.type}
					</span>
				))}
				{d.outs.map((p) => (
					<span key={p.name} className="sig port-line">
						out {p.name}: {p.type}
					</span>
				))}
				<span className="how">
					The other lane today. Its children are served on the ledger, each through its own agent
					program, told through an inbox, not a wire.
				</span>
			</div>
			<div className="chips">
				{["plan", "build", "review"].map((c) => (
					<div key={c} className="chip">
						<span className="n">{c}</span>
						<span className="ag">{SPARK}agent</span>
						<span className="faint trunc">in: inbox</span>
					</div>
				))}
			</div>
			<CallHandle at={Position.Right} />
		</section>
	);
}

interface WireData extends Record<string, unknown> {
	readonly type: string;
}

function WireEdge(props: EdgeProps<Edge<WireData>>) {
	const [path, x, y] = getBezierPath(props);
	const type = props.data?.type ?? "";
	const family = familyOf(type);
	return (
		<>
			<BaseEdge path={path} className={`wire f-${family}`} interactionWidth={12} />
			<EdgeLabelRenderer>
				<div
					className={`wl f-${family}`}
					style={{transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`}}
				>
					<Shape family={family} />
					{type}
				</div>
			</EdgeLabelRenderer>
		</>
	);
}

interface CallData extends Record<string, unknown> {
	readonly what: string;
}

function CallEdge(props: EdgeProps<Edge<CallData>>) {
	const [path, x, y] = getStraightPath(props);
	return (
		<>
			<BaseEdge path={path} className="call" interactionWidth={0} />
			<EdgeLabelRenderer>
				<div className="cl" style={{transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`}}>
					{props.data?.what}
				</div>
			</EdgeLabelRenderer>
		</>
	);
}

const NODE_TYPES = {
	program: ProgramBox,
	ledger: LedgerBox,
	operate: OperateFrame,
	deliver: DeliverFrame,
};
const EDGE_TYPES = {wire: WireEdge, call: CallEdge};

/** Which side of the ledger a box's dotted line lands on. */
const LANDS: Partial<Record<ProgramName, string>> = {
	tracker: "left",
	asks: "top",
	operate: "right",
	deliver: "left",
	agent: "bottom",
};

const placed = (name: ProgramName | "ledger") => {
	const at = AT[name];
	return {position: {x: at.x, y: at.y}, style: {width: at.w}};
};

function bodyOf(name: ProgramName, lit: Lit): ReactNode {
	const n = lit.number === null ? "" : `#${lit.number}`;
	switch (name) {
		case "tracker":
			return (
				<>
					<span className={`trunc${lit.asks.length > 0 ? " w-you" : ""}`}>
						<span className="mono">{n}</span> {lit.line}
					</span>
					<span className="faint">reads and writes the ledger</span>
				</>
			);
		case "plan": {
			const planned = lit.ticket?.timeline.findLast((e) => e.fact.type === "planned")?.fact;
			return planned?.type === "planned" ? (
				<span className="trunc">
					{n}: plan v{planned.version}, {planned.tasks.length}{" "}
					{planned.tasks.length === 1 ? "task" : "tasks"}
				</span>
			) : (
				<span className="faint">no plan yet</span>
			);
		}
		case "asks": {
			const ask = lit.asks[0];
			return ask === undefined ? (
				<span className="faint">nothing waits on you</span>
			) : (
				<span className="trunc w-you">
					<span className="mono">{ask.ask}</span> {ask.what}
				</span>
			);
		}
		case "agent":
			return <span className="faint">one per child of deliver; holds and charges its spend</span>;
		default:
			return <span className="faint">run alone and piped; not on {n || "this ticket"}'s path</span>;
	}
}

const BOXED: readonly ProgramName[] = [
	"tracker",
	"plan",
	"asks",
	"build",
	"review",
	"ship",
	"agent",
];

const nodesOf = (lit: Lit): Node[] => [
	...BOXED.map(
		(name): Node<ProgramData> => ({
			id: name,
			type: "program",
			...placed(name),
			data: {
				program: PROGRAMS[name],
				body: bodyOf(name, lit),
				lit: name === "asks" && lit.asks.length > 0,
				calls: LEDGER_CALLS.some((c) => c.from === name),
			},
		}),
	),
	{id: "ledger", type: "ledger", ...placed("ledger"), data: {lit}},
	{id: "operate", type: "operate", ...placed("operate"), data: {lit}},
	{id: "deliver", type: "deliver", ...placed("deliver"), data: {}},
];

const EDGES: readonly Edge[] = [
	...WIRES.map(
		(w): Edge<WireData> => ({
			id: `${w.from.join(".")}>${w.into.join(".")}`,
			type: "wire",
			source: w.from[0],
			sourceHandle: `out-${w.from[1]}`,
			target: w.into[0],
			targetHandle: `in-${w.into[1]}`,
			data: {
				type: PROGRAMS[w.from[0]].outs.find((p) => p.name === w.from[1])?.type ?? "",
			},
		}),
	),
	...LEDGER_CALLS.map(
		(c): Edge<CallData> => ({
			id: `${c.from}~ledger`,
			type: "call",
			source: c.from,
			sourceHandle: "call",
			target: "ledger",
			targetHandle: LANDS[c.from] ?? "top",
			data: {what: c.what},
			selectable: false,
		}),
	),
];

/** Fit the canvas to its tile, at start and whenever the tile changes size. */
function FitOnResize({box}: {readonly box: RefObject<HTMLDivElement | null>}) {
	const flow = useReactFlow();
	useEffect(() => {
		const el = box.current;
		if (el === null) return;
		const seen = new ResizeObserver(() => void flow.fitView({padding: 0.04}));
		seen.observe(el);
		return () => seen.disconnect();
	}, [box, flow]);
	return null;
}

function Bar({lit}: {readonly lit: Lit}) {
	const n = lit.number === null ? "the ticket" : `#${lit.number}`;
	return (
		<div className="mapbar">
			<span className="state" role="status">
				{lit.asks.length > 0 ? (
					<>
						<span className="dot you" aria-hidden="true" />
						<span>
							{n} waits on you in <span className="mono">asks</span>.
						</span>
					</>
				) : (
					<>
						<span className="dot" aria-hidden="true" />
						<span>
							{n}: {lit.line}.
						</span>
					</>
				)}
			</span>
			<span className="faint">
				{Object.keys(PROGRAMS).length} programs today · {WIRES.length} wires
			</span>
			<span className="legend">
				{FAMILY_WORDS.map(([family, words]) => (
					<span key={family}>
						<Shape family={family} />
						{words}
					</span>
				))}
				<span>
					<i className="svcl" aria-hidden="true" />
					service call, not a wire
				</span>
				<span>
					<i className="nbl" aria-hidden="true" />
					not built yet
				</span>
			</span>
		</div>
	);
}

export function MapWindow({view}: WindowProps<typeof map>) {
	const box = useRef<HTMLDivElement>(null);
	const lit = litOf(view);
	return (
		<section className="view map-view" aria-label="program map">
			<Bar lit={lit} />
			<div className="canvas" ref={box}>
				<ReactFlowProvider>
					<ReactFlow
						nodes={nodesOf(lit)}
						edges={[...EDGES]}
						nodeTypes={NODE_TYPES}
						edgeTypes={EDGE_TYPES}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable={false}
						fitView
						fitViewOptions={{padding: 0.04}}
						minZoom={0.3}
						maxZoom={2}
						colorMode="dark"
					>
						<FitOnResize box={box} />
					</ReactFlow>
				</ReactFlowProvider>
			</div>
		</section>
	);
}
