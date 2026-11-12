import { DurableObject } from "@alchemy.run/cloudflare/Workers/DurableObject";
import { Worker } from "@alchemy.run/cloudflare/Workers/Worker";
import type { Effect } from "effect";
import type { Failure } from "../settings/Start.ts";
import type { ProjectBinding, ProcessBinding, ConnectionBinding } from "./bindings.ts";
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
export type ConnectionShape = ConnectionBinding;
export class Project extends DurableObject<Project, ProjectShape>()("Project") {}
export class Process extends DurableObject<Process, ProcessShape>()("Process") {}
export class Connection extends DurableObject<Connection, ConnectionShape>()("Connection") {}
export class RecordPart extends DurableObject<RecordPart, RecordShape>()("RecordPart") {}
export class Brain extends Worker<Brain, Record<never, never>, RecordPart>()("Brain") {}
