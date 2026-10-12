import {Cmd, defineMachine} from "@demlik/tea";
import {z} from "zod";
import {checkRun} from "./primitives.ts";

// Draft and vet, as a child machine a parent holds and steps with `applyCell`,
// the way the lane holds review. A writer (an agent turn ending in typed data,
// in one conversation) drafts; a checker (code) checks the draft; problems go
// back to the writer in the same conversation, up to a limit of tries. Then it
// stops for its parent, which decides whether a person is asked.
//
// In the primitives' words (src/primitives.ts): the checker is a Check in its
// Cmd form, and the writer is a Draft in its older form, one `claude -p` turn
// behind a Cmd, which nothing can watch or stop while it runs. The same loop
// on the Draft as a Sub is `createRefineLoop` in src/combos.ts; triage and the
// lane move to it when their agents run through the Agent SDK.
//
// It is made per use, like tea's `createJevAsk({ name })`: `createRefine({ name:
// "enrich", ... })` makes the Cmds `enrich_write` and `enrich_check`, so two
// uses in one parent never share a Msg. The state is plain data; a restart
// sends `resume`, and the Cmd that was in flight is asked again.
//
// A use may also say, purely, when a run stops early for its parent with a
// reason of its own (`stopOf`): a draft that is not one to check (a writer
// that says it is blocked), or a verdict no writer should act on (a run that
// failed for a reason the writer cannot fix).

/** A run in progress: what the writer is given, its conversation, and the tries so far. */
export interface RefineRun<B> {
	/** What the writer works from, beside the note. The checker gets it too. */
	readonly brief: B;
	/** The writer's conversation, once it has answered. */
	readonly session: string | null;
	/** Drafts asked for so far, the one in flight included. A parent that keeps one count across runs may start it partway. */
	readonly tries: number;
	/** How many drafts may be asked for before the run stops as `out_of_tries`. */
	readonly limit: number;
}

/** A run whose writer has answered at least once, so its conversation is known. */
type Drafted<B, D> = RefineRun<B> & {readonly session: string; readonly draft: D};

export type RefineState<B, D, V = unknown, R = never> =
	| {readonly phase: "idle"}
	/** `note` is what the writer is told this turn: the parent's note at the start, then the checker's problems. */
	| (RefineRun<B> & {readonly phase: "writing"; readonly note: string | null})
	| (Drafted<B, D> & {readonly phase: "checking"})
	/** Stopped: the writer's turn failed. `retry` asks it again with the same note. */
	| (RefineRun<B> & {readonly phase: "write_failed"; readonly note: string | null})
	/** Stopped: the checker could not run. `retry` checks again; `accept` takes the draft unchecked. */
	| (Drafted<B, D> & {readonly phase: "check_failed"})
	/** Stopped: the last draft still has problems and the tries are spent. `more` grants tries; `accept` takes it as it is. */
	| (Drafted<B, D> & {readonly phase: "out_of_tries"; readonly problems: readonly string[]})
	/** Stopped: the use's `stopOf` said so, before the check or after it. `retry` checks the draft (again). */
	| (Drafted<B, D> & {readonly phase: "stopped"; readonly reason: R})
	/** The draft the parent takes, with the verdict that passed it: `null` when the parent accepted it without one. */
	| {
			readonly phase: "done";
			readonly draft: D;
			readonly session: string;
			readonly tries: number;
			readonly verdict: V | null;
	  };

/** What a parent answers a stopped run with. Any answer that does not fit where it stopped changes nothing. */
export type RefineAnswer =
	| {readonly kind: "retry"}
	| {readonly kind: "more"; readonly tries: number}
	| {readonly kind: "accept"};

