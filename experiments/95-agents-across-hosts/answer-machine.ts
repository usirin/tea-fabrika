// The answerer's own machine: OTP's `gen_server` with `handle_call`'s reply as a Cmd. It does
// not run the agent and does not decide what is new; its program does both (./answerer.ts),
// and tells it one of two things per question, in inbox order:
//
//   answered {id: "q-7", rev: 12, answer: "115", ...}   a new answer: count it, reply with it
//   repeat   {id: "q-7", rev: 30, answer: "115", ...}   an id answered before (a retried call):
//                                                     reply with the answer on record, count nothing
//
// The state is saved before the reply is sent (tea saves a step before its Cmds run), so an
// answer is on record, under this host's fence, before anyone hears it. A message at or behind
// the cursor changes nothing: a replay that tells it a question twice cannot answer it twice.
import {defineMachine} from "@demlik/tea";

export interface Answerer {
	/** The inbox rev of the last question handled. */
	readonly cursor: number;
	/** Answers produced: one per message id, ever. */
	readonly answered: number;
	/** Replies sent again from the record, for a retried call. */
	readonly repeats: number;
	/** The answer produced last: the saved states, in order, name every answer once. */
	readonly last: {readonly id: string; readonly corr: string; readonly answer: string} | null;
}

export const START: Answerer = {cursor: 0, answered: 0, repeats: 0, last: null};

export type Asked = {
	readonly id: string;
	readonly corr: string;
	/** The inbox the reply goes to: the caller's address. */
	readonly replyTo: string;
	/** Its rev in the answerer's inbox. */
	readonly rev: number;
	readonly answer: string;
};

export type AnswerMsg = ({readonly type: "answered"} & Asked) | ({readonly type: "repeat"} & Asked);

export type AnswerCmd = {
	readonly type: "reply";
	readonly to: string;
	readonly id: string;
	readonly corr: string;
	readonly answer: string;
};

type Step = readonly [Answerer, readonly AnswerCmd[]];

const replyTo = (m: Asked): AnswerCmd => ({
	type: "reply",
	to: m.replyTo,
	id: m.id,
	corr: m.corr,
	answer: m.answer,
});

export const answerUpdate = (s: Answerer, m: AnswerMsg): Step => {
	if (m.rev <= s.cursor) return [s, []];
	if (m.type === "answered")
		return [
			{
				...s,
				cursor: m.rev,
				answered: s.answered + 1,
				last: {id: m.id, corr: m.corr, answer: m.answer},
			},
			[replyTo(m)],
		];
	return [{...s, cursor: m.rev, repeats: s.repeats + 1}, [replyTo(m)]];
};

export const answerer = defineMachine<Answerer, AnswerMsg, AnswerCmd, never, undefined>({
	types: {
		model: {} as Answerer,
		msg: {} as AnswerMsg,
		cmd: {} as AnswerCmd,
		sub: {} as never,
		ctx: undefined,
	},
	init: (loaded) => [loaded ?? START, []],
	update: {answered: answerUpdate, repeat: answerUpdate},
});
