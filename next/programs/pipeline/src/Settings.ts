import { Setting } from "@kampus/libfabrika";
import { Schema } from "effect";
import { Kinds, Plan, type Kind } from "./Change.ts";

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

export const all = Setting.group({
  kinds: Setting.make("queue.kinds", {
    schema: Kinds,
    default: { rows: [], docs: [] },
    doc: "Globs for rows and docs; unmatched or incomplete paths make a code change.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
  checks: Setting.make("queue.checks", {
    schema: Plan,
    default: { rows: [], docs: [], code: [] },
    doc: "The checks that must be green on the head that lands, per kind of change. A kind with no check is never merged; the queue says which key to set.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
  wait: Setting.make("merger.wait", {
    schema: Positive,
    default: 60,
    doc: "Minutes before silent checks or a missing command answer count as lost.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
  poll: Setting.make("merger.poll", {
    schema: Positive,
    default: 30,
    doc: "Seconds between pending check reads, and the first wait after a fault.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
  backoff: Setting.make("merger.backoff", {
    schema: Positive,
    default: 300,
    doc: "Maximum seconds to wait after a fault; waits double from merger.poll.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
  rounds: Setting.make("merger.rounds", {
    schema: Positive,
    default: 5,
    doc: "New heads checked before a landing replies behind because main keeps moving.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
  most: Setting.make("queue.most", {
    schema: Positive,
    default: 256,
    doc: "Maximum entries waiting in the merge queue's line.",
    scope: ["repo"],
    reload: "restart",
    since: "0.0.0",
  }),
});

export type Values = typeof all extends Setting.Group<infer A> ? A : never;

export const key = (kind: typeof Kind.Type) => `queue.checks.${kind}`;
