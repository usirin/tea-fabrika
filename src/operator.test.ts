import { applyCell } from "@demlik/tea";
import { run } from "@demlik/tea/effect";
import { memoryStore } from "@demlik/tea/mem";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { type FakeScript, fakeFabrika } from "./fabrika-scripted.ts";
import { createOperator, defaultKnobs, type Knobs, type Operator, type OperatorMsg, update } from "./operator.ts";
import { fieldRows, operatorInterpret, operatorSubscribe } from "./operator-host.ts";
import { scriptedJev } from "./scripted.ts";
import { makeTree, type OperatorCmd, recordFact } from "./turn.ts";

// The operator, driven end to end on the Effect engine against fabrika in
// memory: scripted shells, a scripted merge queue and pull request, working
// copies kept in a set, a thread a person answers on, and Jev scripted for the
// replies it reads. Its Listens run on the real runners, polling the fake
// every millisecond. No agent, no CLI, no GitHub.

const PR = "https://github.com/example/repo/pull/7";
const OWNER = "owner";
const TREE = "42-r1";
const knobs: Knobs = { ...defaultKnobs, slots: 2, recheckMs: 2, rechecks: 3, queueStallMs: 5_000, msPerMinute: 1_000, who: [OWNER] };
const say = (token: string) => ({ token, pr: PR });

type Fake = ReturnType<typeof fakeFabrika>;
/** The live shell runner's config, never used here. */
const NO_SHELLS = { trees: "", plugin: "", alsoWritable: [], model: "", effort: "medium", maxShellUsd: 0 } as const;

/** Run the operator on a fake until `until` holds, from `first`, with `store` if given. */
function runOn(fake: Fake, first: OperatorMsg, o: { until?: (s: Operator) => boolean; store?: ReturnType<typeof memoryStore<Operator>>; jev?: readonly unknown[] } = {}) {
  const program = Effect.gen(function* () {
    const handle = yield* run(createOperator(2), {
      ctx: undefined,
      interpret: operatorInterpret("jev-test"),
      // The Listens are the real runners; only the shells are scripted.
      subscribe: { ...operatorSubscribe({ pollMs: 1, shell: NO_SHELLS }), shell: fake.shellRunner },
      terminal: o.until ?? ((s) => s.phase === "ended"),
      ...(o.store === undefined ? {} : { store: o.store }),
    });
    const runtime = yield* handle.ready;
    yield* runtime.dispatch(first);
    // A run that never gets there fails the test instead of hanging the suite.
    return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
  });
  const services = Layer.mergeAll(fake.layer, fake.thread, scriptedJev((o.jev ?? []) as never));
  return Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(services)));
}

async function drive(script: FakeScript, options: { knobs?: Knobs; jev?: readonly unknown[] } = {}) {
  const fake = fakeFabrika(script);
  const start: OperatorMsg = { type: "start", run: "r1", lane: script.lane, knobs: options.knobs ?? knobs };
  const end = await runOn(fake, start, options.jev === undefined ? {} : { jev: options.jev });
  if (end.phase !== "ended") throw new Error(`the run did not end: ${end.phase}`);
  return { end, fake, writes: fake.writes.map((w) => w.what) };
}

const shipIt = [
  { shell: "builder", reports: "DONE", says: say("SHIPPED-PR"), opens: PR },
  { shell: "reviewer", reports: "PASS", says: say("PASS") },
  { shell: "shipper", reports: "DONE", says: say("MERGED") },
] as const;

