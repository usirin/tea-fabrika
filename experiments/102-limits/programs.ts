// Experiment 102's programs, on the package's exports alone.
//
//   agent       a stub agent: no model calls. Each turn costs a made-up amount (the same for the
//               same name, turn and lease), says so on stdout (the provider's bill), sleeps, then
//               charges it. With admission it holds the turn's upper bound first. A builder asks
//               its scouts supervisor for scouts; a scout is a temporary child that does turns too.
//   the tree    top (one_for_one) over one ticket per case and copy. A ticket is a supervisor
//               over its scouts supervisor (`ss:`, children capped) and its builder (`b:`).
//               Every limit is in a child spec: top's spec limits each ticket, a ticket's spec its
//               builder and scouts supervisor, a builder's start_child its scouts.
//
// The cases, one ticket each (the large run has more copies, and more money to spend):
//
//   own    the builder crosses its own dollar limit (admission on)
//   ownn   the same with no admission: the charge after a turn is the only check
//   tok    the builder crosses its own token limit
//   sum    the builder and three scouts, each under its own limit, cross the ticket's together
//   sumn   the same with no admission
//   loop   the builder crashes after every turn: a crash loop that must stop at its limit
//   kill   the harness SIGKILLs the builder's host mid-turn, later freezes it past its lease
//   wall   the ticket and its builder have wall time; the builder crashes once on the way
//   burst  the builder asks for ten scouts at once against `children: 3`, twice
import {defineMachine} from "@demlik/tea";
import type {Limits} from "@kampus/fabrika-old";
import {
	type ChildSpec,
	defineProgram,
	envelope,
	input,
	Reply,
	Self,
	type SupervisorSpec,
	streams,
	supervisor,
} from "@kampus/fabrika-old";
import {Duration, Effect, Exit, Schedule, Schema, Stream} from "effect";

const EVERY_100_MS = Schedule.spaced(Duration.millis(100));

export const CASES = [
	"own",
	"ownn",
	"tok",
	"sum",
	"sumn",
	"loop",
	"kill",
	"wall",
	"burst",
] as const;
export type Case = (typeof CASES)[number];

/** One turn: between `min` and `max` dollars and tokens. The hold is the max: an upper bound. */
export const TURN = {usdMin: 0.01, usdMax: 0.05, tokMin: 500, tokMax: 2500, ms: 150} as const;
export const HOLD = {usd: TURN.usdMax, tokens: TURN.tokMax} as const;
/** Scouts asked per burst, and the scouts supervisor's cap. */
export const BURST = {asks: 10, cap: 3, bursts: 2, scoutTurns: 3} as const;

export const ticket = (c: Case, i: number) => `t:${c}:${i}`;
export const builder = (c: Case, i: number) => `b:${c}:${i}`;
export const scouts = (c: Case, i: number) => `ss:${c}:${i}`;
export const scout = (c: Case, i: number, k: number) => `sc:${c}:${i}:${k}`;

/** The run's size, the same in every host process: `SCALE` multiplies every dollar limit. */
export type Size = {readonly perCase: number; readonly scale: number};

const caseOf = (name: string) => name.split(":")[1] as Case;

/** Every limit, by the spec that declares it. */
export const limitsOf = (size: Size) => {
	const usd = (x: number) => Math.round(x * size.scale * 100) / 100;
	return {
		ticket: (c: Case): Limits =>
			c === "sum" || c === "sumn"
				? {usd: usd(1)}
				: c === "wall"
					? {usd: usd(5), wallMs: 4000}
					: {usd: usd(5)},
		builder: (c: Case): Limits | undefined =>
			c === "own" || c === "ownn"
				? {usd: usd(0.5)}
				: c === "tok"
					? {tokens: Math.round(20_000 * size.scale)}
					: c === "sum" || c === "sumn"
						? {usd: usd(0.6)}
						: c === "loop"
							? {usd: usd(0.4)}
							: c === "kill"
								? {usd: usd(0.8)}
								: c === "wall"
									? {wallMs: 2000}
									: undefined,
		scouts: {children: BURST.cap} satisfies Limits,
		scout: (c: Case): Limits => (c === "burst" ? {usd: usd(0.2)} : {usd: usd(0.4)}),
	};
};

/** How many scouts a case's builder may ask for, over the whole run. */
const scoutsAsked = (c: Case) =>
	c === "sum" || c === "sumn" ? 3 : c === "burst" ? BURST.asks * BURST.bursts : 0;

export const namesOf = (size: Size) => {
	const all = CASES.flatMap((c) =>
		Array.from({length: size.perCase}, (_, n) => {
			const i = n + 1;
			return {
				c,
				i,
				ticket: ticket(c, i),
				builder: builder(c, i),
				scouts: scouts(c, i),
				scout: Array.from({length: scoutsAsked(c)}, (_, k) => scout(c, i, k + 1)),
			};
		}),
	);
	return {
		all,
		tickets: all.map((x) => x.ticket),
		supervisors: ["top", ...all.flatMap((x) => [x.ticket, x.scouts])],
		agents: all.flatMap((x) => [x.builder, ...x.scout]),
	};
};

