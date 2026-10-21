// The laws of experiment 101's answer machine (./machine.ts) and of `planFor`, the choice a new
// owner makes from the record, walked by the repo's checker (packages/fabrika/src/pipeline/laws/explore.ts): every Msg
// order up to a bound, through the real reducers, each law after every step, each law seen to fail
// once on a planted mistake. 95's answerer laws come first, unchanged in meaning; the rest are the
// record of the run in flight.
//
// The world: two questions. q-1 may start a fresh run (s-1) and a run forked from it (s-2); q-2
// one run (s-3). Any run's turns and transcript lines may come at any time, in any order, twice,
// and for a session that is not in flight (a late callback from a run that was cut off). An
// answer, a repeat and a start may come at the cursor or past it.
import {
	broke,
	explore,
	type Law,
	law,
	pathText,
	stepOf,
	type Update,
	type World,
	watched,
} from "@kampus/fabrika/pipeline/laws/explore";
import {
	type AgentRun,
	type AnswerCmd,
	type Answerer,
	type AnswerMsg,
	answerer,
	answerUpdate,
	type Entry,
	type Plan,
	planFor,
	START,
	type Turn,
	turnsDone,
} from "./machine.ts";

const INBOX = "asker:1/inbox";
const TURNS = 2;
const IDS = ["q-1", "q-2"] as const;
type Planner = (s: Answerer, id: string, resume: boolean, turns: number) => Plan;

const turn = (n: number, ok: boolean, id: string): Turn => ({
	turn: n,
	ok,
	text: ok ? `a-${id}` : "no answer",
	totalUsd: 0,
});
const line = (uuid: string): Entry => ({type: "user", uuid});

export function answerWorld(): World<Answerer, AnswerMsg, AnswerCmd> {
	const asked = (type: "answered" | "repeat", id: string, rev: number): AnswerMsg => ({
		type,
		id,
		corr: `c-${id}`,
		replyTo: INBOX,
		rev,
		answer: `a-${id}`,
	});
	return {
		outside: (s) => {
			const c = s.cursor;
			return [
				{type: "started", id: "q-1", rev: c + 1, session: "s-1", from: null},
				{type: "started", id: "q-1", rev: c + 1, session: "s-2", from: "s-1"},
				...(c >= 1
					? [{type: "started", id: "q-1", rev: c, session: "s-1", from: null} as AnswerMsg]
					: []),
				{type: "turned", id: "q-1", session: "s-1", turn: turn(1, true, "q-1")},
				{type: "turned", id: "q-1", session: "s-1", turn: turn(2, true, "q-1")},
				{type: "turned", id: "q-1", session: "s-1", turn: turn(1, false, "q-1")},
				{type: "turned", id: "q-1", session: "s-2", turn: turn(2, true, "q-1")},
				{type: "progress", id: "q-1", session: "s-1", entries: [line("e-1")]},
				{type: "progress", id: "q-1", session: "s-2", entries: [line("e-2")]},
				asked("answered", "q-1", c + 1),
				...(c >= 1 ? [asked("answered", "q-1", c)] : []),
				asked("repeat", "q-1", c + 1),
				{type: "started", id: "q-2", rev: c + 1, session: "s-3", from: null},
				{type: "turned", id: "q-2", session: "s-3", turn: turn(1, true, "q-2")},
				{type: "progress", id: "q-2", session: "s-3", entries: [line("e-3")]},
				asked("answered", "q-2", c + 1),
			];
		},
		answers: () => [],
	};
}

const hasRev = (m: AnswerMsg): m is Extract<AnswerMsg, {readonly rev: number}> =>
	m.type === "answered" || m.type === "repeat" || m.type === "started";
const runOf = (s: Answerer, id: string, session: string): AgentRun | undefined =>
	s.inflight?.id === id ? s.inflight.runs.find((r) => r.session === session) : undefined;

