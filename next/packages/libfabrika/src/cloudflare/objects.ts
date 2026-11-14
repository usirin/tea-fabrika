import { DurableObject } from "@alchemy.run/cloudflare/Workers/DurableObject";
import { Worker } from "@alchemy.run/cloudflare/Workers/Worker";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import type { Effect } from "effect";
import type { LedgerError } from "../ledger/Ledger.ts";
import type { Activity } from "../processes/Process.ts";
import type { Descriptor, Opened, Sent } from "../runtime/Runner.ts";
import type { Failure } from "../settings/Start.ts";
import type { ProjectBinding, ConnectionBinding } from "./bindings.ts";
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

/**
 * The Process object's contract: the platform's alarm slot, and the calls other objects and the
 * control socket make. A call fails with `LedgerError` only. The alarm slot has no failure, as
 * Alchemy types it, so a failed alarm dies and the platform delivers it again.
 */
export type ProcessShape = {
  readonly alarm: () => Effect.Effect<void>;
  readonly usage: (rows: unknown) => Effect.Effect<void, LedgerError>;
  readonly configure: (descriptor: Descriptor, drain?: boolean) => Effect.Effect<void, LedgerError>;
  readonly descriptor: () => Effect.Effect<Descriptor, LedgerError>;
  readonly msg: (input: unknown) => Effect.Effect<Sent, LedgerError>;
  readonly open: (client: string) => Effect.Effect<Opened, LedgerError>;
  readonly mailed: (trace?: { readonly traceId: string; readonly spanId: string }) => Effect.Effect<void, LedgerError>;
  readonly due: (at: number) => Effect.Effect<void, LedgerError>;
  readonly restart: (request: { readonly id: string; readonly build: string }) => Effect.Effect<void, LedgerError>;
  readonly activity: (value: typeof Activity.Type) => Effect.Effect<void, LedgerError>;
  readonly recover: () => Effect.Effect<unknown, LedgerError>;
  readonly savedAlarm: () => Effect.Effect<number | undefined, LedgerError>;
  readonly abort: () => Effect.Effect<void, never, RuntimeContext>;
};

export type ConnectionShape = ConnectionBinding;
export class Project extends DurableObject<Project, ProjectShape>()("Project") {}
export class Process extends DurableObject<Process, ProcessShape>()("Process") {}
export class Connection extends DurableObject<Connection, ConnectionShape>()("Connection") {}
export class RecordPart extends DurableObject<RecordPart, RecordShape>()("RecordPart") {}
export class Brain extends Worker<Brain, Record<never, never>, RecordPart | Process>()("Brain") {}
