// A sender: sends COUNT increments to a registered name, each one ledger append to the name's
// inbox with a message id of its own. It never knows which host runs the program.
//
// The inbox append is 93's compare-and-set: it names the rev it thinks the inbox ends at, and a
// `stale` answer gives the real end, so it tries again there. A send whose answer never comes is
// sent again under the SAME id. So is one whose answer the sender pretends to have lost
// (DUP_RATE, a share of sends): that is what a client timeout after a commit looks like, and it
// puts the same id in the inbox twice, which the mailbox must skip.
//
// Config (env): LEDGER_URL, LEDGER_NAME, NAME, SENDER, COUNT, RATE (sends a second), DUP_RATE,
// SEED. Prints one JSON line at the end: counts and every latency, in milliseconds.
import {NodeRuntime} from "@effect/platform-node";
import {Config, Console, Duration, Effect} from "effect";
import {Ledger, ledgerLayer, streams} from "./ledger.ts";

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

	let rev = 0;
	const attempts: number[] = [];
	const sends: number[] = [];
	let stale = 0;
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
			const r = yield* ledger
				.append(inbox, rev, {kind: "inc", writer: sender, data: {id}})
				.pipe(Effect.result);
			attempts.push(performance.now() - a0);
			if (r._tag === "Failure") {
				errors++;
				yield* Effect.sleep(Duration.millis(50));
				continue;
			}
			const answer = r.success;
			if (answer.ok) {
				rev = answer.rev;
				if (repeatsLeft > 0) {
					// The answer "never came": send the same id again.
					repeatsLeft--;
					repeats++;
					continue;
				}
				break;
			}
			if (answer.why === "stale") {
				stale++;
				rev = answer.rev;
				continue;
			}
			return yield* Effect.die(`an inbox append was fenced: ${JSON.stringify(answer)}`);
		}
		sends.push(performance.now() - began);
	}
	yield* Console.log(
		JSON.stringify({
			sender,
			sent: count,
			repeats,
			stale,
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
