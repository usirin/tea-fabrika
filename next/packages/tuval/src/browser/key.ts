// The browser's window key, next/ (Tier 1, P14; experiment 215). One Ed25519 key pair per browser
// profile, made with `extractable: false` and kept in IndexedDB as the `CryptoKeyPair` itself, so
// the private half can sign and can never be read out. Only the public half leaves: as the raw
// bytes in canonical base64url for the hello, and as its SSH key line for SSHSIG.
//
// Two tabs may each make a candidate, but one read-write transaction picks the stored winner
// before either signs. A failure to read, write or make the key is a typed error and a blocked
// screen, never a quiet new key. Ask again replaces only the key the door removed, by a
// compare-and-set, so a second tab that asks again takes the first one's replacement.
import {ProgramClient} from "@kampus/libfabrika";
import {KeyLine} from "@kampus/libfabrika/transport";
import {Context, Effect, Layer, Schema} from "effect";
import {Base64, Base64Url} from "effect/encoding";

const DB = "fabrika";
const STORE = "keys";
const KEY = "window";
const PERSIST = "persist";
const ED = "Ed25519";
const USES: Array<KeyUsage> = ["sign", "verify"];

/** Why the key store could not be used: the step and the failure's class, nothing it carried. */
export class KeyError extends Schema.TaggedError<KeyError>()("KeyError", {
	op: Schema.Literals(["open", "read", "write", "make", "sign"]),
	error: ProgramClient.ErrorClass,
}) {}
const fail = (op: KeyError["op"]) => (error: unknown) =>
	new KeyError({op, error: ProgramClient.errorClass(error)});

/** The window's identity as the door checks it. */
export type Identity = {
	/** `SHA256:` and the unpadded base64 of SHA-256 over the raw public key: the gateway's name. */
	readonly fingerprint: string;
	/** The raw public key in canonical base64url, as the hello carries it. */
	readonly raw: string;
	readonly line: KeyLine;
	/** How this read found the key: made now, reused, or made to replace a removed one. */
	readonly found: "created" | "reused" | "replaced";
	readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, KeyError>;
};

type Stored = {
	readonly pair: CryptoKeyPair;
	readonly fingerprint: string;
	readonly raw: string;
};
const isStored = (u: unknown): u is Stored =>
	typeof u === "object" &&
	u !== null &&
	"pair" in u &&
	"fingerprint" in u &&
	typeof u.fingerprint === "string" &&
	"raw" in u &&
	typeof u.raw === "string";

/** One IndexedDB request as an Effect. */
const request = <A>(op: KeyError["op"], make: () => IDBRequest<A>) =>
	Effect.callback<A, KeyError>((resume) => {
		try {
			const req = make();
			req.onsuccess = () => resume(Effect.succeed(req.result));
			req.onerror = () => resume(Effect.fail(fail(op)(req.error)));
		} catch (error) {
			resume(Effect.fail(fail(op)(error)));
		}
	});

const openDb = request("open", () => {
	const open = indexedDB.open(DB, 1);
	open.onupgradeneeded = () => {
		if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
	};
	return open;
});

/**
 * One read-write step on the store: `decide` sees what is stored under `key` and answers what to
 * put there, if anything, and what to return. The read and the write share one transaction, so
 * two tabs cannot both win.
 */
const atomically = <A>(
	db: IDBDatabase,
	key: string,
	decide: (stored: unknown) => {readonly put?: unknown; readonly value: A},
) =>
	Effect.callback<A, KeyError>((resume) => {
		try {
			const tx = db.transaction(STORE, "readwrite");
			const store = tx.objectStore(STORE);
			let out: A | undefined;
			const read = store.get(key);
			read.onsuccess = () => {
				const decided = decide(read.result);
				out = decided.value;
				if ("put" in decided) store.put(decided.put, key);
			};
			tx.oncomplete = () => resume(Effect.succeed(out as A));
			tx.onerror = () => resume(Effect.fail(fail("write")(tx.error)));
			tx.onabort = () => resume(Effect.fail(fail("write")(tx.error)));
		} catch (error) {
			resume(Effect.fail(fail("write")(error)));
		}
	});

const readKey = (db: IDBDatabase) =>
	request("read", () => db.transaction(STORE, "readonly").objectStore(STORE).get(KEY));

