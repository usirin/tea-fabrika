/**
 * Where an object's old measurements go: one R2 bucket behind our own small interface, so nothing
 * here imports Cloudflare. The object's wiring passes the bucket's calls in.
 *
 * R2's `put` takes a `sha256` and fails when the bytes do not match it, and `head` answers the
 * stored checksums. So `put` here answers the hash R2 says it stored, and the sink deletes its
 * local rows only when that equals the hash it worked out itself.
 *
 * @stability unstable
 */
import { Context, Effect, Layer, Schema } from "effect";
import { SinkError } from "./Trace.ts";

/**
 * The two R2 calls the archive makes, as plain Promise calls. R2 fails a `put` whose body does not
 * match `sha256`, and `head` answers null when it finds no file.
 *
 * @stability unstable
 * @category models
 */
export interface BucketCalls {
  readonly put: (key: string, body: Uint8Array, sha256: string) => Promise<void>;
  readonly head: (key: string) => Promise<{ readonly sha256: string } | null>;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Computes a body's SHA-256, as lowercase hex.
 *
 * **Details**
 *
 * It opens no span, since the sink's own work must leave no span for the sink to keep. A WebCrypto
 * failure is a `SinkError` with `reason: "storage"`.
 *
 * @stability unstable
 * @category constructors
 */
export const sha256 = Effect.fn(function* (body: Uint8Array) {
  const bytes = new Uint8Array(body);
  const fail = (cause: unknown) => new SinkError({ reason: "storage", held: 0, cause });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers only with a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });
  const digest = yield* work;
  return hex(new Uint8Array(digest));
});

const Head = Schema.NullOr(Schema.Struct({ sha256: Schema.String }));
const decodeHead = Schema.decodeUnknownEffect(Head);

/**
 * Service that stores one file of old measurements and says what the store holds afterwards.
 *
 * **Details**
 *
 * `put` answers the hash the store reports, never the hash of what was sent. The sink deletes its
 * local rows only when that hash equals the one it worked out itself, so a lost or damaged upload
 * costs a retry and no data.
 *
 * @stability unstable
 * @category services
 */
export class Archive extends Context.Service<
  Archive,
  {
    /** Stores `body` at `key` and answers the SHA-256 the store says it holds: null when it finds
     *  no file there, which proves no copy. */
    readonly put: (key: string, body: Uint8Array) => Effect.Effect<{ readonly sha256: string | null }, SinkError>;
  }
>()("@kampus/libfabrika/telemetry/Archive") {
  /** In memory, for tests: it holds what it was given, so its hash always matches. */
  static readonly memory: Layer.Layer<Archive> = Layer.sync(Archive)(() => {
    const files = new Map<string, Uint8Array>();
    return {
      put: Effect.fnUntraced(function* (key: string, body: Uint8Array) {
        const hash = yield* sha256(body);
        files.set(key, body.slice());
        return { sha256: hash };
      }),
    };
  });

  /** An R2 bucket: `put` with the body's hash, then `head`. A call that rejects is `unreachable`,
   *  a `head` that does not decode is `bad_row`, and one that finds nothing answers null. */
  static readonly bucket = (calls: BucketCalls): Layer.Layer<Archive> => {
    const call = <M extends keyof BucketCalls>(
      method: M,
      ...args: Parameters<BucketCalls[M]>
    ): Effect.Effect<Awaited<ReturnType<BucketCalls[M]>>, SinkError> => {
      const fail = (cause: unknown) => new SinkError({ reason: "unreachable", held: 0, cause });
      // oxlint-disable-next-line fabrika/no-promises -- edge: an R2 binding answers with a Promise
      return Effect.tryPromise({ try: () => Reflect.apply(calls[method], calls, args), catch: fail });
    };
    return Layer.succeed(Archive, {
      put: Effect.fnUntraced(function* (key: string, body: Uint8Array) {
        const hash = yield* sha256(body);
        yield* call("put", key, body, hash);
        const raw = yield* call("head", key);
        const stored = yield* decodeHead(raw).pipe(
          Effect.mapError((cause) => new SinkError({ reason: "bad_row", held: 0, cause })),
        );
        return { sha256: stored === null ? null : stored.sha256 };
      }),
    });
  };
}
