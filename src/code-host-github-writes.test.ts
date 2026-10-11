import { readFileSync } from "node:fs";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { checksSettledNow, codeHostOn, type Gh, leftQueueNow } from "./code-host-github.ts";
import { codeHostWritesOn, ENQUEUE_READ, ENQUEUE_WRITE, enqueueOn, rerunChecksOn } from "./code-host-github-writes.ts";
import { Worktrees } from "./fabrika.ts";
import { CodeHost, CodeHostWrites } from "./services.ts";
import { alone, modeLine, type Parts, planOf } from "./stages/ship/alone.ts";
import { shipSubscribe, shipTidyTree, shipWriteInterpret } from "./stages/ship/handlers.ts";
import { type ChecksSub, createShip, finish, type QueueSub } from "./stages/ship/machine.ts";

// The write side of `CodeHost` on GitHub, and the two waits, against a
// scripted `gh`. Nothing here reaches a real repository: every call is
// answered from the test, and every argument list a write is made of is
// checked whole, because a wrong flag on a write is where the damage is.

const PR = "https://github.com/example/repo/pull/7";
const AT = ["-f", "owner=example", "-f", "name=repo", "-F", "number=7"];
const HEAD = "9eb6b52c75d64b555547780717bd43a2460bb658";
const OTHER = "0000000000000000000000000000000000000000";
/** The commit the merge queue makes on the base branch. Never the head. */
const MERGE = "d694f6b710c8688176ae7ec31983eaaddb79973a";
const unknown = { _tag: "unknown" };

type Answer = string | "breaks";
/** A `gh` that answers each call from `answer`, and keeps every call. */
function scripted(answer: (args: readonly string[], nth: number) => Answer) {
  const calls: (readonly string[])[] = [];
  const gh: Gh = (args) => {
    calls.push(args);
    const out = answer(args, calls.length);
    return out === "breaks" ? Effect.fail({ _tag: "unknown" as const }) : Effect.succeed(out);
  };
  return { gh, calls };
}
/** A `gh` that answers the calls in order. One call too many fails the test. */
function inOrder(...answers: Answer[]) {
  return scripted((_args, nth) => {
    const out = answers[nth - 1];
    if (out === undefined) throw new Error(`call ${nth} came, and the script has ${answers.length}`);
    return out;
  });
}
/** A call that changes something: a GraphQL mutation, or a REST call that is not a read. */
const isWrite = (args: readonly string[]) => args.includes("--method") || args.includes("-X") || args.some((arg) => /^query=\s*mutation/.test(arg));
const queryOf = (args: readonly string[]) => args.find((arg) => arg.startsWith("query=")) ?? "";

// ---------------------------------------------------------------- enqueue

const stands = (pr: Partial<Record<"state" | "headRefOid" | "mergeable", string> & { isInMergeQueue: boolean; isMergeQueueEnabled: boolean }> = {}) =>
  JSON.stringify({
    data: { repository: { pullRequest: { id: "PR_abc", state: "OPEN", headRefOid: HEAD, mergeable: "MERGEABLE", isInMergeQueue: false, isMergeQueueEnabled: true, ...pr } } },
  });
const ENQUEUED = JSON.stringify({ data: { enqueuePullRequest: { mergeQueueEntry: { id: "MQE_1" } } } });
const READ_CALL = ["api", "graphql", ...AT, "-f", `query=${ENQUEUE_READ}`];
const WRITE_CALL = ["api", "graphql", "-f", "pull=PR_abc", "-f", `head=${HEAD}`, "-f", `query=${ENQUEUE_WRITE}`];
const enqueued = (gh: Gh, pr = PR) => Effect.runPromise(enqueueOn(gh)(pr, HEAD));
const refused = (gh: Gh, pr = PR) => Effect.runPromise(Effect.flip(enqueueOn(gh)(pr, HEAD)));

