// Writes that leave the ledger, made safe (experiment 104, step S6). A push, a pull request, a
// comment, an enqueue or a merge goes out at most once per idempotency key, and only while the
// stage holds its name's lease.
//
// The key is a ledger id. Before a write is sent, its intent is a row in `<name>/writes`, fenced
// on the stage's lease, under the message id `intent:<key>`. Once it is sent, a second row,
// `done:<key>`, holds what it answered. A stage that runs again (a restart, a takeover by another
// host) finds the rows:
//
//   done     the write's answer, from the ledger. Nothing is sent.
//   intent   a send may have happened, or not: a host died between the two rows. The world is
//            read first (`look`: the branch's commit, the pull request from the branch, a comment
//            with the key's marker, the pull request in the queue). Found: the done row is
//            written, and nothing is sent. Not found: it is sent now.
//   neither  nothing was ever sent: the intent row first, then the send.
//
// Just before the send, the lease is read again: a host frozen past its lease and woken finds
// another fence there, and sends nothing. A write cannot be made without this gate, by type and
// at run time: every outside call takes a `Key`, a key is made only here (its constructor is
// private), and an adapter takes one only through `useKey`, which refuses a key this gate did
// not hand out, or one whose send is over.
//
// What this does not cover, measured in experiment 104: a host frozen between the lease read and
// the send itself. A push, a pull request, an enqueue and a merge are guarded there by the code
// host's own rules (a push that is not a fast-forward is refused; one pull request per branch;
// an enqueue of a queued head changes nothing). A comment has no such rule and can be posted twice.
import {Context, Duration, Effect, Exit, Layer, Option, Schedule, Schema} from "effect";
import {Ledger} from "../../host/ledger.ts";

type Failed = {readonly _tag: "unknown"};

// ---------------------------------------------------------------- the key

/** Keys this module handed out, and of those, the ones whose send is going on now. */
const minted = new WeakSet<Key>();
const sending = new WeakSet<Key>();
let mint: (text: string, name: string, fence: number) => Key;

/**
 * An idempotency key: the id of a write's intent row in the ledger. Only this module makes one:
 * the constructor is private, and the private field makes a look-alike object a type error.
 */
export class Key {
	readonly #minted = true;
	/** The key as the outside sees it: `<name>#<op>:<subject>`. */
	readonly text: string;
	/** The registered name whose lease the write was sent under. */
	readonly name: string;
	readonly fence: number;
	private constructor(text: string, name: string, fence: number) {
		this.text = text;
		this.name = name;
		this.fence = fence;
	}
	static {
		mint = (text, name, fence) => {
			const key = new Key(text, name, fence);
			minted.add(key);
			return key;
		};
	}
	/** True for a key this module made. A key forged with a cast is not one. */
	get real(): boolean {
		return this.#minted && minted.has(this);
	}
}

/** A write sent with a key that is not live: forged, or used after its send. */
export class KeyRefused extends Schema.TaggedError<KeyRefused>()("KeyRefused", {
	why: Schema.String,
}) {}

/**
 * What an adapter calls before it sends: the key's text, for a key this gate handed out and whose
 * send is on now. Anything else is refused, and the adapter sends nothing.
 */
export const useKey = (key: Key): Effect.Effect<string, KeyRefused> =>
	minted.has(key) && sending.has(key)
		? Effect.succeed(key.text)
		: Effect.fail(new KeyRefused({why: minted.has(key) ? "its send is over" : "not a key"}));

/** The marker a key leaves in a text it is sent with: a pull request's body, a comment, a commit. */
export const markerOf = (key: string): string => `<!-- fabrika-key: ${key} -->`;

// ---------------------------------------------------------------- a write

/** One write that leaves the ledger. */
export interface Write<A> {
	/** push, open, comment, enqueue, merge, rerun. */
	readonly op: string;
	/** What it is about, the same on every host: a branch at a commit, a pull request at a head. */
	readonly subject: string;
	/** Its answer, as the done row keeps it (JSON). */
	readonly answer: Schema.Codec<A, unknown>;
	/** Is it out there already? Read only after an intent row with no done row. */
	readonly look: (key: string) => Effect.Effect<Option.Option<A>, Failed>;
	/** Send it, with its key. */
	readonly send: (key: Key) => Effect.Effect<A, Failed | KeyRefused>;
}

/** What the gate says about each write, for the harness. */
export type WriteNote = {
	readonly ev: "write";
	readonly op: string;
	readonly key: string;
	readonly fence: number;
	readonly step:
		| "done_found"
		| "intent"
		| "found_out_there"
		| "send"
		| "sent"
		| "done"
		| "refused_fence"
		| "refused_lease"
		| "failed";
};

/** A named point where a planted fault may stop the process (FoundationDB's Buggify). */
export class Faults extends Context.Service<
	Faults,
	{readonly at: (point: string) => Effect.Effect<void>}
>()("@kampus/fabrika/pipeline/Faults") {}

/** No faults: what every run outside a fault test has. */
export const noFaults = Layer.succeed(Faults, {at: () => Effect.void});

