// The ledger as a service: append, read and wait, the same three calls for every caller (D6). In
// the project object it is the referee on that object's SQLite (`Ledger.sql`); in any other object
// it is the project's stub (`Ledger.remote`). Tier 1, P6 (laws p18 to p20, p94 and p95).
import {Context, Effect, Layer, Option, Schema, Stream} from "effect";
import {Appended, Entry, type Line, PAGE, type Rev, Waited} from "./log.ts";
import {Referee, type Sql, STREAM, tag} from "./referee.ts";
import {short} from "./trace.ts";

export class LedgerError extends Schema.TaggedError<LedgerError>()("LedgerError", {
	/** `unreachable`: a call that never reached the referee. `bad_row`: an answer or a row that does
	 *  not decode. `storage`: SQLite threw, for example `SQLITE_FULL`. `refused`: the ledger refused
	 *  a line the caller needed written.
	 *  `crypto`: WebCrypto threw or rejected. */
	why: Schema.Literals(["unreachable", "bad_row", "storage", "refused", "crypto"]),
	/** What the thrown error said. It rides in the span's failure, never in a tag. */
	message: Schema.optional(Schema.String),
}) {}

/** Rings a waiter, at most once. P12's thin class gives the real one: a call to the gateway. */
export class Doorbell extends Context.Service<
	Doorbell,
	{readonly ring: (to: string, stream: string, rev: Rev) => Effect.Effect<void, LedgerError>}
>()("@kampus/libfabrika/Doorbell") {}

/** What the project object answers across an object call. Its answers are decoded by the caller. */
export type LedgerCalls = {
	append(stream: string, id: string, line: unknown): Promise<unknown>;
	read(stream: string, after: number, reader: string): Promise<unknown>;
	wait(stream: string, after: number, reader: string): Promise<unknown>;
};

/** Who is calling, given once when a ledger is built: the object's own name, such as `gateway:t1`. */
type Who = {readonly reader: string};

/** A read as a Stream of pages, fetched only as it is pulled; a short page is the last. */
const pages = (
	after: Rev,
	page: (after: Rev) => Effect.Effect<ReadonlyArray<Entry>, LedgerError>,
): Stream.Stream<Entry, LedgerError> =>
	Stream.paginate(
		after,
		(from): Effect.Effect<readonly [ReadonlyArray<Entry>, Option.Option<Rev>], LedgerError> =>
			Effect.map(page(from), (entries) => [
				entries,
				entries.length < PAGE ? Option.none() : Option.fromUndefinedOr(entries.at(-1)?.rev),
			]),
	);

export class Ledger extends Context.Service<
	Ledger,
	{
		readonly append: (
			stream: string,
			id: string,
			line: Line,
		) => Effect.Effect<Appended, LedgerError>;
		/** The stream's entries past `after`, oldest first, read in pages as the Stream runs. */
		readonly read: (stream: string, after: Rev) => Stream.Stream<Entry, LedgerError>;
		/** Never blocks: `ready` with the stream's newest rev, or `parked` until a ring. */
		readonly wait: (stream: string, after: Rev) => Effect.Effect<Waited, LedgerError>;
	}
>()("@kampus/libfabrika/Ledger") {
	/** The referee in this process, on any `Sql`: in the project object, and on node:sqlite in tests. */
	static readonly sql = (sql: Sql, who: Who): Layer.Layer<Ledger, never, Doorbell> =>
		Layer.effect(
			Ledger,
			Effect.gen(function* () {
				const referee = yield* Referee;
				return {
					append: referee.append,
					read: (stream, after) => pages(after, (from) => referee.read(stream, from, who.reader)),
					wait: (stream, after) => referee.wait(stream, after, who.reader),
				};
			}),
		).pipe(Layer.provide(Referee.layer(sql)));

	/** Any other object: the project's stub. A rejected call is `unreachable`; an answer that does
	 *  not decode, `bad_row`. Each call ends one `ledger.call` span on the caller's side. */
	static readonly remote = (stub: LedgerCalls, who: Who): Layer.Layer<Ledger> => {
		const call = Effect.fn("ledger.call")(function* <A, M extends keyof LedgerCalls>(
			name: M,
			stream: string,
			answer: Schema.Decoder<A>,
			...args: Parameters<LedgerCalls[M]>
		): Effect.fn.Return<A, LedgerError> {
			yield* Effect.annotateCurrentSpan({
				"rpc.method": name,
				...short({[STREAM]: stream, [tag("reader")]: who.reader}),
			});
			const fail = () => new LedgerError({why: "unreachable"});
			// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
			const io = Effect.tryPromise({try: () => Reflect.apply(stub[name], stub, args), catch: fail});
			return yield* io.pipe(
				Effect.flatMap((raw) =>
					Schema.decodeUnknownEffect(answer)(raw).pipe(
						Effect.mapError(() => new LedgerError({why: "bad_row"})),
					),
				),
				Effect.tapError((error) => Effect.annotateCurrentSpan(tag("why"), error.why)),
			);
		});
		const page = Schema.Array(Entry);
		return Layer.succeed(Ledger, {
			append: (stream, id, line) => call("append", stream, Appended, stream, id, line),
			read: (stream, after) =>
				pages(after, (from) => call("read", stream, page, stream, from, who.reader)),
			wait: (stream, after) => call("wait", stream, Waited, stream, after, who.reader),
		});
	};
}
