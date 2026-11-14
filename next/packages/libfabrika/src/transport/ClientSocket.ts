import { Context, type Effect, Schema, type Scope, type Stream } from "effect";
import { ErrorClass } from "./ClientRows.ts";

export class ClientSocketError extends Schema.TaggedError<ClientSocketError>()("ClientSocketError", {
  error: ErrorClass,
}) {}

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
