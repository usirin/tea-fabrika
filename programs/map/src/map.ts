import type {StepName} from "@tea-fabrika/tracker";

// Today's programs as data: each one's name, where it lives, its inputs and outputs by their
// names and schema names, and the wires that exist in code. No program is imported here, so the
// window's page never loads one: ./map.test.ts imports them all and checks every name against
// its `defineProgram`, and every wire with `fit`.
//
//   PROGRAMS.plan   {name: "plan", at: "packages/pipeline/src/stages/plan/program.ts",
//                    ins: [{name: "ticket", type: "TicketUrl"}], outs: [{name: "planned", type: "Planned"}]}
//   WIRES[0]        {from: ["plan", "planned"], into: ["asks", "planned"], why: "..."}
//
// A wire is typed: one program's output piped into another's input. A service call is not a
// wire: a program asks the `Ledger` service, and every program that does is a dotted line to it.

/** One input or output: its name in `defineProgram`, and the name of its schema in the source. */
export interface Port {
	readonly name: string;
	readonly type: string;
}

export type ProgramName =
	| "tracker"
	| "plan"
	| "asks"
	| "operate"
	| "build"
	| "review"
	| "ship"
	| "deliver"
	| "agent";

export interface ProgramNode {
	readonly name: ProgramName;
	/** Its file, from the repository's root. */
	readonly at: string;
	readonly ins: readonly Port[];
	readonly outs: readonly Port[];
}

const port = (name: string, type: string): Port => ({name, type});

const PIPELINE = "packages/pipeline/src";

export const PROGRAMS: {readonly [N in ProgramName]: ProgramNode & {readonly name: N}} = {
	tracker: {
		name: "tracker",
		at: "programs/tracker/src/index.ts",
		ins: [
			port("file", "File"),
			port("comment", "Comment"),
			port("close", "OneTicket"),
			port("reopen", "OneTicket"),
			port("answer", "Answer"),
			port("rate_duplicate", "RateDuplicate"),
			port("query", "Query"),
			port("quit", "Null"),
		],
		outs: [port("ticket", "TicketNumber")],
	},
	plan: {
		name: "plan",
		at: `${PIPELINE}/stages/plan/program.ts`,
		ins: [port("ticket", "TicketUrl")],
		outs: [port("planned", "Planned")],
	},
	asks: {
		name: "asks",
		at: `${PIPELINE}/asks/program.ts`,
		ins: [
			port("planned", "Planned"),
			port("revised", "Revised"),
			port("reviewed", "Reviewed"),
			port("ruling", "Ruling"),
			port("answer", "Answer"),
			port("build", "Build"),
			port("cleared", "Cleared"),
			port("raise", "Raise"),
		],
		outs: [
			port("ask", "AskShape"),
			port("settled", "Settled"),
			port("refused", "Refused"),
			port("waiting", "Waiting"),
			port("built", "Built"),
			port("ship", "BuildRef"),
		],
	},
	operate: {
		name: "operate",
		at: `${PIPELINE}/stages/operate/program.ts`,
		ins: [port("ticket", "TicketUrl")],
		outs: [port("step", "Step"), port("ended", "Ended")],
	},
	build: {
		name: "build",
		at: `${PIPELINE}/stages/build/program.ts`,
		ins: [port("ticket", "TicketUrl")],
		outs: [port("built", "Built"), port("opened", "PullRequestUrl")],
	},
	review: {
		name: "review",
		at: `${PIPELINE}/stages/review/program.ts`,
		ins: [port("pr", "ReviewTarget")],
		outs: [port("verdict", "Reviewed"), port("passed", "Passed"), port("note", "Filed")],
	},
	ship: {
		name: "ship",
		at: `${PIPELINE}/stages/ship/program.ts`,
		ins: [port("pr", "Told"), port("ask", "Ask"), port("forget", "Forget")],
		outs: [
			port("found", "Look"),
			port("outcome", "Shipped"),
			port("answer", "Answer"),
			port("forgot", "Forget"),
		],
	},
	deliver: {
		name: "deliver",
		at: `${PIPELINE}/hosted/deliver-program.ts`,
		ins: [port("plan", "TicketUrl")],
		outs: [port("delivered", "Delivered")],
	},
	agent: {
		name: "agent",
		at: `${PIPELINE}/hosted/agent.ts`,
		ins: [port("inbox", "envelope")],
		outs: [],
	},
};

/** One typed wire: an output piped into an input, as the source says to. */
export interface Wire {
	readonly from: readonly [ProgramName, string];
	readonly into: readonly [ProgramName, string];
	/** Where the source says so, in its own words. */
	readonly why: string;
}

export const WIRES: readonly Wire[] = [
	{
		from: ["plan", "planned"],
		into: ["asks", "planned"],
		why: "asks takes the plan stage's own Planned",
	},
	{
		from: ["build", "opened"],
		into: ["review", "pr"],
		why: "build's opened says: pipe it into review's pr",
	},
	{
		from: ["review", "passed"],
		into: ["ship", "pr"],
		why: "review's passed says: pipe it into ship's pr",
	},
];

/** A program that asks the `Ledger` service, and what for. Not a wire: nothing is piped. */
export interface Call {
	readonly from: ProgramName;
	readonly what: string;
}

export const LEDGER_CALLS: readonly Call[] = [
	{from: "tracker", what: "reads, writes"},
	{from: "asks", what: "keeps its facts"},
	{from: "operate", what: "claims a lane"},
	{from: "deliver", what: "serves its children"},
	{from: "agent", what: "its inbox, its spend"},
];

/**
 * Where each of the plan's nine steps lives today, from the operate program's point of view.
 * `stepped`: operate holds it and steps it by hand, as a library. `apart`: it exists, but outside
 * operate, as a machine or a program, `in` the place named. `missing`: nothing in code does it yet.
 */
export type Where =
	| {readonly kind: "stepped"; readonly by: string}
	| {readonly kind: "apart"; readonly as: "machine" | "program"; readonly in: string}
	| {readonly kind: "missing"; readonly note: string};

export const SPOTS: {readonly [S in StepName]: Where} = {
	triage: {kind: "apart", as: "program", in: "stages/sort"},
	plan: {kind: "apart", as: "program", in: "plan"},
	approval: {kind: "apart", as: "program", in: "asks"},
	test_writer: {kind: "apart", as: "program", in: "stages/test-writer"},
	build: {kind: "stepped", by: "the build machine"},
	mutation: {kind: "apart", as: "program", in: "stages/mutation"},
	review: {kind: "stepped", by: "the review machine"},
	push: {kind: "apart", as: "program", in: "stages/push"},
	merge: {kind: "stepped", by: "the ship machine"},
};

/** The family a schema's name belongs to, which picks its port's shape and colour. */
export type Family = "fact" | "turn" | "checks" | "step";

const FAMILIES: {readonly [F in Family]: ReadonlySet<string>} = {
	fact: new Set(["TicketUrl", "File", "Comment", "OneTicket", "RateDuplicate"]),
	turn: new Set([
		"Planned",
		"Revised",
		"AskShape",
		"Answer",
		"Settled",
		"Refused",
		"Waiting",
		"Ruling",
	]),
	checks: new Set([
		"PullRequestUrl",
		"Passed",
		"Told",
		"ReviewTarget",
		"Reviewed",
		"Shipped",
		"Look",
		"Filed",
		"Ask",
		"Forget",
	]),
	step: new Set(),
};

/** A ticket, a plan or an ask, a pull request, or a run's own step. */
export const familyOf = (type: string): Family =>
	(["fact", "turn", "checks"] as const).find((f) => FAMILIES[f].has(type)) ?? "step";
