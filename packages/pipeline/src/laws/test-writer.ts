import {structuralHash} from "@demlik/tea";
import {noSpend, type Spend} from "@kampus/fabrika/agents/claude";
import type {Checked} from "../stages/test-writer/checked.ts";
import {
	commitTests,
	MAX_RESTARTS,
	onBase,
	readChecked,
	readTaken,
	recordFacts,
	runSub,
	type TestWriter,
	type TestWriterCmd,
	testWriter,
} from "../stages/test-writer/machine.ts";
import {ASK, COMMIT, GOOD, pid, TAKEN} from "../stages/test-writer/scripted.ts";
import type {Written} from "../stages/test-writer/written.ts";
import {problemsOf} from "../stages/test-writer/written.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
	type World,
	watched,
} from "./explore.ts";

// The test writer under every order of messages: its world and its laws.
//
// The world reads the files at the base, commits, runs and records, and
// answers each of those well or badly, in any order, and may restart. The
// writer is a Sub: while a draft is asked for, it may send a tool call, a
// draft (one that passes the Check, one that edits a file that exists, one
// that tests nothing, one that did not fit), or a failure. A late Msg from
// the first run may come at any time.

export type AnyTestWriterMsg = MsgOf<typeof testWriter>;
type Msg = AnyTestWriterMsg;
const update = stepOf<TestWriter, Msg, TestWriterCmd>(testWriter);

const TRIES = 2;
const KEY = "k";
const SPENT: Spend = {...noSpend, costUsd: 1, turns: 1};

/** What the writer may hand back, by a short name. */
export const DRAFTS: Readonly<Record<string, Written | null>> = {
	good: GOOD,
	"edits a test": {
		...GOOD,
		files: [{path: TAKEN[0] ?? "", text: "changed"}],
	},
	"tests nothing": {
		files: [],
		answers: [
			{property: pid("p1"), kind: "cannot", why: "x"},
			{property: pid("p2"), kind: "cannot", why: "y"},
		],
	},
	"no fit": null,
};

const runIdOf = (s: TestWriter): string | null => runSub.deps(s)?.id ?? null;
const FIRST_RUN = `${KEY}/1`;

const result = (p1: "red" | "green", p2: "red" | "green") => [
	{property: pid("p1"), result: p1},
	{property: pid("p2"), result: p2},
];

export function testWriterWorld(): World<TestWriter, Msg, TestWriterCmd> {
	return {
		outside: (s) => {
			const current = runIdOf(s);
			const ids = [...new Set([...(current === null ? [] : [current]), FIRST_RUN])];
			return [
				{type: "start", ask: {...ASK, tries: TRIES}, key: KEY},
				{type: "resume"},
				...ids.flatMap((id): Msg[] => [
					{type: "tests_write_tool", key: KEY, id, tool: "Read"},
					...Object.values(DRAFTS).map(
						(output): Msg => ({
							type: "tests_write_finished",
							key: KEY,
							id,
							output,
							session: "s",
							spend: SPENT,
						}),
					),
					{type: "tests_write_failed", key: KEY, id, error: "boom", spend: SPENT},
				]),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "tests_taken":
					return [readTaken.ok(cmd, TAKEN, 0), readTaken.err(cmd, {_tag: "unknown"}, 0)];
				case "tests_commit":
					return [commitTests.ok(cmd, COMMIT, 0), commitTests.err(cmd, {_tag: "unknown"}, 0)];
				case "tests_on_base":
					return [
						onBase.ok(cmd, result("red", "green"), 0),
						onBase.ok(cmd, result("green", "red"), 0),
						onBase.ok(cmd, result("red", "green").slice(1), 0),
						onBase.err(cmd, {_tag: "could_not_run"}, 0),
					];
				case "tests_record":
					return [recordFacts.ok(cmd, null, 0), recordFacts.err(cmd, {_tag: "unknown"}, 0)];
				case "tests_checked":
					return [
						readChecked.ok(cmd, wroteFor(cmd.head), 0),
						readChecked.ok(cmd, [], 0),
						readChecked.err(cmd, {_tag: "unknown"}, 0),
					];
			}
		},
		restart: (msg) => msg.type === "resume",
	};
}

/** What the ledger shows after a good write: both results as the plan says. */
const wroteFor = (head: string): readonly Checked[] =>
	result("red", "green").map((r) => ({
		fact: "checked",
		property: r.property,
		version: ASK.plan.version,
		head,
		tool: "test",
		result: r.result,
	}));

const briefOf = (s: TestWriter) => (s.phase === "writing" ? s.brief : null);

