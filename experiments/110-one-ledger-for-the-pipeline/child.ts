// Experiment 110's child process: one pipeline process on a Miniflare ledger, reached over HTTP.
// Every line it prints is one JSON object. The harness (../110-one-ledger-for-the-pipeline.ts)
// starts each child in its own process group and SIGKILLs, SIGSTOPs and SIGCONTs whole groups.
//
//   node child.ts flow <url> <ledger> <ttl ms> <pause ms>
//       One ticket's life: plan it, approve the plan, start a lane, claim the ticket, a scripted
//       review round (a `judged` and a `reviewed` fact), let the ticket go. Each step has a fixed
//       message id, so a run started again after a kill writes nothing twice. It reads the facts
//       first and stops at once when the lane has let the ticket go already. Prints
//       {"step": n} after each step, with <pause ms> between steps, then {"done": lane}.
//
//   node child.ts race <url> <ledger> <lane> <rounds> <slot ms> <go file>
//       Waits for <go file>, which holds a start time; round r claims o/r#r at start + r * slot.
//       Prints {"told": r, "holder": lane} per round, then {"refused": n}.
//
//   node child.ts hold <url> <ledger> <ticket> <ttl ms> <every ms>
//       Claims <ticket> as L1, prints {"held": fence}, then writes a fact under the ticket with
//       that fence every <every ms>, for ever, printing {"wrote": i, "word": ok|fenced, "at": ms}.
//       It never asks whether it still holds the ticket: the ledger must refuse its late writes.

import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Clock, Duration, Effect, FileSystem, Layer} from "effect";
import {layerHttp} from "../../packages/fabrika/src/host/http.ts";
import {say} from "../../packages/fabrika/src/host/laws.ts";
import {
	claim,
	Lanes,
	layerLanes,
	newLane,
	release,
} from "../../packages/pipeline/src/asks/claims.ts";
import {demoFacts} from "../../packages/pipeline/src/asks/demo.ts";
import {
	appendFact,
	type Fact,
	Ledger,
	readFacts,
	sendFact,
} from "../../packages/pipeline/src/asks/ledger.ts";
import {planAskId} from "../../packages/pipeline/src/asks/rules.ts";
import {laneId, planOf, taskId, ticketId} from "../../packages/pipeline/src/ids.ts";

const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o));
const [mode = "", url = "", ledgerName = "", ...rest] = process.argv.slice(2);

let refused = 0;
/** The Miniflare ledger, counting the claims another process won. */
const ledger = Layer.effect(
	Ledger,
	Effect.gen(function* () {
		const inner = yield* Ledger;
		return Ledger.of({
			...inner,
			claim: (name, holder, rev, ttlMs) =>
				inner.claim(name, holder, rev, ttlMs).pipe(
					Effect.tapError((e) =>
						Effect.sync(() => {
							if (e._tag === "Held" || e._tag === "Stale") refused++;
						}),
					),
				),
		});
	}),
).pipe(Layer.provide(layerHttp({url, ledger: ledgerName})));

/** The one ticket the flow works: the first of experiment 89's real plans. */
const planned = demoFacts().find((f) => f.type === "planned");
if (planned === undefined || planned.type !== "planned") throw new Error("no planned fact");
const T = planned.tickets[0] ?? ticketId("o/r#1");
const P = planOf(T);
const T1 = taskId("t1");

const flow = (pause: number) =>
	Effect.gen(function* () {
		const lane = yield* newLane(T, "lane-1");
		const done = (yield* readFacts).some(
			(e) => e.fact.type === "released" && e.fact.ticket === T && e.fact.lane === lane,
		);
		if (done) return out({done: lane, already: true});
		const step = (n: number) =>
			Effect.sync(() => out({step: n})).pipe(Effect.andThen(Effect.sleep(Duration.millis(pause))));
		yield* Effect.orDie(sendFact(planned, {id: "planned", by: "plan"}));
		yield* step(1);
		yield* Effect.orDie(
			sendFact(
				{type: "answered", id: planAskId(P, 1), answer: {kind: "approve"}},
				{id: "approve", by: "owner"},
			),
		);
		yield* step(2);
		const holder = yield* claim(T, lane);
		if (holder !== lane) return yield* Effect.die(`the ticket is held by ${holder}`);
		yield* step(3);
		const hold = yield* Lanes.use((l) => l.hold(T));
		if (hold === null) return yield* Effect.die("a claim with no lease");
		const judged: Fact = {
			type: "judged",
			plan: P,
			task: T1,
			head: "h1",
			proof: "scripted",
			rows: [],
			found: ["a gap"],
		};
		yield* Effect.orDie(appendFact(judged, hold, {id: "judged-1", by: lane}));
		yield* step(4);
		yield* Effect.orDie(
			appendFact({type: "reviewed", plan: P, task: T1, open: 0}, hold, {
				id: "reviewed-1",
				by: lane,
			}),
		);
		yield* step(5);
		yield* release(T, lane);
		out({done: lane});
	});

const race = (lane: string, rounds: number, slot: number, goFile: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		out({ready: true});
		let start = 0;
		while (start === 0) {
			const text = yield* fs.readFileString(goFile).pipe(Effect.orElseSucceed(() => ""));
			if (text.trim() !== "") start = Number(text);
			else yield* Effect.sleep(Duration.millis(5));
		}
		for (let round = 1; round <= rounds; round++) {
			const wait = start + round * slot - (yield* Clock.currentTimeMillis);
			if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
			out({told: round, holder: yield* claim(ticketId(`o/r#${round}`), laneId(lane))});
		}
		out({refused});
	});

const hold = (ticket: string, every: number) =>
	Effect.gen(function* () {
		const T = ticketId(ticket);
		const L1 = laneId("L1");
		yield* claim(T, L1);
		const h = yield* Lanes.use((l) => l.hold(T));
		if (h === null) return yield* Effect.die("a claim with no lease");
		out({held: h.fence});
		const l = yield* Ledger;
		for (let i = 1; ; i++) {
			const fact: Fact = {
				type: "ruling_needed",
				ticket: T,
				ask: `write ${i}`,
				options: [],
				why: "the holder writes",
			};
			const s = yield* say(
				Effect.provideService(appendFact(fact, h, {id: `w${i}`, by: L1}), Ledger, l),
			);
			out({wrote: i, word: s.word, at: Date.now()});
			yield* Effect.sleep(Duration.millis(every));
		}
	});

const [a = "", b = "", c = "", d = ""] = rest;
const run: Effect.Effect<void, never, Lanes | Ledger | FileSystem.FileSystem> =
	mode === "flow"
		? flow(Number(b))
		: mode === "race"
			? race(a, Number(b), Number(c), d)
			: mode === "hold"
				? hold(a, Number(c))
				: Effect.die(`unknown mode ${mode}`);
const ttlMs = mode === "flow" ? Number(a) : mode === "hold" ? Number(b) : 30_000;
await Effect.runPromise(
	run.pipe(
		Effect.provide(
			Layer.mergeAll(layerLanes({ttlMs}).pipe(Layer.provideMerge(ledger)), nodeServices),
		),
		Effect.scoped,
	),
);
