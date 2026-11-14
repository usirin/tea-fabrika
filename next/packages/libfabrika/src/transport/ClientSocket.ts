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
import { Context, type Effect, Schema, type Scope, type Stream } from "effect";
import { ErrorClass } from "./ClientRows.ts";

export class ClientSocketError extends Schema.TaggedError<ClientSocketError>()("ClientSocketError", {
  error: ErrorClass,
}) {}

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
export type SocketEvent =
  | { readonly event: "open" }
  | { readonly event: "message"; readonly data: unknown }
  | { readonly event: "close"; readonly code: number };

export type Socket = {
  readonly events: Stream.Stream<SocketEvent>;
  readonly send: (text: string) => boolean;
  readonly close: (code: number, reason?: string) => void;
};

export class ClientSocket extends Context.Service<
  ClientSocket,
  {
    readonly dial: (url: string) => Effect.Effect<Socket, ClientSocketError, Scope.Scope>;
  }
>()("@kampus/libfabrika/transport/ClientSocket") {}