/** The SSH wire field of `bytes`: a 4-byte length, then the bytes. */
const field = (bytes: Uint8Array): Uint8Array => {
	const out = new Uint8Array(4 + bytes.length);
	new DataView(out.buffer).setUint32(0, bytes.length);
	out.set(bytes, 4);
	return out;
};

/** A fresh non-extractable Ed25519 pair, with its public names. */
const makeKey = Effect.gen(function* () {
	const bad = fail("make");
	const s = crypto.subtle;
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto makes a key through a Promise
	const pair = yield* Effect.tryPromise({try: () => s.generateKey(ED, false, USES), catch: bad});
	if (!("privateKey" in pair)) return yield* Effect.fail(bad(new TypeError("not a key pair")));
	const pub = pair.publicKey;
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the public half through a Promise
	const out = yield* Effect.tryPromise({try: () => s.exportKey("raw", pub), catch: bad});
	const raw = new Uint8Array(out);
	// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
	const digest = yield* Effect.tryPromise({try: () => s.digest("SHA-256", raw), catch: bad});
	return {
		pair,
		raw: Base64Url.encode(raw),
		fingerprint: `SHA256:${Base64.encode(new Uint8Array(digest)).replace(/=+$/, "")}`,
	} satisfies Stored;
});

const lineFor = (raw: string): Effect.Effect<KeyLine, KeyError> => {
	const bytes = Base64Url.decode(raw);
	if (bytes._tag === "Failure") return Effect.fail(new KeyError({op: "read", error: "DataError"}));
	const type = new TextEncoder().encode("ssh-ed25519");
	const blob = new Uint8Array([...field(type), ...field(bytes.success)]);
	return Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`).pipe(
		Effect.mapError(() => new KeyError({op: "read", error: "DataError"})),
	);
};

const identity = (stored: Stored, found: Identity["found"]) =>
	Effect.map(lineFor(stored.raw), (line) => ({
		fingerprint: stored.fingerprint,
		raw: stored.raw,
		line,
		found,
		sign: (bytes: Uint8Array) => {
			const [s, key, data] = [crypto.subtle, stored.pair.privateKey, new Uint8Array(bytes)];
			// oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs through a Promise
			const signed = Effect.tryPromise({try: () => s.sign(ED, key, data), catch: fail("sign")});
			return Effect.map(signed, (signature) => new Uint8Array(signature));
		},
	}));

export class WindowKey extends Context.Service<
	WindowKey,
	{
		/** The profile's key, made once. `rejected` names a key the door removed: if it is still the
		 *  stored one, it is replaced; if another tab replaced it already, that one is used. */
		readonly current: (rejected: string | null) => Effect.Effect<Identity, KeyError>;
		/** Claims the one persistence attempt of a new grant. False when a tab claimed it before. */
		readonly claimPersist: Effect.Effect<boolean, KeyError>;
	}
>()("@kampus/tuval/WindowKey") {
	static readonly layer = Layer.sync(WindowKey, () => {
		let db: IDBDatabase | null = null;
		const opened = Effect.suspend(() =>
			db === null ? Effect.tap(openDb, (d) => Effect.sync(() => (db = d))) : Effect.succeed(db),
		);
		const current = Effect.fn("client.key")(function* (rejected: string | null) {
			const d = yield* opened;
			const stored = yield* readKey(d);
			if (isStored(stored) && stored.fingerprint !== rejected)
				return yield* identity(stored, "reused");
			const candidate = yield* makeKey;
			const chosen = yield* atomically<{
				readonly stored: Stored;
				readonly found: Identity["found"];
			}>(d, KEY, (now) =>
				isStored(now) && now.fingerprint !== rejected
					? {value: {stored: now, found: "reused" as const}}
					: {
							put: candidate,
							value: {
								stored: candidate,
								found: isStored(now) ? ("replaced" as const) : ("created" as const),
							},
						},
			);
			return yield* identity(chosen.stored, chosen.found);
		});
		const claimPersist = Effect.gen(function* () {
			const d = yield* opened;
			return yield* atomically(d, PERSIST, (now) =>
				now === undefined ? {put: {claimed: true}, value: true} : {value: false},
			);
		}).pipe(Effect.withSpan("client.persist"));
		return {current, claimPersist};
	});
}
