import {structuralHash} from "@demlik/tea";
import {criterionId} from "../ids.ts";
import {bodyText, messageText} from "../stages/build/body.ts";
import type {Built} from "../stages/build/form.ts";
import {
	type Build,
	type BuildCmd,
	build,
	copyTree,
	openPr,
	pushBranch,
	readTicket,
} from "../stages/build/machine.ts";
import {READY, type Ticket} from "../stages/build/ticket.ts";
import type {Criterion} from "../stages/review/pack.ts";
import {noRun, type Settings} from "../stages/review/reviewer.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	type Step,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The build machine under every order of messages. What matters here is the
// one channel an agent has into it: the builder's form (`build_built`). The
// laws say what that form may never do.

export type AnyBuildMsg = MsgOf<typeof build>;
type Msg = AnyBuildMsg;
const buildUpdate = stepOf<Build, Msg, BuildCmd>(build);

const NUMBER = 1;
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const CRITERIA: readonly [Criterion, ...Criterion[]] = [
	{id: criterionId("c1"), version: 1, text: "every window opens", checked: false, evidence: null},
	{id: criterionId("c2"), version: 1, text: "the door locks", checked: false, evidence: null},
];

const ticket = (patch: Partial<Ticket> = {}): Ticket => ({
	url: "T",
	number: NUMBER,
	state: "open",
	title: "windows",
	body: "b",
	labels: [READY],
	criteria: [...CRITERIA],
	prs: [],
	rules: [],
	...patch,
});

/** What a builder may hand back. */
export const BUILTS: Readonly<Record<string, Built>> = {
	plain: {summary: "Opens the windows.", deviations: [], ran: [], left: []},
	"met another way": {
		summary: "Opens the windows.",
		deviations: ["criterion c1 is met another way"],
		ran: [],
		left: [],
	},
	"left criterion 2": {
		summary: "Opens the windows.",
		deviations: [],
		ran: [],
		left: ["criterion c2"],
	},
	"names another ticket": {
		summary: "Opens the windows. Also fixes #2.",
		deviations: [],
		ran: [],
		left: [],
	},
	/** Every other list the text is made from, each closing a ticket another way GitHub reads. */
	"closes in its lists": {
		summary: "Opens the windows.",
		deviations: ["Resolves: GH-2, done here instead"],
		ran: [{command: "fix https://github.com/example/repo/issues/3", passed: true}],
		left: ["closed example/other#4"],
	},
};

const UNKNOWN = {_tag: "unknown" as const};

export function buildWorld(options: {readonly echoes?: boolean} = {}): World<Build, Msg, BuildCmd> {
	return {
		outside: (s) => {
			const runs = s.phase === "building" ? [s.run, s.run - 1] : [1];
			return [
				{
					type: "start",
					ask: {ticket: "T", number: NUMBER, round: 1, open: []},
					settings: SETTINGS,
					session: "x",
				},
				{type: "resume"},
				...runs.flatMap((run): Msg[] => [
					...Object.values(BUILTS).map(
						(built): Msg => ({type: "build_built", ticket: "T", round: 1, run, built, ran: noRun}),
					),
					{type: "build_failed", ticket: "T", round: 1, run, why: "broke", error: null, ran: noRun},
				]),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "build_ticket":
					return [
						readTicket.ok(cmd, ticket(), 0),
						readTicket.ok(cmd, ticket({prs: [{url: "P", state: "open", head: "A"}]}), 0),
						readTicket.ok(cmd, ticket({state: "closed"}), 0),
						readTicket.err(cmd, UNKNOWN, 0),
					];
				case "build_copy":
					return [
						copyTree.ok(cmd, {tree: "w", branch: "build/1", base: "base"}, 0),
						copyTree.err(cmd, UNKNOWN, 0),
					];
				case "build_push":
					return [
						pushBranch.ok(cmd, {head: "A", changed: true}, 0),
						pushBranch.ok(cmd, {head: "base", changed: false}, 0),
						pushBranch.err(cmd, UNKNOWN, 0),
					];
				case "build_open":
					return [openPr.ok(cmd, "P", 0), openPr.err(cmd, UNKNOWN, 0)];
			}
		},
		restart: (msg) => msg.type === "resume",
		...(options.echoes === undefined ? {} : {echoes: options.echoes}),
	};
}