export type RefineMsg<B> =
	/**
	 * `session` continues a conversation the writer already had; `note` is what
	 * it is told first, beside the brief. `tries` is the count this run's first
	 * draft takes (1 when left out), so a parent can keep one count across runs.
	 */
	| {
			readonly type: "start";
			readonly brief: B;
			readonly session: string | null;
			readonly note: string | null;
			readonly limit: number;
			readonly tries?: number;
	  }
	/** Sent once after booting from saved state: ask again whatever was in flight. */
	| {readonly type: "resume"}
	| {readonly type: "answer"; readonly answer: RefineAnswer};

/** The phases a run stops in for its parent. */
export const STOPPED = ["write_failed", "check_failed", "out_of_tries", "stopped"] as const;

/** What the writer is told when its draft is sent back, by default. */
export const sentBack = (problems: readonly string[]): string =>
	[
		"Your draft was checked by code, and it does not pass yet:",
		...problems.map((p) => `- ${p}`),
		"Fix these, and answer with the whole draft again.",
	].join("\n");

export interface RefineConfig<N extends string, B, D, V, R> {
	/** Names the Cmds `<name>_write` and `<name>_check`, and so every Msg they settle with. */
	readonly name: N;
	readonly brief: z.ZodType<B>;
	readonly draft: z.ZodType<D>;
	/** What the checker hands back: data about the draft, not a pass or a fail. */
	readonly verdict: z.ZodType<V>;
	/** Pure: what is wrong with `draft`, by the checker's verdict, as sentences the writer can act on. None is a pass. */
	readonly problemsOf: (draft: D, verdict: V, brief: B) => readonly string[];
	/**
	 * Pure: whether the run stops here for its parent, and why. Asked of each
	 * new draft with `verdict` `null`, before the checker sees it, and of each
	 * verdict before its problems are read. `null` goes on. Left out, a run never stops early.
	 */
	readonly stopOf?: (draft: D, verdict: V | null, brief: B) => R | null;
	/** What the writer is told about the problems. {@link sentBack} when left out. */
	readonly feedback?: (problems: readonly string[]) => string;
}