describe("the operator drives a lane to its end with no agent of its own", () => {
  it("takes an issue through a failed review, a repair, a review that waits on CI, and a merge queue that holds it", async () => {
    const { end, fake, writes } = await drive({
      lane: "42",
      shells: [
        { shell: "builder", reports: "DONE", says: say("SHIPPED-PR"), opens: PR },
        { shell: "reviewer", reports: "FAIL", says: say("FAIL") },
        { shell: "builder", reports: "DONE", says: say("SHIPPED-PR") },
        { shell: "reviewer", reports: "PASS", says: say("PASS") },
        { shell: "shipper", reports: "QUEUED", says: say("QUEUED") },
      ],
      // The first review meets a green PR; the second waits through pending checks and an unknown merge.
      prs: [
        { mergeable: "mergeable", checks: "green" },
        { mergeable: "mergeable", checks: "pending" },
        { mergeable: "unknown", checks: "green" },
        { mergeable: "mergeable", checks: "green" },
      ],
      queue: ["waiting", "waiting", "waiting", "landed"],
    });

    expect(end.end).toEqual({ kind: "terminal", status: "done" });
    expect(fake.lane.state).toBe("shipped");
    expect(fake.dispatched).toEqual(["builder", "reviewer", "builder", "reviewer", "shipper"]);
    expect(writes).toEqual([
      "claim",
      "make tree",
      "record started",
      "dispatched builder",
      "dispatched reviewer",
      "dispatched builder",
      "dispatched reviewer",
      "dispatched shipper",
      "record queue",
      "finish",
      "remove tree",
      "release",
    ]);
    expect(fake.asked).toEqual([]);
    expect(end.log.jev).toBe(0);
    expect(end.log.passes).toBe(8);
  });

  it("logs the run for the field notes: the machine's row at zero tokens, and one row per shell", async () => {
    const { end } = await drive({ lane: "42", shells: [...shipIt] });
    const rows = fieldRows(end, { date: "2026-10-10", repo: "example/repo", minutes: 1.234, model: "opus", effort: "medium" });

    expect(rows.map((r) => [r.role, r.outcome, r.tokens, r.tools])).toEqual([
      ["machine", "merged", 0, end.log.cmds],
      ["builder", "pass", 50_000, 2],
      ["reviewer", "pass", 50_000, 2],
      ["shipper", "merged", 50_000, 2],
    ]);
    expect(rows[0]).toMatchObject({ lane: "example/repo#42", minutes: 1.2, jev: 0, costUsd: 1.5 });
    // A shell's `tokens` is its conversation's size at the end, as a subagent reports it; what was billed is beside it.
    expect(rows[1]).toMatchObject({ tokens: 50_000, billed: 150_000, costUsd: 0.5, effort: "medium" });
  });

  it("drives three lanes the same way, run after run", async () => {
    const runs = await Promise.all(["1", "2", "3"].map((lane) => drive({ lane, shells: [...shipIt], queue: ["waiting", "landed"] })));

    expect(runs.map((r) => r.end.end.kind)).toEqual(["terminal", "terminal", "terminal"]);
    expect(new Set(runs.map((r) => r.writes.join(","))).size).toBe(1);
  });
});

