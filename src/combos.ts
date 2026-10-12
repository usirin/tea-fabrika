import {createHash} from "node:crypto";
import type {Cmd, DepKeyedSub, Sub} from "@demlik/tea";
import {Context, type Effect, type Stream} from "effect";
import {z} from "zod";
import type {Draft, DraftMsg, DraftRun} from "./draft.ts";
import {act, type Check, type createJudge, listen, type Ruled} from "./primitives.ts";
import {sentBack} from "./refine.ts";

// The primitives joined, in the few shapes that keep coming back. Each is
// plain data plus pure functions a hand-written parent calls from its own
// update, Elm's nested-TEA way: the child has a model and an update; the
// parent keeps the child's model in its own and hands it the Msgs that are its.
// There is no pipeline language: a parent says in code which combo comes next.
//
// Every Cmd and Sub a child asks for carries the child's `key`, and so does
// every Msg that comes back, so a parent holding several children knows whose
// answer it is (Elm's Cmd.map / Sub.map, by data instead of by a wrapper).

// ---------------------------------------------------------------- gate

/** A gate's answer: the work goes on, or it parks with why. */
export type Gate<W> = {readonly pass: true} | {readonly pass: false; readonly why: W};

export const pass: Gate<never> = {pass: true};
export const park = <W>(why: W): Gate<W> => ({pass: false, why});

/** Gate on a Check: no problems passes; any problem parks, with all of them. */
export const gateCheck = (problems: readonly string[]): Gate<readonly string[]> =>
	problems.length === 0 ? pass : park(problems);

/** Gate on a Judge: a sure answer among `passes` passes; a sure other answer or an unsure one parks. */
export const gateJudge = <C extends string>(
	ruled: Ruled<C>,
	passes: readonly C[],
): Gate<Ruled<C>> => (ruled.sure && passes.includes(ruled.choice) ? pass : park(ruled));

// ---------------------------------------------------------------- remember

/**
 * Remember: write a fact (an Act), then read the world back (a Gather) and
 * count the write as done only when the read shows it. Both Cmds are kept in
 * the state, so a restart re-sends whichever was in flight: the write with
 * its same intent, or the read.
 */
export type Remember<W extends Cmd, R extends Cmd> =
	| {readonly step: "writing"; readonly write: W; readonly read: R}
	| {readonly step: "reading"; readonly write: W; readonly read: R};

export const remember = <W extends Cmd, R extends Cmd>(
	write: W,
	read: R,
): readonly [Remember<W, R>, readonly [W]] => [{step: "writing", write, read}, [write]];

/** The write answered: read it back. */
export const written = <W extends Cmd, R extends Cmd>(
	r: Remember<W, R>,
): readonly [Remember<W, R>, readonly [R]] => [{...r, step: "reading"}, [r.read]];

/** What a restart sends again. */
export const inFlight = <W extends Cmd, R extends Cmd>(r: Remember<W, R>): W | R =>
	r.step === "writing" ? r.write : r.read;

// ---------------------------------------------------------------- refine

