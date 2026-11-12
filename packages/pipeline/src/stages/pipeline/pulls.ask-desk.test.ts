import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import { property } from "../../ask-desk.test-support.ts";
import { sealAsk } from "../../tickets/ask.ts";
import { type Pull, yesOf } from "./pulls.ts";

// Today's version. A person's merge binds only to the newest sealed merge ask, and only as `merge`.
const { DRAFT, HEAD, NONE, TOOK } = JSON.parse(
  readFileSync(new URL("../../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

const PULL: Pull = {
  id: "local:117",
  kind: "lane",
  ticket: 117,
  branch: "lane/117",
  head: HEAD,
  tree: "t",
  state: "open",
  title: "t",
  body: "b",
  verdicts: [],
};

const evidence = {
  _tag: "change",
  head: HEAD,
  diff: "diff --git a/file b/file\n+one",
  checks: [],
  review: null,
  rules: [],
};

const merge = {
  ...DRAFT,
  for: "merge",
  step: "merge",
  picks: [
    { pick: "merge", does: "Merge the pull request" },
    { pick: "no", does: "Keep the lane parked" },
  ],
  rec: { ...DRAFT.rec, pick: "merge" },
  evidence,
};

const LANE = { kind: "agent" };
const OWNER = { kind: "user" };

const said = (ask: { ask: string; saw: string }, answer: unknown) => ({
  by: OWNER,
  fact: {
    type: "answered",
    format: 1,
    ask: ask.ask,
    answer,
    saw: ask.saw,
    via: { _tag: "window", took: TOOK },
  },
});

describe("ask desk P22: the merge read takes the sealed answer", () => {
  property(
    "binds a merge answer to the head the ask showed",
    { head: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)) },
    async ({ head }) => {
      const ask = await Effect.runPromise(sealAsk({ ...merge, ask: "a-merge-1", evidence: { ...evidence, head } }));
      const timeline = [{ by: LANE, fact: ask }, said(ask, { _tag: "rec" })];
      expect(yesOf({ timeline }, { ...PULL, head })).toEqual({ _tag: "asked", head });
    },
  );
  property(
    "a no answer is not a merge",
    {
      note: Schema.NonEmptyString.check(
        Schema.isTrimmed(),
        Schema.isMaxLength(120),
        Schema.isPattern(/^[^\r\n\uD800-\uDFFF]*$/u),
      ),
    },
    async ({ note }) => {
      const ask = await Effect.runPromise(sealAsk({ ...merge, ask: "a-merge-1" }));
      const timeline = [{ by: LANE, fact: ask }, said(ask, { _tag: "against", pick: "no", note })];
      expect(yesOf({ timeline }, PULL)).toEqual({ _tag: "none" });
    },
  );
  property(
    "a merge to an older ask does not answer the newest one, though it showed the same",
    { n: Schema.Int },
    async ({ n }) => {
      // No rec, so no blind draw tells the two displays apart.
      const plain = { ...merge, rec: NONE };
      const first = await Effect.runPromise(sealAsk({ ...plain, ask: `a-merge-${n}-old` }));
      const newest = await Effect.runPromise(sealAsk({ ...plain, ask: `a-merge-${n}-new` }));
      expect(newest.saw).toBe(first.saw);
      const yes = said(first, { _tag: "chose", pick: "merge" });
      expect(yesOf({ timeline: [{ by: LANE, fact: first }, yes] }, PULL)).toEqual({
        _tag: "asked",
        head: HEAD,
      });
      const timeline = [{ by: LANE, fact: first }, yes, { by: LANE, fact: newest }];
      expect(yesOf({ timeline }, PULL)).toEqual({ _tag: "none" });
    },
  );
});
