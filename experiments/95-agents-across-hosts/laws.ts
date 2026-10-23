// The laws of experiment 95's two new machines, walked by the repo's checker
// (wip/src/laws/explore.ts): every Msg order up to a bound, through the real reducers, each law
// after every step, each law seen to fail once on a planted mistake. The host machine is 94's,
// unchanged; its laws are 94's and are run again by the harness.
//
// The call machine's world: 3 questions, a window of 2. Any pending call's deadline may run out,
// and stray deadlines come too; a reply may come for any question, right or wrong, new or at
// the cursor; a restart (`resume`) may come at any time and kills every send in flight. A send
// is answered `sent` or `send_failed`.
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
} from "@kampus/pipeline/laws/explore";
import {
	START as ANSWERER_START,
	type AnswerCmd,
	type Answerer,
	type AnswerMsg,
	answerer,
	answerUpdate,
} from "./answer-machine.ts";
import {
	type Asker,
	type CallCmd,
	type CallMsg,
	type CallSettings,
	callUpdate,
	createCalls,
	START,
	sendOf,
} from "./call-machine.ts";
import {isRight, questionOf} from "./question.ts";

const SETTINGS: CallSettings = {total: 3, window: 2, timeoutMs: 100, retryMs: 10, real: false};
const calls = createCalls(SETTINGS);
const Q = [1, 2, 3] as const;

export function callWorld(): World<Asker, CallMsg, CallCmd> {
	return {
		outside: (s) => [
			{type: "resume"},
			...s.pending.flatMap((p): CallMsg[] =>
				p.due === null ? [] : [{type: "timed_out", i: p.i, tries: p.tries}],
			),
			{type: "timed_out", i: 1, tries: 1},
			...Q.flatMap((i): CallMsg[] => {
				const q = questionOf(i);
				const reply = {type: "reply" as const, id: q.id, corr: q.corr};
				return [
					{...reply, answer: String(q.expected), rev: s.cursor + 1},
					{...reply, answer: "wrong", rev: s.cursor + 1},
					{...reply, answer: String(q.expected), rev: s.cursor},
				];
			}),
		],
		answers: (cmd) => [
			{type: "sent", i: cmd.i, tries: cmd.tries, at: 0},
			{type: "send_failed", i: cmd.i, tries: cmd.tries, at: 0},
		],
		restart: (m) => m.type === "resume",
	};
}

const pendingOf = (s: Asker, i: number) => s.pending.find((p) => p.i === i);

