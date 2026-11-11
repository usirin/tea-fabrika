// Where an object's old raw health rows go: one R2 bucket, `measurements`, behind our own small interface,
// so nothing here imports Cloudflare. Tier 1, P37 (law p101). P12 passes the env's R2 binding.
//
// R2's `put` takes a `sha256` and fails when the bytes do not match it, and `head` answers the stored
// checksums. So `put` here answers the hash R2 says it stored, and the sink deletes its local rows
// only when that equals the hash it worked out itself.
import { Context, Effect, Layer, Schema } from "effect";
import { SinkError } from "./Trace.ts";

/** The two R2 calls the archive makes. R2 fails a `put` whose body does not match `sha256`. */
export interface BucketCalls {
  readonly put: (key: string, body: Uint8Array, sha256: string) => Promise<void>;
  readonly head: (key: string) => Promise<{ readonly sha256: string } | null>;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The body's SHA-256, as lowercase hex. An unnamed `Effect.fn`: the sink's own work ends no span. */
export const sha256 = Effect.fn(function* (body: Uint8Array) {
  const bytes = new Uint8Array(body);
  const fail = () => new SinkError({ reason: "storage", held: 0 });
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto answers only with a Promise
  const work = Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", bytes), catch: fail });
  const digest = yield* work;
  return hex(new Uint8Array(digest));
});

const Head = Schema.NullOr(Schema.Struct({ sha256: Schema.String }));
const decodeHead = Schema.decodeUnknownEffect(Head);

export class Archive extends Context.Service<
  Archive,
  {
    /** Stores `body` at `key` and answers the SHA-256 the store says it holds: null when it finds
     *  no file there, which proves no copy. */
    readonly put: (key: string, body: Uint8Array) => Effect.Effect<{ readonly sha256: string | null }, SinkError>;
  }
>()("@kampus/libfabrika/Archive") {
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
      const fail = () => new SinkError({ reason: "unreachable", held: 0 });
      // oxlint-disable-next-line fabrika/no-promises -- edge: an R2 binding answers with a Promise
      return Effect.tryPromise({ try: () => Reflect.apply(calls[method], calls, args), catch: fail });
    };
    return Layer.succeed(Archive, {
      put: Effect.fnUntraced(function* (key: string, body: Uint8Array) {
        const hash = yield* sha256(body);
        yield* call("put", key, body, hash);
        const raw = yield* call("head", key);
        const stored = yield* decodeHead(raw).pipe(
          Effect.mapError(() => new SinkError({ reason: "bad_row", held: 0 })),
        );
        return { sha256: stored === null ? null : stored.sha256 };
      }),
    });
  };
}
