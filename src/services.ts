import type { JevHttpReply, JevRequest } from "@demlik/tea/jev";
import { Context, type Effect } from "effect";
import type { Issue } from "./issue.ts";
import type { Questions } from "./judge.ts";

/**
 * The thing that writes code. Claude, Codex or a script: the lane cannot tell,
 * each one is a Layer behind this.
 */
export class Builder extends Context.Service<
  Builder,
  {
    readonly build: (
      issue: Issue,
      feedback: string | null,
    ) => Effect.Effect<
      { readonly summary: string },
      { readonly _tag: "agent_failed" }
    >;
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