export function callLaws(): readonly Law<Asker, CallMsg, CallCmd>[] {
	return [
		watched<Asker, CallMsg, CallCmd, readonly number[]>(
			"a call is answered at most once",
			[],
			(done, {prev, next}) => {
				const added = next.answered - prev.answered;
				if (added === 0) return done;
				if (added !== 1 || next.last === null) return broke(`answered went up by ${added}`);
				return done.includes(next.last.i)
					? broke(`call ${next.last.i} answered a second time`)
					: [...done, next.last.i];
			},
		),
		watched<Asker, CallMsg, CallCmd, Readonly<Record<number, string>>>(
			"every send of a call carries the same message id",
			{},
			(ids, {cmds}) => {
				let seen = ids;
				for (const c of cmds) {
					const first = seen[c.i];
					if (first !== undefined && first !== c.id)
						return broke(`call ${c.i} sent as ${c.id}, first sent as ${first}`);
					if (c.corr !== questionOf(c.i).corr) return broke(`call ${c.i} sent with corr ${c.corr}`);
					seen = {...seen, [c.i]: c.id};
				}
				return seen;
			},
		),
		law<Asker, CallMsg, CallCmd>("a call is sent only while it is pending", ({next, cmds}) => {
			const bad = cmds.find((c) => pendingOf(next, c.i)?.tries !== c.tries);
			return bad === undefined ? null : `sends call ${bad.i} try ${bad.tries}, not pending as that`;
		}),
		law<Asker, CallMsg, CallCmd>("at most `window` calls are pending", ({next}) =>
			next.pending.length > SETTINGS.window ? `${next.pending.length} pending` : null,
		),
		law<Asker, CallMsg, CallCmd>(
			"a reply at or behind the cursor changes nothing",
			({prev, msg, next, cmds}) =>
				msg.type === "reply" && msg.rev <= prev.cursor && (next !== prev || cmds.length > 0)
					? `reply at rev ${msg.rev}, cursor ${prev.cursor}, changed the state`
					: null,
		),
		law<Asker, CallMsg, CallCmd>(
			"a reply for a call not pending answers nothing",
			({prev, msg, next}) => {
				if (msg.type !== "reply" || msg.rev <= prev.cursor) return null;
				const pending = prev.pending.some((p) => questionOf(p.i).corr === msg.corr);
				return !pending && next.answered !== prev.answered
					? `a reply for ${msg.corr}, not pending, was counted`
					: null;
			},
		),
		law<Asker, CallMsg, CallCmd>(
			"a call whose deadline ran out is sent again",
			({prev, msg, cmds}) => {
				if (msg.type !== "timed_out") return null;
				const p = pendingOf(prev, msg.i);
				if (p === undefined || p.tries !== msg.tries || p.due === null) return null;
				return cmds.some((c) => c.i === msg.i && c.tries === p.tries + 1)
					? null
					: `call ${msg.i} timed out and was not sent again`;
			},
		),
		law<Asker, CallMsg, CallCmd>(
			"a restart sends every pending call again",
			({prev, msg, cmds}) => {
				if (msg.type !== "resume") return null;
				const missed = prev.pending.find((p) => !cmds.some((c) => c.i === p.i));
				return missed === undefined ? null : `call ${missed.i} pending and not sent at restart`;
			},
		),
		law<Asker, CallMsg, CallCmd>("an answer is marked right only when it is", ({prev, next}) => {
			if (next.answered === prev.answered || next.last === null) return null;
			const right = isRight(questionOf(next.last.i), next.last.answer);
			return right === next.last.right && next.wrong - prev.wrong === (right ? 0 : 1)
				? null
				: `call ${next.last.i} answered "${next.last.answer}" marked right: ${next.last.right}`;
		}),
	];
}

// ---------------------------------------------------------------- planted mistakes, calls

const real = callUpdate(SETTINGS);
type CallStep = Update<Asker, CallMsg, CallCmd>;

/** A reply for a call not pending (a retried call's second reply) is counted again. */
const countsLateReply: CallStep = (s, m) => {
	if (m.type !== "reply" || m.rev <= s.cursor) return real(s, m);
	const pending = s.pending.some((p) => questionOf(p.i).corr === m.corr);
	if (pending) return real(s, m);
	const i = Number(m.id.slice(2));
	return [
		{...s, cursor: m.rev, answered: s.answered + 1, last: {i, answer: m.answer, right: true}},
		[],
	];
};
/** A retry gets a fresh message id, so the answerer cannot tell it is the same call. */
const freshIdOnRetry: CallStep = (s, m) => {
	const [next, cmds] = real(s, m);
	return [next, cmds.map((c) => (c.tries > 1 ? {...c, id: `${c.id}-${c.tries}`} : c))];
};
/** Sends the answered call once more when its reply comes. */
const sendsAfterAnswer: CallStep = (s, m) => {
	const [next, cmds] = real(s, m);
	if (m.type !== "reply" || next.answered === s.answered || next.last === null) return [next, cmds];
	return [next, [...cmds, sendOf(SETTINGS, next.last.i, 1)]];
};
/** Fills one past the window. */
const overfills: CallStep = (s, m) => {
	const [next, cmds] = callUpdate({...SETTINGS, window: SETTINGS.window + 1})(s, m);
	return [next, cmds];
};
/** Reads every reply, the cursor ignored. */
const ignoresCursor: CallStep = (s, m) =>
	m.type === "reply" && m.rev <= s.cursor ? real({...s, cursor: m.rev - 1}, m) : real(s, m);
/** A deadline that ran out is dropped. */
const dropsTimeout: CallStep = (s, m) => (m.type === "timed_out" ? [s, []] : real(s, m));
/** A restart only asks new questions; the pending ones wait for their old deadlines. */
const forgetsAtRestart: CallStep = (s, m) =>
	m.type === "resume" ? real({...s, pending: []}, m) : real(s, m);
