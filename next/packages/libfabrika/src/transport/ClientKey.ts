import { Context, type Effect, Schema } from "effect";
import { ErrorClass } from "./ClientRows.ts";
import type { KeyLine } from "./Sshsig.ts";

export class ClientKeyError extends Schema.TaggedError<ClientKeyError>()("ClientKeyError", {
  op: Schema.Literals(["open", "read", "write", "make", "sign"]),
  error: ErrorClass,
}) {}

/** Only the public key can leave the store. Signing keeps the private half there. */
export type Identity = {
  readonly fingerprint: string;
  readonly raw: string;
  readonly line: KeyLine;
  readonly found: "created" | "reused" | "replaced";
  readonly sign: (bytes: Uint8Array) => Effect.Effect<Uint8Array, ClientKeyError>;
};

export class ClientKey extends Context.Service<
  ClientKey,
  {
    readonly current: (rejected: string | null) => Effect.Effect<Identity, ClientKeyError>;
    readonly claimPersist: Effect.Effect<boolean, ClientKeyError>;
    readonly persist: Effect.Effect<boolean, "unsupported" | "failed">;
  }
>()("@kampus/libfabrika/transport/ClientKey") {}