export interface GateOptions {
	readonly name: string;
	readonly fence: number;
	readonly holder: string;
	/** A send needs at least this much of the lease left. */
	readonly marginMs?: number;
	readonly say?: (n: WriteNote) => void;
	/** Planted mistakes, each one a law must catch. `no_lease_check`: send without reading the lease. */
	readonly planted?: "no_lease_check";
}

export class Idempotency extends Context.Service<
	Idempotency,
	{
		/** Send `write` once per key, under this lease. A lost lease never answers: the host stops the program. */
		readonly once: <A>(write: Write<A>) => Effect.Effect<A, Failed>;
		/** The ledger stream the rows are in. */
		readonly stream: string;
	}
>()("@kampus/fabrika/pipeline/Idempotency") {}

const DoneRow = Schema.fromJsonString(Schema.Struct({answer: Schema.Unknown}));
const decodeDone = Schema.decodeUnknownExit(DoneRow);

/** The stream a name's write rows are in. */
export const writesOf = (name: string) => `${name}/writes`;

/** The gate for one lease. Every write a stage makes outside the ledger goes through `once`. */
export const gate = (o: GateOptions) =>
	Effect.gen(function* () {
		const ledger = yield* Ledger;
		const faults = yield* Faults;
		const stream = writesOf(o.name);
		const marginMs = o.marginMs ?? 300;
		const say = o.say ?? (() => {});

		/** A lost lease: the program waits here until the host stops it. */
		const stop = (op: string, key: string, step: "refused_fence" | "refused_lease") =>
			Effect.sync(() => say({ev: "write", op, key, fence: o.fence, step})).pipe(
				Effect.andThen(Effect.never),
			);

		/** Retried while the ledger does not answer: the id makes a resend safe. */
		const append = (id: string, kind: string, data: unknown) =>
			ledger.append(stream, "any", {kind, writer: o.holder, data, id}, o.fence).pipe(
				Effect.retry({
					while: (e) => e._tag === "LedgerUnreachable",
					times: 40,
					schedule: SPACED,
				}),
			);

		/** The lease is this fence's, with time to send in. Waits out a renew that is due. */
		const leaseHeld = Effect.gen(function* () {
			for (let tries = 0; tries < 40; tries++) {
				const lease = yield* ledger.lease(o.name).pipe(Effect.orElseSucceed(() => null));
				if (lease !== null && lease.fence !== o.fence) return false;
				if (lease !== null && lease.expires_at - Date.now() > marginMs) return true;
				yield* Effect.sleep(SPACING);
			}
			return false;
		});

		const once = <A>(write: Write<A>): Effect.Effect<A, Failed> =>
			Effect.gen(function* () {
				const key = `${o.name}#${write.op}:${write.subject}`;
				const note = (step: WriteNote["step"]) =>
					Effect.sync(() => say({ev: "write", op: write.op, key, fence: o.fence, step}));
				const decodeAnswer = Schema.decodeUnknownExit(write.answer);
				const rows = yield* ledger
					.readStream(stream)
					.pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
				const done = rows.find((r) => r.id === `done:${key}`);
				if (done !== undefined) {
					const row = decodeDone(done.data);
					const answer = Exit.isSuccess(row) ? decodeAnswer(row.value.answer) : null;
					if (answer !== null && Exit.isSuccess(answer)) {
						yield* note("done_found");
						return answer.value;
					}
				}
				const finish = (answer: A) =>
					append(`done:${key}`, "done", {key, op: write.op, answer}).pipe(
						Effect.matchEffect({
							onSuccess: () => note("done").pipe(Effect.as(answer)),
							onFailure: (e) =>
								e._tag === "Fenced"
									? stop(write.op, key, "refused_fence")
									: Effect.fail<Failed>({_tag: "unknown"}),
						}),
					);
				if (rows.some((r) => r.id === `intent:${key}`)) {
					// A host died between the two rows: is the write out there?
					const there = yield* write.look(key);
					if (Option.isSome(there)) {
						yield* note("found_out_there");
						return yield* finish(there.value);
					}
				} else {
					const wrote = yield* append(`intent:${key}`, "intent", {key, op: write.op}).pipe(
						Effect.result,
					);
					if (wrote._tag === "Failure")
						return yield* wrote.failure._tag === "Fenced"
							? stop(write.op, key, "refused_fence")
							: Effect.fail<Failed>({_tag: "unknown"});
					yield* note("intent");
				}
				yield* faults.at(`before-send:${write.op}`);
				if (o.planted !== "no_lease_check" && !(yield* leaseHeld))
					return yield* stop(write.op, key, "refused_lease");
				const k = mint(key, o.name, o.fence);
				yield* note("send");
				const sent = yield* Effect.acquireUseRelease(
					Effect.sync(() => sending.add(k)),
					() => write.send(k),
					() => Effect.sync(() => sending.delete(k)),
				).pipe(Effect.result);
				if (sent._tag === "Failure") {
					yield* note("failed");
					return yield* Effect.fail<Failed>({_tag: "unknown"});
				}
				yield* note("sent");
				yield* faults.at(`after-send:${write.op}`);
				return yield* finish(sent.success);
			});

		return Idempotency.of({once, stream});
	});

const SPACING = Duration.millis(50);
const SPACED = Schedule.spaced(SPACING);
