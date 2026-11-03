import {Duration, Effect, Schedule} from "effect";
import {Ledger} from "./ledger.ts";

// A hosted name's job, and so its trace. A job is what one start made: a root name and every
// name it started, like a Unix process group. On the ledger the registry is the process table
// already: a name with no parent leads a job, and `startChild` puts a child in its parent's job,
// as a forked child keeps its parent's process group (OTP's group leader). `leaderOf` reads it;
// nothing more is written.
//
//   yield* leaderOf("lane:700:t2:r1:build")   // "lane:700"
//
// `serve` (./host.ts) starts each program under `traceOf(leader)`, so a lane's stages are in the
// lane's trace. The same key gives the same trace in any process, so a name that moves host, or
// whose host restarts, stays in one trace.
//
// A host in one process keeps its jobs in a table instead (./host-jobs.ts), and tsh shows it.

/** More parents than any tree of names has: a chain this long is a loop, and a bug in the ledger. */
const DEEPEST = 64;

/**
 * The name that leads `name`'s job: up its parents, the first with none. A name the ledger does
 * not know leads its own. Each read is tried again until the ledger answers.
 */
export const leaderOf = (name: string): Effect.Effect<string, never, Ledger> =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		let at = name;
		for (let depth = 0; depth < DEEPEST; depth++) {
			const info = yield* ledger
				.processInfo(at)
				.pipe(Effect.retry(Schedule.spaced(Duration.millis(100))), Effect.orDie);
			if (info === null || info.parent === null) return at;
			at = info.parent;
		}
		return yield* Effect.die(new Error(`${name} has more than ${DEEPEST} parents`));
	});
