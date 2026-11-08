import {Effect, Queue, Ref} from "effect";
import * as Socket from "effect/socket/Socket";

// An Effect Socket, including its detached writer and scoped reader semantics.
// This collects frames. It does not implement JSON-RPC, ping or dial policy.
export const memorySocket = Effect.gen(function* () {
	const current = yield* Ref.make<Queue.Queue<readonly [string], Socket.SocketError> | null>(null);
	const readers = yield* Ref.make(0);
	const writes = yield* Ref.make<ReadonlyArray<string>>([]);
	const close = (code: number) =>
		new Socket.SocketError({
			reason: new Socket.SocketCloseError({code}),
		});
	const reader = Effect.gen(function* () {
		const queue = yield* Queue.unbounded<readonly [string], Socket.SocketError>();
		yield* Ref.update(readers, (n) => n + 1);
		yield* Ref.set(current, queue);
		yield* Effect.addFinalizer(() =>
			Effect.gen(function* () {
				yield* Queue.fail(queue, close(1000));
				yield* Ref.update(readers, (n) => n - 1);
				yield* Ref.update(current, (active) => (active === queue ? null : active));
			}),
		);
		return {pull: Queue.take(queue), upgrade: () => Effect.void};
	});
	const write = (frame: Uint8Array | string | Socket.CloseEvent) =>
		Effect.gen(function* () {
			// The real Socket writer waits for a connection. P18 must guard against this.
			while ((yield* Ref.get(current)) === null) yield* Effect.yieldNow;
			if (Socket.isCloseEvent(frame)) {
				const queue = yield* Ref.get(current);
				if (queue !== null) yield* Queue.fail(queue, close(frame.code));
			} else
				yield* Ref.update(writes, (old) => [
					...old,
					typeof frame === "string" ? frame : new TextDecoder().decode(frame),
				]);
		});
	return {
		socket: Socket.make({
			reader,
			writer: Effect.succeed({
				write,
				writeAll: (frames) => Effect.forEach(frames, write, {discard: true, concurrency: 1}),
			}),
		}),
		push: (text: string) =>
			Effect.gen(function* () {
				const queue = yield* Ref.get(current);
				if (queue === null) return yield* Effect.die(new Error("push without an acquired reader"));
				yield* Queue.offer(queue, [text]);
			}),
		end: (code: number) =>
			Effect.gen(function* () {
				const queue = yield* Ref.get(current);
				if (queue !== null) yield* Queue.fail(queue, close(code));
			}),
		writes: Ref.get(writes),
		activeReaders: Ref.get(readers),
	};
});
