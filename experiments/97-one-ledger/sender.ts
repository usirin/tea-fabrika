// Experiment 97's copy of experiment 96's sender, on the one ledger. New in 97: the senders hold no
// lease, and the ledger lets them in only because the stream is an inbox. A refusal (`Denied`,
// `Fenced`) would mean that door shut, so it stops the sender: it is a failure, not a retry.
//
// 96 copied it from experiments/94-tea-host/sender.ts. What changed: a send is the ledger's `send`, an
// append at the inbox's end with the message id (EventStoreDB's `ExpectedRevision.Any` with an
// event id). It names no rev, so two senders never race and nothing comes back `stale`. A resend
// of the same id (an answer that never came, or one the sender pretends it lost: DUP_RATE) is
// answered `dup` and written nowhere, so the inbox holds each id once.
//
// Config (env): LEDGER_URL, LEDGER_NAME, NAME, SENDER, COUNT, RATE (sends a second), DUP_RATE,
// SEED. Prints one JSON line at the end: counts and every latency, in milliseconds.
import {NodeRuntime} from "@effect/platform-node";
import {Config, Console, Duration, Effect} from "effect";
import {Ledger, ledgerLayer, streams} from "./service.ts";

/** A small seeded random (mulberry32), so a run's injected repeats are the same each time. */
const seeded = (seed: number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const main = Effect.gen(function* () {
	const sender = yield* Config.String("SENDER");
	const name = yield* Config.String("NAME").pipe(Config.withDefault("counter:1"));
	const count = yield* Config.Number("COUNT");
	const rate = yield* Config.Number("RATE").pipe(Config.withDefault(50));
	const dupRate = yield* Config.Number("DUP_RATE").pipe(Config.withDefault(0.02));
	const random = seeded(yield* Config.Number("SEED").pipe(Config.withDefault(1)));
	const ledger = yield* Ledger;
	const inbox = streams(name).inbox;

	const attempts: number[] = [];
	const sends: number[] = [];
	let dups = 0;
	let errors = 0;
	let repeats = 0;
	const t0 = Date.now();

	for (let i = 1; i <= count; i++) {
		// Paced: send i goes out at i / rate seconds, or at once when behind.
		const due = t0 + (i * 1000) / rate;
		if (due > Date.now()) yield* Effect.sleep(Duration.millis(due - Date.now()));
		const id = `${sender}-${i}`;
		const began = performance.now();
		let repeatsLeft = random() < dupRate ? 1 : 0;
		for (;;) {
			const a0 = performance.now();
			const r = yield* ledger.send(inbox, id, {kind: "inc", writer: sender, data: {id}}).pipe(
				Effect.catchTags({
					Denied: (e) => Effect.die(`the inbox ${e.stream} refused a sender: denied`),
					Fenced: (e) => Effect.die(`the inbox ${e.stream} refused a sender: fenced`),
				}),
				Effect.result,
			);
			attempts.push(performance.now() - a0);
			if (r._tag === "Failure") {
				errors++;
				yield* Effect.sleep(Duration.millis(50));
				continue;
			}
			if (r.success.dup) dups++;
			if (repeatsLeft > 0) {
				// The answer "never came": send the same id again.
				repeatsLeft--;
				repeats++;
				continue;
			}
			break;
		}
		sends.push(performance.now() - began);
	}
	yield* Console.log(
		JSON.stringify({
			sender,
			sent: count,
			repeats,
			dups,
			stale: 0,
			errors,
			ms: Date.now() - t0,
			attempts: attempts.map((x) => Math.round(x * 100) / 100),
			sends: sends.map((x) => Math.round(x * 100) / 100),
		}),
	);
});

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = ledgerLayer(
			yield* Config.String("LEDGER_URL"),
			yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
		);
		return yield* main.pipe(Effect.provide(layer));
	}),
);
