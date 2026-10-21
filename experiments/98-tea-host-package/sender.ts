// Experiment 97's sender (../97-one-ledger/sender.ts), on the package: a send is `cast`, the
// package's gen_server:cast from outside any program (no lease, a message id, sent again under
// the same id while the ledger does not answer). A refusal (`fenced`, `denied`, `unknown`) would
// mean the inbox shut on a sender, so it stops the sender: a failure, not a retry.
//
// The injected repeats are 97's: with DUP_RATE, the sender pretends an answer never came and
// sends the same id again; the ledger answers `dup` and writes nothing.
//
// Config (env): LEDGER_URL, LEDGER_NAME, NAME, SENDER, COUNT, RATE (sends a second), DUP_RATE,
// SEED. Prints one JSON line at the end: counts and every latency, in milliseconds.

import {NodeRuntime} from "@effect/platform-node";
import {cast} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Config, Console, Duration, Effect} from "effect";

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

	const attempts: number[] = [];
	const sends: number[] = [];
	let dups = 0;
	let repeats = 0;
	let errors = 0;
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
			const r = yield* cast(name, id, {id}, sender);
			attempts.push(performance.now() - a0);
			// `cast` already sent it again 20 times; a ledger still restarting is waited for.
			if (r.how === "unreachable") {
				errors++;
				continue;
			}
			if (r.how !== "sent")
				return yield* Effect.die(`the inbox of ${name} refused a sender: ${r.how}`);
			if (r.dup) dups++;
			if (repeatsLeft > 0) {
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
		const layer = layerHttp({
			url: yield* Config.String("LEDGER_URL"),
			ledger: yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
		});
		return yield* main.pipe(Effect.provide(layer));
	}),
);
