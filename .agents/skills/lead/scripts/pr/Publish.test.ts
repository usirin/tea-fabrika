// Today's lead tooling. Publish's laws (0134) on the test layers: nothing here pushes or asks GitHub.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import * as Publish from "./Publish.ts";
import type { PullRequest } from "./PullRequests.ts";
import * as PullRequestsGh from "./PullRequestsGh.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import * as PushesProcess from "./PushesProcess.ts";
import * as PushesTest from "./PushesTest.ts";

/** Branch names of every kind the commit step meets: the bot's, a lane's backup, a person's, a bare one. */
const Branch = Schema.Literals(["fabrikalfa/a", "fabrikalfa/lane-wip", "person/b", "c"]);
const Sha = Schema.Literals(["1".repeat(40), "2".repeat(40), "a".repeat(40)]);
/** No PR on the branch yet, an open draft, or an open ready one. */
const Already = Schema.NullOr(Schema.Boolean);
const text = { title: "T1 tests: a law", body: Publish.DRAFT_BODY };

const open = (number: number, head: string, draft: boolean): PullRequest => ({
  number,
  head,
  oid: "",
  state: "OPEN",
  draft,
});

/** Fresh memory for one run: the remote, GitHub, and the layer over both. */
const memory = (
  prs: ReadonlyArray<PullRequest> = [],
  failing: { pushes?: PushesTest.Failing; prs?: PullRequestsTest.Failing } = {},
) => {
  const remote = PushesTest.remote();
  const github = PullRequestsTest.world(prs);
  const layer = Layer.mergeAll(PushesTest.layer(remote, failing.pushes), PullRequestsTest.layer(github, failing.prs));
  return { remote, github, layer };
};

const ask = (branch: string, head: string): Publish.Ask => ({ dir: ".", branch, head, text });

describe("publish: a commit is pushed when it is made, with a draft PR from the first commit (0134)", () => {
  it.effect.prop(
    "property: the leak grep runs first, the head reaches its branch, and a draft opens only when none is open",
    { b: Branch, head: Sha, already: Already },
    ({ b, head, already }) =>
      Effect.gen(function* () {
        const m = memory(already === null ? [] : [open(7, b, already)]);
        yield* Publish.publish(ask(b, head)).pipe(Effect.provide(m.layer));
        expect(m.remote.calls).toEqual([`leakgrep ${head}`, `push ${b} ${head}`]);
        expect(m.remote.branches.get(b)).toBe(head);
        expect(m.github.prs.filter((pr) => pr.head === b && pr.state === "OPEN")).toHaveLength(1);
        expect(m.github.calls).toEqual(already === null ? [{ _tag: "draft", branch: b, title: text.title }] : []);
      }),
  );

  it.effect.prop(
    "property: a second commit on the branch opens no second pull request",
    { b: Branch, first: Sha, second: Sha },
    ({ b, first, second }) =>
      Effect.gen(function* () {
        const m = memory();
        const one = yield* Publish.publish(ask(b, first)).pipe(Effect.provide(m.layer));
        const two = yield* Publish.publish(ask(b, second)).pipe(Effect.provide(m.layer));
        expect(one).toEqual({ pr: 1, opened: true, draft: true });
        expect(two).toEqual({ pr: 1, opened: false, draft: true });
        expect(m.github.prs).toHaveLength(1);
        expect(m.remote.branches.get(b)).toBe(second);
      }),
  );

  it.effect.prop(
    "property: a refused leak grep pushes nothing and asks GitHub nothing",
    { b: Branch, head: Sha },
    ({ b, head }) =>
      Effect.gen(function* () {
        const m = memory([], { pushes: { leak: "private_word" } });
        const e = yield* Effect.flip(Publish.publish(ask(b, head)).pipe(Effect.provide(m.layer)));
        expect(e._tag).toBe("LeakGrepRefused");
        expect(m.remote.calls).toEqual([`leakgrep ${head}`]);
        expect(m.remote.branches.size).toBe(0);
        expect(m.github.calls).toEqual([]);
      }),
  );

  it.effect.prop(
    "property: a refused push fails the publish and opens no pull request",
    { b: Branch, head: Sha },
    ({ b, head }) =>
      Effect.gen(function* () {
        const m = memory([], { pushes: { push: "rejected" } });
        const e = yield* Effect.flip(Publish.publish(ask(b, head)).pipe(Effect.provide(m.layer)));
        expect(e._tag).toBe("PushRefused");
        expect(m.github.prs).toEqual([]);
      }),
  );

  // scenario: drive's sign worktree is detached, and no commit step ever pushes main.
  it.effect("scenario: a detached head or main is refused before any grep or push", () =>
    Effect.forEach(
      ["", "HEAD", "main", "refs/heads/main"],
      (b) =>
        Effect.gen(function* () {
          const m = memory();
          const e = yield* Effect.flip(Publish.publish(ask(b, "a".repeat(40))).pipe(Effect.provide(m.layer)));
          expect(e._tag, b).toBe("NoBranch");
          expect(m.remote.calls).toEqual([]);
        }),
      { concurrency: 1 },
    ),
  );

  // scenario: the push and the draft are two calls; a refused draft must not read as a pass.
  it.effect("scenario: GitHub refusing the draft fails the publish after the push, so the commit is on GitHub", () =>
    Effect.gen(function* () {
      const m = memory([], { prs: { draft: "422" } });
      const e = yield* Effect.flip(Publish.publish(ask("fabrikalfa/x", "b".repeat(40))).pipe(Effect.provide(m.layer)));
      expect(e._tag).toBe("PullRequestsError");
      expect(m.remote.branches.get("fabrikalfa/x")).toBe("b".repeat(40));
    }),
  );
});

describe("ready: a lane's steps passed, so its pull request takes the brief's words and is ready (0134)", () => {
  it.effect.prop(
    "property: the PR gets the brief's text, a draft is marked ready, a ready one is left as it is",
    { b: Branch, head: Sha, already: Already },
    ({ b, head, already }) =>
      Effect.gen(function* () {
        const m = memory(already === null ? [] : [open(7, b, already)]);
        yield* Publish.ready(ask(b, head)).pipe(Effect.provide(m.layer));
        const pr = already === null ? 1 : 7;
        const readied = already === false ? [] : [{ _tag: "ready", number: pr }];
        const opened = already === null ? [{ _tag: "draft", branch: b, title: text.title }] : [];
        expect(m.github.calls).toEqual([...opened, { _tag: "edit", number: pr, ...text }, ...readied]);
        expect(m.github.prs.find((p) => p.number === pr)?.draft).toBe(false);
      }),
  );
});

describe("the process layers' own reads", () => {
  // vector: the URL shapes `git remote get-url` prints for GitHub, and two that are not GitHub.
  it("vector: an origin URL GitHub serves gives owner/name; any other gives none", () => {
    expect(PullRequestsGh.repoFromUrl("https://github.com/o/r.git\n")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("https://github.com/o/r")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("git@github.com:o/r.git")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("ssh://git@github.com/o/r.git")).toBe("o/r");
    expect(PullRequestsGh.repoFromUrl("https://gitlab.com/o/r.git")).toBeNull();
    expect(PullRequestsGh.repoFromUrl("/srv/git/r.git")).toBeNull();
  });

  it.prop(
    "property: only a fabrikalfa/ branch is the bot's to push; any other is pushed on the person's login",
    { b: Branch },
    ({ b }) => PushesProcess.isBotBranch(b) === b.startsWith("fabrikalfa/"),
  );
});
