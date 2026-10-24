import {Schema} from "effect";

export const Backup = Schema.Struct({
	id: Schema.String.check(Schema.isUUID(4)),
	dir: Schema.Literal("/desk"),
	size: Schema.Int.check(Schema.isGreaterThan(0)),
	sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
	format: Schema.Literal("tar+zstd/1"),
	name: Schema.optionalKey(Schema.String),
});
export type Backup = typeof Backup.Type;
export const Saved = Schema.Struct({
	phase: Schema.Literals(["empty", "ready", "saving", "sleeping", "restoring", "failed"]),
	saved: Schema.NullOr(Backup),
	at: Schema.NullOr(Schema.Int),
	failure: Schema.NullOr(Schema.String),
});
export type Saved = typeof Saved.Type;
export const initial: Saved = {phase: "empty", saved: null, at: null, failure: null};

// The reference changes only after the upload and durable commit both succeed.
export async function save(
	previous: Saved,
	sleep: boolean,
	operations: {
		quiet: () => Promise<unknown>;
		backup: () => Promise<unknown>;
		remember: (next: Saved) => Promise<void>;
		open: () => Promise<unknown>;
		destroy: () => Promise<void>;
	},
) {
	let saved = previous;
	return (async () => {
		await operations.quiet();
		const record = Schema.decodeUnknownSync(Backup)(await operations.backup());
		const next: Saved = {
			phase: sleep ? "sleeping" : "ready",
			saved: record,
			at: Date.now(),
			failure: null,
		};
		await operations.remember(next);
		saved = next;
		if (sleep) await operations.destroy();
		else await operations.open();
		return saved;
	})().catch(async (cause: unknown) => {
		// A failed backup never authorizes destroying the still recoverable live disk.
		const failure = cause instanceof Error ? cause.message : String(cause);
		const reopened = await operations.open().then(
			() => true,
			() => false,
		);
		const next: Saved = {...saved, phase: reopened ? "ready" : "failed", failure};
		await operations.remember(next);
		return next;
	});
}
