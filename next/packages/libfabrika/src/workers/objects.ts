import * as Cloudflare from "@alchemy.run/cloudflare";
import type { ProjectBinding, ProcessBinding, GatewayBinding } from "./bindings.ts";
import type { recordWrite } from "./record.ts";

type Part = ReturnType<typeof import("../data/records.ts").recordPart>;

type Call<K extends keyof Part> = (
  chain: Parameters<typeof recordWrite>[2],
  at: number,
  ...args: Parameters<Part[K]>
) => ReturnType<Part[K]>;

export type RecordShape = {
  write: Call<"write">;
  read: Call<"read">;
  content: Call<"content">;
  deleteContent: Call<"deleteContent">;
};

export type ProjectShape = ProjectBinding;
export type ProcessShape = ProcessBinding;
export type GatewayShape = GatewayBinding;
export class Project extends Cloudflare.DurableObject<Project, ProjectShape>()("Project") {}
export class Process extends Cloudflare.DurableObject<Process, ProcessShape>()("Process") {}
export class Gateway extends Cloudflare.DurableObject<Gateway, GatewayShape>()("Gateway") {}
export class RecordPart extends Cloudflare.DurableObject<RecordPart, RecordShape>()("RecordPart") {}
export class Brain extends Cloudflare.Worker<Brain, Record<never, never>, RecordPart>()("Brain") {}
