// Who belongs, as a service: it reads and writes `door/members` and folds it with `members.ts`'s one
// rule (p96, p97). Tier 1, P9. It never verifies a signature: the door checks SSHSIG at wiring, then
// calls `write`.
//
// `write` folds, refuses what the rule refuses (writing nothing), else appends under the fact's own
// id and folds on to the new rev. The second fold is the honest answer to a race: two Macs typing
// one stolen sheet at once both pass the first check, the log puts one first, and the other hears
// `ignored used`, never "you are in".
import {Context, Effect, Layer, Result, Schema, Stream} from "effect";
import {Ledger, LedgerError} from "../data/ledger.ts";
import {Appended, type Entry, fromHere, lineFor, Rev, valueFor} from "../data/log.ts";
import {short} from "../data/trace.ts";
import type {From} from "./mailbox.ts";
import {
	allows,
	EMPTY,
	factId,
	type Folded,
	MemberFact,
	type Members,
	signedBy,
	subject,
	Why,
} from "./members.ts";

/** The stream who belongs is kept on. */
const MEMBERS = "door/members";

/** What the founding screen gives: the name, the first person keys, and the first window. */
export const Founder = Schema.Struct({
	name: Schema.String,
	keys: Schema.Array(Schema.String),
	window: Schema.NullOr(Schema.String),
});
export type Founder = typeof Founder.Type;

/** What `write` answers. */
export const Written = Schema.TaggedUnion({
	/** In the log, and the fold takes it. */
	applied: {rev: Rev},
	/** In the log, but an earlier fact won the race (flag 6). */
	ignored: {rev: Rev, why: Why},
	/** Nothing written: the rule's why, or the ledger's own. */
	refused: {why: Schema.Union([Why, Appended.cases.refused.fields.why])},
});
export type Written = typeof Written.Type;

const tag = (word: string): string => `fab.members.${word}`;

const known: ReadonlySet<string> = new Set(Object.keys(MemberFact.cases));
const decodeFact = Schema.decodeUnknownResult(MemberFact);

/** One entry of `door/members` and the fact it holds; a case this piece does not know is none. */
type Row = {readonly entry: Entry; readonly fact: MemberFact | null};

/** The fold of a read, with the why of each fact it skipped, by rev. */
type Replayed = {
	readonly rows: ReadonlyArray<Row>;
	readonly folded: Folded;
	readonly skipped: ReadonlyMap<Rev, Why>;
	/** The rev of the stream's newest entry, 0 when it is empty. */
	readonly head: Rev;
};

const row = Effect.fnUntraced(function* (entry: Entry) {
	if (!known.has(entry._tag)) {
		return {entry, fact: null} satisfies Row;
	}

	const fact = decodeFact(valueFor(entry));

	if (Result.isFailure(fact)) {
		return yield* new LedgerError({why: "bad_row"});
	}

	return {entry, fact: fact.success} satisfies Row;
});

const replay = (rows: ReadonlyArray<Row>): Replayed => {
	const skipped = new Map<Rev, Why>();
	let folded = EMPTY;

	for (const {entry, fact} of rows) {
		if (fact === null) {
			continue;
		}

		const next = allows(folded, fact);

		if (Result.isSuccess(next)) {
			folded = next.success;
		} else {
			skipped.set(entry.rev, next.failure);
		}
	}

	return {rows, folded, skipped, head: rows.at(-1)?.entry.rev ?? 0};
};

const view = ({folded, skipped, rows}: Replayed) => ({
	[tag("facts")]: rows.length,
	[tag("keys")]: folded.members.keys.size,
	[tag("live")]: [...folded.members.keys.values()].filter((k) => k.live).length,
	[tag("ignored")]: skipped.size,
});

export class ClientManager extends Context.Service<
	ClientManager,
	{
		readonly members: Effect.Effect<Members, LedgerError>;
		readonly write: (fact: MemberFact, from: From) => Effect.Effect<Written, LedgerError>;
	}