/** Every answer is marked right. */
const trustsAnswers: CallStep = (s, m) => {
	const [next, cmds] = real(s, m);
	return next.last === null || next.answered === s.answered
		? [next, cmds]
		: [{...next, wrong: s.wrong, last: {...next.last, right: true}}, cmds];
};

export const CALL_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: CallStep;
}[] = [
	{name: "counts a late reply", law: "a call is answered at most once", update: countsLateReply},
	{
		name: "fresh id on retry",
		law: "every send of a call carries the same message id",
		update: freshIdOnRetry,
	},
	{
		name: "sends after answer",
		law: "a call is sent only while it is pending",
		update: sendsAfterAnswer,
	},
	{name: "overfills", law: "at most `window` calls are pending", update: overfills},
	{
		name: "ignores the cursor",
		law: "a reply at or behind the cursor changes nothing",
		update: ignoresCursor,
	},
	{
		name: "drops a timeout",
		law: "a call whose deadline ran out is sent again",
		update: dropsTimeout,
	},
	{
		name: "forgets at restart",
		law: "a restart sends every pending call again",
		update: forgetsAtRestart,
	},
	{
		name: "trusts every answer",
		law: "an answer is marked right only when it is",
		update: trustsAnswers,
	},
];

// ---------------------------------------------------------------- the answerer

const INBOX = "asker:1/inbox";

export function answerWorld(): World<Answerer, AnswerMsg, AnswerCmd> {
	return {
		outside: (s) =>
			["q-1", "q-2"].flatMap((id) =>
				(["answered", "repeat"] as const).flatMap((type) =>
					[s.cursor - 1, s.cursor, s.cursor + 1]
						.filter((rev) => rev >= 1)
						.map(
							(rev): AnswerMsg => ({
								type,
								id,
								corr: `c-${id}`,
								replyTo: INBOX,
								rev,
								answer: `a-${id}`,
							}),
						),
				),
			),
		answers: () => [],
	};
}

export function answerLaws(): readonly Law<Answerer, AnswerMsg, AnswerCmd>[] {
	return [
		law<Answerer, AnswerMsg, AnswerCmd>("the cursor never goes back", ({prev, next}) =>
			next.cursor < prev.cursor ? `cursor ${prev.cursor} went back to ${next.cursor}` : null,
		),
		law<Answerer, AnswerMsg, AnswerCmd>(
			"a question at or behind the cursor changes nothing and sends nothing",
			({prev, msg, next, cmds}) =>
				msg.rev <= prev.cursor && (next !== prev || cmds.length > 0)
					? `rev ${msg.rev} at cursor ${prev.cursor} changed the state or sent ${cmds.length}`
					: null,
		),
		law<Answerer, AnswerMsg, AnswerCmd>(
			"a new answer counts once and is on record",
			({prev, msg, next}) => {
				if (msg.rev <= prev.cursor) return null;
				const added = next.answered - prev.answered;
				const want = msg.type === "answered" ? 1 : 0;
				if (added !== want) return `${msg.type} added ${added} answers`;
				if (msg.type === "answered" && next.last?.id !== msg.id)
					return `answered ${msg.id}, on record ${next.last?.id ?? "nothing"}`;
				return null;
			},
		),
		law<Answerer, AnswerMsg, AnswerCmd>(
			"each question past the cursor gets exactly one reply, to its caller, with its answer",
			({prev, msg, cmds}) => {
				if (msg.rev <= prev.cursor) return null;
				if (cmds.length !== 1) return `${msg.type} ${msg.id} sent ${cmds.length} replies`;
				const c = cmds[0];
				return c !== undefined &&
					c.to === msg.replyTo &&
					c.id === msg.id &&
					c.corr === msg.corr &&
					c.answer === msg.answer
					? null
					: `${msg.type} ${msg.id} replied ${JSON.stringify(c)}`;
			},
		),
	];
}

type AnswerStep = Update<Answerer, AnswerMsg, AnswerCmd>;
const answerReal: AnswerStep = answerUpdate;

const countsRepeats: AnswerStep = (s, m) =>
	m.type === "repeat" ? answerReal(s, {...m, type: "answered"}) : answerReal(s, m);