describe("the working copy belongs to the machine", () => {
  it("is made when the lane is claimed, every shell runs in it, and it is removed once the lane ships", async () => {
    const { fake, end } = await drive({ lane: "42", shells: [...shipIt] });

    expect(fake.trees.made).toEqual([TREE]);
    expect(fake.folders).toEqual([TREE, TREE, TREE]);
    expect(fake.trees.removed).toEqual([TREE]);
    expect(fake.trees.standing.size).toBe(0);
    expect(end).toMatchObject({ tree: TREE, removed: true });
  });

  it("is removed when the issue is cancelled mid-lane, and no record is posted", async () => {
    const { fake, end, writes } = await drive({
      lane: "42",
      state: "build",
      shells: [{ shell: "builder", reports: "CANCELLED", says: null }],
    });

    expect(end.end).toEqual({ kind: "terminal", status: "cancelled" });
    expect(writes.slice(-2)).toEqual(["remove tree", "release"]);
    expect(writes).not.toContain("finish");
    expect(fake.trees.standing.size).toBe(0);
  });

  it("is removed when the run parks or stops, too", async () => {
    const parked = await drive({ lane: "42", state: "blocked", replies: [{ id: "c", author: OWNER, body: "/leave", at: 2_000 }] });
    const stopped = await drive({ lane: "42", state: "integrate:replay" });

    expect(parked.end.end.kind).toBe("parked");
    expect(stopped.end.end.kind).toBe("stopped");
    expect([parked.fake.trees.standing.size, stopped.fake.trees.standing.size]).toEqual([0, 0]);
    expect(stopped.writes).toEqual(["claim", "make tree", "remove tree", "release"]);
  });

  it("is never made when the claim is lost", async () => {
    const { end, fake, writes } = await drive({ lane: "42", claim: { won: false, why: "held", detail: "seat 2" } });

    expect(end.end).toEqual({ kind: "unclaimed", why: "held", detail: "seat 2" });
    expect(writes).toEqual(["claim"]);
    expect(fake.trees.made).toEqual([]);
  });

  it("is made once and removed once across a restart in the middle of a build", async () => {
    const fake = fakeFabrika({
      lane: "42",
      shells: [{ shell: "builder", reports: null, says: null, ends: "hangs" }, ...shipIt],
    });
    const store = memoryStore<Operator>();
    const building = (s: Operator) => s.phase === "driving" && s.turns.issue?.state.phase === "drafting";

    // The first run is killed while its builder works.
    const killed = await runOn(fake, { type: "start", run: "r1", lane: "42", knobs }, { store, until: building });
    expect(building(killed)).toBe(true);
    expect(fake.trees.standing).toEqual(new Set([TREE]));

    // The second boots from what the first saved, and carries on.
    const end = await runOn(fake, { type: "resume" }, { store });

    expect(end).toMatchObject({ phase: "ended", end: { kind: "terminal", status: "done" } });
    expect(fake.trees.made).toEqual([TREE]);
    expect(fake.trees.removed).toEqual([TREE]);
    expect(fake.trees.standing.size).toBe(0);
    // The killed builder, the one the restart opened in its place, then review and ship: all in the one tree.
    expect(fake.folders).toEqual([TREE, TREE, TREE, TREE]);
  });
});

describe("when a shell does not do what it should", () => {
  it("writes a shell's last word itself when the shell's own report did not land", async () => {
    const { end, writes } = await drive({
      lane: "42",
      state: "build",
      shells: [{ shell: "builder", reports: null, says: say("SHIPPED-PR"), opens: PR }, shipIt[1], shipIt[2]],
    });

    expect(end.end).toEqual({ kind: "terminal", status: "done" });
    expect(writes).toContain("record token");
  });

  it("records a shell that broke, or ended with no word, as dead, and runs the stage again", async () => {
    const { end, fake, writes } = await drive({
      lane: "42",
      state: "build",
      shells: [
        { shell: "builder", reports: null, says: null, ends: "fails" },
        { shell: "builder", reports: null, says: null },
        ...shipIt,
      ],
    });

    expect(end.end.kind).toBe("terminal");
    expect(writes.filter((w) => w === "record shell_dead")).toHaveLength(2);
    expect(fake.dispatched.slice(0, 3)).toEqual(["builder", "builder", "builder"]);
    expect(end.log.shells.map((s) => s.outcome)).toEqual(["failed", "finished", "finished", "finished", "finished"]);
  });

  it("stops a shell that runs past its time, records it dead, and runs the stage again", async () => {
    const { end, writes } = await drive(
      { lane: "42", state: "build", shells: [{ shell: "builder", reports: null, says: null, ends: "hangs" }, ...shipIt] },
      { knobs: { ...knobs, msPerMinute: 1 } },
    );

    expect(end.end.kind).toBe("terminal");
    expect(writes).toContain("record shell_dead");
    expect(end.log.shells[0]).toMatchObject({ outcome: "overtime", why: "ran past 40 minutes" });
  });

  it("sends a pull request that conflicts with its base back to the builder before any reviewer reads it", async () => {
    const { fake, writes } = await drive({
      lane: "42",
      state: "review",
      pr: PR,
      prs: [{ mergeable: "conflicting", checks: "green" }, { mergeable: "mergeable", checks: "green" }],
      shells: [...shipIt],
    });

    expect(writes[2]).toBe("record base_conflicted");
    expect(fake.dispatched).toEqual(["builder", "reviewer", "shipper"]);
  });

  it("stops when fabrika names a different shell than the routing table, instead of running either", async () => {
    const { end, fake } = await drive({ lane: "42", state: "review", shells: [{ shell: "builder", reports: null, says: null }] });

    expect(end.end).toEqual({
      kind: "stopped",
      why: "issue: fabrika briefs `builder` for `review`; the routing table says `reviewer`",
    });
    expect(fake.dispatched).toEqual([]);
  });
});