export function answerLaws(
	plan: Planner = planFor,
): readonly Law<Answerer, AnswerMsg, AnswerCmd>[] {
	type L = Law<Answerer, AnswerMsg, AnswerCmd>;
	const one = (name: string, check: Parameters<typeof law<Answerer, AnswerMsg, AnswerCmd>>[1]): L =>
		law<Answerer, AnswerMsg, AnswerCmd>(name, check);
	return [
		// ------------------------------------------------ 95's laws
		one("the cursor never goes back", ({prev, next}) =>
			next.cursor < prev.cursor ? `cursor ${prev.cursor} went back to ${next.cursor}` : null,
		),
		one(
			"a message at or behind the cursor changes nothing and sends nothing",
			({prev, msg, next, cmds}) =>
				hasRev(msg) && msg.rev <= prev.cursor && (next !== prev || cmds.length > 0)
					? `${msg.type} at rev ${msg.rev}, cursor ${prev.cursor}, changed the state or sent`
					: null,
		),
		one("a new answer counts once and is on record", ({prev, msg, next}) => {
			const want = msg.type === "answered" && msg.rev > prev.cursor ? 1 : 0;
			const added = next.answered - prev.answered;
			if (added !== want) return `${msg.type} added ${added} answers`;
			if (want === 1 && next.last?.id !== msg.id)
				return `answered ${msg.id}, on record ${next.last?.id ?? "nothing"}`;
			return null;
		}),
		one(
			"each question past the cursor gets exactly one reply, to its caller, with its answer; nothing else replies",
			({prev, msg, cmds}) => {
				if (msg.type !== "answered" && msg.type !== "repeat")
					return cmds.length === 0 ? null : `${msg.type} sent ${cmds.length} replies`;
				if (msg.rev <= prev.cursor) return null;
				const c = cmds[0];
				return cmds.length === 1 &&
					c !== undefined &&
					c.to === msg.replyTo &&
					c.id === msg.id &&
					c.answer === msg.answer
					? null
					: `${msg.type} ${msg.id} replied ${JSON.stringify(cmds)}`;
			},
		),
		// ------------------------------------------------ the record of the run in flight
		one("a run in flight is kept until its question is answered", ({prev, msg, next}) => {
			const f = prev.inflight;
			if (f === null || next.inflight?.id === f.id) return null;
			return msg.type === "answered" && msg.id === f.id && msg.rev > prev.cursor
				? null
				: `${msg.type} ${"id" in msg ? msg.id : ""} dropped ${f.id}'s run`;
		}),
		one("an answer forgets its run", ({prev, msg, next}) =>
			msg.type === "answered" && msg.rev > prev.cursor && next.inflight?.id === msg.id
				? `answered ${msg.id} and kept its run`
				: null,
		),
		one("while a question is in flight, its record only grows", ({prev, next}) => {
			const a = prev.inflight;
			const b = next.inflight;
			if (a === null || b === null || a.id !== b.id) return null;
			for (const r of a.runs) {
				const after = b.runs.find((x) => x.session === r.session);
				if (after === undefined) return `run ${r.session} went missing`;
				if (after.turns.length < r.turns.length || after.entries.length < r.entries.length)
					return `run ${r.session} shrank`;
				if (after.turns.some((t, i) => i < r.turns.length && t !== r.turns[i]))
					return `run ${r.session}'s recorded turns changed`;
			}
			return null;
		}),
		one("a transcript line is recorded once per run", ({next}) => {
			for (const r of next.inflight?.runs ?? []) {
				const ids = r.entries.flatMap((e) => (typeof e.uuid === "string" ? [e.uuid] : []));
				if (new Set(ids).size !== ids.length) return `run ${r.session} holds a line twice`;
			}
			return null;
		}),
		one("a run's turns are recorded in order, once each", ({next}) => {
			for (const r of next.inflight?.runs ?? [])
				if (r.turns.some((t, i) => t.turn !== r.base + i + 1))
					return `run ${r.session} (base ${r.base}) holds turns ${r.turns.map((t) => t.turn).join(",")}`;
			return null;
		}),
		one(
			"a turn or a transcript line for a session not in flight changes nothing",
			({prev, msg, next}) =>
				(msg.type === "turned" || msg.type === "progress") &&
				runOf(prev, msg.id, msg.session) === undefined &&
				next !== prev
					? `${msg.type} for ${msg.id}/${msg.session}, not in flight, changed the state`
					: null,
		),
		// ------------------------------------------------ what a new owner does with it
		one("a recover hands back the last turn of a run that did every turn", ({next}) => {
			for (const id of IDS) {
				const p = plan(next, id, true, TURNS);
				if (p.how !== "recover") continue;
				const r = runOf(next, id, p.session);
				const last = r?.turns.find((t) => t.turn === TURNS);
				if (r === undefined || turnsDone(r) < TURNS || last?.text !== p.answer)
					return `${id}: recover ${p.answer} from ${p.session}, which did ${r === undefined ? "no" : turnsDone(r)} turns`;
			}
			return null;
		}),
		one(
			"a resume starts from a run of the same question with a turn done and its transcript",
			({next}) => {
				for (const id of IDS) {
					const p = plan(next, id, true, TURNS);
					if (p.how !== "resume") continue;
					const r = runOf(next, id, p.from);
					if (
						r === undefined ||
						turnsDone(r) < 1 ||
						r.entries.length === 0 ||
						p.done !== turnsDone(r)
					)
						return `${id}: resume from ${p.from}, not a run of ${id} with a turn and a transcript`;
				}
				return null;
			},
		),
		one("a run with a turn and its transcript is not thrown away", ({next}) => {
			for (const id of IDS) {
				const p = plan(next, id, true, TURNS);
				const usable = (next.inflight?.id === id ? next.inflight.runs : []).some(
					(r) => turnsDone(r) >= 1 && r.entries.length > 0,
				);
				if (usable && p.how === "fresh") return `${id}: a usable run, and the plan is fresh`;
			}
			return null;
		}),
		one("with resume off, every plan is fresh", ({next}) => {
			for (const id of IDS)
				if (plan(next, id, false, TURNS).how !== "fresh") return `${id}: resume off, not fresh`;
			return null;
		}),
		watched<Answerer, AnswerMsg, AnswerCmd, readonly string[]>(
			"an answered question is never recovered or resumed",
			[],
			(done, {next}) => {
				const now =
					next.last === null || done.includes(next.last.id) ? done : [...done, next.last.id];
				for (const id of now) {
					const p = plan(next, id, true, TURNS);
					if (p.how !== "fresh" && next.inflight?.id !== id)
						return broke(`${id} answered, the plan is ${p.how}`);
				}
				return now;
			},
		),
	];
}

