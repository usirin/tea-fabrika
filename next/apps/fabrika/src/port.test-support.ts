// next/, test support. A TCP port for a test's own dev.ts, kept apart from every other taker.
//
// The old way asked the OS for a free port, closed it and passed the number on. dev.ts builds for
// seconds before it binds, and in that time the OS may hand the same number to anyone: another
// test's stage, or this stage's own workerd, which asks for OS-assigned ports too.
//
// Two rules remove that:
// - The port is below every default OS-assigned range (Linux starts at 32768, macOS at 49152), so
//   the OS never hands it out by itself. A machine whose range was widened loses this half.
// - Ports come in pairs. The test keeps a listener on the even one for as long as it uses the odd
//   one. Another test process that wants the pair fails to bind the even one and moves on. The
//   kernel is the lock: it holds across processes and lets go when a process dies.
import {createServer, type Server} from "node:net";
import {Effect} from "effect";

const FIRST = 20000;
const PAIRS = 6000;

// Start at a different pair per process, so parallel test files rarely meet at all. Then move on
// after every pair handed out: a stage that runs inside the test process leaves the runtime's own
// note that its port is taken, for 30 seconds, so one process never gets the same pair twice in a row.
let cursor = process.pid % PAIRS;

const listen = (port: number) =>
	Effect.callback<Server | null>((resume) => {
		const server = createServer();
		server.once("error", () => resume(Effect.succeed(null)));
		server.listen({port, host: "127.0.0.1", exclusive: true}, () => resume(Effect.succeed(server)));
	});

const close = (server: Server) =>
	Effect.callback<void>((resume) => {
		server.close(() => resume(Effect.void));
	});

/** A port nobody else is given until `release` runs. Run `release` after the port's user is gone. */
export const heldPort = Effect.fn("port.heldPort")(function* () {
	for (let n = 0; n < PAIRS; n++) {
		const lock = FIRST + 2 * (cursor % PAIRS);
		cursor++;
		const held = yield* listen(lock);

		if (held === null) {
			continue;
		}

		// Something outside these tests may sit on the odd port. Look once, while holding the pair.
		const free = yield* listen(lock + 1);

		if (free === null) {
			yield* close(held);
			continue;
		}

		yield* close(free);
		return {port: lock + 1, release: close(held)};
	}

	return yield* Effect.die(new Error("no free test port pair"));
});
