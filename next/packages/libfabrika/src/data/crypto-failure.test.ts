// A WebCrypto Promise that rejects reaches the Effect error channel as the module's own error,
// never as a defect or a bare undefined error.
import {assert, describe, it, vi} from "@effect/vitest";
import {Effect, Schema} from "effect";
import {sha256} from "./archive.ts";

describe("a rejected WebCrypto Promise", () => {
	it.effect.prop(
		"archive sha256 fails with SinkError storage for every digest rejection",
		{generated: Schema.Unknown},
		({generated}) =>
			Effect.forEach(
				[new Error("no"), generated],
				(value) =>
					Effect.promise(async () => {
						const spy = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(value);

						try {
							const error = await Effect.runPromise(Effect.flip(sha256(new Uint8Array([1]))));
							assert.strictEqual(error._tag, "SinkError");
							assert.strictEqual(error.reason, "storage");
						} finally {
							spy.mockRestore();
						}
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
});
