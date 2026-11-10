// What a client's platform gives it, next/ (Tier 1, P14). Moved unchanged out of `link.ts` (plan A8):
// that file holds the link machine only (decision 0046). These are the contracts a window consumes
// and a platform adapter provides (Tuval's browser adapter today, P18's later ones). Declarations
// only: nothing here dials, stores or signs.
import { Context, type Effect, Schema, type Scope, type Stream } from "effect";
import type { KeyLine } from "./sshsig.ts";

/** Why a client's own store could not be used: the step, and the failure's platform name (a
 *  `DOMException` name, `TypeError`, or `other`). Never a message or a value. */
export class StoreError extends Schema.TaggedError<StoreError>()("StoreError", {
  op: Schema.Literals(["open", "read", "write", "make", "sign"]),
  error: Schema.String,
}) {}

/** A client's key as the door checks it. */
export type Identity = {
  /** `SHA256:` and the unpadded base64 of SHA-256 over the raw public key: the gateway's name. */
  readonly fingerprint: string;
  /** The raw public key in canonical base64url, as the hello carries it. */
  readonly raw: string;
  readonly line: KeyLine;
  /** How this read found the key: made now, reused, or made to replace a removed one. */
  readonly found: "created" | "reused" | "replaced";
  readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, StoreError>;
};

/** The profile's one key, and the one persistence attempt of a new grant. */
export class ClientKey extends Context.Service<
  ClientKey,
  {
    /** The profile's key, made once. `rejected` names a key the door removed: if it is still the
     *  stored one, it is replaced; if another tab replaced it already, that one is used. */
    readonly current: (rejected: string | null) => Effect.Effect<Identity, StoreError>;
    /** Claims the one persistence attempt of a new grant. False when a tab claimed it before. */
    readonly claimPersist: Effect.Effect<boolean, StoreError>;
    /** Asks the platform to keep this client's storage: its answer, or why it could not ask. */
    readonly persist: Effect.Effect<boolean, "unsupported" | "failed">;
  }
>()("@kampus/libfabrika/transport/ClientKey") {}

/** What one dial's socket tells the client, in the order it happened. */
export type SocketEvent =
  | { readonly event: "open" }
  | { readonly event: "message"; readonly data: unknown }
  | { readonly event: "close"; readonly code: number };

/** One dial's socket: its events from the instant it exists, and text out. It closes with its
 *  scope. */
export type Socket = {
  readonly events: Stream.Stream<SocketEvent>;
  /** Sends `text`; false when the socket is not open. */
  readonly send: (text: string) => boolean;
  readonly close: (code: number, reason: string) => void;
};

/** Dials the brain at `url`. */
export class ClientSocket extends Context.Service<
  ClientSocket,
  { readonly dial: (url: string) => Effect.Effect<Socket, never, Scope.Scope> }
>()("@kampus/libfabrika/transport/ClientSocket") {}

/** The client's own rows waiting for the door's acknowledgement, kept across a closed client. A row
 *  is any value with a string `id`; the client checks what it reads back. */
export class ClientRows extends Context.Service<
  ClientRows,
  {
    readonly put: (row: { readonly id: string }) => Effect.Effect<void, StoreError>;
    readonly all: Effect.Effect<ReadonlyArray<unknown>, StoreError>;
    readonly remove: (ids: ReadonlyArray<string>) => Effect.Effect<void, StoreError>;
  }
>()("@kampus/libfabrika/transport/ClientRows") {}
