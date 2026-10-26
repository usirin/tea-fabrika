// Dead letters, read and sent again. The ledger sets aside an inbox message that crashed a program
// `maxDeliveries` times in a row: a `dead_letter` event in `<name>/dead` names its inbox rev, and
// hosts feed past it (experiment 99). This module is the other half, the operator's: list them with
// the message each one set aside, and once the bug is fixed, send one back.
//
//   deadLetters("c:1")             [{rev: 12, strikes: 3, why, at, message, redriven: false}]
//   redrive("c:1", 12, "ops")      the message at rev 12 again, at the end of c:1's inbox, under the
//                                  id `redrive:12`; sent twice, it lands once (`dup`)
//
// The industry's names: SQS's redrive back to the source queue, RabbitMQ's shovel. A resent message
// is a new message at a new rev: the program sees it once more, after what came since. Its sender
// is now the writer given here; its kind and body are the original's. A DOWN or an EXIT is never
// sent again: only the ledger writes those, and a copy would be a forgery the ledger refuses.
//
// Experiment 102: a run its limit ended leaves a `limit` record in the same stream, one per run:
//
//   limitEnds("ticket:1")          [{limit: "usd", of: "ticket:1", used: 1.02, max: 1, why,
//                                    incarnation: 1, at}]
//
// A limit end has no message to send back: the fix is a raise (`setLimits`), not a redrive.
import {Effect, Exit, Schema} from "effect";
import {REDRIVE} from "./door.ts";
import {DeadLetter, type Inbox, Ledger, LimitRecord, type Row, streams} from "./ledger.ts";

export type DeadLetterEntry = DeadLetter & {
	/** The inbox message it set aside, or null: the inbox no longer has that rev. */
	readonly message: Row | null;
	/** Sent back already (`redrive:<rev>` is in the inbox). */
	readonly redriven: boolean;
};

export type Redriven =
	| {readonly how: "sent"; readonly rev: number; readonly dup: boolean}
	/** No dead letter names that rev. */
	| {readonly how: "not_dead"}
	/** A DOWN or an EXIT: only the ledger writes those. */
	| {readonly how: "ledger_message"}
	| {readonly how: "denied" | "unknown"};

const decodeDead = Schema.decodeUnknownExit(Schema.fromJsonString(DeadLetter));
const decodeLimit = Schema.decodeUnknownExit(Schema.fromJsonString(LimitRecord));

/** Every run of `name` a limit ended, oldest first. `of`: the name whose limit it was. */
export const limitEnds = (name: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const rows = yield* ledger.readStream(streams(name).dead);
		return rows.flatMap((r) => {
			if (r.kind !== "limit" || r.writer !== "ledger") return [];
			const d = decodeLimit(r.data);
			return Exit.isSuccess(d) ? [d.value] : [];
		});
	});
/** Under `REDRIVE`, so the door lets only a person send one (an agent's credential is refused). */
const redriveId = (rev: number) => `${REDRIVE}${rev}`;

/** The rows of `<name>/dead`, decoded; a row that does not decode is no dead letter. */
const deadOf = (name: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const rows = yield* ledger.readStream(streams(name).dead);
		return rows.flatMap((r) => {
			if (r.kind !== "dead_letter" || r.writer !== "ledger") return [];
			const d = decodeDead(r.data);
			return Exit.isSuccess(d) ? [d.value] : [];
		});
	});

/** Every dead letter of `name`, oldest first, with the message it set aside. */
export const deadLetters = (name: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const inbox = streams(name).inbox;
		const dead = yield* deadOf(name);
		const ids = new Set((yield* ledger.readStream(inbox)).flatMap((r) => (r.id ? [r.id] : [])));
		return yield* Effect.forEach(
			dead,
			(d) =>
				Effect.map(
					ledger.readStream(inbox, d.rev - 1, 1),
					(rows): DeadLetterEntry => ({
						...d,
						message: rows[0]?.rev === d.rev ? rows[0] : null,
						redriven: ids.has(redriveId(d.rev)),
					}),
				),
			// One small read per dead letter, none depending on another; the order is kept anyway.
			{concurrency: "unbounded"},
		);
	});

/**
 * Send the message a dead letter set aside back to the end of `name`'s inbox, once: the id is
 * `redrive:<rev>`, so a second redrive of the same rev is `dup`.
 */
export const redrive = (name: string, rev: number, writer: string) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const inbox: Inbox = streams(name).inbox;
		if (!(yield* deadOf(name)).some((d) => d.rev === rev)) return {how: "not_dead"} as Redriven;
		const original = (yield* ledger.readStream(inbox, rev - 1, 1))[0];
		if (original === undefined || original.rev !== rev) return {how: "not_dead"} as Redriven;
		if (original.writer === "ledger") return {how: "ledger_message"} as Redriven;
		const data = yield* Effect.try(() => JSON.parse(original.data) as unknown).pipe(
			Effect.orElseSucceed(() => original.data),
		);
		return yield* ledger.send(inbox, redriveId(rev), {kind: original.kind, writer, data}).pipe(
			Effect.map((a): Redriven => ({how: "sent", rev: a.rev, dup: a.dup})),
			Effect.catchTags({
				Denied: () => Effect.succeed<Redriven>({how: "denied"}),
				UnknownName: () => Effect.succeed<Redriven>({how: "unknown"}),
				Fenced: () => Effect.succeed<Redriven>({how: "denied"}),
			}),
		);
	});