// ---------------------------------------------------------------- planted mistakes

type AnswerStep = Update<Answerer, AnswerMsg, AnswerCmd>;
const real = stepOf<Answerer, AnswerMsg, AnswerCmd>(answerer);

const answerKeepsRun: AnswerStep = (s, m) => {
	const [next, cmds] = real(s, m);
	return m.type === "answered" && m.rev > s.cursor
		? [{...next, inflight: s.inflight}, cmds]
		: [next, cmds];
};
const newQuestionDropsRun: AnswerStep = (s, m) =>
	m.type === "started" && m.rev > s.cursor && s.inflight !== null && s.inflight.id !== m.id
		? real({...s, inflight: null}, m)
		: real(s, m);
const startsBehindCursor: AnswerStep = (s, m) =>
	m.type === "started" && m.rev <= s.cursor ? real(s, {...m, rev: s.cursor + 1}) : real(s, m);
const progressOnAnyRun: AnswerStep = (s, m) => {
	if (m.type !== "progress" || s.inflight === null) return real(s, m);
	const first = s.inflight.runs[0];
	return first === undefined
		? real(s, m)
		: answerUpdate.progress(s, {...m, id: s.inflight.id, session: first.session});
};
const linesTwice: AnswerStep = (s, m) => {
	if (m.type !== "progress" || s.inflight?.id !== m.id) return real(s, m);
	const runs = s.inflight.runs.map((r) =>
		r.session === m.session ? {...r, entries: [...r.entries, ...m.entries]} : r,
	);
	return [{...s, inflight: {...s.inflight, runs}}, []];
};
const turnsAnyOrder: AnswerStep = (s, m) => {
	if (m.type !== "turned" || s.inflight?.id !== m.id) return real(s, m);
	const runs = s.inflight.runs.map((r) =>
		r.session === m.session ? {...r, turns: [...r.turns, m.turn]} : r,
	);
	return [{...s, inflight: {...s.inflight, runs}}, []];
};
const countsRepeats: AnswerStep = (s, m) =>
	m.type === "repeat" ? real(s, {...m, type: "answered"}) : real(s, m);

const recoverFromHalf: Planner = (s, id, resume, turns) => {
	const p = planFor(s, id, resume, turns);
	const r = s.inflight?.runs.find((x) => turnsDone(x) >= 1);
	const t = r?.turns.at(-1);
	return p.how === "resume" && r !== undefined && t !== undefined
		? {how: "recover", answer: t.text, session: r.session}
		: p;
};
const resumeWithoutTranscript: Planner = (s, id, resume, turns) => {
	const p = planFor(s, id, resume, turns);
	const r = s.inflight?.id === id ? s.inflight.runs.find((x) => turnsDone(x) >= 1) : undefined;
	return p.how === "fresh" && resume && r !== undefined
		? {how: "resume", from: r.session, done: turnsDone(r)}
		: p;
};
const resumeAnyQuestion: Planner = (s, _id, resume, turns) =>
	s.inflight === null
		? planFor(s, "none", resume, turns)
		: planFor(s, s.inflight.id, resume, turns);