// ---------------------------------------------------------------- the supervisors

const LOOSE = {strategy: "one_for_one", intensity: 100, periodMs: 60_000} as const;

export const specOf = (size: Size, name: string): SupervisorSpec => {
	const L = limitsOf(size);
	if (name === "top")
		return {
			...LOOSE,
			children: namesOf(size).all.map((x): ChildSpec => ({
				name: x.ticket,
				restart: "permanent",
				type: "supervisor",
				limits: L.ticket(x.c),
			})),
		};
	const c = caseOf(name);
	const i = Number(name.split(":")[2]);
	if (name.startsWith("t:")) {
		const b = L.builder(c);
		return {
			...LOOSE,
			// The crash loop restarts quickly: the limit, not intensity, has to stop it.
			backoff: {minMs: 20, maxMs: 100, resetAfterMs: 5000},
			children: [
				{name: scouts(c, i), restart: "permanent", type: "supervisor", limits: L.scouts},
				{name: builder(c, i), restart: "permanent", ...(b === undefined ? {} : {limits: b})},
			],
		};
	}
	// A scouts supervisor starts with no children: its builder adds them (OTP's dynamic children).
	return {...LOOSE, children: []};
};

export const supervisorProgram = (size: Size, name: string) => {
	const sup = supervisor(name, specOf(size, name));
	if (!sup.ok) throw new Error(`${name}: the spec is refused: ${sup.why}`);
	return sup.program;
};

// ---------------------------------------------------------------- the stub agent

