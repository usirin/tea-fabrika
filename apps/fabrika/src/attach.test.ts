import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer";
import {Deferred, Effect, Fiber, FileSystem, Layer, Queue} from "effect";
import {TestClock} from "effect/testing";
import {describe, expect, it} from "vitest";
import {attach, NoHello} from "./attach.ts";
import {pathsOf} from "./host/socket.ts";

// One try to attach, against a host that accepts the socket and never says hello. The try fails
// at its time limit like any other failed try, so the reconnect machine (reconnect.ts) counts it
// and waits, and the try closes its own socket. The socket is real, on a home of the test's own;
// the clock is Effect's TestClock, moved by hand, so the test does not wait 10 s.
//
// Attaching to a host that does answer is in host/host.test.ts.

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, TestClock.layer());

/** A host that listens on `sock`, reads what it is sent, and says nothing. */
const silentHost = (sock: string) =>
	Effect.gen(function* () {
		const server = yield* NodeSocketServer.make({path: sock});
		/** Each connection, in the order it came: done once the other side closed it. */
		const accepted = yield* Queue.unbounded<Deferred.Deferred<void>>();
		yield* server
			.run((socket) =>
				Effect.gen(function* () {
					const closed = yield* Deferred.make<void>();
					yield* Queue.offer(accepted, closed);
					yield* Effect.scoped(Effect.flatMap(socket.reader, (r) => Effect.forever(r.pull))).pipe(
						Effect.ignore,
						Effect.ensuring(Deferred.succeed(closed, undefined)),
					);
				}),
			)
			.pipe(Effect.forkScoped);
		return {next: Queue.take(accepted)};
	});

describe("a try to attach", () => {
	it("fails at 10 s when the host accepts and never says hello, and closes its socket", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const home = yield* fs.makeTempDirectoryScoped({prefix: "fa-"});
				const paths = yield* pathsOf(home);
				yield* fs.makeDirectory(paths.dir, {recursive: true, mode: 0o700});
				const host = yield* silentHost(paths.sock);
				const trying = yield* attach({
					home,
					deliver: () => {},
					start: Effect.die("a host answers, so none is started"),
				}).pipe(Effect.forkScoped);
				// The first connection checks that a host answers (host/socket.ts), and closes at once.
				yield* Deferred.await(yield* host.next);
				const tried = yield* host.next;
				yield* TestClock.adjust("9999 millis");
				const early = trying.pollUnsafe();
				yield* TestClock.adjust("1 millis");
				const failed = yield* Fiber.join(trying).pipe(Effect.flip);
				// Closed by the try itself: this test's scope, which the try ran in, is still open.
				yield* Deferred.await(tried);
				return {early, failed};
			}).pipe(Effect.scoped, Effect.provide(platform)),
		);
		expect(seen.early).toBeUndefined();
		expect(seen.failed).toBeInstanceOf(NoHello);
		expect(seen.failed).toMatchObject({within: "10 seconds"});
	});
});
