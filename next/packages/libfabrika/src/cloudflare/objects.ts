import type * as Cloudflare from "@alchemy.run/cloudflare";
import { DurableObject, type DurableObjectShape } from "@alchemy.run/cloudflare/Workers/DurableObject";
import { Worker } from "@alchemy.run/cloudflare/Workers/Worker";
import type { Effect } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import type { Failure } from "../settings/Start.ts";
import type { ProjectBinding, ProcessBinding } from "./bindings.ts";
import type { recordWrite } from "./record.ts";

type Part = ReturnType<typeof import("../telemetry/Records.ts").recordPart>;

type Call<K extends keyof Part> = (
  chain: Parameters<typeof recordWrite>[2],
  at: number,
  ...args: Parameters<Part[K]>
) => Effect.Effect<Effect.Success<ReturnType<Part[K]>>, Effect.Error<ReturnType<Part[K]>> | typeof Failure.Type>;

export type RecordShape = {
  write: Call<"write">;
  read: Call<"read">;
  content: Call<"content">;
  deleteContent: Call<"deleteContent">;
};

export type ProjectShape = ProjectBinding;
export type ProcessShape = ProcessBinding;

/**
 * The Connection object's contract: the platform's request and socket slots, and the three calls
 * another object makes. A call fails with `LedgerError` only; a slot has no failure, as Alchemy
 * types it.
 */
export type ConnectionShape = {
  readonly fetch: NonNullable<DurableObjectShape["fetch"]>;
  readonly webSocketMessage: (socket: Cloudflare.WebSocket, text: string | ArrayBuffer) => Effect.Effect<void>;
  readonly webSocketClose: (socket: Cloudflare.WebSocket, code: number) => Effect.Effect<void>;
  readonly webSocketError: (socket: Cloudflare.WebSocket) => Effect.Effect<void>;
  readonly ring: (stream: string, rev: number) => Effect.Effect<void, LedgerError>;
  readonly notify: (client: string, news: unknown) => Effect.Effect<void, LedgerError>;
  readonly probe: (session: string) => Effect.Effect<number | null, LedgerError>;
};

export class Project extends DurableObject<Project, ProjectShape>()("Project") {}
export class Process extends DurableObject<Process, ProcessShape>()("Process") {}
export class Connection extends DurableObject<Connection, ConnectionShape>()("Connection") {}
export class RecordPart extends DurableObject<RecordPart, RecordShape>()("RecordPart") {}
export class Brain extends Worker<Brain, Record<never, never>, RecordPart | Connection>()("Brain") {}