/** A conversation's id, made from a name, so the same step names the same conversation on every replay. */
export function sessionOf(name: string): string {
	const h = createHash("sha256").update(name).digest("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type Refining<B, O> =
	| {
			readonly phase: "drafting";
			readonly brief: B;
			readonly run: DraftRun;
			readonly tries: number;
			readonly limit: number;
	  }
	| {readonly phase: "done"; readonly output: O; readonly tries: number; readonly session: string}
	/** The last draft still has problems and the tries are spent. */
	| {
			readonly phase: "out_of_tries";
			readonly output: O;
			readonly problems: readonly string[];
			readonly tries: number;
			readonly session: string;
	  }
	/** The agent broke, or answered with something that does not fit the schema. */
	| {readonly phase: "failed"; readonly error: string; readonly tries: number};

/**
 * Refine: Draft and Check in a loop. The agent drafts; a pure Check reads the
 * draft; its problems go back to the agent in the same conversation, up to a
 * limit of tries. `src/refine.ts` is the same loop with the writer as a Cmd
 * (one `claude -p` turn) and the check as a Cmd; triage and the lane still
 * run on that one.
 */
export function createRefineLoop<const N extends string, B, O>(config: {
	readonly draft: Draft<N, O>;
	readonly check: Check<O, B>;
	/** The prompt for a draft: the brief, and the Check's problems after the first. */
	readonly prompt: (brief: B, note: string | null) => string;
	readonly agent: string | null;
	readonly folder: string | null;
}) {
	type State = Refining<B, O>;
	type Msg = DraftMsg<N, O>;

	const drafting = (
		key: string,
		brief: B,
		tries: number,
		limit: number,
		note: string | null,
	): State => ({
		phase: "drafting",
		brief,
		tries,
		limit,
		run: {
			key,
			id: `${key}/${tries}`,
			prompt: config.prompt(brief, note),
			session: {id: sessionOf(key), continues: tries > 1},
			agent: config.agent,
			folder: config.folder,
		},
	});

	const start = (key: string, brief: B, limit: number): State =>
		drafting(key, brief, 1, Math.max(1, limit), null);

	function update(s: State, m: Msg): State {
		if (s.phase !== "drafting" || m.id !== s.run.id) return s;
		const {is} = config.draft;
		if (is.failed(m)) return {phase: "failed", error: m.error, tries: s.tries};
		if (!is.finished(m)) return s;
		const finished = m;
		if (finished.output === null)
			return {phase: "failed", error: "the answer did not fit the schema", tries: s.tries};
		const problems = config.check(finished.output, s.brief);
		if (problems.length === 0)
			return {phase: "done", output: finished.output, tries: s.tries, session: finished.session};
		if (s.tries >= s.limit) {
			return {
				phase: "out_of_tries",
				output: finished.output,
				problems,
				tries: s.tries,
				session: finished.session,
			};
		}
		return drafting(s.run.key, s.brief, s.tries + 1, s.limit, sentBack(problems));
	}

	/** The Draft this state asks for. */
	const runOf = (s: State): DraftRun | null => (s.phase === "drafting" ? s.run : null);

	return {start, update, runOf, draft: config.draft};
}

// ---------------------------------------------------------------- ask

/** One reply, as the place it was posted shows it. */
export interface Reply {
	readonly id: string;
	readonly author: string;
	readonly body: string;
	/** When it was posted, in ms. The Listen hands over only replies after the last one read. */
	readonly at: number;
}

/**
 * Where a person reads a question and answers it: an issue's comments, a
 * chat. Posting is an Act; replies arrive on their own, so they are a Stream
 * a Listen runner reads.
 */
export class Thread extends Context.Service<
	Thread,
	{
		readonly post: (request: {
			readonly where: string;
			readonly text: string;
			readonly intent: string;
		}) => Effect.Effect<
			{readonly thread: string; readonly at: number},
			{readonly _tag: "post_failed"}
		>;
		readonly replies: (thread: string, after: number) => Stream.Stream<Reply>;
	}
>()("Thread") {}

/** What a parent asks: where, the words, and whose replies count. */
export interface Question {
	readonly where: string;
	readonly text: string;
	/** The people whose reply is read. Anyone else's is passed over. */
	readonly who: readonly string[];
	/** The Judge's floor for reading a reply in words. */
	readonly floor: number;
}

export type Asking<C extends string, P, J> =
	| {
			readonly phase: "posting";
			readonly key: string;
			readonly question: Question;
			readonly asked: P;
	  }
	| {
			readonly phase: "waiting";
			readonly key: string;
			readonly question: Question;
			readonly thread: string;
			/** Replies up to here have been read. */
			readonly after: number;
	  }
	| {
			readonly phase: "reading";
			readonly key: string;
			readonly question: Question;
			readonly thread: string;
			readonly after: number;
			readonly reply: Reply;
			readonly asked: J;
	  }
	/** `by`: read by code (a reply that names a choice outright) or by Jev above the floor. */
	| {
			readonly phase: "answered";
			readonly key: string;
			readonly choice: C;
			readonly reply: Reply;
			readonly by: "code" | "jev";
	  }
	| {
			readonly phase: "post_failed";
			readonly key: string;
			readonly question: Question;
			readonly asked: P;
	  };

/** What the replies Listen asks for. */
export interface RepliesDeps {
	readonly key: string;
	readonly thread: string;
	readonly after: number;
}

/**
 * Ask: post a question (an Act), listen for replies (a Listen), and read each
 * one into one of a fixed set of answers, by code when the reply names a
 * choice as `/choice`, by a Judge otherwise. An unsure reading is set aside
 * and the ask goes on waiting: nothing reaches the parent but a typed answer.
 */
export function createAsk<const N extends string, const C extends string>(config: {
	readonly name: N;
	readonly judge: ReturnType<typeof createJudge<`${N}_read`, C>>;
}) {
	const {judge} = config;
	const post = act(`${config.name}_post`, {
		input: z.object({key: z.string(), where: z.string(), text: z.string()}),
		ok: z.object({thread: z.string(), at: z.number()}),
		err: ["post_failed"],
	});
	const replyType = `${config.name}_reply` as const;
	type Post = ReturnType<typeof post>;
	type Read = ReturnType<typeof judge.ask>;
	type State = Asking<C, Post, Read>;
	type ReplyMsg = {readonly type: typeof replyType; readonly key: string; readonly reply: Reply};

	/** The choices, and how to name one outright, under the question. */
	const footer = () =>
		[
			"",
			"Answer in words, or with one of these:",
			...judge.choices.map((c) => `- \`/${c}\`: ${judge.criteria[c]}`),
		].join("\n");

	const start = (
		key: string,
		question: Question,
		intent: string,
	): readonly [State, readonly [Post]] => {
		const asked = post({key, where: question.where, text: `${question.text}\n${footer()}`, intent});
		return [{phase: "posting", key, question, asked}, [asked]];
	};

	/** Code reads a reply that names a choice: `/resume` and nothing else that counts. */
	const named = (body: string): C | null => {
		const word = /^\s*\/([a-z_]+)\b/.exec(body)?.[1];
		return word !== undefined && (judge.choices as readonly string[]).includes(word)
			? (word as C)
			: null;
	};

	const posted = (s: State, thread: string, at: number): State =>
		s.phase === "posting"
			? {phase: "waiting", key: s.key, question: s.question, thread, after: at}
			: s;

	const failed = (s: State): State => (s.phase === "posting" ? {...s, phase: "post_failed"} : s);

	function replied(s: State, reply: Reply): readonly [State, readonly Read[]] {
		if (s.phase !== "waiting" || reply.at <= s.after) return [s, []];
		const seen = {...s, after: reply.at};
		// A login is the same in any case: `Owner` on the list is `owner` on the reply.
		const author = reply.author.toLowerCase();
		if (!s.question.who.some((w) => w.toLowerCase() === author)) return [seen, []];
		const choice = named(reply.body);
		if (choice !== null) return [{phase: "answered", key: s.key, choice, reply, by: "code"}, []];
		const asked = judge.ask({key: s.key, texts: {question: s.question.text, reply: reply.body}});
		return [{...seen, phase: "reading", reply, asked}, [asked]];
	}

	function read(s: State, ruled: Ruled<C>): State {
		if (s.phase !== "reading") return s;
		if (ruled.sure)
			return {phase: "answered", key: s.key, choice: ruled.choice, reply: s.reply, by: "jev"};
		return {phase: "waiting", key: s.key, question: s.question, thread: s.thread, after: s.after};
	}

	/** Jev could not be asked: set the reply aside, as if unsure. */
	const unread = (s: State): State =>
		s.phase === "reading"
			? {phase: "waiting", key: s.key, question: s.question, thread: s.thread, after: s.after}
			: s;

	const listening = (s: State): RepliesDeps | null =>
		s.phase === "waiting" ? {key: s.key, thread: s.thread, after: s.after} : null;

	const asked = (s: State): Post | Read | null =>
		s.phase === "posting" ? s.asked : s.phase === "reading" ? s.asked : null;

	return {
		name: config.name,
		post,
		judge,
		replyType,
		start,
		posted,
		failed,
		replied,
		read,
		unread,
		listening,
		asked,
	} as const;
}

// ---------------------------------------------------------------- spawn

/** One child, with the Sub slot it keeps for life, so a sibling ending never restarts its Subs. */
export interface Child<S> {
	readonly slot: number;
	readonly state: S;
}

export type Children<S> = Readonly<Record<string, Child<S>>>;

/**
 * Spawn: a child per item. Each child is a nested model the parent steps;
 * the parent waits until all of them are over. tea's `subs` is a fixed list
 * (Elm's `Sub.batch` takes a list built from the model), so each child takes
 * the lowest free slot of a fixed number, and the parent declares one Sub
 * entry per slot and kind ({@link slotSubs}). `null` when every slot is taken.
 */
export function spawn<S>(
	children: Children<S>,
	key: string,
	state: S,
	slots: number,
): Children<S> | null {
	if (key in children) return children;
	const taken = new Set(Object.values(children).map((c) => c.slot));
	const slot = Array.from({length: slots}, (_, i) => i).find((i) => !taken.has(i));
	return slot === undefined ? null : {...children, [key]: {slot, state}};
}

/** Step one child; an answer for a key that is not a child changes nothing. */
export function stepChild<S, C>(
	children: Children<S>,
	key: string,
	step: (state: S) => readonly [S, readonly C[]],
): readonly [Children<S>, readonly C[]] {
	const child = children[key];
	if (child === undefined) return [children, []];
	const [state, cmds] = step(child.state);
	return [{...children, [key]: {slot: child.slot, state}}, cmds];
}

export const allOver = <S>(children: Children<S>, over: (s: S) => boolean): boolean =>
	Object.values(children).every((c) => over(c.state));

/**
 * One Sub entry per slot for one kind of child Sub: on while the child in
 * that slot asks for it. `deps` sees the parent too, for what the child does
 * not keep (the lane, the knobs).
 */
export function slotSubs<P, S, T extends string, D>(
	slots: number,
	type: T,
	childrenOf: (parent: P) => Children<S> | null,
	deps: (child: S, parent: P) => D | null,
): DepKeyedSub<P, Sub<T, D>>[] {
	return Array.from({length: slots}, (_, i) =>
		listen(type, (parent: P) => {
			const children = childrenOf(parent);
			const child =
				children === null ? undefined : Object.values(children).find((c) => c.slot === i);
			return child === undefined ? null : deps(child.state, parent);
		}),
	);
}
