// BranchesTest.layer: the Branches service in memory, on one model of a checkout's branches. A tip
// the model does not name fails, as git does on an unknown object.
import { Effect, Layer } from "effect";
import { type Branch, Branches, BranchesError } from "./Branches.ts";

export type Model = {
  readonly branches: ReadonlyArray<Branch>;
  /** Commits each tip holds that origin/main does not. */
  readonly ahead: Readonly<Record<string, number>>;
  /** The tips whose trial merge into origin/main changes nothing. */
  readonly empty: ReadonlyArray<string>;
  /** Fails the listing, as a git call that cannot run does. */
  readonly broken?: boolean;
};

export const layer = (model: Model): Layer.Layer<Branches> =>
  Layer.succeed(
    Branches,
    Branches.of({
      refresh: Effect.void,
      list: model.broken
        ? Effect.fail(new BranchesError({ command: "for-each-ref", reason: "broken" }))
        : Effect.succeed(model.branches),
      ahead: (tip) => {
        const n = model.ahead[tip];
        return n === undefined
          ? Effect.fail(new BranchesError({ command: "rev-list", reason: `unknown ${tip}` }))
          : Effect.succeed(n);
      },
      landsEmpty: (tip) =>
        model.ahead[tip] === undefined
          ? Effect.fail(new BranchesError({ command: "merge-tree", reason: `unknown ${tip}` }))
          : Effect.succeed(model.empty.includes(tip)),
    }),
  );
