// A WebCrypto Promise that rejects reaches the Effect error channel as the module's own error,
// never as a defect or a bare undefined error.
import {assert, describe, it, vi} from "@effect/vitest";
import {Effect} from "effect";
import {sha256} from "../data/archive.ts";
import {subtle} from "./binary.ts";

describe("a rejected WebCrypto Promise", () => {
	it("scenario: transport subtle fails with WebCryptoError on a bad key import", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				subtle("importKey", "raw", new Uint8Array(3), {name: "ECDSA", namedCurve: "P-256"}, false, [
					"verify",
				]),
			),
		);
		assert.strictEqual(error._tag, "WebCryptoError");
	});
	it("scenario: archive sha256 fails with SinkError storage when digest rejects", async () => {
		const spy = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("no"));
		try {
			const error = await Effect.runPromise(Effect.flip(sha256(new Uint8Array([1]))));
			assert.strictEqual(error._tag, "SinkError");
			assert.strictEqual(error.why, "storage");
		} finally {
			spy.mockRestore();
		}
	});
});
