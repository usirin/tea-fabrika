import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { Row as Judged } from "../../criteria/book.ts";
import { criterionId } from "../../ids.ts";
import { enqueue, merge } from "./machine.ts";
import {
  type Checks,
  type Criterion,
  type Met,
  type Proof,
  Ready,
  ReadyToMerge,
  type Row,
  readyToMerge,
} from "./ready.ts";
import { filed } from "./scripted.ts";

// "Ready to merge" as a value that only `ReadyToMerge.of(proof)` can make:
// one passing row per criterion the ledger holds now, at its current version,
// at the head, and the checks green at that head.

const C1 = criterionId("c1");
const C2 = criterionId("c2");

const CRITERIA: readonly [Criterion, ...Criterion[]] = [
  { id: C1, version: 1, text: "every window opens" },
  // Said again once since the plan: only a verdict on version 2 counts.
  { id: C2, version: 2, text: "the door locks, from inside too" },
];

const versionOf = (id: string) => CRITERIA.find((c) => c.id === id)?.version ?? 1;

/** One review's row on a criterion, before the book files it as a verdict under an id of its own. */
const pass = (criterion = C1, head = "A", version = versionOf(criterion)): Judged => ({
  criterion,
  version,
  head,
  grade: "pass",
  proof: `the review at ${head}`,
});

const fail = (criterion = C1, head = "A"): Judged => ({ ...pass(criterion, head), grade: "fail" });
const green: Checks = { head: "A", state: "green" };

/** A proof whose verdicts are `rows`, filed in order as `v1`, `v2`, ... */
const proof = ({
  rows = [pass(C1), pass(C2)],
  ...patch
}: Partial<Omit<Proof, "verdicts">> & { readonly rows?: readonly Judged[] } = {}): Proof => ({
  pr: "P",
  head: "A",
  tested: "M",
  criteria: CRITERIA,
  checks: green,
  ...patch,
  verdicts: filed(rows),
});

const whys = (p: Proof): readonly string[] => {
  const r = readyToMerge(p);
  return "ready" in r ? [] : r.refused.map((x) => x.why);
};

describe("ReadyToMerge cannot be made by hand", () => {
  it("is refused as a literal, a boolean, a bare head, a failing row and an empty list", () => {
    const [met] = filed([pass()]);

    if (met === undefined) {
      throw new Error("no verdict");
    }

    // @ts-expect-error a literal lacks the brand
    const literal: ReadyToMerge = { pr: "P", head: "A", criteria: CRITERIA, rows: [met] };
    // @ts-expect-error a yes is not a proof
    const yes: ReadyToMerge = true;
    // @ts-expect-error there is no constructor: only `ReadyToMerge.of` checks the rows
    const made = () => new ReadyToMerge(proof());
    // @ts-expect-error a failing row is not a met one
    const failing: Met | undefined = filed([fail()])[0];
    // @ts-expect-error a ticket with no criteria has nothing to prove
    const none: Proof = { pr: "P", head: "A", criteria: [], verdicts: [], checks: green };
    // @ts-expect-error a row names its criterion by id, never by its place in a list
    const byPlace: Row = { n: 1, version: 1, head: "A", grade: "pass", proof: "p" };
    // @ts-expect-error a verdict has an id of its own: a row the book has not filed is not one
    const unfiled: Row = pass();
    expect([literal, yes, made, failing, none, byPlace, unfiled].length).toBe(7);
  });

  it("is the only thing the enqueue and merge Cmds take: no pull request and head on their own", () => {
    // @ts-expect-error the queue takes the proof, not a pull request and a head
    const bare = enqueue({ pr: "P", head: "A", intent: "i" });
    // @ts-expect-error a proof's shape, written out, is not a proof
    const shaped = merge({ ready: { pr: "P", head: "A" }, intent: "i" });
    const r = readyToMerge(proof());

    if (!("ready" in r)) {
      throw new Error("not ready");
    }

    const queued = enqueue({ ready: r.ready, intent: "i" });
    expect([bare, shaped].length).toBe(2);
    expect(queued.ready.head).toBe("A");
  });
});

