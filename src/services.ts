import type { JevHttpReply, JevRequest } from "@demlik/tea/jev";
import { Context, type Effect } from "effect";
import type { Reading } from "./comments.ts";
import type { Comment } from "./tracker.ts";
import type { Issue, RawIssue } from "./issue.ts";
import type { Decided, Deviation, Finding, Relation, Snapshot, Spotted } from "./review.ts";

export type { Deviation, Relation };

export interface EnrichRequest {
  readonly raw: RawIssue;
  /** Why an earlier rewrite was sent back, or `null` on the first one. */
  readonly note: string | null;
  /** The conversation the last rewrite handed back, or `null` on the first one. */
  readonly session: string | null;
}

export interface EnrichResult {
  readonly issue: Issue;
  /** The enricher's conversation, to be handed back if the rewrite is sent back. */
  readonly session: string;
}

/**
 * The thing that reads a raw issue and the code it is about, and writes the
 * issue a builder picks up. It never writes code.
 */
export class Enricher extends Context.Service<
  Enricher,
  {
    readonly enrich: (
      request: EnrichRequest,
    ) => Effect.Effect<EnrichResult, { readonly _tag: "agent_failed" }>;
  }
>()("Enricher") {}

export interface BuildRequest {
  readonly issue: Issue;
  /** Why the last attempt was sent back, or `null` on the first one. */
  readonly feedback: string | null;
  /**
   * The builder's conversation, named by the lane. `continues` is false only
   * for a lane's very first build; a builder that finds no conversation to
   * continue starts one under the same id.
   */
  readonly session: { readonly id: string; readonly continues: boolean };
}

/**
 * How a build ended, in the builder's own words. `done` lists the files it
 * changed beyond the ticket. `contradiction` names an example that breaks its
 * own rule, which the builder must not code to; `blocked` is work it cannot do
 * from here; `dispute` names a review finding it thinks is wrong. None is a
 * failure: each goes to a person with the builder's reason.
 */
export type BuildAnswer =
  | { readonly kind: "done"; readonly summary: string; readonly deviations: readonly Deviation[] }
  | {
      readonly kind: "contradiction";
      readonly criterion: string;
      readonly call: string;
      readonly why: string;
    }
  | { readonly kind: "blocked"; readonly why: string }
  | { readonly kind: "dispute"; readonly finding: string; readonly why: string };

/**
 * The thing that writes code. Claude, Codex or a script: the lane cannot tell,
 * each one is a Layer behind this.
 */
export class Builder extends Context.Service<
  Builder,
  {
    readonly build: (
      request: BuildRequest,
    ) => Effect.Effect<BuildAnswer, { readonly _tag: "agent_failed" }>;
  }
>()("Builder") {}

/** The issue's tests, run once on the code before anyone changed it. */
export interface Prepared {
  /** The names of the tests that passed and failed. One that is in neither did not run. */
  readonly passing: readonly string[];
  readonly failing: readonly string[];
  readonly output: string;
}

export interface CheckResult {
  readonly passed: boolean;
  readonly output: string;
  readonly diff: string;
  /** The names of the tests that passed. */
  readonly passingTests: readonly string[];
  /** Locked files the builder changed. They were put back before the tests ran. */
  readonly touched: readonly string[];
  /** Every file in the diff. */
  readonly changed: readonly string[];
  /** The changed files that still exist, with the lines the diff touched. */
  readonly snapshot: Snapshot;
}

export interface Routed {
  readonly relation: Relation;
  readonly confidence: number;
}

/**
 * The thing that says whether a text is about a ticket's goal: Jev, a model,
 * or a script. `about` says what the text is: the reason for an extra change,
 * or a problem a reviewer found. Review only routes on the answer, and
 * `unsure` stops work rather than letting it through.
 */
export class Router extends Context.Service<
  Router,
  {
    readonly route: (question: {
      readonly about: "change" | "finding";
      readonly text: string;
      readonly goal: string;
    }) => Effect.Effect<Routed, { readonly _tag: "router_failed" }>;
  }
>()("Router") {}

export interface ReviewRequest {
  readonly issue: Issue;
  readonly diff: string;
  /** Findings from earlier rounds, to say of each whether it is fixed now. */
  readonly open: readonly Finding[];
  /** Findings a person already settled, not to be raised again. */
  readonly decided: readonly Decided[];
}

export interface ReviewReport {
  readonly findings: readonly Spotted[];
  readonly rechecks: readonly { readonly id: string; readonly fixed: boolean }[];
}

/**
 * The thing that says whether a new finding makes the same point as one a
 * person already decided. `to` is that one's id, or `null` when it is a
 * different point or the matcher is not sure: `null` sends the finding on to
 * be routed like any new one, so a miss costs a question, never a pass.
 */
export class Matcher extends Context.Service<
  Matcher,
  {
    readonly match: (question: {
      readonly text: string;
      readonly candidates: readonly { readonly id: string; readonly text: string }[];
    }) => Effect.Effect<{ readonly to: string | null; readonly confidence: number }, { readonly _tag: "matcher_failed" }>;
  }
>()("Matcher") {}

/**
 * The thing that reads a diff for problems tests cannot see. It only finds:
 * whether a finding is real, whether it is this ticket's, and whether the
 * change passes are decided elsewhere.
 */
export class Reviewer extends Context.Service<
  Reviewer,
  {
    readonly review: (
      request: ReviewRequest,
    ) => Effect.Effect<ReviewReport, { readonly _tag: "agent_failed" }>;
  }
>()("Reviewer") {}

/**
 * Where tickets live: GitHub, another tracker, a file, a script. Everything the
 * pipeline reads from outside about a ticket comes through here, so swapping
 * GitHub for something else is one Layer.
 */
export class Tracker extends Context.Service<
  Tracker,
  {
    /** One ticket as it was filed. One the tracker does not have is a failure. */
    readonly ticket: (issue: string) => Effect.Effect<RawIssue, { readonly _tag: "tracker_failed" }>;
    /** Every comment on the ticket so far, oldest first, each with an id that never changes. */
    readonly comments: (issue: string) => Effect.Effect<readonly Comment[], { readonly _tag: "tracker_failed" }>;
  }
>()("Tracker") {}

/**
 * The thing that says what an owner's comment does to a ticket's rules: Jev, a
 * model, or a script. Only a sure "changes nothing" lets a comment pass
 * without a person, so a reader that is unsure must say `unsure`. A failure
 * names the comment, so only that one goes to a person.
 */
export class CommentReader extends Context.Service<
  CommentReader,
  {
    readonly weigh: (question: {
      readonly text: string;
      readonly rules: readonly { readonly id: string; readonly rule: string }[];
    }) => Effect.Effect<{ readonly reading: Reading; readonly confidence: number }, { readonly _tag: "reader_failed" }>;
  }
>()("CommentReader") {}

/** The checkout the builder works in: write the issue's tests, run them, read the diff. */
export class Workspace extends Context.Service<
  Workspace,
  {
    /** Write the issue's tests into the checkout, lock them, and run them on the untouched code. */
    readonly prepare: (issue: Issue) => Effect.Effect<
      Prepared,
      { readonly _tag: "could_not_run" }
    >;
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
      request: JevRequest,
    ) => Effect.Effect<JevHttpReply, JevCallFailed>;
  }
>()("Jev") {}
