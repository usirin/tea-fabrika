// The browser's window key, next/ (Tier 1, P14; experiment 215). One Ed25519 key pair per browser
// profile, made with `extractable: false` and kept in IndexedDB as the `CryptoKeyPair` itself, so
// the private half can sign and can never be read out. Only the public half leaves: as the raw
// bytes in canonical base64url for the hello, and as its SSH key line for SSHSIG.
//
// Two tabs may each make a candidate, but one read-write transaction picks the stored winner
// before either signs. A failure to read, write or make the key is a typed error and a blocked
// screen, never a quiet new key. Ask again replaces only the key the door removed, by a
// compare-and-set, so a second tab that asks again takes the first one's replacement.
//
// It provides transport's `ClientKey` contract; the window consumes it.
import { ClientKey, ClientKeyError as StoreError, type Identity } from "@kampus/libfabrika/transport/ClientKey";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import { Effect, Layer, Schema } from "effect";
import { Base64, Base64Url } from "effect/encoding";
import { errorClass } from "./index.ts";

const DB = "fabrika";
const STORE = "keys";
const KEY = "window";
const PERSIST = "persist";
const ED = "Ed25519";
const USES: Array<KeyUsage> = ["sign", "verify"];

/** A failure's platform name: a `DOMException`'s, which the platform takes from a fixed list, or
 *  `TypeError`, else `other`. Never its message. */
const platformName = errorClass;

const storeFailure = (op: StoreError["op"]) => (error: unknown) => new StoreError({ op, error: platformName(error) });

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
const request = Effect.fnUntraced(function* <A>(op: StoreError["op"], make: () => IDBRequest<A>) {
  return yield* Effect.callback<A, StoreError>((resume) => {
    try {
      const req = make();
      req.onsuccess = () => resume(Effect.succeed(req.result));
      req.onerror = () => resume(Effect.fail(storeFailure(op)(req.error)));

      if (req instanceof IDBOpenDBRequest) {
        req.onblocked = () => {
          req.onsuccess = () => req.result.close();
          resume(Effect.fail(new StoreError({ op, error: "InvalidStateError" })));
        };
      }

      return Effect.sync(() => {
        // IndexedDB cannot cancel an open request. Close a database that arrives after cancellation.
        req.onsuccess = () => {
          if (req.result instanceof IDBDatabase) {
            req.result.close();
          }
        };
        req.onerror = null;
      });
    } catch (error) {
      resume(Effect.fail(storeFailure(op)(error)));
    }
  });
});

/** Opens database `name` at version 1, with its one object store `store`. */
const openDb = Effect.fnUntraced(function* (name: string, store: string) {
  return yield* Effect.acquireRelease(
    request("open", () => {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(store)) {
          open.result.createObjectStore(store);
        }
      };
      return open;
    }),
    (db) => Effect.sync(() => db.close()),
  );
});

/** One read-write transaction on `store` as an Effect: `work` runs inside it, and it succeeds once
 *  the transaction is complete, so what it wrote is durable. */
const transaction = Effect.fnUntraced(function* <A>(
  db: IDBDatabase,
  store: string,
  work: (s: IDBObjectStore) => () => A,
) {
  return yield* Effect.callback<A, StoreError>((resume) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const result = work(tx.objectStore(store));
      tx.oncomplete = () => resume(Effect.succeed(result()));
      tx.onerror = () => resume(Effect.fail(storeFailure("write")(tx.error)));
      tx.onabort = () => resume(Effect.fail(storeFailure("write")(tx.error)));
    } catch (error) {
      resume(Effect.fail(storeFailure("write")(error)));
    }
  });
});

/**
 * One read-write step on the key store: `decide` sees what is stored under `key` and answers what
 * to put there, if anything, and what to return. The read and the write share one transaction, so
 * two tabs cannot both win.
 */
