/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { Context, type Effect, Schema } from "effect";
import { ErrorClass } from "./ClientRows.ts";
import type { KeyLine } from "./Sshsig.ts";

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
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