>()("@kampus/libfabrika/ClientManager") {
	/** Building it writes nothing. The first call on an empty `door/members` writes `founded` under
	 *  the fixed id `founded`, inside that call's error channel, so the referee keeps it once (p20). */
	static readonly layer = (
		founder: Founder & {
			/** The person the founder works for: `founded`'s `for`, and its fact's id. */
			readonly person: string;
			/** The founder's checked key, which signs `founded`: `by`, never the person. */
			readonly by: string;
			/** The build of the code that writes `founded` (H6). */
			readonly build: string;
		},
	): Layer.Layer<ClientManager, never, Ledger> =>
		Layer.effect(
			ClientManager,
			Effect.gen(function* () {
				const ledger = yield* Ledger;
				const founding = MemberFact.cases.founded.make({
					id: founder.person,
					name: founder.name,
					keys: founder.keys,
					window: founder.window,
				});

				const read = Stream.runCollect(ledger.read(MEMBERS, 0)).pipe(
					Effect.flatMap((entries) => Effect.forEach(entries, row, {concurrency: 1})),
					Effect.map(replay),
				);

				/** The stream folded, after `founded` is in it. */
				const load = Effect.gen(function* () {
					const first = yield* read;

					if (first.rows.length > 0) {
						return first;
					}

					const {by, person, build} = founder;
					// Both callers, members.read and members.write, already own a span.
					const from = yield* fromHere({by, for: person, seen: 0, parent: null, build}).pipe(
						Effect.orDie,
					);
					// Two first calls at once write the same line under one id: the referee keeps one,
					// and the other hears `id_reused` and reads what the first wrote. Any other refusal
					// fails: a stream with no `founded` would start with no members.
					const placed = yield* ledger.append(MEMBERS, "founded", lineFor(from, founding));

					if (placed._tag === "refused" && placed.why !== "id_reused") {
						return yield* new LedgerError({
							why: "refused",
							message: `founded refused: ${placed.why}`,
						});
					}

					return yield* read;
				});

				const answer = Effect.fnUntraced(function* (written: Written) {
					yield* Effect.annotateCurrentSpan({
						[tag("answer")]: written._tag,
						...Written.match(written, {
							applied: ({rev}) => ({[tag("rev")]: rev}),
							ignored: ({rev, why}) => ({[tag("rev")]: rev, [tag("why")]: why}),
							refused: ({why}) => ({[tag("why")]: why}),
						}),
					});
					return written;
				});

				const write = Effect.fn("members.write")(
					function* (fact: MemberFact, from: From) {
						yield* Effect.annotateCurrentSpan(
							short({
								[tag("tag")]: fact._tag,
								[tag("id")]: factId(fact),
								...nonNull(tag("signer"), signedBy(fact)),
								...nonNull(tag("key"), subject(fact)),
							}),
						);
						const before = yield* load;
						const id = factId(fact);

						// A fact already in the log goes to the referee as it is: a resend gets its first
						// placing, and the answer is what the fold did with it then.
						if (!before.rows.some(({entry}) => entry.id === id)) {
							const verdict = allows(before.folded, fact);

							if (Result.isFailure(verdict)) {
								return yield* answer(Written.cases.refused.make({why: verdict.failure}));
							}
						}

						const placed = yield* ledger.append(
							MEMBERS,
							id,
							lineFor({...from, seen: before.head}, fact),
						);

						if (placed._tag === "refused") {
							return yield* answer(Written.cases.refused.make({why: placed.why}));
						}

						const why = (yield* read).skipped.get(placed.rev);
						return yield* answer(
							why === undefined
								? Written.cases.applied.make({rev: placed.rev})
								: Written.cases.ignored.make({rev: placed.rev, why}),
						);
					},
					Effect.tapError((error) => Effect.annotateCurrentSpan(tag("why"), error.why)),
				);

				const members = Effect.fn("members.read")(function* () {
					return yield* load.pipe(
						Effect.tap((replayed) => Effect.annotateCurrentSpan(view(replayed))),
						Effect.map(({folded}) => folded.members),
						Effect.tapError((error) => Effect.annotateCurrentSpan(tag("why"), error.why)),
					);
				});
				return {
					members: members(),
					write,
				};
			}),
		);
}

const nonNull = (key: string, text: string | null): Record<string, string> =>
	text === null ? {} : {[key]: text};