describe("a park", () => {
  it("is cleared by its recipe, tried again on a clock until the recipe's read holds", async () => {
    const { end, writes, fake } = await drive({
      lane: "42",
      state: "blocked",
      cause: "head-ci-red",
      pr: PR,
      unpark: ["not_yet", "not_yet", "cleared"],
      shells: [...shipIt],
    });

    expect(end.end.kind).toBe("terminal");
    expect(writes.filter((w) => w === "unpark")).toHaveLength(3);
    expect(fake.asked).toEqual([]);
  });

  it("stops when its recipe says cleared and the lane has not moved, instead of going round", async () => {
    const { end, writes } = await drive({ lane: "42", state: "blocked", cause: "spawn-dead", unpark: ["cleared"], stuck: true });

    expect(end.end).toEqual({ kind: "stopped", why: "issue: the recipe's clearance was recorded, and the lane did not move" });
    expect(writes.filter((w) => w === "unpark")).toHaveLength(1);
  });

  it("with no recipe goes to a person, whose `/resume` clears it; a stranger's reply is passed over", async () => {
    const { end, fake, writes } = await drive({
      lane: "42",
      state: "blocked",
      cause: null,
      replies: [
        { id: "c1", author: "someone-else", body: "/leave", at: 2_000 },
        { id: "c2", author: OWNER, body: "/resume", at: 3_000 },
      ],
      shells: [...shipIt],
    });

    expect(end.end.kind).toBe("terminal");
    expect(fake.asked).toHaveLength(1);
    expect(fake.asked[0]?.text).toContain("stopped at `blocked`");
    expect(fake.asked[0]?.text).toContain("`/resume`");
    expect(writes).toContain("clear");
    expect(end.log.jev).toBe(0);
  });

  it("reads a reply in words with a Judge; an unsure reading waits for the next reply", async () => {
    const { end, fake } = await drive(
      {
        lane: "42",
        state: "blocked",
        cause: null,
        replies: [
          { id: "c1", author: OWNER, body: "hmm, not sure yet", at: 2_000 },
          { id: "c2", author: OWNER, body: "I'll take this one myself", at: 3_000 },
        ],
      },
      { jev: [{ answer: ["resume", 0.4] }, { answer: ["leave", 0.93] }] },
    );

    expect(end.end).toEqual({ kind: "parked", why: "issue: a person said to leave it: I'll take this one myself" });
    expect(end.log.jev).toBe(2);
    expect(fake.lane.state).toBe("blocked");
  });

  it("that only a person can clear asks at once, even with a recipe", async () => {
    const { end, fake } = await drive({
      lane: "42",
      state: "human:cp-approval",
      cause: "awaiting-cp-approval",
      unpark: ["not_yet"],
      replies: [{ id: "c1", author: OWNER, body: "/leave", at: 2_000 }],
    });

    expect(end.end.kind).toBe("parked");
    expect(fake.asked[0]?.text).toContain("only a person can make");
  });

  it("from the size stop is recorded, then gated to a person on the next read", async () => {
    const { end, writes, fake } = await drive({
      lane: "42",
      state: "build",
      refuse: { build: "size_stop" },
      replies: [{ id: "c1", author: OWNER, body: "/leave", at: 2_000 }],
    });

    expect(writes).toContain("record park");
    expect(fake.lane).toMatchObject({ state: "blocked", cause: "size-stop" });
    expect(end.end.kind).toBe("parked");
  });
});

