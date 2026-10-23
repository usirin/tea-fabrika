import {structuralHash} from "@demlik/tea";
import {z} from "zod";
import {createRefine, type RefineMsg, type RefineState} from "../refine.ts";
import {type Law, law, stepOf, type Update, type World} from "./explore.ts";

// The draft-and-vet child (src/refine.ts) under every order of messages: one
// small use of it, its world, and its laws.
//
// The use: a writer hands back a draft ("good", "bad", or "blocked", which
// stops the run for its parent), and the checker passes only "good". The
// world answers each Cmd in any order, may restart, and with `echoes` may
// answer a Cmd a second time, later: the case where an old answer arrives
// while a newer Cmd is in flight.

export const drafts = createRefine({
	name: "draft",
	brief: z.string(),
	draft: z.string(),
	verdict: z.object({ok: z.boolean()}),
	problemsOf: (draft, verdict) => (verdict.ok ? [] : [`"${draft}" is not right`]),
	stopOf: (draft) => (draft === "blocked" ? ("blocked" as const) : null),
});

export type Refine = RefineState<string, string, {readonly ok: boolean}, "blocked">;
type WriteCmd = ReturnType<typeof drafts.write>;
type CheckCmd = ReturnType<typeof drafts.check>;
export type RefineCmd = WriteCmd | CheckCmd;
export type AnyRefineMsg =
	| RefineMsg<string>
	| ReturnType<typeof drafts.write.ok>
	| ReturnType<typeof drafts.write.err>
	| ReturnType<typeof drafts.check.ok>
	| ReturnType<typeof drafts.check.err>;
type Msg = AnyRefineMsg;
const refineUpdate = stepOf<Refine, Msg, RefineCmd>(drafts.machine);

const DRAFTS = ["good", "bad", "blocked"] as const;

export function refineWorld(
	options: {readonly echoes?: boolean} = {},
): World<Refine, Msg, RefineCmd> {
	return {
		outside: () => [
			{type: "start", brief: "b", session: null, note: null, limit: 2},
			{type: "resume"},
			{type: "answer", answer: {kind: "retry"}},
			{type: "answer", answer: {kind: "more", tries: 1}},
			{type: "answer", answer: {kind: "accept"}},
		],
		answers: (cmd): readonly Msg[] =>
			cmd.type === "draft_write"
				? [
						...DRAFTS.map((draft) => drafts.write.ok(cmd, {draft, session: "s"}, 0)),
						drafts.write.err(cmd, {_tag: "agent_failed"}, 0),
					]
				: [
						drafts.check.ok(cmd, {ok: cmd.draft === "good"}, 0),
						drafts.check.err(cmd, {_tag: "could_not_run"}, 0),
					],
		restart: (msg) => msg.type === "resume",
		...(options.echoes === undefined ? {} : {echoes: options.echoes}),
	};
}

/** The Cmd a state waits on: the one a restart sends again. */
const waitingOn = (s: Refine): RefineCmd | null => {
	const [, cmds] = refineUpdate(s, {type: "resume"});
	return cmds[0] ?? null;
};
const moved = (prev: Refine, next: Refine) => structuralHash(prev) !== structuralHash(next);
const isAnswer = (m: Msg): m is Exclude<Msg, RefineMsg<string>> => "cmd" in m;

export function refineLaws<S extends Refine>(): readonly Law<S, Msg, RefineCmd>[] {
	return [
		law<S, Msg, RefineCmd>("an answer counts only for the Cmd in flight", ({prev, msg, next}) => {
			if (!isAnswer(msg) || !moved(prev, next)) return null;
			const asked = waitingOn(prev);
			return structuralHash(msg.cmd) === structuralHash(asked)
				? null
				: `${msg.type} answered ${show(msg.cmd)}, and the run was waiting on ${asked === null ? "nothing" : show(asked)}`;
		}),
		law<S, Msg, RefineCmd>(
			"done with a verdict only when it found no problem, and without one only when the parent accepted",
			({prev, msg, next}) => {
				if (next.phase !== "done" || prev.phase === "done") return null;
				if (next.verdict === null)
					return msg.type === "answer" && msg.answer.kind === "accept"
						? null
						: `done unchecked after ${msg.type}`;
				const problems = drafts.problemsOf(next.draft, next.verdict, "b");
				return problems.length === 0 ? null : `done with ${problems.join("; ")}`;
			},
		),
		law<S, Msg, RefineCmd>("tries never pass the limit", ({next}) =>
			"limit" in next && next.tries > next.limit
				? `try ${next.tries} of a limit of ${next.limit}`
				: null,
		),
		law<S, Msg, RefineCmd>("a done run sends nothing", ({prev, cmds}) =>
			prev.phase === "done" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after it was done`
				: null,
		),
	];
}

export const refineInit: Refine = {phase: "idle"};
export const refineStep: Update<Refine, Msg, RefineCmd> = refineUpdate;

const show = (cmd: RefineCmd): string =>
	cmd.type === "draft_write"
		? `the write ${cmd.note === null ? "first asked" : "asked again"}`
		: `the check of "${cmd.draft}"`;

// ---------------------------------------------------------------- planted mistakes

/** A checker that could not run is taken as a pass. */
export const passesUnchecked: Update<Refine, Msg, RefineCmd> = (s, m) =>
	m.type === "draft_check_err" && s.phase === "checking"
		? [{phase: "done", draft: s.draft, session: s.session, tries: s.tries, verdict: null}, []]
		: refineUpdate(s, m);

/** Out of tries, a retry asks the writer once more, past the limit. */
export const retriesPastTheLimit: Update<Refine, Msg, RefineCmd> = (s, m) =>
	m.type === "answer" && m.answer.kind === "retry" && s.phase === "out_of_tries"
		? refineUpdate(
				{
					phase: "write_failed",
					brief: s.brief,
					session: s.session,
					tries: s.tries + 1,
					limit: s.limit,
					note: null,
				},
				m,
			)
		: refineUpdate(s, m);

/** A restart after the end checks the draft again. */
export const actsAfterTheEnd: Update<Refine, Msg, RefineCmd> = (s, m) =>
	m.type === "resume" && s.phase === "done"
		? [s, [drafts.check({brief: "b", draft: s.draft})]]
		: refineUpdate(s, m);

export function showRefineMsg(m: Msg): string {
	switch (m.type) {
		case "start":
		case "resume":
			return m.type;
		case "answer":
			return `parent: ${m.answer.kind}`;
		case "draft_write_ok":
			return `"${m.value.draft}" for ${show(m.cmd)}`;
		case "draft_check_ok":
			return `${m.value.ok ? "passes" : "problems"} for ${show(m.cmd)}`;
		default:
			return `${m.type} for ${show(m.cmd)}`;
	}
}