/**
 * The tickets a text names with a closing word, as GitHub reads them: a
 * closing word, an optional colon, then `#n`, `owner/repo#n`, `GH-n`, or the
 * ticket's url. Each as `#n`, or `owner/repo#n` for another repository's.
 */
export const closes = (text: string): readonly string[] =>
	[
		...text.matchAll(
			/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:([\w.-]+\/[\w.-]+)#|#|gh-|https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/)(\d+)\b/gi,
		),
	]
		.map((m) => `${m[1] ?? m[2] ?? ""}#${m[3]}`)
		.sort();

/**
 * What a write of the build would close, if it landed: its text, as the one
 * writer the handlers use makes it. `null`: the Cmd writes no text.
 */
const closedBy = (
	cmd: BuildCmd,
): {readonly what: string; readonly named: readonly string[]} | null => {
	switch (cmd.type) {
		case "build_open":
			return {what: "the pull request's text", named: closes(bodyText(cmd.body))};
		case "build_push":
			return {what: "the commit message", named: closes(messageText(cmd.message))};
		default:
			return null;
	}
};

const criteriaIn = (s: Build): readonly Criterion[] | null => ("criteria" in s ? s.criteria : null);

export function buildLaws<S extends Build>(): readonly Law<S, Msg, BuildCmd>[] {
	return [
		watched<S, Msg, BuildCmd, readonly Criterion[] | null>(
			"a builder's form never changes a criterion",
			null,
			(read, step) => {
				const ticketRead =
					step.msg.type === "build_ticket_ok" && step.prev.phase === "reading"
						? step.msg.value.criteria
						: read;
				const now = criteriaIn(step.next);
				if (now !== null && structuralHash(now) !== structuralHash(ticketRead))
					return broke(
						`after ${step.msg.type} the criteria are ${now.map((c) => c.id).join(", ") || "none"}, and the ticket's are ${(ticketRead ?? []).map((c) => c.id).join(", ")}`,
					);
				return ticketRead;
			},
		),
		law<S, Msg, BuildCmd>("the pull request closes its own ticket and no other", (step) => {
			for (const cmd of step.cmds) {
				const closed = closedBy(cmd);
				if (closed === null) continue;
				// The commit lands too: its message may close nothing, so the pull request's text alone says what closes.
				const owed = cmd.type === "build_open" ? [`#${cmd.number}`] : [];
				if (closed.named.join(" ") !== owed.join(" "))
					return `${closed.what} closes ${closed.named.join(", ") || "nothing"}, and it owes ${owed.join(", ") || "nothing"}`;
			}
			return null;
		}),
		law<S, Msg, BuildCmd>("an ended build sends nothing", (step: Step<S, Msg, BuildCmd>) =>
			step.prev.phase === "over" && step.cmds.length > 0
				? `${step.cmds.map((c) => c.type).join(", ")} after the build ended`
				: null,
		),
	];
}

export const buildInit: Build = {phase: "idle"};
export const buildStep: Update<Build, Msg, BuildCmd> = buildUpdate;

export function showBuildMsg(m: Msg): string {
	switch (m.type) {
		case "build_ticket_ok":
			return `ticket read: ${m.value.state}, ${m.value.prs.length} pull request(s)`;
		case "build_built": {
			const name = Object.entries(BUILTS).find(
				([, b]) => structuralHash(b) === structuralHash(m.built),
			)?.[0];
			return `builder hands back "${name ?? "?"}" (run ${m.run})`;
		}
		case "build_push_ok":
			return `pushed ${m.value.head}${m.value.changed ? "" : ", nothing new"}`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** The builder's "left" list descopes the criteria it names. */
export const leftDescopes: Update<Build, Msg, BuildCmd> = (s, m) => {
	const [next, cmds] = buildUpdate(s, m);
	if (m.type !== "build_built" || next.phase !== "pushing") return [next, cmds];
	const [first, ...rest] = next.criteria.filter(
		(c) => !m.built.left.some((left) => left.includes(`criterion ${c.id}`)),
	);
	return first === undefined ? [next, cmds] : [{...next, criteria: [first, ...rest]}, cmds];
};

/** A restart after the end reads the ticket again. */
export const actsAfterTheEnd: Update<Build, Msg, BuildCmd> = (s, m) =>
	s.phase === "over" && m.type === "resume"
		? [s, [readTicket({ticket: "T", number: NUMBER})]]
		: buildUpdate(s, m);
