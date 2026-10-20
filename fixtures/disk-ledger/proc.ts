// A second process on one disk ledger, for wip/src/asks/ledger-disk.test.ts.
//
//   node proc.ts claim <file> <lane> <rounds> <slot ms> <cas|blind>
//       Prints `ready` once loaded, then waits for `<file>.go`, which holds a
//       start time in ms. Round r claims the ticket o/r#r for <lane> at
//       <start> + r * <slot>, so every process told the same start claims the
//       same ticket at the same moment, however slowly each one started.
//       Prints `told <r> <holder>` for each round, then `refused <n>`: how
//       many compare-and-sets lost to another process. `blind` is the planted
//       mistake: read the holder, then append a claim with no compare.
//
//   node proc.ts read <file>
//       Prints the ledger as this fresh process folds it, as one JSON line.
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Clock, Effect, FileSystem, Layer} from "effect";
import {claim, holderOf} from "../../wip/src/asks/claims.ts";
import {Ledger} from "../../wip/src/asks/ledger.ts";
import {diskLedger} from "../../wip/src/asks/ledger-disk.ts";
import {foldLedger, openAsks} from "../../wip/src/asks/rules.ts";
import {laneId, ticketId} from "../../wip/src/ids.ts";

const [mode = "", file = "", ...rest] = process.argv.slice(2);
const disk = diskLedger(file).pipe(Layer.provide(nodeServices));

/** The disk ledger, counting the compare-and-sets another process won. */
let refused = 0;
const counted = Layer.effect(
	Ledger,
	Effect.gen(function* () {
		const inner = yield* Ledger;
		return Ledger.of({
			...inner,
			appendAfter: (after, fact) =>
				inner.appendAfter(after, fact).pipe(
					Effect.tap((entry) =>
						Effect.sync(() => {
							if (entry === null) refused++;
						}),
					),
				),
		});
	}),
).pipe(Layer.provide(disk));

/** The planted claim: it reads the holder, then writes its claim with no compare. */
const blind = (ticket: ReturnType<typeof ticketId>, lane: ReturnType<typeof laneId>) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const holder = holderOf(yield* ledger.entries, ticket);
		if (holder !== null) return holder;
		yield* ledger.append({type: "claimed", ticket, lane});
		return lane;
	});

/** The start time the test writes once every process said `ready`. */
const go = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (;;) {
		const text = yield* fs.readFileString(`${file}.go`).pipe(Effect.orElseSucceed(() => ""));
		if (text.trim() !== "") return Number(text);
		yield* Effect.sleep(5);
	}
});

const claims = (lane: string, rounds: number, slot: number, how: string) =>
	Effect.gen(function* () {
		console.log("ready");
		const start = yield* go;
		for (let round = 1; round <= rounds; round++) {
			const wait = start + round * slot - (yield* Clock.currentTimeMillis);
			if (wait > 0) yield* Effect.sleep(wait);
			const ticket = ticketId(`o/r#${round}`);
			const holder = yield* (how === "blind" ? blind : claim)(ticket, laneId(lane));
			console.log(`told ${round} ${holder}`);
		}
		console.log(`refused ${refused}`);
	});

const read = Effect.gen(function* () {
	const entries = yield* (yield* Ledger).entries;
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
await Effect.runPromise(run.pipe(Effect.provide(Layer.merge(counted, nodeServices))));