describe("readyToMerge", () => {
  it("is ready only with a passing row per criterion, at its version, at the head, and green checks there", () => {
    const r = readyToMerge(proof());

    if (!("ready" in r)) {
      throw new Error("not ready");
    }

    expect({ pr: r.ready.pr, head: r.ready.head }).toEqual({ pr: "P", head: "A" });
    expect(r.ready.rows.map((row) => `${row.id}: ${row.criterion} v${row.version}@${row.head}`)).toEqual([
      "v1: c1 v1@A",
      "v2: c2 v2@A",
    ]);
  });

  it("names every reason it is not", () => {
    expect(whys(proof({ rows: [pass(C1)] }))).toEqual(["no_verdict"]);
    expect(whys(proof({ rows: [pass(C1), fail(C2)] }))).toEqual(["not_met"]);
    // A new head voids every row at the old one.
    expect(whys(proof({ rows: [pass(C1), pass(C2, "B")] }))).toEqual(["other_head"]);
    // A reworded criterion voids the row on its old words.
    expect(whys(proof({ rows: [pass(C1), pass(C2, "A", 1)] }))).toEqual(["old_version"]);
    expect(whys(proof({ checks: { head: "A", state: "pending" } }))).toEqual(["checks"]);
    expect(whys(proof({ checks: { head: "B", state: "green" } }))).toEqual(["checks"]);
    expect(whys(proof({ rows: [], checks: { head: "A", state: "red" } }))).toEqual([
      "no_verdict",
      "no_verdict",
      "checks",
    ]);
  });

  it("says which criterion each reason is about, by id", () => {
    const r = readyToMerge(proof({ rows: [pass(C1), pass(C2, "A", 1)] }));
    expect("refused" in r && r.refused).toEqual([{ why: "old_version", id: "c2", version: 1 }]);
  });

  it("takes the latest verdict at the head: a later fail undoes an earlier pass", () => {
    expect(whys(proof({ rows: [pass(C1), pass(C2), fail(C2)] }))).toEqual(["not_met"]);
    expect(whys(proof({ rows: [pass(C1), fail(C2), pass(C2)] }))).toEqual([]);
  });

  it("survives being kept: it is plain data, and a kept one is checked again", () => {
    const r = readyToMerge(proof({ rows: [fail(C1, "B"), pass(C1), pass(C2)] }));

    if (!("ready" in r)) {
      throw new Error("not ready");
    }

    const kept: unknown = JSON.parse(JSON.stringify(r.ready));
    expect(ReadyToMerge.revive(kept)).toEqual(r.ready);
    // What was kept is checked again, not trusted: an edited row is refused.
    const edited = JSON.parse(JSON.stringify(r.ready).replace('"pass"', '"fail"'));
    expect(ReadyToMerge.revive(edited)).toBeNull();
    expect(ReadyToMerge.revive({ pr: "P", head: "A" })).toBeNull();
    // A copy moved to another head no longer proves it: its rows are at the old one.
    expect(Schema.is(Ready)({ ...r.ready, head: "B" })).toBe(false);
    expect(Schema.is(Ready)(r.ready)).toBe(true);
  });

  it("agrees with the rule on every small proof", () => {
    // Every mix of rows for two criteria and every checks read, against the rule in words.
    const rowsFor = (id: typeof C1): readonly (Judged | null)[] => [
      null,
      pass(id),
      pass(id, "B"),
      fail(id),
      pass(id, "A", versionOf(id) + 1),
      ...(versionOf(id) > 1 ? [pass(id, "A", versionOf(id) - 1)] : []),
    ];
    const checks: readonly Checks[] = [
      green,
      { head: "B", state: "green" },
      { head: "A", state: "pending" },
      { head: "A", state: "red" },
    ];
    let tried = 0;
    const wrong: string[] = [];

    for (const one of rowsFor(C1)) {
      for (const two of rowsFor(C2)) {
        for (const c of checks) {
          const rows = [one, two].filter((v): v is Judged => v !== null);
          const p = proof({ rows, checks: c });
          const rule =
            CRITERIA.every((k) =>
              rows.some((v) => v.criterion === k.id && v.version === k.version && v.head === "A" && v.grade === "pass"),
            ) &&
            c.head === "A" &&
            c.state === "green";
          tried++;

          if ("ready" in readyToMerge(p) !== rule) {
            wrong.push(JSON.stringify(p));
          }
        }
      }
    }

    expect({ tried, wrong }).toEqual({ tried: 5 * 6 * 4, wrong: [] });
  });
});