/** FNV-1a, to a number in [0, 1): the same turn under the same lease always costs the same. */
const unit = (s: string) => {
	let h = 0x811c9dc5;
	for (let k = 0; k < s.length; k++) {
		h ^= s.charCodeAt(k);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h / 0x1_0000_0000;
};
export const costOf = (name: string, turn: string, fence: number) => {
	const u = unit(`${name}|${turn}|${fence}`);
	return {
		usd: Math.round((TURN.usdMin + u * (TURN.usdMax - TURN.usdMin)) * 1e6) / 1e6,
		tokens: Math.round(TURN.tokMin + u * (TURN.tokMax - TURN.tokMin)),
	};
};

/** The agent's journal: the last turn it charged. The host starts feeding it once it has loaded. */
export const Turns = Schema.Struct({turns: Schema.Number});
export type Turns = typeof Turns.Type;
const turnsMachine = defineMachine({
	types: {
		model: {} as Turns,
		msg: {} as {readonly type: "turned"; readonly turn: number},
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {turns: 0}, []],
	update: {turned: (s, m) => [{turns: Math.max(s.turns, m.turn)}, []]},
});

const SpendRow = Schema.Struct({turn: Schema.String});
const decodeSpend = Schema.decodeUnknownExit(Schema.fromJsonString(SpendRow));
const decodeReply = Schema.decodeUnknownExit(Schema.fromJsonString(Reply));

type Plan = {
	readonly admit: boolean;
	/** Turns, then it exits `normal`; null: until it is stopped. */
	readonly turns: number | null;
	readonly crash: "never" | "every" | "once";
	readonly asks: "none" | "three" | "bursts";
};
const planOf = (name: string): Plan => {
	const c = caseOf(name);
	const admit = c !== "ownn" && c !== "sumn";
	if (name.startsWith("sc:"))
		return {
			admit,
			turns: c === "burst" ? BURST.scoutTurns : null,
			crash: "never",
			asks: "none",
		};
	return {
		admit,
		turns: c === "burst" ? 0 : null,
		crash: c === "loop" ? "every" : c === "wall" ? "once" : "never",
		asks: c === "sum" || c === "sumn" ? "three" : c === "burst" ? "bursts" : "none",
	};
};

/** One stdout line: the provider's bill, and what the program saw. */
export type Say = (o: Record<string, unknown>) => void;

export const agent = (size: Size, say: Say) =>
	defineProgram({
		name: "stub-agent",
		description:
			"Turns that cost money and tokens, held before and charged after; a builder asks for scouts.",
		inputs: {inbox: input(envelope(Schema.Unknown), "Replies to its asks; read from the ledger.")},
		outputs: {},
		main: ({inputs}) =>
			Effect.gen(function* () {
				const self = yield* Self;
				const {name, fence, incarnation} = self;
				const plan = planOf(name);
				const c = caseOf(name);
				const i = Number(name.split(":")[2]);
				const L = limitsOf(size);
				const line = (o: Record<string, unknown>) => Effect.sync(() => say({name, fence, ...o}));
				// It takes nothing from its inbox (replies are read from the ledger): cursor 0.
				const handle = yield* self.run(
					turnsMachine,
					{schema: Turns, cursor: () => 0},
					{ctx: undefined},
				);
				const journal = yield* handle.ready;
				yield* inputs.inbox.pipe(Stream.runDrain, Effect.forkScoped);
				/** Again every 100 ms while `again` says so. */
				const retry = <A>(e: Effect.Effect<A>, again: (a: A) => boolean) =>
					e.pipe(Effect.repeat({until: (a) => !again(a), schedule: EVERY_100_MS}));

				// ------------------------------------------------ asks for scouts
				const ask = (k: number) =>
					retry(
						self.send(streams(scouts(c, i)).inbox, `ask:${k}`, {
							id: `ask:${k}`,
							replyTo: self.inbox,
							req: {
								op: "start_child",
								spec: {name: scout(c, i, k), restart: "temporary", limits: L.scout(c)},
							},
						}),
						(d) => d.how === "unknown" || d.how === "unreachable",
					);
				const replies = Effect.map(self.reads.readStream(self.inbox), (rows) =>
					rows.flatMap((r) => {
						const x = decodeReply(r.data);
						return Exit.isSuccess(x) ? [x.value] : [];
					}),
				);
				const allAnswered = (ids: readonly string[]) =>
					retry(
						replies.pipe(
							Effect.orElseSucceed(() => []),
							Effect.map((rs) => ids.every((id) => rs.some((r) => r.id === id))),
						),
						(ok) => !ok,
					);
				// One scout ask after another, as a builder would.
				if (plan.asks === "three") yield* Effect.forEach([1, 2, 3], ask, {concurrency: 1});
				if (plan.asks === "bursts") {
					for (let b = 0; b < BURST.bursts; b++) {
						const ks = Array.from({length: BURST.asks}, (_, n) => b * BURST.asks + n + 1);
						// A burst: every ask at once.
						yield* Effect.forEach(ks, ask, {concurrency: "unbounded"});
						yield* allAnswered(ks.map((k) => `ask:${k}`));
						const rs = yield* replies.pipe(Effect.orElseSucceed(() => []));
						const ok = ks.filter((k) => rs.some((r) => r.id === `ask:${k}` && r.res.ok));
						yield* line({ev: "burst", burst: b + 1, ok: ok.length});
						// Room again: every scout this burst started has ended.
						yield* Effect.forEach(
							ok,
							(k) =>
								retry(
									self.reads.processInfo(scout(c, i, k)).pipe(Effect.orElseSucceed(() => null)),
									(p) => p === null || p.down === 0,
								),
							{concurrency: "unbounded"},
						);
					}
					yield* line({ev: "bursts_done"});
					return yield* Effect.never;
				}

				// ------------------------------------------------ the turns
				// The next turn: one past the last one charged, under any lease and any run.
				const spent = yield* self.reads
					.readStream(`${name}/spend`)
					.pipe(Effect.orElseSucceed(() => []));
				const done = spent.reduce((n, r) => {
					if (r.kind !== "charged") return n;
					const x = decodeSpend(r.data);
					return Exit.isSuccess(x) ? Math.max(n, Number(x.value.turn.slice(1))) : n;
				}, 0);
				for (let k = done + 1; plan.turns === null || k <= plan.turns; k++) {
					const turn = `t${k}`;
					const cost = costOf(name, turn, fence);
					if (plan.admit) {
						const h = yield* retry(self.hold(turn, HOLD), (x) => x.how === "unreachable");
						if (h.how !== "ok") {
							yield* line({ev: "held", turn, how: h.how, ...("over" in h ? {over: h.over} : {})});
							return yield* Effect.never;
						}
					}
					// The bill: the provider is paid for every turn that starts.
					yield* line({ev: "turn", turn, incarnation, ...cost});
					// A turn stopped part way is paid for all the same (experiment 101: an abort is no
					// refund), so the charge still goes out as the host stops the program. A SIGKILL
					// runs nothing: then only a hold, if there is one, has counted it.
					// Only the turn itself may be cut: once it is done, its charge goes out whatever comes.
					const ch = yield* Effect.uninterruptibleMask((restore) =>
						restore(Effect.sleep(Duration.millis(TURN.ms))).pipe(
							Effect.onInterrupt(() =>
								self
									.charge(turn, cost)
									.pipe(
										Effect.flatMap((x) => line({ev: "charged", turn, how: x.how, stopped: true})),
									),
							),
							Effect.andThen(self.charge(turn, cost)),
						),
					);
					// The same charge again, as a host that never saw the answer would send it.
					const again = yield* self.charge(turn, cost);
					yield* line({
						ev: "charged",
						turn,
						how: ch.how,
						dup: ch.how === "ok" ? ch.dup : null,
						againDup: again.how === "ok" ? again.dup : null,
						over: ch.how === "ok" ? ch.over : null,
					});
					if (ch.how !== "ok" || ch.over !== null) return yield* Effect.never;
					yield* journal.dispatch({type: "turned", turn: k});
					if (plan.crash === "every" || (plan.crash === "once" && incarnation === 1 && k === 3))
						return yield* Effect.die(`planted crash after ${turn}`);
				}
				yield* self.exit("normal", "its turns are done");
				return yield* Effect.never;
			}).pipe(Effect.scoped),
	});
