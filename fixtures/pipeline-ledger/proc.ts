// A second process on one pipeline ledger kept in a node:sqlite file, for
// packages/pipeline/src/asks/ledger.test.ts.
//
//   node proc.ts claim <file> <lane> <rounds> <slot ms> <cas|blind>
//       Prints `ready` once loaded, then waits for `<file>.go`, which holds a
//       start time in ms. Round r claims the ticket o/r#r for <lane> at
//       <start> + r * <slot>, so every process told the same start claims the
//       same ticket at the same moment, however slowly each one started.
//       Prints `told <r> <holder>` for each round, then `refused <n>`: how
//       many claims the ledger refused because another process was first.
//       `blind` is the planted mistake: read the lease, and with nobody
//       holding it, take the ticket with no claim.
//
//   node proc.ts read <file>
//       Prints the facts as this fresh process folds them, as one JSON line.
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Ledger} from "@kampus/fabrika-old";
import {layerSqlite} from "@kampus/fabrika-old/sqlite";
import {claim, holderOf, layerLanes} from "@kampus/pipeline/asks/claims";
import {readFacts} from "@kampus/pipeline/asks/ledger";
import {foldLedger, openAsks} from "@kampus/pipeline/asks/rules";
import {laneId, ticketId} from "@kampus/pipeline/ids";
import {Clock, Duration, Effect, FileSystem, Layer} from "effect";

const [mode = "", file = "", ...rest] = process.argv.slice(2);

/** The file's ledger, counting the claims another process won. */
let refused = 0;
const counted = Layer.effect(
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
).pipe(Layer.provide(layerSqlite({path: file})));

/** The planted claim: it reads the lease, and with nobody holding it, takes the ticket with no claim. */
const blind = (ticket: ReturnType<typeof ticketId>, lane: ReturnType<typeof laneId>) =>
	Effect.map(holderOf(ticket), (holder) => holder ?? lane);

/** The start time the test writes once every process said `ready`. */
const go = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (;;) {
		const text = yield* fs.readFileString(`${file}.go`).pipe(Effect.orElseSucceed(() => ""));
		if (text.trim() !== "") return Number(text);
		yield* Effect.sleep(Duration.millis(5));
	}
});

const claims = (lane: string, rounds: number, slot: number, how: string) =>
	Effect.gen(function* () {
		console.log("ready");
		const start = yield* go;
		for (let round = 1; round <= rounds; round++) {
			const wait = start + round * slot - (yield* Clock.currentTimeMillis);
			if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
			const ticket = ticketId(`o/r#${round}`);
			const holder = yield* (how === "blind" ? blind : claim)(ticket, laneId(lane));
			console.log(`told ${round} ${holder}`);
		}
		console.log(`refused ${refused}`);
	});

const read = Effect.gen(function* () {
	const entries = yield* readFacts;
	const folded = foldLedger(entries);
	console.log(
		JSON.stringify({
			count: entries.length,
			open: openAsks(folded).map((ask) => ask.id),
			answered: [...folded.answered.keys()],
			builds: [...folded.builds.keys()],
		}),
	);
});

const [lane = "", rounds = "0", slot = "0", how = "cas"] = rest;
const run =
	mode === "claim"
		? claims(lane, Number(rounds), Number(slot), how)
		: mode === "read"
			? read
			: Effect.die(`unknown mode ${mode}`);
await Effect.runPromise(
	run.pipe(
		Effect.provide(Layer.mergeAll(layerLanes().pipe(Layer.provideMerge(counted)), nodeServices)),
		Effect.scoped,
	),
);
