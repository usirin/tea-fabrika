// Where an object's old raw health rows go: one R2 bucket, `health`, behind our own small interface,
// so nothing here imports Cloudflare. Tier 1, P37 (law p99). P12 passes the env's R2 binding.
//
// R2's `put` takes a `sha256` and fails when the bytes do not match it, and `head` answers the stored
// checksums. So `put` here answers the hash R2 says it stored, and the sink deletes its local rows
// only when that equals the hash it worked out itself.
import {Context, Effect, Layer, Schema} from "effect";
import {SinkError} from "./trace.ts";

/** The two R2 calls the archive makes. R2 fails a `put` whose body does not match `sha256`. */
export interface BucketCalls {
	readonly put: (key: string, body: Uint8Array, sha256: string) => Promise<void>;
	readonly head: (key: string) => Promise<{readonly sha256: string} | null>;
}

const hex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The body's SHA-256, as lowercase hex. */
export const sha256 = (body: Uint8Array): Effect.Effect<string, SinkError> =>
	Effect.map(
		// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers only with a Promise
		Effect.tryPromise({
			try: () => crypto.subtle.digest("SHA-256", new Uint8Array(body)),
			catch: () => new SinkError({why: "storage", held: 0}),
		}),
		(digest) => hex(new Uint8Array(digest)),
	);

const Head = Schema.NullOr(Schema.Struct({sha256: Schema.String}));
const decodeHead = Schema.decodeUnknownEffect(Head);

export class Archive extends Context.Service<
	Archive,
	{
		/** Stores `body` at `key` and answers the SHA-256 the store says it holds. */
		readonly put: (key: string, body: Uint8Array) => Effect.Effect<{sha256: string}, SinkError>;
	}
>()("@kampus/libfabrika/Archive") {
	/** In memory, for tests: it holds what it was given, so its hash always matches. */
	static readonly memory: Layer.Layer<Archive> = Layer.sync(Archive)(() => {
		const files = new Map<string, Uint8Array>();
		return {
			put: (key, body) =>
				Effect.map(sha256(body), (hash) => {
					files.set(key, body.slice());
					return {sha256: hash};
				}),
		};
	});

	/** An R2 bucket: `put` with the body's hash, then `head`. A call that rejects is `unreachable`,
	 *  a `head` that finds nothing or does not decode is `bad_row`. */
	static readonly bucket = (calls: BucketCalls): Layer.Layer<Archive> => {
		const call = <A>(send: () => Promise<A>): Effect.Effect<A, SinkError> =>
			// oxlint-disable-next-line fabrika/no-promises -- edge: an R2 binding answers with a Promise
			Effect.tryPromise({try: send, catch: () => new SinkError({why: "unreachable", held: 0})});
		return Layer.succeed(Archive, {
			put: (key, body) =>
				Effect.gen(function* () {
					const hash = yield* sha256(body);
					yield* call(() => calls.put(key, body, hash));
					const stored = yield* call(() => calls.head(key)).pipe(
						Effect.flatMap((raw) => decodeHead(raw)),
						Effect.mapError((error) =>
							error instanceof SinkError ? error : new SinkError({why: "bad_row", held: 0}),
						),
					);
					if (stored === null) return yield* Effect.fail(new SinkError({why: "bad_row", held: 0}));
					return {sha256: stored.sha256};
				}),
		});
	};
}