const cursorFollows: AnswerStep = (s, m) =>
	m.rev <= s.cursor ? [{...s, cursor: m.rev}, []] : answerReal(s, m);
const repliesTwice: AnswerStep = (s, m) => {
	const [next, cmds] = answerReal(s, m);
	return [next, [...cmds, ...cmds]];
};
const repliesToItself: AnswerStep = (s, m) => {
	const [next, cmds] = answerReal(s, m);
	return [next, cmds.map((c) => ({...c, to: "answerer:1/inbox"}))];
};
const answersTwiceOnReplay: AnswerStep = (s, m) =>
	m.rev <= s.cursor && m.type === "answered"
		? [{...s, answered: s.answered + 1, last: {id: m.id, corr: m.corr, answer: m.answer}}, []]
		: answerReal(s, m);

export const ANSWER_PLANTED: readonly {
	readonly name: string;
	readonly law: string;
	readonly update: AnswerStep;
}[] = [
	{name: "counts repeats", law: "a new answer counts once and is on record", update: countsRepeats},
	{name: "cursor follows", law: "the cursor never goes back", update: cursorFollows},
	{
		name: "replies twice",
		law: "each question past the cursor gets exactly one reply, to its caller, with its answer",
		update: repliesTwice,
	},
	{
		name: "replies to itself",
		law: "each question past the cursor gets exactly one reply, to its caller, with its answer",
		update: repliesToItself,
	},
	{
		name: "answers twice on replay",
		law: "a question at or behind the cursor changes nothing and sends nothing",
		update: answersTwiceOnReplay,
	},
];

// ---------------------------------------------------------------- the check

export interface LawsResult {
	readonly machine: string;
	readonly states: number;
	readonly complete: boolean;
	readonly ms: number;
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

const showCallMsg = (m: CallMsg): string => {
	const {type, ...rest} = m;
	const args = Object.values(rest).join(" ");
	return args === "" ? type : `${type} ${args}`;
};
const showAnswerMsg = (m: AnswerMsg): string => `${m.type} ${m.id} rev ${m.rev}`;

function check<S, M extends {readonly type: string}, C>(o: {
	readonly machine: string;
	readonly init: S;
	readonly update: Update<S, M, C>;
	readonly world: () => World<S, M, C>;
	readonly laws: () => readonly Law<S, M, C>[];
	readonly planted: readonly {
		readonly name: string;
		readonly law: string;
		readonly update: Update<S, M, C>;
	}[];
	readonly alphabet: readonly string[];
	readonly depth: number;
	readonly show: (m: M) => string;
}): LawsResult {
	const laws = o.laws();
	const r = explore({init: o.init, update: o.update, world: o.world(), laws, depth: o.depth});
	const planted = o.planted.map((p) => {
		const found = explore({
			init: o.init,
			update: p.update,
			world: o.world(),
			laws: o.laws(),
			depth: o.depth,
		}).broken.find((b) => b.law === p.law);
		return {
			name: p.name,
			law: p.law,
			caught: found !== undefined,
			path: found === undefined ? null : pathText(found.path, o.show),
		};
	});
	return {
		machine: o.machine,
		states: r.states,
		complete: r.complete,
		ms: r.ms,
		unsent: o.alphabet.filter((t) => !r.sent.includes(t)),
		broken: Object.fromEntries(r.broken.map((b) => [b.law, pathText(b.path, o.show)])),
		laws: laws.map((l) => l.name),
		planted,
	};
}

export const checkCalls = (depth = 7): LawsResult =>
	check({
		machine: "calls",
		init: START,
		update: stepOf<Asker, CallMsg, CallCmd>(calls),
		world: callWorld,
		laws: callLaws,
		planted: CALL_PLANTED,
		alphabet: Object.keys(calls.update).sort(),
		depth,
		show: showCallMsg,
	});

export const checkAnswerer = (depth = 6): LawsResult =>
	check({
		machine: "answerer",
		init: ANSWERER_START,
		update: stepOf<Answerer, AnswerMsg, AnswerCmd>(answerer),
		world: answerWorld,
		laws: answerLaws,
		planted: ANSWER_PLANTED,
		alphabet: Object.keys(answerer.update).sort(),
		depth,
		show: showAnswerMsg,
	});
