import {Clock, Effect, Option, Stream} from "effect";
import {jsonSchema, reader} from "../claude/schema.ts";
import {
	type Adapter,
	type Agents,
	type Counted,
	type Ended,
	failed,
	type Heard,
	NO_TOKENS,
	type Raw,
	type Reaper,
	type Sessions,
	type Stopped,
	type Tokens,
	type Turn,
} from "./turn.ts";

// What the interface adds once, for every adapter (./turn.ts). An adapter
// only starts its maker's agent and says what it heard, as `Raw`. Here:
//
//   - the provider table: a turn names its row, and nothing else changes;
//   - our session id, mapped to the maker's, kept in `Sessions`;
//   - a session stays on the provider it was opened on;
//   - the prompt carries the schema when the maker has no schema field;
//   - the answer, read with the stage's schema from the maker's typed answer
//     or the last message: `null` on a misfit, never text;
//   - the turn's tokens: the maker's total, or each request's added up;
//   - a dollar cap only where the adapter holds one, else the turn fails at start;
//   - a tool-call limit and a clock, for every adapter;
//   - exactly one end, and nothing after it;
//   - the stop: the maker's own gentle stop, then every process that was
//     under the agent and outlived it is killed.

/** How long a stop waits for the agent's process tree to go before it kills what is left. */
const GRACE_MS = 3_000;

/** The schema, for a maker with no schema field: the prompt asks for one JSON object, last. */
export const formOf = (schema: Record<string, unknown>) =>
	[
		"",
		"At the very end, reply with one JSON object and nothing after it, matching this JSON Schema:",
		JSON.stringify(schema),
	].join("\n");

/** The last JSON object in a text that the schema reads, or none. */
export const lastFit = <A>(read: (value: unknown) => Option.Option<A>, text: string): A | null => {
	const whole = Option.liftThrowable(JSON.parse)(text.trim());
	if (Option.isSome(whole)) {
		const fit = read(whole.value);
		if (Option.isSome(fit)) return fit.value;
	}
	// A message that holds an object among other words: try each `{` from the last.
	for (let at = text.lastIndexOf("{"); at >= 0; at = text.lastIndexOf("{", at - 1)) {
		for (let end = text.lastIndexOf("}"); end > at; end = text.lastIndexOf("}", end - 1)) {
			const parsed = Option.liftThrowable(JSON.parse)(text.slice(at, end + 1));
			if (Option.isNone(parsed)) continue;
			const fit = read(parsed.value);
			if (Option.isSome(fit)) return fit.value;
		}
		if (at === 0) break;
	}
	return null;
};

const add = (a: Tokens, b: Tokens): Tokens => ({
	input: a.input + b.input,
	cached: a.cached + b.cached,
	output: a.output + b.output,
});

export interface AgentsConfig {
	/** The provider table: a turn's `provider` is a key here. */
	readonly adapters: Readonly<Record<string, Adapter>>;
	readonly sessions: Sessions;
	readonly reaper: Reaper;
	/** Each stop, for a log or a trace. The machine never reads it. */
	readonly stopped?: (stopped: Stopped) => void;
}

