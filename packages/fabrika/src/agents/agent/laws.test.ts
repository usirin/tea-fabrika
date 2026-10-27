import {Effect, Exit, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {type AgentsConfig, formOf, makeAgents} from "./core.ts";
import {type FakeScript, fakeAdapter, saying} from "./fake.ts";
import {memorySessions} from "./sessions.ts";
import {
	type Agents,
	type Ended,
	type Heard,
	NO_LIMITS,
	type Raw,
	type Reaper,
	type Tokens,
	type Turn,
} from "./turn.ts";

// The laws of the agent interface, on the fake adapter: what it adds once for
// every adapter holds for any script a maker could play. Each law is a
// function over a way to make the service, so it runs twice: on the real one,
// where it must hold, and on the same service with one mistake planted, where
// it must break. A law that passes a planted mistake proves nothing.

const Answer = Schema.Struct({done: Schema.Boolean, note: Schema.String});
type Answer = typeof Answer.Type;

type Make = (config: AgentsConfig) => typeof Agents.Service;

const turnOf = (over: Partial<Turn<Answer>> = {}): Turn<Answer> => ({
	provider: "fake",
	session: "s-1",
	folder: "/nowhere",
	prompt: "do the job",
	answer: Answer,
	model: null,
	effort: null,
	limits: NO_LIMITS,
	...over,
});

const quietReaper: Reaper = {
	tree: () => Effect.succeed([]),
	alive: () => Effect.succeed([]),
	kill: () => Effect.void,
};

/** One whole run: what was heard, and how it ended. */
const runAll = (agents: typeof Agents.Service, turn: Turn<Answer>, take?: number) =>
	Effect.runPromise(
		Effect.exit(
			Stream.runCollect(
				take === undefined ? agents.run(turn) : agents.run(turn).pipe(Stream.take(take)),
			),
		),
	).then((exit) => ({
		heard: Exit.isSuccess(exit) ? [...exit.value] : [],
		exit,
	}));

const setup = (make: Make, script: (n: number) => FakeScript, more: Partial<AgentsConfig> = {}) => {
	const fake = fakeAdapter((_t, n) => script(n));
	const sessions = memorySessions();
	const agents = make({adapters: {fake}, sessions, reaper: quietReaper, ...more});
	return {fake, sessions, agents};
};

// ---------------------------------------------------------------- what a maker may say

const fit = fc
	.record({done: fc.boolean(), note: fc.string({maxLength: 8})})
	.map((a) => ({text: JSON.stringify(a), value: a as Answer | null}));
const misfit = fc.oneof(
	fc.constant({text: '{"done": "maybe"}', value: null}),
	fc
		.string({maxLength: 12})
		.map((s) => ({text: `no json here ${s.replace(/[{}]/g, "")}`, value: null})),
);
const tokens: fc.Arbitrary<Tokens> = fc.record({
	input: fc.nat(1000),
	cached: fc.nat(100),
	output: fc.nat(500),
});
const step = fc.oneof(
	fc.oneof(fit, misfit).map((s) => ({raw: {_tag: "said", text: s.text} as Raw, value: s.value})),
	fc
		.record({
			id: fc.constantFrom("t1", "t2", "t3", "t4"),
			status: fc.constantFrom("pending", "completed"),
		})
		.map((t) => ({raw: {_tag: "tool", id: t.id, title: "Read", status: t.status} as Raw})),
	fc.constant({raw: {_tag: "asked", id: "a1", title: "Write"} as Raw}),
	tokens.map((t) => ({raw: {_tag: "tokens", tokens: t, whole: false} as Raw})),
	tokens.map((t) => ({raw: {_tag: "tokens", tokens: t, whole: true} as Raw})),
);
/** A script: some steps, then an end or not. */
const script = fc.record({
	steps: fc.array(step, {maxLength: 12}),
	ends: fc.boolean(),
});
type Script = typeof script extends fc.Arbitrary<infer S> ? S : never;
const scriptOf = (s: Script): FakeScript => ({
	raws: [
		...s.steps.map((x) => x.raw),
		...(s.ends
			? [{_tag: "ended", stop: "end_turn", structured: undefined, usd: null, requests: 1} as Raw]
			: []),
	],
});

const OPTS = {numRuns: 150, seed: 1};
const endOf = (heard: readonly Heard<Answer>[]) =>
	heard.filter((h): h is Ended<Answer> => h._tag === "ended");

// ---------------------------------------------------------------- the laws

interface Law {
	readonly name: string;
	readonly check: (make: Make) => Promise<void>;
}

const laws: Law[] = [
	{
		name: "a turn ends exactly once, last; a stream with no end fails as broken",
		check: (make) =>
			fc.assert(
				fc.asyncProperty(script, async (s) => {
					const {agents} = setup(make, () => scriptOf(s));
					const {heard, exit} = await runAll(agents, turnOf());
					if (!s.ends) {
						expect(Exit.isFailure(exit)).toBe(true);
						return;
					}
					expect(endOf(heard)).toHaveLength(1);
					expect(heard.at(-1)?._tag).toBe("ended");
				}),
				OPTS,
			),
	},
	{
		name: "the answer is the last message read by the schema, null on a misfit",
		check: (make) =>
			fc.assert(
				fc.asyncProperty(script, async (s) => {
					const {agents} = setup(make, () => scriptOf({...s, ends: true}));
					const {heard} = await runAll(agents, turnOf());
					const said = s.steps.flatMap((x) => ("value" in x ? [x.value] : []));
					const want = said.length === 0 ? null : (said.at(-1) ?? null);
					expect(endOf(heard)[0]?.answer ?? null).toEqual(want);
				}),
				OPTS,
			),
	},
	{
		name: "the turn's tokens: the maker's last total, else every request added up",
		check: (make) =>
			fc.assert(
				fc.asyncProperty(script, async (s) => {
					const {agents} = setup(make, () => scriptOf({...s, ends: true}));
					const {heard} = await runAll(agents, turnOf());
					const ts = s.steps.flatMap((x) => (x.raw._tag === "tokens" ? [x.raw] : []));
					const wholes = ts.filter((t) => t.whole);
					const sum = ts
						.filter((t) => !t.whole)
						.reduce(
							(a, t) => ({
								input: a.input + t.tokens.input,
								cached: a.cached + t.tokens.cached,
								output: a.output + t.tokens.output,
							}),
							{input: 0, cached: 0, output: 0},
						);
					const end = endOf(heard)[0];
					expect(end?.tokens).toEqual(wholes.at(-1)?.tokens ?? sum);
					expect(end?.counted).toBe(
						wholes.length > 0 ? "turn" : ts.length > 0 ? "requests" : "none",
					);
				}),
				OPTS,
			),
	},
	{
		name: "the session is ours: the maker's id never shows, and the next turn carries the maker's on",
		check: (make) =>
			fc.assert(
				fc.asyncProperty(fc.stringMatching(/^[a-z]{1,6}\/[0-9]{1,3}$/), async (session) => {
					const {agents, fake} = setup(make, () => saying('{"done":true,"note":""}'));
					const first = await runAll(agents, turnOf({session}));
					const second = await runAll(agents, turnOf({session}));
					for (const run of [first, second]) {
						expect(run.heard[0]).toEqual({_tag: "started", session});
						expect(JSON.stringify(run.heard)).not.toContain("fake-own-");
					}
					expect(fake.seen.started[0]?.resume).toBeNull();
					expect(fake.seen.started[1]?.resume).toBe("fake-own-1");
					expect(await Effect.runPromise(agents.knows(session))).toBe("fake");
				}),
				{...OPTS, numRuns: 40},
			),
	},
	{
		name: "a session stays on its provider; a cap the adapter cannot hold fails before it starts",
		check: async (make) => {
			const fake = fakeAdapter(() => saying("{}"));
			const other = fakeAdapter(() => saying("{}"));
			const sessions = memorySessions();
			const agents = make({adapters: {fake, other}, sessions, reaper: quietReaper});
			await runAll(agents, turnOf());
			const moved = await runAll(agents, turnOf({provider: "other"}));
			expect(Exit.isFailure(moved.exit)).toBe(true);
			expect(JSON.stringify(moved.exit)).toContain("other_provider");
			const capped = await runAll(agents, turnOf({session: "s-2", limits: {...NO_LIMITS, usd: 1}}));
			expect(JSON.stringify(capped.exit)).toContain("cannot_limit");
			expect(other.seen.started).toHaveLength(0);
			expect(fake.seen.started).toHaveLength(1);
		},
	},
	{
		name: "a tool limit of k lets at most k tool calls through, then ends as max_turn_requests",
		check: (make) =>
			fc.assert(
				fc.asyncProperty(script, fc.integer({min: 0, max: 3}), async (s, k) => {
					const {agents} = setup(make, () => scriptOf({...s, ends: true}));
					const {heard} = await runAll(agents, turnOf({limits: {...NO_LIMITS, tools: k}}));
					const ids = new Set(heard.flatMap((h) => (h._tag === "tool" ? [h.id] : [])));
					expect(ids.size).toBeLessThanOrEqual(k);
					const all = new Set(s.steps.flatMap((x) => (x.raw._tag === "tool" ? [x.raw.id] : [])));
					if (all.size > k) expect(endOf(heard)[0]?.stop).toBe("max_turn_requests");
				}),
				OPTS,
			),
	},
	{
		name: "leaving at any point stops the maker once and closes it once",
		check: (make) =>
			fc.assert(
				fc.asyncProperty(script, fc.integer({min: 0, max: 14}), async (s, take) => {
					// A script with no end hangs, as a stuck agent: leave it within what it says (started + steps).
					const {agents, fake} = setup(make, () => ({...scriptOf(s), hang: !s.ends}));
					await runAll(agents, turnOf(), Math.max(1, Math.min(take, s.steps.length + 1)));
					expect(fake.seen.stopped).toBe(1);
					expect(fake.seen.closed).toBe(1);
				}),
				OPTS,
			),
	},
	{
		name: "a turn stuck past its clock ends as over_time",
		check: async (make) => {
			const {agents, fake} = setup(make, () => ({raws: [], hang: true}));
			const {heard} = await runAll(agents, turnOf({limits: {...NO_LIMITS, seconds: 0.05}}));
			expect(endOf(heard)[0]?.stop).toBe("over_time");
			expect(fake.seen.stopped).toBe(1);
		},
	},
	{
		name: "the prompt carries the schema only when the maker has no schema field",
		check: async (make) => {
			const plain = fakeAdapter(() => saying("{}"));
			const native = fakeAdapter(() => saying("{}"), {usd: false, schema: true});
			const agents = make({
				adapters: {plain, native},
				sessions: memorySessions(),
				reaper: quietReaper,
			});
			await runAll(agents, turnOf({provider: "plain", session: "p"}));
			await runAll(agents, turnOf({provider: "native", session: "n"}));
			expect(plain.seen.started[0]?.prompt).toContain(formOf(plain.seen.started[0]?.schema ?? {}));
			expect(native.seen.started[0]?.prompt).toBe("do the job");
		},
	},
	{
		name: "what outlives the maker's own stop is killed; what it ended is left alone",
		check: async (make) => {
			for (const ends of [true, false]) {
				const live = new Set([100, 101, 102]);
				const killed: number[] = [];
				const reaper: Reaper = {
					tree: (pid) => Effect.succeed(pid === 100 ? [101, 102] : []),
					alive: (pids) => Effect.succeed(pids.filter((p) => live.has(p))),
					kill: (pids) =>
						Effect.sync(() => {
							for (const p of pids) {
								killed.push(p);
								live.delete(p);
							}
						}),
				};
				const base = fakeAdapter(() => saying('{"done":true,"note":""}'));
				// A maker whose stop ends its own process; `ends`: its commands too.
				const fake = {
					...base,
					start: (t: Parameters<typeof base.start>[0]) =>
						Effect.map(base.start(t), (r) => ({
							...r,
							pid: 100,
							stop: Effect.sync(() => {
								live.delete(100);
								if (ends) live.clear();
							}),
						})),
				};
				const agents = make({adapters: {fake}, sessions: memorySessions(), reaper});
				await runAll(agents, turnOf());
				expect(killed.sort()).toEqual(ends ? [] : [101, 102]);
				expect(live.size).toBe(0);
			}
		},
	},
];

// ---------------------------------------------------------------- planted mistakes

/** The real service with its stream bent after the fact: each a mistake an adapter-side fix could make. */
const bent =
	(
		f: (heard: Stream.Stream<Heard<unknown>, unknown>) => Stream.Stream<Heard<unknown>, unknown>,
	): Make =>
	(config) => {
		const real = makeAgents(config);
		return {
			...real,
			run: (turn) => f(real.run(turn) as never) as never,
		};
	};

const PLANTED: Readonly<Record<string, Make>> = {
	"a turn ends exactly once, last; a stream with no end fails as broken": bent((s) =>
		Stream.flatMap(
			s,
			(h): Stream.Stream<Heard<unknown>> =>
				h._tag === "ended" ? Stream.make(h, h) : Stream.make(h),
		),
	),
	"the answer is the last message read by the schema, null on a misfit": (config) => {
		// The first message read, not the last.
		const real = makeAgents(config);
		return {
			...real,
			run: (turn) => {
				let first: unknown = null;
				return Stream.map(real.run(turn), (h) => {
					if (h._tag === "said" && first === null) first = h.text;
					if (h._tag !== "ended") return h;
					const read = Schema.decodeUnknownOption(Schema.fromJsonString(Answer));
					const got = typeof first === "string" ? read(first) : null;
					return {...h, answer: got !== null && got._tag === "Some" ? got.value : null} as never;
				});
			},
		};
	},
	"the turn's tokens: the maker's last total, else every request added up": (config) =>
		// A maker's turn total taken as one more request, and added to the rest.
		makeAgents({
			...config,
			adapters: Object.fromEntries(
				Object.entries(config.adapters).map(([k, a]) => [
					k,
					{
						...a,
						start: (t) =>
							Effect.map(a.start(t), (r) => ({
								...r,
								updates: Stream.map(r.updates, (raw) =>
									raw._tag === "tokens" ? {...raw, whole: false} : raw,
								),
							})),
					},
				]),
			),
		}),
	"the session is ours: the maker's id never shows, and the next turn carries the maker's on": (
		config,
	) =>
		// A map that forgets: every turn opens a new session.
		makeAgents({
			...config,
			sessions: {get: () => Effect.succeed(null), put: () => Effect.void},
		}),
	"a session stays on its provider; a cap the adapter cannot hold fails before it starts": (
		config,
	) => {
		// The provider check skipped: the map is asked as if empty when the provider differs.
		const real = config.sessions;
		return makeAgents({
			...config,
			sessions: {...real, get: (s) => real.get(s).pipe(Effect.map(() => null))},
		});
	},
	"a tool limit of k lets at most k tool calls through, then ends as max_turn_requests": (
		config,
	) => {
		const real = makeAgents(config);
		// The limit dropped on the way in.
		return {...real, run: (turn) => real.run({...turn, limits: {...turn.limits, tools: null}})};
	},
	"leaving at any point stops the maker once and closes it once": (config) =>
		// Adapters whose gentle stop is never asked for.
		makeAgents({
			...config,
			adapters: Object.fromEntries(
				Object.entries(config.adapters).map(([k, a]) => [
					k,
					{...a, start: (t) => Effect.map(a.start(t), (r) => ({...r, stop: Effect.void}))},
				]),
			),
		}),
	"a turn stuck past its clock ends as over_time": (config) => {
		const real = makeAgents(config);
		// The clock dropped, and a stand-in end after 0.2 s so the test does not hang.
		return {
			...real,
			run: (turn) =>
				real
					.run({...turn, limits: {...turn.limits, seconds: null}})
					.pipe(Stream.interruptWhen(Effect.sleep("200 millis"))),
		};
	},
	"the prompt carries the schema only when the maker has no schema field": (config) =>
		// Every adapter told it holds a schema field.
		makeAgents({
			...config,
			adapters: Object.fromEntries(
				Object.entries(config.adapters).map(([k, a]) => [
					k,
					{...a, holds: {...a.holds, schema: true}},
				]),
			),
		}),
	"what outlives the maker's own stop is killed; what it ended is left alone": (config) =>
		// A reaper that never kills.
		makeAgents({...config, reaper: {...config.reaper, kill: () => Effect.void}}),
};

describe("the agent interface's laws, on the fake adapter", () => {
	for (const law of laws) {
		it(law.name, () => law.check(makeAgents));
	}
});

describe("each law catches its planted mistake", () => {
	for (const law of laws) {
		it(law.name, async () => {
			const planted = PLANTED[law.name];
			expect(planted, "every law has a planted mistake").toBeDefined();
			await expect(law.check(planted as Make)).rejects.toThrow();
		});
	}
});