// Self-fix PR 10, Part 4 (docs/direction/a-yes-binds-to-the-diff.md). A proof may name hops: a head
// the rows were judged at, and a later head code found the diff they judged still stands at (a
// `carried` fact, from `carry`). A row counts at the head when it was judged there, or carried there.
// It keeps the head it was judged at, so the proof says what a review saw. The checks never carry.

describe("readyToMerge, with rows carried to the head", () => {
  /** The hop that carries `B` to the head, `A`. */
  const carried = { from: "B", to: "A" };

  it("is ready on rows judged at another head, when that head was carried to this one", () => {
    const r = readyToMerge(proof({ rows: [pass(C1, "B"), pass(C2, "B")], carried: [carried] }));

    if (!("ready" in r)) {
      throw new Error(`not ready: ${JSON.stringify(r.refused)}`);
    }

    expect({ pr: r.ready.pr, head: r.ready.head }).toEqual({ pr: "P", head: "A" });
    // A carried row keeps the head it was judged at.
    expect(r.ready.rows.map((row) => `${row.criterion}@${row.head}`)).toEqual(["c1@B", "c2@B"]);
  });

  it("takes a carry only from the row's head to this one", () => {
    const rows = [pass(C1, "B"), pass(C2, "B")];
    expect(whys(proof({ rows }))).toEqual(["other_head", "other_head"]);
    expect(whys(proof({ rows, carried: [{ from: "B", to: "C" }] }))).toEqual(["other_head", "other_head"]);
    expect(whys(proof({ rows, carried: [{ from: "A", to: "B" }] }))).toEqual(["other_head", "other_head"]);
    expect(whys(proof({ rows, carried: [{ from: "C", to: "A" }] }))).toEqual(["other_head", "other_head"]);
  });

  it("keeps every other reason: a carried fail, a carried old wording, and checks at another head", () => {
    expect(whys(proof({ rows: [pass(C1, "B"), fail(C2, "B")], carried: [carried] }))).toEqual(["not_met"]);
    expect(whys(proof({ rows: [pass(C1, "B"), pass(C2, "B", 1)], carried: [carried] }))).toEqual(["old_version"]);
    expect(
      whys(
        proof({
          rows: [pass(C1, "B"), pass(C2, "B")],
          carried: [carried],
          checks: { head: "B", state: "green" },
        }),
      ),
    ).toEqual(["checks"]);
  });

  it("takes the latest row among those at the head and those carried there", () => {
    // A review at the head itself, after the carried pass, failed it.
    expect(whys(proof({ rows: [pass(C1, "B"), pass(C2, "B"), fail(C2, "A")], carried: [carried] }))).toEqual([
      "not_met",
    ]);
    // A later review at the old head passed what had failed, and it was carried.
    expect(whys(proof({ rows: [pass(C1), fail(C2, "B"), pass(C2, "B")], carried: [carried] }))).toEqual([]);
  });

  it("keeps both hops when rows judged at two heads are each carried to this one", () => {
    // c1 was judged at B, c2 at C, and code carried each head to A: two hops into one head.
    const hops = [carried, { from: "C", to: "A" }];
    const r = readyToMerge(proof({ rows: [pass(C1, "B"), pass(C2, "C")], carried: hops }));

    if (!("ready" in r)) {
      throw new Error(`not ready: ${JSON.stringify(r.refused)}`);
    }

    expect(r.ready.rows.map((row) => `${row.criterion}@${row.head}`)).toEqual(["c1@B", "c2@C"]);
    expect(r.ready.carried).toEqual(hops);
    // The same hop twice goes in once.
    const twice = readyToMerge(proof({ rows: [pass(C1, "B"), pass(C2, "B")], carried: [carried, carried] }));

    if (!("ready" in twice)) {
      throw new Error("not ready");
    }

    expect(twice.ready.carried).toEqual([carried]);
  });

  it("leaves `carried` out of a proof whose rows were all judged at the head", () => {
    const none = readyToMerge(proof());

    if (!("ready" in none)) {
      throw new Error("not ready");
    }

    expect("carried" in none.ready).toBe(false);
    // A hop the rows do not stand on goes in no more than none at all.
    const unused = readyToMerge(proof({ carried: [carried] }));

    if (!("ready" in unused)) {
      throw new Error("not ready");
    }

    expect("carried" in unused.ready).toBe(false);
  });

  it("survives being kept, and a kept one is checked again, its carry too", () => {
    const r = readyToMerge(proof({ rows: [pass(C1, "B"), pass(C2, "B")], carried: [carried] }));

    if (!("ready" in r)) {
      throw new Error("not ready");
    }

    const kept: unknown = JSON.parse(JSON.stringify(r.ready));
    expect(ReadyToMerge.revive(kept)).toEqual(r.ready);
    expect(Schema.is(Ready)(r.ready)).toBe(true);
    // Moved to another head, its rows at B prove nothing there.
    expect(Schema.is(Ready)({ ...r.ready, head: "C" })).toBe(false);
    // A kept carry edited to point elsewhere proves nothing either.
    const elsewhere = JSON.parse(JSON.stringify(r.ready).replaceAll('"to":"A"', '"to":"C"'));
    expect(ReadyToMerge.revive(elsewhere)).toBeNull();
  });

  it("agrees on every small proof: a carried row counts as if it had been judged at the head", () => {
    // Rows for two criteria at A or B, every set of hops among A, B and C that cannot chain into A
    // through C, and two checks reads. The rule: move every row whose head is carried to A onto A,
    // then the rule with no carry.
    const rowsFor = (id: typeof C1): readonly (Judged | null)[] => [
      null,
      pass(id),
      pass(id, "B"),
      fail(id, "B"),
      pass(id, "B", versionOf(id) + 1),
    ];
    const HOPS = [
      { from: "B", to: "A" },
      { from: "A", to: "B" },
      { from: "B", to: "C" },
    ];
    const hopSets = HOPS.reduce<(typeof HOPS)[]>((sets, hop) => [...sets, ...sets.map((s) => [...s, hop])], [[]]);
    const checks: readonly Checks[] = [green, { head: "A", state: "red" }];
    let tried = 0;
    const wrong: string[] = [];

    for (const one of rowsFor(C1)) {
      for (const two of rowsFor(C2)) {
        for (const hops of hopSets) {
          for (const c of checks) {
            const rows = [one, two].filter((v): v is Judged => v !== null);
            const moved = rows.map((v) =>
              hops.some((h) => h.from === v.head && h.to === "A") ? { ...v, head: "A" } : v,
            );
            const rule =
              CRITERIA.every(
                (k) =>
                  moved.findLast((v) => v.criterion === k.id && v.version === k.version && v.head === "A")?.grade ===
                  "pass",
              ) &&
              c.head === "A" &&
              c.state === "green";
            tried++;
            const p = proof({ rows, carried: hops, checks: c });

            if ("ready" in readyToMerge(p) !== rule) {
              wrong.push(JSON.stringify(p));
            }
          }
        }
      }
    }

    expect({ tried, wrong }).toEqual({ tried: 5 * 5 * 8 * 2, wrong: [] });
  });
});