/** The service, on a provider table. */
export const makeAgents = (config: AgentsConfig): typeof Agents.Service => {
	const {reaper} = config;
	/**
	 * The stop that ends child commands: find what is under the agent, ask the
	 * maker to stop, give its tree a moment to go, then kill what is left.
	 */
	const stopAndReap = (turn: Turn<unknown>, pid: number | null, gentle: Effect.Effect<void>) =>
		Effect.gen(function* () {
			const began = yield* Clock.currentTimeMillis;
			const under = pid === null ? [] : yield* reaper.tree(pid);
			const all = pid === null ? under : [pid, ...under];
			yield* gentle.pipe(Effect.timeout(GRACE_MS), Effect.ignore);
			let left = yield* reaper.alive(all);
			for (let waited = 0; left.length > 0 && waited < GRACE_MS; waited += 100) {
				yield* Effect.sleep("100 millis");
				left = yield* reaper.alive(all);
			}
			if (left.length > 0) yield* reaper.kill(left);
			const ended = yield* Clock.currentTimeMillis;
			config.stopped?.({
				provider: turn.provider,
				session: turn.session,
				ms: ended - began,
				under: under.length,
				killed: left.filter((p) => p !== pid).length,
			});
		});
	return {
		knows: (session) =>
			config.sessions.get(session).pipe(Effect.map((known) => known?.provider ?? null)),
		run: <A>(turn: Turn<A>) =>
			Stream.unwrap(
				Effect.gen(function* () {
					const adapter = config.adapters[turn.provider];
					if (adapter === undefined)
						return yield* failed("no_provider", `no provider ${turn.provider} in the table`);
					if (turn.limits.usd !== null && !adapter.holds.usd)
						return yield* failed(
							"cannot_limit",
							`${turn.provider} holds no dollar cap; run it with usd: null`,
						);
					const known = yield* config.sessions.get(turn.session);
					if (known !== null && known.provider !== turn.provider)
						return yield* failed(
							"other_provider",
							`session ${turn.session} was opened on ${known.provider}`,
						);
					const schema = jsonSchema(turn.answer);
					const read = reader(turn.answer);
					const running = yield* adapter.start({
						folder: turn.folder,
						prompt: adapter.holds.schema ? turn.prompt : `${turn.prompt}\n${formOf(schema)}`,
						schema,
						resume: known?.own ?? null,
						session: turn.session,
						model: turn.model,
						effort: turn.effort,
						usd: turn.limits.usd,
					});
					// Added after the adapter's own finalizer, so it runs first: the gentle stop and the reaping
					// happen while the process is still there to be asked.
					yield* Effect.addFinalizer(() => stopAndReap(turn, running.pid, running.stop));

					const state = {
						text: "",
						tools: new Set<string>(),
						summed: NO_TOKENS,
						whole: null as Tokens | null,
						sawRequest: false,
						over: false,
					};
					const tokens = () => state.whole ?? state.summed;
					const counted = (last: boolean): Counted =>
						state.whole !== null ? "turn" : state.sawRequest ? "requests" : last ? "last" : "none";
					const end = (
						stop: Ended<A>["stop"],
						more: {
							structured?: unknown;
							usd?: number | null;
							requests?: number | null;
							last?: Tokens;
						},
					): Ended<A> => {
						const typed = more.structured === undefined ? Option.none() : read(more.structured);
						const measured = state.whole !== null || state.sawRequest;
						return {
							_tag: "ended",
							stop,
							answer: Option.isSome(typed) ? typed.value : lastFit(read, state.text),
							tokens: measured ? tokens() : (more.last ?? NO_TOKENS),
							counted: counted(more.last !== undefined),
							usd: more.usd ?? null,
							requests: more.requests ?? null,
						};
					};

					const step = (raw: Raw | "over_time"): Effect.Effect<readonly Heard<A>[]> =>
						Effect.gen(function* () {
							if (raw === "over_time") return [end("over_time", {})];
							switch (raw._tag) {
								case "opened":
									if (known === null)
										yield* config.sessions.put(turn.session, turn.provider, raw.own);
									return [{_tag: "started", session: turn.session}];
								case "said":
									state.text = raw.text;
									return [raw];
								case "tool": {
									state.tools.add(raw.id);
									const limit = turn.limits.tools;
									if (limit !== null && state.tools.size > limit)
										return [end("max_turn_requests", {})];
									return [raw];
								}
								case "asked":
									return [raw];
								case "tokens":
									if (raw.whole) state.whole = raw.tokens;
									else {
										state.sawRequest = true;
										state.summed = add(state.summed, raw.tokens);
									}
									return [{_tag: "tokens", tokens: tokens()}];
								case "ended":
									return [
										end(raw.stop, {
											structured: raw.structured,
											usd: raw.usd,
											requests: raw.requests,
											...(raw.last === undefined ? {} : {last: raw.last}),
										}),
									];
							}
						});

					const clock =
						turn.limits.seconds === null
							? Stream.empty
							: Stream.fromEffect(
									Effect.sleep(turn.limits.seconds * 1000).pipe(Effect.as("over_time" as const)),
								);
					const heard = running.updates.pipe(
						// The agent's stream ending ends the turn; the clock never keeps it open.
						Stream.merge(clock, {haltStrategy: "left"}),
						Stream.mapEffect(step),
						Stream.flattenIterable,
						Stream.takeUntil((h) => h._tag === "ended"),
					);
					// A stream that ends with no end is a broken run.
					const tail = Stream.suspend(() =>
						state.over
							? Stream.empty
							: Stream.fail(failed("broke", "the agent's stream ended with no end")),
					);
					return Stream.concat(
						heard.pipe(Stream.tap((h) => Effect.sync(() => (state.over ||= h._tag === "ended")))),
						tail,
					);
				}),
			),
	};
};
