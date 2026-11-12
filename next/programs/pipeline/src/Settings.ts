import * as Setting from "@kampus/libfabrika/settings/Setting";
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
  }),
  checks: Setting.make("queue.checks", {
    schema: Plan,
    default: { rows: [], docs: [], code: [] },
    doc: "The checks that must be green on the head that lands, per kind of change. A kind with no check is never merged; the queue says which key to set.",
    scope: ["repo"],
    reload: "restart",
  }),
  wait: Setting.make("merger.wait", {
    schema: Positive,
    default: 60,
    doc: "Minutes before silent checks or a missing command answer count as lost.",
    scope: ["repo"],
    reload: "restart",
  }),
  poll: Setting.make("merger.poll", {
    schema: Positive,
    default: 30,
    doc: "Seconds between pending check reads, and the first wait after a fault.",
    scope: ["repo"],
    reload: "restart",
  }),
  backoff: Setting.make("merger.backoff", {
    schema: Positive,
    default: 300,
    doc: "Maximum seconds to wait after a fault; waits double from merger.poll.",
    scope: ["repo"],
    reload: "restart",
  }),
});

export type Values = typeof all extends Setting.Group<infer A> ? A : never;

// oxlint-disable-next-line fabrika/no-of -- ticket 765 approved plan names this public function keyOf
export const keyOf = (kind: typeof Kind.Type) => `queue.checks.${kind}`;
