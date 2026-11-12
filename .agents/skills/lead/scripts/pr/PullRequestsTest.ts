// PullRequestsTest.layer: the PullRequests service in memory, on one list of pull requests that its
// writes change as GitHub's would. It asks GitHub nothing. `calls` keeps every write, in order.
import { Effect, Layer, Option, Schema } from "effect";
import { type PullRequest, PullRequests, PullRequestsError } from "./PullRequests.ts";

/** One write the layer took, as the caller made it. */
export const Call = Schema.TaggedUnion({
  draft: { branch: Schema.String, title: Schema.String },
  edit: { number: Schema.Number, title: Schema.String, body: Schema.String },
  ready: { number: Schema.Number },
});
export type Call = typeof Call.Type;

/** The calls that fail with a reason, by name: `openOn`, `all`, `draft`, `edit` or `ready`. */
export type Failing = Partial<Record<"openOn" | "all" | "draft" | "edit" | "ready", string>>;

export type World = { readonly prs: Array<PullRequest>; readonly calls: Array<Call> };

/** A fresh world over these pull requests; the layer reads and changes it in place. */
export const world = (prs: ReadonlyArray<PullRequest> = []): World => ({ prs: [...prs], calls: [] });

export const layer = (w: World, failing: Failing = {}): Layer.Layer<PullRequests> => {
  const fails = (name: keyof Failing) => {
    const reason = failing[name];
    return reason === undefined ? Effect.void : Effect.fail(new PullRequestsError({ reason }));
  };

  return Layer.succeed(
    PullRequests,
    PullRequests.of({
      openOn: (branch) =>
        Effect.map(fails("openOn"), () =>
          Option.fromUndefinedOr(w.prs.find((pr) => pr.head === branch && pr.state === "OPEN")),
        ),
      all: Effect.map(fails("all"), () => [...w.prs]),
      draft: (branch, text) =>
        Effect.map(fails("draft"), () => {
          const number = Math.max(0, ...w.prs.map((pr) => pr.number)) + 1;
          w.prs.push({ number, head: branch, oid: "", state: "OPEN", draft: true });
          w.calls.push(Call.cases.draft.make({ branch, title: text.title }));
          return number;
        }),
      edit: (number, text) =>
        Effect.map(fails("edit"), () => {
          w.calls.push(Call.cases.edit.make({ number, title: text.title, body: text.body }));
        }),
      ready: (number) =>
        Effect.map(fails("ready"), () => {
          const at = w.prs.findIndex((pr) => pr.number === number);
          const pr = w.prs[at];

          if (pr !== undefined) {
            w.prs[at] = { ...pr, draft: false };
          }

          w.calls.push(Call.cases.ready.make({ number }));
        }),
    }),
  );
};
