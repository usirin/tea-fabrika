import type { JevHttpReply, JevRequest } from "@demlik/tea/jev";
import { Context, type Effect } from "effect";
import type { Issue } from "./issue.ts";
import type { Questions } from "./judge.ts";

export interface BuildRequest {
  readonly issue: Issue;
  /** Why the last attempt was sent back, or `null` on the first one. */
  readonly feedback: string | null;
  /** The conversation the last attempt handed back, or `null` on the first one. */
  readonly session: string | null;
}

export interface BuildResult {
  readonly summary: string;
  /** The builder's conversation, to be handed back on a retry. */
  readonly session: string;
}

/**
 * The thing that writes code. Claude, Codex or a script: the lane cannot tell,
 * each one is a Layer behind this.
 */
export class Builder extends Context.Service<
  Builder,
  {
    readonly build: (
      request: BuildRequest,
    ) => Effect.Effect<BuildResult, { readonly _tag: "agent_failed" }>;
  }
>()("Builder") {}

export interface CheckResult {
  readonly passed: boolean;
  readonly output: string;
  readonly diff: string;
}

/** The checkout the builder worked in: run its tests, read its diff. */
export class Workspace extends Context.Service<
  Workspace,
  {
    readonly check: () => Effect.Effect<
      CheckResult,
      { readonly _tag: "could_not_run" }
    >;
  }
>()("Workspace") {}

/** A call to Jev that never got a reply: a socket error, a DNS failure. */
export interface JevCallFailed {
  readonly _tag: "jev_call_failed";
  readonly cause: unknown;
}

/** One HTTP call to Jev. The key and the network live in the Layer. */
export class Jev extends Context.Service<
  Jev,
  {
    readonly call: (
      request: JevRequest<Questions>,
    ) => Effect.Effect<JevHttpReply, JevCallFailed>;
  }
>()("Jev") {}