describe("the edges of a run", () => {
  it("starts no new shell once its shells have cost more than the run's limit, and leaves the lane where it stands", async () => {
    // Each scripted shell costs $0.50.
    const { end, fake } = await drive({ lane: "42", shells: [...shipIt] }, { knobs: { ...knobs, maxRunUsd: 0.9 } });

    expect(end.end).toEqual({ kind: "stopped", why: "the run's shells have cost $1.00, past its limit of $0.9" });
    expect(fake.dispatched).toEqual(["builder", "reviewer"]);
    expect(fake.lane.state).toBe("ship");
    expect(fake.trees.standing.size).toBe(0);
  });

  it("stops on a state with no route, and says which", async () => {
    const { end } = await drive({ lane: "42", state: "integrate:replay" });
    expect(end.end).toEqual({ kind: "stopped", why: "issue: no route for the state `integrate:replay`" });
  });

  it("stops when the lane cannot be read, without guessing", async () => {
    const { end } = await drive({ lane: "42", unreadable: true });
    expect(end.end).toEqual({ kind: "stopped", why: "the lane could not be read" });
  });
});

describe("a restart, step by step", () => {
  const step = (s: Operator, m: OperatorMsg | { type: string; cmd: object; value?: unknown }) =>
    applyCell<Operator, never, OperatorCmd>({ update: { [m.type]: update } }, s, m as never);
  const start: OperatorMsg = { type: "start", run: "r1", lane: "42", knobs };
  const claimed = () => {
    const [s, cmds] = step({ phase: "idle" }, start);
    return step(s, { type: "lane_claim_ok", cmd: cmds[0] as object, value: { won: true, token: "t" } });
  };

  it("names the tree in the state before the Act that makes it, and sends that same Act again after a restart", () => {
    const [s, cmds] = claimed();

    expect(s).toMatchObject({ phase: "making", tree: TREE });
    expect(cmds).toEqual([makeTree({ name: TREE, intent: "r1/tree" })]);
    const saved = JSON.parse(JSON.stringify(s)) as Operator;
    expect(step(saved, { type: "resume" })[1]).toEqual(cmds);
  });

  it("sends again the write that was in flight, under the same intent, so it is written once", async () => {
    let [s, cmds] = claimed();
    [s, cmds] = step(s, { type: "tree_make_ok", cmd: cmds[0] as object, value: null });
    [s, cmds] = step(s, {
      type: "lane_view_ok",
      cmd: cmds[0] as object,
      value: { lane: "42", issue: "i", status: "active", tasks: [{ task: "issue", state: "queued", cause: null, pr: null, seq: 0 }] },
    });
    const write = cmds[0];
    expect(write?.type).toBe(recordFact.cmdType);

    const saved = JSON.parse(JSON.stringify(s)) as Operator;
    const [again, resent] = step(saved, { type: "resume" });
    expect(again).toMatchObject({ phase: "driving", turns: (s as { turns: unknown }).turns });
    expect(resent).toEqual([write]);

    // The fake answers a second send of the same intent as the first, and writes once.
    const fake = fakeFabrika({ lane: "42" });
    const record = (cmd: OperatorCmd) =>
      Effect.runPromise(operatorInterpret("j").lane_record(cmd as never).pipe(Effect.provide(fake.layer)));
    expect(await record(write as OperatorCmd)).toBe(true);
    expect(await record(resent[0] as OperatorCmd)).toBe(true);
    expect(fake.writes.map((w) => w.what)).toEqual(["record started"]);
    expect(fake.lane.state).toBe("build");
  });
});
