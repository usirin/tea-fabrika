import * as Cloudflare from "@alchemy.run/cloudflare";
import type { Effect } from "effect";
import type { ProjectBinding, ProcessBinding, GatewayBinding } from "./bindings.ts";
import type { recordWrite, recordRead, recordContent, recordDelete } from "./record.ts";

type Shape<B> = {
  [K in keyof B as B[K] extends (...args: never[]) => unknown ? K : never]: B[K] extends (
    ...args: infer A
  ) => Promise<infer V>
    ? (...args: A) => Effect.Effect<V>
    : never;
};

type Call<F> = F extends (state: never, cap: never, ...args: infer A) => infer V ? (...args: A) => V : never;

export type RecordShape = {
  write: Call<typeof recordWrite>;
  read: Call<typeof recordRead>;
  content: Call<typeof recordContent>;
  deleteContent: Call<typeof recordDelete>;
};

export type ProjectShape = Shape<ProjectBinding>;
export type ProcessShape = Shape<ProcessBinding>;
export type GatewayShape = Shape<GatewayBinding>;
export class Project extends Cloudflare.DurableObject<Project, ProjectShape>()("Project") {}
export class Process extends Cloudflare.DurableObject<Process, ProcessShape>()("Process") {}
export class Gateway extends Cloudflare.DurableObject<Gateway, GatewayShape>()("Gateway") {}
export class RecordPart extends Cloudflare.DurableObject<RecordPart, RecordShape>()("RecordPart") {}
export class Brain extends Cloudflare.Worker<Brain, Record<never, never>, RecordPart>()("Brain") {}