export function testWriterLaws<S extends TestWriter>(): readonly Law<S, Msg, TestWriterCmd>[] {
	return [
		watched<S, Msg, TestWriterCmd, ReturnType<typeof briefOf>>(
			"nothing is committed that the Check did not pass",
			null,
			(brief, {next, cmds}) => {
				const now = briefOf(next) ?? brief;
				for (const cmd of cmds) {
					if (cmd.type !== "tests_commit") continue;
					if (now === null) return broke("a commit with no brief");
					const draft = next.phase === "committing" ? next.written : null;
					if (draft === null || problemsOf(draft, now).length > 0)
						return broke("committed a draft the Check fails");
				}
				return now;
			},
		),
		law<S, Msg, TestWriterCmd>(
			"done only with a commit, every result recorded and read back, and nothing to ask",
			({prev, next}) => {
				if (next.phase !== "over" || prev.phase === "over" || next.outcome.kind !== "done")
					return null;
				const {report} = next;
				if (report.commit === null) return "done with no commit";
				if (report.found.length > 0) return `done with ${report.found.length} surprises`;
				return report.checked.length === ASK.properties.length
					? null
					: `done with ${report.checked.length} results of ${ASK.properties.length}`;
			},
		),
		law<S, Msg, TestWriterCmd>("an ask names a surprise of that kind", ({prev, next}) => {
			if (next.phase !== "over" || prev.phase === "over" || next.outcome.kind !== "ask")
				return null;
			const {outcome, report} = next;
			return report.found.some((f) => f.for === outcome.for)
				? null
				: `asked ${outcome.for} with none found`;
		}),
		law<S, Msg, TestWriterCmd>(
			"a writer Msg counts only for the run asked for",
			({prev, msg, next}) =>
				(msg.type === "tests_write_finished" || msg.type === "tests_write_failed") &&
				msg.id !== runIdOf(prev) &&
				structuralHash(prev) !== structuralHash(next)
					? `${msg.type} from run ${msg.id} was taken while ${runIdOf(prev) ?? "no run"} was asked for`
					: null,
		),
		law<S, Msg, TestWriterCmd>("tries never pass the limit asked", ({next}) => {
			const tries =
				next.phase === "writing"
					? next.refining.tries
					: next.phase === "over"
						? next.report.tries
						: 0;
			return tries > TRIES ? `try ${tries} of ${TRIES}` : null;
		}),
		law<S, Msg, TestWriterCmd>(
			"the writer is started over at most once a restart allows",
			({next}) =>
				next.phase === "writing" && next.restarts > MAX_RESTARTS
					? `started over ${next.restarts} times`
					: null,
		),
		watched<S, Msg, TestWriterCmd, number>(
			"every dollar the writer spent is in the report",
			0,
			(spent, {prev, msg, next}) => {
				const took =
					(msg.type === "tests_write_finished" || msg.type === "tests_write_failed") &&
					structuralHash(prev) !== structuralHash(next);
				const now = took ? spent + msg.spend.costUsd : spent;
				if (next.phase !== "over" || prev.phase === "over") return now;
				return next.report.costUsd === now
					? now
					: broke(`${now} spent, and the report says ${next.report.costUsd}`);
			},
		),
		law<S, Msg, TestWriterCmd>("an ended run sends nothing", ({prev, cmds}) =>
			prev.phase === "over" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after the run ended`
				: null,
		),
	];
}

export const testWriterInit: TestWriter = {phase: "idle"};
export const testWriterStep: Update<TestWriter, Msg, TestWriterCmd> = update;

const draftName = (output: Written | null) =>
	Object.entries(DRAFTS).find(([, d]) => structuralHash(d) === structuralHash(output))?.[0] ?? "?";

export function showTestWriterMsg(m: Msg): string {
	switch (m.type) {
		case "tests_write_finished":
			return `run ${m.id}: draft "${draftName(m.output)}"`;
		case "tests_write_failed":
			return `run ${m.id} failed: ${m.error}`;
		case "tests_write_tool":
			return `run ${m.id}: tool`;
		case "tests_on_base_ok":
			return `on base: ${m.value.map((r) => `${r.property} ${r.result}`).join(", ")}`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** A surprise is taken as done. */
export const doneWithSurprise: Update<TestWriter, Msg, TestWriterCmd> = (s, m) => {
	const [next, cmds] = update(s, m);
	return next.phase === "over" && next.outcome.kind === "ask"
		? [{...next, outcome: {kind: "done", part: false, commit: COMMIT}}, cmds]
		: [next, cmds];
};

/** A writer Msg is taken whatever run it is from. */
export const takesAnyRun: Update<TestWriter, Msg, TestWriterCmd> = (s, m) => {
	if (
		(m.type === "tests_write_finished" || m.type === "tests_write_failed") &&
		s.phase === "writing"
	) {
		const id = runIdOf(s);
		return id === null ? update(s, m) : update(s, {...m, id});
	}
	return update(s, m);
};

/** What is committed is not the draft the Check passed. */
export const commitsAnotherDraft: Update<TestWriter, Msg, TestWriterCmd> = (s, m) => {
	const [next, cmds] = update(s, m);
	const other = DRAFTS["edits a test"];
	return next.phase === "committing" && other !== null && other !== undefined
		? [{...next, written: other}, cmds]
		: [next, cmds];
};

/** A failed run's spend is left out of the report. */
export const dropsAFailedSpend: Update<TestWriter, Msg, TestWriterCmd> = (s, m) =>
	m.type === "tests_write_failed" ? update(s, {...m, spend: noSpend}) : update(s, m);
