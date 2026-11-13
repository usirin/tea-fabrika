// PushesTest.layer: the Pushes service in memory. A leak grep refuses or passes as told, and each
// push that passes moves the branch on a remote kept in memory, as `origin` would. `calls` keeps
// every call in order, so a test can read that the grep ran before the push.
import { Effect, Layer } from "effect";
import { LeakGrepRefused, Pushes, PushRefused } from "./Pushes.ts";

export type Remote = {
  /** Each branch on the remote, and the head it points at. */
  readonly branches: Map<string, string>;
  readonly calls: Array<string>;
};

export const remote = (): Remote => ({ branches: new Map(), calls: [] });

export type Failing = {
  readonly leak?: string;
  readonly leakChange?: string;
  readonly leakText?: string;
  readonly push?: string;
};

export const layer = (r: Remote, failing: Failing = {}): Layer.Layer<Pushes> =>
  Layer.succeed(
    Pushes,
    Pushes.of({
      leakGrep: (_dir, head) =>
        Effect.suspend(() => {
          r.calls.push(`leakgrep ${head}`);
          return failing.leak === undefined ? Effect.void : Effect.fail(new LeakGrepRefused({ reason: failing.leak }));
        }),
      leakChange: (_dir, head) =>
        Effect.suspend(() => {
          r.calls.push(`leakchange ${head}`);
          return failing.leakChange === undefined
            ? Effect.void
            : Effect.fail(new LeakGrepRefused({ reason: failing.leakChange }));
        }),
      leakText: (_dir, text) =>
        Effect.suspend(() => {
          r.calls.push(`leaktext ${text}`);
          return failing.leakText === undefined
            ? Effect.void
            : Effect.fail(new LeakGrepRefused({ reason: failing.leakText }));
        }),
      push: (_dir, branch, head) =>
        Effect.suspend(() => {
          r.calls.push(`push ${branch} ${head}`);

          if (failing.push !== undefined) {
            return Effect.fail(new PushRefused({ reason: failing.push }));
          }

          r.branches.set(branch, head);
          return Effect.void;
        }),
    }),
  );