const resumeWhenOff: Planner = (s, id, _resume, turns) => planFor(s, id, true, turns);
const neverResume: Planner = (s, id, resume, turns) => {
	const p = planFor(s, id, resume, turns);
	return p.how === "resume" ? {how: "fresh"} : p;
};

export const PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update?: AnswerStep;
	readonly plan?: Planner;
}[] = [
	{name: "an answer keeps its run", law: "an answer forgets its run", update: answerKeepsRun},
	{
		name: "a new question drops the run in flight",
		law: "a run in flight is kept until its question is answered",
		update: newQuestionDropsRun,
	},
	{
		name: "starts behind the cursor",
		law: "a message at or behind the cursor changes nothing and sends nothing",
		update: startsBehindCursor,
	},
	{
		name: "progress lands on any run",
		law: "a turn or a transcript line for a session not in flight changes nothing",
		update: progressOnAnyRun,
	},
	{
		name: "lines recorded twice",
		law: "a transcript line is recorded once per run",
		update: linesTwice,
	},
	{
		name: "turns in any order",
		law: "a run's turns are recorded in order, once each",
		update: turnsAnyOrder,
	},
	{name: "counts repeats", law: "a new answer counts once and is on record", update: countsRepeats},
	{
		name: "recovers from half a run",
		law: "a recover hands back the last turn of a run that did every turn",
		plan: recoverFromHalf,
	},
	{
		name: "resumes without a transcript",
		law: "a resume starts from a run of the same question with a turn done and its transcript",
		plan: resumeWithoutTranscript,
	},
	{
		name: "resumes another question's run",
		law: "a resume starts from a run of the same question with a turn done and its transcript",
		plan: resumeAnyQuestion,
	},
	{name: "resumes when off", law: "with resume off, every plan is fresh", plan: resumeWhenOff},
	{
		name: "never resumes",
		law: "a run with a turn and its transcript is not thrown away",
		plan: neverResume,
	},
];

// ---------------------------------------------------------------- the check

export interface LawsResult {
	readonly machine: string;
	readonly states: number;
	readonly complete: boolean;
	readonly ms: number;
	readonly depth: number;
	readonly unsent: readonly string[];
	readonly broken: Readonly<Record<string, string>>;
	readonly laws: readonly string[];
	readonly planted: readonly {
		readonly name: string;
		readonly law: string;
		readonly caught: boolean;
		readonly path: string | null;
	}[];
}

const show = (m: AnswerMsg): string =>
	m.type === "turned"
		? `turned ${m.id}/${m.session} ${m.turn.turn}${m.turn.ok ? "" : " failed"}`
		: m.type === "progress"
			? `progress ${m.id}/${m.session} ${m.entries.map((e) => e.uuid).join(",")}`
			: m.type === "started"
				? `started ${m.id} rev ${m.rev} ${m.session}${m.from === null ? "" : ` from ${m.from}`}`
				: `${m.type} ${m.id} rev ${m.rev}`;

export const checkAnswerer = (depth = 6): LawsResult => {
	const laws = answerLaws();
	const r = explore({init: START, update: real, world: answerWorld(), laws, depth});
	const planted = PLANTED.map((p) => {
		const found = explore({
			init: START,
			update: p.update ?? real,
			world: answerWorld(),
			laws: answerLaws(p.plan ?? planFor),
			depth,
		}).broken.find((b) => b.law === p.law);
		return {
			name: p.name,
			law: p.law,
			caught: found !== undefined,
			path: found === undefined ? null : pathText(found.path, show),
		};
	});
	return {
		machine: "answerer with runs in flight",
		states: r.states,
		complete: r.complete,
		ms: r.ms,
		depth,
		unsent: Object.keys(answerer.update).filter((t) => !r.sent.includes(t)),
		broken: Object.fromEntries(r.broken.map((b) => [b.law, pathText(b.path, show)])),
		laws: laws.map((l) => l.name),
		planted,
	};
};