/** Make one writer-and-checker loop: its two Cmds and the machine that runs them. */
export function createRefine<const N extends string, B, D, V, R = never>(
	config: RefineConfig<N, B, D, V, R>,
) {
	const feedback = config.feedback ?? sentBack;
	const stopOf = config.stopOf ?? (() => null);

	/** Ask the writer for a draft. `note` is what changed since its last one; `session` its conversation, or `null` for a new one. */
	const write = Cmd.define(`${config.name}_write`, {
		input: z.object({
			brief: config.brief,
			note: z.string().nullable(),
			session: z.string().nullable(),
		}),
		ok: z.object({draft: config.draft, session: z.string()}),
		err: ["agent_failed"],
	});

	/** Ask the checker about a draft. Code: it runs things and reports what it saw. */
	const check = checkRun(`${config.name}_check`, {
		input: z.object({brief: config.brief, draft: config.draft}),
		verdict: config.verdict,
	});

	type State = RefineState<B, D, V, R>;
	type RefineCmd = ReturnType<typeof write> | ReturnType<typeof check>;
	type Step = readonly [State, readonly RefineCmd[]];
	type Writing = Extract<State, {phase: "writing"}>;
	type Checking = Extract<State, {phase: "checking"}>;

	const run = (s: RefineRun<B>): RefineRun<B> => ({
		brief: s.brief,
		session: s.session,
		tries: s.tries,
		limit: s.limit,
	});
	const stay = (s: State): Step => [s, []];

	const writing = (s: RefineRun<B>, note: string | null): Step => {
		const next: Writing = {phase: "writing", ...run(s), note};
		return [next, [write({brief: s.brief, note, session: s.session})]];
	};
	const checking = (s: Drafted<B, D>): Step => {
		const next: Checking = {phase: "checking", ...run(s), session: s.session, draft: s.draft};
		return [next, [check({brief: s.brief, draft: s.draft})]];
	};
	const done = (s: Drafted<B, D>, verdict: V | null): Step => [
		{phase: "done", draft: s.draft, session: s.session, tries: s.tries, verdict},
		[],
	];
	const stopped = (s: Drafted<B, D>, reason: R): Step => [
		{phase: "stopped", ...run(s), session: s.session, draft: s.draft, reason},
		[],
	];

	/** The writer answered: stopped if the use says so, to the checker otherwise. */
	function drafted(s: Drafted<B, D>): Step {
		const reason = stopOf(s.draft, null, s.brief);
		return reason === null ? checking(s) : stopped(s, reason);
	}

	/** The checker answered: stopped if the use says so, done when nothing is wrong, back to the writer while tries are left, stopped otherwise. */
	function checked(s: Checking, verdict: V): Step {
		const reason = stopOf(s.draft, verdict, s.brief);
		if (reason !== null) return stopped(s, reason);
		const problems = config.problemsOf(s.draft, verdict, s.brief);
		if (problems.length === 0) return done(s, verdict);
		if (s.tries >= s.limit) return [{...s, phase: "out_of_tries", problems}, []];
		return writing({...run(s), tries: s.tries + 1}, feedback(problems));
	}

	function answer(s: State, a: RefineAnswer): Step {
		switch (s.phase) {
			case "write_failed":
				return a.kind === "retry" ? writing(s, s.note) : stay(s);
			case "check_failed":
				return a.kind === "retry" ? checking(s) : a.kind === "accept" ? done(s, null) : stay(s);
			case "stopped":
				return a.kind === "retry" ? checking(s) : stay(s);
			case "out_of_tries":
				if (a.kind === "accept") return done(s, null);
				return a.kind === "more" && a.tries >= 1
					? writing({...run(s), tries: s.tries + 1, limit: s.limit + a.tries}, feedback(s.problems))
					: stay(s);
			default:
				return stay(s);
		}
	}

	function resume(s: State): Step {
		switch (s.phase) {
			case "writing":
				return [s, [write({brief: s.brief, note: s.note, session: s.session})]];
			case "checking":
				return [s, [check({brief: s.brief, draft: s.draft})]];
			default:
				return stay(s);
		}
	}

	type WriteOk = {readonly value: {readonly draft: D; readonly session: string}};
	type CheckOk = {readonly value: V};
	type Start = Extract<RefineMsg<B>, {type: "start"}>;

	const update = {
		start: (s: State, m: Start): Step => {
			if (s.phase !== "idle") return stay(s);
			const tries = Math.max(1, m.tries ?? 1);
			return writing(
				{brief: m.brief, session: m.session, tries, limit: Math.max(tries, m.limit)},
				m.note,
			);
		},
		resume: (s: State): Step => resume(s),
		answer: (s: State, m: Extract<RefineMsg<B>, {type: "answer"}>): Step => answer(s, m.answer),
		[write.okType]: (s: State, m: WriteOk): Step =>
			s.phase === "writing"
				? drafted({...run(s), session: m.value.session, draft: m.value.draft})
				: stay(s),
		[write.errType]: (s: State): Step =>
			s.phase === "writing" ? [{...s, phase: "write_failed"}, []] : stay(s),
		[check.okType]: (s: State, m: CheckOk): Step =>
			s.phase === "checking" ? checked(s, m.value) : stay(s),
		[check.errType]: (s: State): Step =>
			s.phase === "checking" ? [{...s, phase: "check_failed"}, []] : stay(s),
	};

	const machine = defineMachine({
		types: {model: {} as State, msg: {} as RefineMsg<B>, ctx: undefined},
		cmds: [write, check],
		init: (loaded) => [loaded ?? {phase: "idle"}, []],
		// The settle cells are keyed by this use's own Cmd names, which the type of a generic name cannot spell out.
		update: update as never,
	});

	/** Whether the run is waiting on its parent: done, or stopped for an answer. */
	const isOver = (s: State): s is Extract<State, {phase: "done" | (typeof STOPPED)[number]}> =>
		s.phase === "done" || (STOPPED as readonly string[]).includes(s.phase);

	return {name: config.name, write, check, machine, isOver, problemsOf: config.problemsOf};
}