describe("enqueue", () => {
  it("reads where the pull request stands, then puts this head in the queue: two calls, exactly these", async () => {
    const { gh, calls } = inOrder(stands(), ENQUEUED);

    expect(await enqueued(gh)).toBe("queued");
    expect(calls).toEqual([READ_CALL, WRITE_CALL]);
  });

  it("the one write names the head GitHub must find, and is nothing but an enqueue", () => {
    expect(ENQUEUE_WRITE).toMatch(/enqueuePullRequest\(input: \{ pullRequestId: \$pull, expectedHeadOid: \$head \}\)/);
    // Never "merge when ready", a direct merge, a merge method, a jump of the queue, a deleted branch or a bypass.
    expect(ENQUEUE_WRITE).not.toMatch(/AutoMerge|mergePullRequest|mergeMethod|jump|deleteRef|bypass|admin/i);
    expect(ENQUEUE_WRITE.match(/\w+\(input:/g)).toEqual(["enqueuePullRequest(input:"]);
    expect(ENQUEUE_READ).not.toMatch(/mutation/);
  });

  it("a head that moved, seen in the read: head moved, and nothing is written", async () => {
    const { gh, calls } = inOrder(stands({ headRefOid: OTHER }));

    expect(await enqueued(gh)).toBe("head_moved");
    expect(calls).toEqual([READ_CALL]);
  });

  it("a head that moves after the read: GitHub refuses the write by its match on the head, and the answer is head moved", async () => {
    // The read sees this head. A push lands. The write carries this head, so GitHub refuses it.
    const { gh, calls } = inOrder(stands(), "breaks", stands({ headRefOid: OTHER }));

    expect(await enqueued(gh)).toBe("head_moved");
    // Why it was refused is read again, not guessed. The write itself went out once, with the old head on it.
    expect(calls).toEqual([READ_CALL, WRITE_CALL, READ_CALL]);
  });

  it("conflicts with the base: conflicts, and nothing is written", async () => {
    const { gh, calls } = inOrder(stands({ mergeable: "CONFLICTING" }));

    expect(await enqueued(gh)).toBe("conflicts");
    expect(calls).toEqual([READ_CALL]);
  });

  it("a write refused for a conflict that came after the read: conflicts", async () => {
    const { gh, calls } = inOrder(stands(), "breaks", stands({ mergeable: "CONFLICTING" }));

    expect(await enqueued(gh)).toBe("conflicts");
    expect(calls.filter(isWrite)).toEqual([WRITE_CALL]);
  });

  it("sent a second time, it finds its own first write and writes nothing", async () => {
    const inQueue = inOrder(stands({ isInMergeQueue: true }));
    const merged = inOrder(stands({ state: "MERGED", headRefOid: OTHER }));

    expect(await enqueued(inQueue.gh)).toBe("queued");
    expect(await enqueued(merged.gh)).toBe("queued");
    expect([inQueue.calls, merged.calls]).toEqual([[READ_CALL], [READ_CALL]]);
  });

  it("a write that went through though its answer was lost: the second read finds it in the queue", async () => {
    const { gh, calls } = inOrder(stands(), "breaks", stands({ isInMergeQueue: true }));

    expect(await enqueued(gh)).toBe("queued");
    expect(calls.filter(isWrite)).toHaveLength(1);
  });

  it("a repo with no merge queue: it fails and writes nothing. It never merges a pull request itself", async () => {
    const { gh, calls } = inOrder(stands({ isMergeQueueEnabled: false }));

    expect(await refused(gh)).toEqual(unknown);
    expect(calls).toEqual([READ_CALL]);
  });

  it("a closed pull request: it fails and writes nothing", async () => {
    const { gh, calls } = inOrder(stands({ state: "CLOSED" }));

    expect(await refused(gh)).toEqual(unknown);
    expect(calls).toEqual([READ_CALL]);
  });

  it("gh failing is the Cmd's err: on the read, on the write with no reason found, on an answer that does not fit", async () => {
    expect(await refused(inOrder("breaks").gh)).toEqual(unknown);
    expect(await refused(inOrder("gh: not logged in").gh)).toEqual(unknown);
    expect(await refused(inOrder(stands(), "breaks", stands()).gh)).toEqual(unknown);
    expect(await refused(inOrder(stands(), "breaks", "breaks").gh)).toEqual(unknown);
    // A write that answers with no queue entry did not queue it.
    expect(await refused(inOrder(stands(), '{"data":{"enqueuePullRequest":null}}', stands()).gh)).toEqual(unknown);
  });

  it("a URL that is not a pull request's is refused before any call", async () => {
    const { gh, calls } = inOrder();

    expect(await refused(gh, "https://github.com/example/repo/issues/7")).toEqual(unknown);
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------- re-run

const run = (id: number, conclusion: string | null, more: { status?: string; head_sha?: string; run_attempt?: number } = {}) => ({
  id,
  head_sha: HEAD,
  status: conclusion === null ? "in_progress" : "completed",
  conclusion,
  run_attempt: 1,
  ...more,
});
const runs = (list: ReturnType<typeof run>[], total = list.length) => JSON.stringify({ total_count: total, workflow_runs: list });
const RUNS_CALL = ["api", `repos/example/repo/actions/runs?head_sha=${HEAD}&per_page=100`];
const rerunCall = (id: number) => ["api", "--method", "POST", `repos/example/repo/actions/runs/${id}/rerun-failed-jobs`];
const reran = (gh: Gh) => Effect.runPromise(rerunChecksOn(gh)(PR, HEAD));
const notReran = (gh: Gh) => Effect.runPromise(Effect.flip(rerunChecksOn(gh)(PR, HEAD)));

describe("re-run of red checks", () => {
  it("asks for the failed jobs of this head's red runs, and only those", async () => {
    const { gh, calls } = inOrder(
      runs([
        run(10, "success"),
        run(11, "failure"),
        run(12, "timed_out", { run_attempt: 2 }),
        run(13, null),
        run(14, "cancelled"),
        run(15, "skipped"),
        // GitHub matches the commit as written, and this guards it all the same.
        run(16, "failure", { head_sha: OTHER }),
      ]),
      "{}",
      "{}",
    );

    // Each run it started again, with the try it was on: what the wait after it goes by.
    expect(await reran(gh)).toEqual([
      { run: 11, attempt: 1 },
      { run: 12, attempt: 2 },
    ]);
    expect(calls).toEqual([RUNS_CALL, rerunCall(11), rerunCall(12)]);
  });

  it("the write is the failed-jobs re-run, never the whole run, a cancel or a dispatch", async () => {
    const { gh, calls } = inOrder(runs([run(11, "failure")]), "{}");
    await reran(gh);

    const writes = calls.filter(isWrite);
    expect(writes).toEqual([rerunCall(11)]);
    expect(writes.flat().join(" ")).not.toMatch(/\/rerun$|\/rerun |cancel|dispatches|force/);
  });

  it("no red run of this head: it fails and writes nothing", async () => {
    const { gh, calls } = inOrder(runs([run(10, "success"), run(13, null)]));

    expect(await notReran(gh)).toEqual(unknown);
    expect(calls).toEqual([RUNS_CALL]);
  });

  it("more runs than one call holds: it fails and writes nothing", async () => {
    const { gh, calls } = inOrder(runs([run(11, "failure")], 101));

    expect(await notReran(gh)).toEqual(unknown);
    expect(calls.filter(isWrite)).toEqual([]);
  });

  it("gh failing is the Cmd's err: on the list, and on a re-run", async () => {
    expect(await notReran(inOrder("breaks").gh)).toEqual(unknown);
    expect(await notReran(inOrder("not json").gh)).toEqual(unknown);
    expect(await notReran(inOrder(runs([run(11, "failure")]), "breaks").gh)).toEqual(unknown);
  });
});

// ---------------------------------------------------------------- the queue's wait

const queueNow = (pr: { state?: string; isInMergeQueue?: boolean; mergeCommit?: { oid: string } | null }) =>
  JSON.stringify({ data: { repository: { pullRequest: { state: "OPEN", isInMergeQueue: true, mergeCommit: null, ...pr } } } });
const leftNow = (answer: Answer) => Effect.runPromise(leftQueueNow(inOrder(answer).gh, PR));

describe("how a pull request left the merge queue", () => {
  it("merged: landed, with the commit on the base branch, which is not the head", async () => {
    expect(await leftNow(queueNow({ state: "MERGED", isInMergeQueue: false, mergeCommit: { oid: MERGE } }))).toEqual({ reading: "landed", commit: MERGE });
    expect(MERGE).not.toBe(HEAD);
  });

  it("open and out of the queue, or closed: ejected", async () => {
    expect(await leftNow(queueNow({ isInMergeQueue: false }))).toEqual({ reading: "ejected" });
    expect(await leftNow(queueNow({ state: "CLOSED", isInMergeQueue: false }))).toEqual({ reading: "ejected" });
  });

  it("still in the queue, merged with no commit named yet, or a read that failed: no answer yet", async () => {
    expect(await leftNow(queueNow({}))).toBeNull();
    expect(await leftNow(queueNow({ state: "MERGED", isInMergeQueue: false }))).toBeNull();
    expect(await leftNow("breaks")).toBeNull();
    expect(await leftNow("not json")).toBeNull();
  });

  it("asks again until it has an answer, says it once, and only ever reads", async () => {
    const answers = [queueNow({}), "breaks" as const, queueNow({}), queueNow({ state: "MERGED", isInMergeQueue: false, mergeCommit: { oid: MERGE } })];
    const { gh, calls } = scripted((_args, nth) => answers[Math.min(nth, answers.length) - 1] as Answer);
    const host = codeHostOn(gh, { own: [], reviewers: [], pollMs: 1 });

    expect(await Effect.runPromise(Stream.runCollect(host.leftQueue(PR, HEAD)))).toEqual([{ reading: "landed", commit: MERGE }]);
    expect(calls).toHaveLength(4);
    expect(calls.filter(isWrite)).toEqual([]);
    expect(calls[0]?.slice(0, 8)).toEqual(["api", "graphql", ...AT]);
  });
});

// ---------------------------------------------------------------- the checks' wait

const checksNow = (state: string | null, head = HEAD) =>
  JSON.stringify({ data: { repository: { pullRequest: { headRefOid: head, commits: { nodes: [{ commit: { oid: head, statusCheckRollup: state === null ? null : { state } } }] } } } } });
const runNow = (run_attempt: number, status: string) => JSON.stringify({ status, run_attempt });
const settledNow = (after: readonly { run: number; attempt: number }[], ...answers: Answer[]) => {
  const { gh, calls } = inOrder(...answers);
  return Effect.runPromise(checksSettledNow(gh, PR, HEAD, after)).then((settled) => ({ settled, calls }));
};

describe("when the checks of a head have settled", () => {
  it("green, or red: settled. It does not say which", async () => {
    expect((await settledNow([], checksNow("SUCCESS"))).settled).toBe(true);
    expect((await settledNow([], checksNow("FAILURE"))).settled).toBe(true);
    expect((await settledNow([], checksNow("ERROR"))).settled).toBe(true);
  });

  it("still running, still expected, none reported, or a read that failed: not yet", async () => {
    expect((await settledNow([], checksNow("PENDING"))).settled).toBe(false);
    expect((await settledNow([], checksNow("EXPECTED"))).settled).toBe(false);
    expect((await settledNow([], checksNow(null))).settled).toBe(false);
    expect((await settledNow([], "breaks")).settled).toBe(false);
  });

  it("a head that is no longer this one: settled, so the machine reads fresh and finds the new head", async () => {
    expect((await settledNow([], checksNow("PENDING", OTHER))).settled).toBe(true);
  });

  it("after a re-run, the old red run is not taken for the answer: the run must have finished a later try", async () => {
    const after = [{ run: 11, attempt: 1 }];
    // The re-run was asked a moment ago. GitHub still shows the first try, finished and red.
    const stale = await settledNow(after, checksNow("FAILURE"), runNow(1, "completed"));
    // The second try has started.
    const going = await settledNow(after, checksNow("FAILURE"), runNow(2, "in_progress"));
    // The second try has finished, green or red.
    const done = await settledNow(after, checksNow("SUCCESS"), runNow(2, "completed"));
    const redAgain = await settledNow(after, checksNow("FAILURE"), runNow(2, "completed"));

    expect([stale.settled, going.settled, done.settled, redAgain.settled]).toEqual([false, false, true, true]);
    expect(stale.calls[1]).toEqual(["api", "repos/example/repo/actions/runs/11"]);
    expect(stale.calls.filter(isWrite)).toEqual([]);
  });

  it("with two runs started again, both must have finished their later try", async () => {
    const after = [
      { run: 11, attempt: 1 },
      { run: 12, attempt: 2 },
    ];

    expect((await settledNow(after, checksNow("FAILURE"), runNow(2, "completed"), runNow(2, "completed"))).settled).toBe(false);
    expect((await settledNow(after, checksNow("SUCCESS"), runNow(2, "completed"), runNow(3, "completed"))).settled).toBe(true);
  });

  it("a run that cannot be read after a re-run: not yet", async () => {
    expect((await settledNow([{ run: 11, attempt: 1 }], checksNow("SUCCESS"), "breaks")).settled).toBe(false);
  });

  it("asks again until they settle, says so once, and only ever reads", async () => {
    const answers = [checksNow("PENDING"), checksNow("PENDING"), checksNow("SUCCESS")];
    const { gh, calls } = scripted((_args, nth) => answers[Math.min(nth, answers.length) - 1] as Answer);
    const host = codeHostOn(gh, { own: [], reviewers: [], pollMs: 1 });

    expect(await Effect.runPromise(Stream.runCollect(host.checksSettled(PR, HEAD, [])))).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(calls.filter(isWrite)).toEqual([]);
  });
});

// ---------------------------------------------------------------- the handlers and the Listens

describe("the handlers and the Listens", () => {
  it("the Listens hand on what the service says, as the machine's Msg for that pull request and head", async () => {
    const host = Layer.succeed(CodeHost, {
      prFacts: () => Effect.fail({ _tag: "unknown" as const }),
      checksSettled: () => Stream.make(undefined),
      leftQueue: () => Stream.make({ reading: "landed" as const, commit: MERGE }),
    });
    const deps = { pr: PR, head: HEAD };
    const collect = <A>(stream: Stream.Stream<A, never, CodeHost>) => Effect.runPromise(Stream.runCollect(stream).pipe(Effect.provide(host)));

    // A Sub as the engine hands it to a runner. Its id is the engine's own, and no runner reads it.
    const opened = <S>(sub: Omit<S, "id">) => ({ ...sub, id: "sub-1" }) as S;

    expect(await collect(shipSubscribe.ship_checks(opened<ChecksSub>({ type: "ship_checks", deps: { ...deps, after: [] } })))).toEqual([{ type: "ship_checks", ...deps }]);
    expect(await collect(shipSubscribe.ship_queue(opened<QueueSub>({ type: "ship_queue", deps })))).toEqual([{ type: "ship_queue", ...deps, reading: "landed", commit: MERGE }]);
  });

  it("the tidy-up of a run alone does nothing, and needs no service", async () => {
    const cmd = finish({ pr: PR, intent: "ship/finish" });

    expect(await Effect.runPromise(shipWriteInterpret().ship_finish(cmd))).toBeNull();
  });

  it("the tidy-up of a run that was given a working copy removes that one, through Worktrees", async () => {
    const removed: unknown[] = [];
    const trees = Layer.succeed(Worktrees, { make: () => Effect.void, remove: (request) => Effect.sync(() => void removed.push(request)) });
    const cmd = finish({ pr: PR, intent: "ship/finish" });

    expect(await Effect.runPromise(shipTidyTree("42-r1").ship_finish(cmd).pipe(Effect.provide(trees)))).toBeNull();
    expect(removed).toEqual([{ name: "42-r1", intent: "ship/finish" }]);
  });
});

// ---------------------------------------------------------------- the machine alone, in its two modes

const recorded = (name: string): string => readFileSync(new URL(`../fixtures/code-host/${name}.json`, import.meta.url), "utf8");
const WHO = { own: ["repo-owner", "second-owner"], reviewers: ["repo-owner", "second-owner"] };
const plan = (write: boolean) => ({ pr: PR, ...WHO, write });

/**
 * GitHub, scripted for one whole run on the recorded clean pull request: its
 * facts, where it stands, the enqueue, and a queue that holds it for two
 * reads and then merges it. `change`: another answer for some call.
 */
function github(change: (args: readonly string[], nth: number) => Answer | null = () => null) {
  let queueReads = 0;
  return scripted((args, nth) => {
    const other = change(args, nth);
    if (other !== null) return other;
    const query = queryOf(args);
    if (query.includes("enqueuePullRequest")) return ENQUEUED;
    if (query.includes("isMergeQueueEnabled")) return stands();
    if (query.includes("baseRefName")) return JSON.stringify({ data: { repository: { pullRequest: { headRefOid: HEAD, baseRefName: "main" } } } });
    if (query.includes("codeowners:")) return recorded("open-clean");
    if (query.includes("mergeCommit")) return (queueReads += 1) < 3 ? queueNow({}) : queueNow({ state: "MERGED", isInMergeQueue: false, mergeCommit: { oid: MERGE } });
    throw new Error(`a call the script does not know: ${args.join(" ").slice(0, 120)}`);
  });
}
const partsOn = (gh: Gh, made: string[] = []): Parts => ({
  reads: () => (made.push("reads"), Layer.succeed(CodeHost, codeHostOn(gh, { ...WHO, pollMs: 1 }))),
  writes: () => (made.push("writes"), Layer.succeed(CodeHostWrites, codeHostWritesOn(gh))),
});

describe("the machine alone on a pull request", () => {
  it("writing is off unless it is asked for by name", () => {
    expect(planOf([PR, "--own", "repo-owner"])).toEqual({ pr: PR, own: ["repo-owner"], reviewers: ["repo-owner"], write: false });
    expect(planOf([PR, "--own", "a,b", "--reviewers", "c"])).toEqual({ pr: PR, own: ["a", "b"], reviewers: ["c"], write: false });
    expect(planOf([PR, "--own", "a", "--write"])?.write).toBe(true);
    expect(planOf(["--write", PR, "--own", "a"])).toBeNull();
    expect(planOf([PR, "--own", "--write"])).toBeNull();
    expect(planOf([PR])).toBeNull();
    expect(planOf(["https://github.com/example/repo/issues/7", "--own", "a"])).toBeNull();
  });

  it("says which mode it is in, in one line", () => {
    expect(modeLine(plan(false))).toBe(`mode: read only. Nothing on ${PR} will be changed.`);
    expect(modeLine(plan(true))).toMatch(/^mode: WRITE\. This run may put .* in the merge queue/);
  });

  it("read mode: the write side is never made, no write goes out, and it says what it would send", async () => {
    const made: string[] = [];
    const { gh, calls } = github();
    const ran = await Effect.runPromise(alone(plan(false), partsOn(gh, made)));

    expect(made).toEqual(["reads"]);
    expect(calls.filter(isWrite)).toEqual([]);
    expect(ran).toMatchObject({ mode: "read", found: { outcome: null, wouldSend: { type: "ship_enqueue", pr: PR, head: HEAD } } });
  });

  it("read mode cannot write even when its write side would throw on being made", async () => {
    const parts: Parts = { ...partsOn(github().gh), writes: () => Effect.runSync(Effect.die("the write side was made")) };

    expect((await Effect.runPromise(alone(plan(false), parts))).mode).toBe("read");
  });

  it("write mode: the machine runs to its end, and the one write is the enqueue of the head it read", async () => {
    const made: string[] = [];
    const { gh, calls } = github();
    const ran = await Effect.runPromise(alone(plan(true), partsOn(gh, made)));

    // Landed, with the commit the queue made on the base branch.
    expect(ran).toEqual({ mode: "write", pr: PR, outcome: { kind: "done", part: false, commit: MERGE, cleanup: "done" }, name: "done" });
    expect(made).toEqual(["reads", "writes"]);
    expect(calls.filter(isWrite)).toEqual([WRITE_CALL]);
    // The queue was read until it answered: twice still in it, then merged.
    expect(calls.filter((args) => queryOf(args).includes("mergeCommit"))).toHaveLength(3);
  });

  it("write mode, gh failing on the enqueue: the machine ends as cannot tell, and nothing was written", async () => {
    const { gh, calls } = github((args) => (queryOf(args).includes("isMergeQueueEnabled") ? "breaks" : null));
    const ran = await Effect.runPromise(alone(plan(true), partsOn(gh)));

    expect(ran).toMatchObject({ outcome: { kind: "stuck", why: "enqueue_failed" } });
    expect(calls.filter(isWrite)).toEqual([]);
  });

  it("write mode, red checks: the failed jobs are run again once, the old red run is waited out, and then it lands", async () => {
    let factReads = 0;
    let runReads = 0;
    const redFacts = recorded("open-clean").replace('"state": "SUCCESS"', '"state": "FAILURE"');
    const { gh, calls } = github((args) => {
      const query = queryOf(args);
      const path = args[args.length - 1] ?? "";
      // Red on the first read of the facts, green after the re-run.
      if (query.includes("codeowners:")) return (factReads += 1) === 1 ? redFacts : null;
      if (path.includes("/actions/runs?head_sha=")) return runs([run(10, "success"), run(11, "failure")]);
      if (path.endsWith("/rerun-failed-jobs")) return "{}";
      // The wait: the old red try twice, the second try running, then finished.
      if (query.includes("statusCheckRollup") && !query.includes("codeowners:")) return checksNow(runReads < 3 ? "FAILURE" : "SUCCESS");
      if (path.endsWith("/actions/runs/11")) return [runNow(1, "completed"), runNow(1, "completed"), runNow(2, "in_progress"), runNow(2, "completed")][Math.min((runReads += 1), 4) - 1] as string;
      return null;
    });
    const ran = await Effect.runPromise(alone(plan(true), partsOn(gh), createShip({ waits: { checksMs: 3_000, queueMs: 3_000 } })));

    expect(ran).toMatchObject({ outcome: { kind: "done", part: false, commit: MERGE, cleanup: "done" } });
    // Two writes in all, in this order: the re-run of the one red run, then the enqueue.
    expect(calls.filter(isWrite)).toEqual([rerunCall(11), WRITE_CALL]);
    // It did not go on while GitHub still showed the first try: the run was read until its second try had finished.
    expect(runReads).toBe(4);
    expect(factReads).toBe(2);
  });

  it("write mode, the re-run cannot be asked for: back to the builder for red checks, and no enqueue", async () => {
    const redFacts = recorded("open-clean").replace('"state": "SUCCESS"', '"state": "FAILURE"');
    const { gh, calls } = github((args) => (queryOf(args).includes("codeowners:") ? redFacts : (args[args.length - 1] ?? "").includes("/actions/runs?head_sha=") ? "breaks" : null));
    const ran = await Effect.runPromise(alone(plan(true), partsOn(gh)));

    expect(ran).toMatchObject({ outcome: { kind: "send", to: "builder", why: "checks_red" } });
    expect(calls.filter(isWrite)).toEqual([]);
  });
});