const atomically = <A>(
  db: IDBDatabase,
  key: string,
  decide: (stored: unknown) => { readonly put?: unknown; readonly value: A },
) =>
  transaction(db, STORE, (store) => {
    let out: A | undefined;
    const read = store.get(key);
    read.onsuccess = () => {
      const decided = decide(read.result);
      out = decided.value;

      if ("put" in decided) {
        store.put(decided.put, key);
      }
    };
    return () => out as A;
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
  const bad = storeFailure("make");
  const s = crypto.subtle;
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto makes a key through a Promise
  const pair = yield* Effect.tryPromise({ try: () => s.generateKey(ED, false, USES), catch: bad });

  if (!("privateKey" in pair)) {
    return yield* Effect.fail(bad(new TypeError("not a key pair")));
  }

  const pub = pair.publicKey;
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto exports the public half through a Promise
  const out = yield* Effect.tryPromise({ try: () => s.exportKey("raw", pub), catch: bad });
  const raw = new Uint8Array(out);
  // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto hashes through a Promise
  const digest = yield* Effect.tryPromise({ try: () => s.digest("SHA-256", raw), catch: bad });
  return {
    pair,
    raw: Base64Url.encode(raw),
    fingerprint: `SHA256:${Base64.encode(new Uint8Array(digest)).replace(/=+$/, "")}`,
  } satisfies Stored;
});

const lineFor = Effect.fnUntraced(function* (raw: string): Effect.fn.Return<KeyLine, StoreError> {
  const bytes = Base64Url.decode(raw);

  if (bytes._tag === "Failure") {
    return yield* new StoreError({ op: "read", error: "DataError" });
  }

  const type = new TextEncoder().encode("ssh-ed25519");
  const blob = new Uint8Array([...field(type), ...field(bytes.success)]);
  return yield* Schema.decodeUnknownEffect(KeyLine)(`ssh-ed25519 ${Base64.encode(blob)}`).pipe(
    Effect.mapError(() => new StoreError({ op: "read", error: "DataError" })),
  );
});

const identity = (stored: Stored, found: Identity["found"]): Effect.Effect<Identity, StoreError> =>
  Effect.map(lineFor(stored.raw), (line) => ({
    fingerprint: stored.fingerprint,
    raw: stored.raw,
    line,
    found,
    sign: (bytes: Uint8Array) => {
      const [s, key, data] = [crypto.subtle, stored.pair.privateKey, new Uint8Array(bytes)];
      const bad = storeFailure("sign");
      // oxlint-disable-next-line fabrika/no-promises -- edge: WebCrypto signs through a Promise
      const signed = Effect.tryPromise({ try: () => s.sign(ED, key, data), catch: bad });
      return Effect.map(signed, (signature) => new Uint8Array(signature));
    },
  }));

/** The browser's `ClientKey`: the profile's key in IndexedDB, and the Storage API's persistence. */
export const browserKey = Layer.sync(ClientKey, () => {
  const current = Effect.fn("client.key")(function* (rejected: string | null) {
    const d = yield* openDb(DB, STORE);
    const stored = yield* readKey(d);

    if (isStored(stored) && stored.fingerprint !== rejected) {
      return yield* identity(stored, "reused");
    }

    if (stored !== undefined && !isStored(stored)) {
      return yield* new StoreError({ op: "read", error: "DataError" });
    }

    const candidate = yield* makeKey;
    const chosen = yield* atomically<{
      readonly stored: Stored;
      readonly found: Identity["found"];
    }>(d, KEY, (now) =>
      isStored(now) && now.fingerprint !== rejected
        ? { value: { stored: now, found: "reused" as const } }
        : {
            put: candidate,
            value: {
              stored: candidate,
              found: isStored(now) ? ("replaced" as const) : ("created" as const),
            },
          },
    );
    return yield* identity(chosen.stored, chosen.found);
  }, Effect.scoped);
  const claimPersist = Effect.gen(function* () {
    const d = yield* openDb(DB, STORE);
    return yield* atomically(d, PERSIST, (now) =>
      now === undefined ? { put: { claimed: true }, value: true } : { value: false },
    );
  }).pipe(Effect.scoped, Effect.withSpan("client.persist"));
  const persist = Effect.suspend(() => {
    const st: StorageManager | undefined = navigator.storage;

    if (st?.persist === undefined) {
      return Effect.fail("unsupported" as const);
    }

    // oxlint-disable-next-line fabrika/no-promises -- edge: the Storage API asks for persistence through a Promise
    return Effect.tryPromise({ try: () => st.persist(), catch: () => "failed" as const });
  });
  return { current, claimPersist, persist };
});
