import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { shipInterpret } from "./handlers.ts";
import { scriptedRepo } from "./scripted.ts";
import { type Ship, type ShipInput, type ShipMsg, ship } from "./ship.ts";

// Ship on its own: a change that passed review goes in, landed or parked comes out.

const input: ShipInput = {
  issue: "7",
  title: "slugify makes slugs",
  record: ["1 attempt(s), 1 build(s)"],
  missing: { kind: "checked", asked: 2, flagged: [] },
};
type RepoScript = Parameters<typeof scriptedRepo>[0];

async function step(from: Ship, msg: ShipMsg, script: RepoScript = {}) {
  const repo = scriptedRepo(script);
  const result = await Effect.runPromise(drive(ship, from, msg, shipInterpret).pipe(Effect.provide(repo.layer)));
  const cmds = result.trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : []));
  return { ...result, cmds, seals: repo.seals };
}
const approve = (head: string): ShipMsg => ({ type: "answer", answer: { park: "approve", answer: { kind: "approve", head } } });

describe("ship", () => {
  it("seals the change and waits for a person before anything lands", async () => {
    const { state, cmds, seals } = await step({ phase: "idle" }, { type: "start", input });

    expect(cmds).toEqual(["seal"]);
    expect(seals).toEqual(["slugify makes slugs\n\nCloses 7"]);
    expect(state).toMatchObject({ phase: "parked", why: { kind: "approve", head: "sealed-1", stat: expect.any(String) } });
  });

  it("lands the approved commit, and ignores an approval for any other", async () => {
    const { state: waiting } = await step({ phase: "idle" }, { type: "start", input });
    const wrong = await step(waiting, approve("sealed-0"));
    const right = await step(waiting, approve("sealed-1"));

    expect(wrong.state).toEqual(waiting);
    expect(right.state).toEqual({ phase: "landed", input, sha: "sealed-1" });
  });

  it("merges with a base that moved, runs the merge on a fresh copy, and lands it", async () => {
    const { state: waiting } = await step({ phase: "idle" }, { type: "start", input });
    const { state, cmds } = await step(waiting, approve("sealed-1"), { lands: ["behind", "landed"] });

    expect(cmds).toEqual(["land", "catch_up", "retest", "land"]);
    expect(state).toEqual({ phase: "landed", input, sha: "merge-of-sealed-1" });
  });

  it("parks on a conflict with the moved base, and tries again on retry", async () => {
    const { state: waiting } = await step({ phase: "idle" }, { type: "start", input });
    const { state: conflicted } = await step(waiting, approve("sealed-1"), { lands: ["behind"], merges: [["slugify.js"]] });
    const retried = await step(conflicted, { type: "answer", answer: { park: "conflicted", answer: { kind: "retry" } } });

    expect(conflicted).toMatchObject({ phase: "parked", why: { kind: "conflicted", approved: "sealed-1", files: ["slugify.js"] } });
    // The retry lands the change that was approved, not an earlier merge.
    expect(retried.cmds).toEqual(["land"]);
    expect(retried.state).toMatchObject({ phase: "landed", sha: "sealed-1" });
  });

  it("parks when the change merges clean but its tests fail with the new base", async () => {
    const { state: waiting } = await step({ phase: "idle" }, { type: "start", input });
    const { state } = await step(waiting, approve("sealed-1"), { lands: ["behind"], retests: [false] });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "fails_on_new_base", approved: "sealed-1", output: "retest output" } });
  });

  it("parks when the repo fails, and asks again on retry", async () => {
    const { state: waiting } = await step({ phase: "idle" }, { type: "start", input });
    const { state: failed } = await step(waiting, approve("sealed-1"), { lands: ["fail"] });
    const retried = await step(failed, { type: "answer", answer: { park: "repo_failed", answer: { kind: "retry" } } });

    expect(failed).toMatchObject({ phase: "parked", why: { kind: "repo_failed", from: { phase: "landing" } } });
    expect(retried.state).toMatchObject({ phase: "landed" });
  });

  it("killed after any step, ends the same and asks again only for what was in flight", async () => {
    const { state: waiting } = await step({ phase: "idle" }, { type: "start", input });
    const script: RepoScript = { lands: ["behind", "landed"] };
    const whole = await step(waiting, approve("sealed-1"), script);
    const msgs = whole.trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));

    for (let at = 1; at < msgs.length; at++) {
      const saved = JSON.parse(JSON.stringify(replay(ship, { msgs: msgs.slice(0, at), ctx: undefined, loaded: waiting }).state)) as Ship;
      // What already answered is used up; the rest of the script is what the repo says next.
      const landed = msgs.slice(0, at).filter((m) => m.type === "land_ok").length;
      const again = await step(saved, { type: "resume" }, { lands: (script.lands ?? []).slice(landed) });

      expect(again.state, `killed after ${msgs[at - 1]?.type}`).toEqual(whole.state);
    }
  });
});
