import { describe, expect, it } from "vitest";
import type { TaskView } from "./fabrika.ts";
import {
  clearTask,
  defaultKnobs,
  type OperatorCmd,
  type Pass,
  parkAsk,
  readLane,
  recheckOf,
  type Settle,
  startTurn,
  stepTurn,
  type Turn,
  type TurnMsg,
  timerOf,
  turnInFlight,
  unparkTask,
} from "./turn.ts";

// One turn at a park, stepped by hand. An open question has two things in
// flight at most: a reply being read, and a try of the park's recipe. These
// are the orders they can settle in. The operator's tests run the same turn
// end to end on the fake; here every Msg is placed.

const PR = "https://github.com/example/repo/pull/7";
const ISSUE = "https://github.com/example/repo/issues/42";
const knobs = { ...defaultKnobs, who: ["owner"] };
const pass: Pass = { run: "r1", lane: "42", pass: 3, issue: ISSUE, tree: "42-r1", knobs };
const approval: TaskView = { task: "issue", state: "human:cp-approval", cause: "awaiting-cp-approval", pr: PR, seq: 4 };

type Asking = Extract<Turn, { phase: "asking" }>;
const ok = (cmd: OperatorCmd | undefined, value: unknown): Settle => ({ type: `${cmd?.type}_ok`, cmd: cmd as never, value });
const err = (cmd: OperatorCmd | undefined): Settle => ({ type: `${cmd?.type}_err`, cmd: cmd as never, error: { _tag: "unknown" } });
const step = (t: Turn, m: TurnMsg | Settle) => stepTurn(t, m, pass);
const reply = (body: string, at = 2_000): TurnMsg => ({ type: "park_reply", key: "issue", reply: { id: `${at}`, author: "owner", body, at } });
const clock = (tries: number, seq = 4): TurnMsg => ({ type: "ask_recheck", key: "issue", seq, tries });
const overdue: TurnMsg = { type: "ask_overdue", key: "issue", seq: 4 };

/** A park's question, posted and waiting. `text`: the words that went on the issue. */
function open(task: TaskView, first: "not_yet" | "novel" = "not_yet"): { readonly turn: Asking; readonly text: string } {
  let [t, cmds] = startTurn(task, pass);
  if (t.phase === "unparking") [t, cmds] = step(t, ok(cmds[0], first));
  const post = cmds[0] as ReturnType<typeof parkAsk.post>;
  [t] = step(t, ok(post, { thread: `${ISSUE}#question`, at: 1_000 }));
  if (t.phase !== "asking" || t.ask.phase !== "waiting") throw new Error(`the question is not open: ${t.phase}`);
  return { turn: t, text: post.text };
}

/** The same question with a try of the recipe in flight. */
function trying(): { readonly turn: Asking; readonly asked: OperatorCmd } {
  const [t, cmds] = step(open(approval).turn, clock(1));
  return { turn: t as Asking, asked: cmds[0] as OperatorCmd };
}

describe("what the question says about answering", () => {
  it("with a recipe to try, says the act is enough and how often the machine looks", () => {
    const { text } = open(approval);

    expect(text).toContain(`To clear it: approve ${PR}.`);
    expect(text).toContain("Approving is enough: you need not answer here.");
    expect(text).toContain("The machine looks for the approval every 5 minutes for the next 12 hours, and carries on when it finds it.");
    expect(text).toContain("After that the lane stays parked until someone starts it again.");
    expect(text).not.toContain("Then answer `/resume` here.");
    // The choices still stand under it: a person may still say to leave the lane parked.
    expect(text).toContain("`/leave`");
  });

  it("takes the numbers from the run's knobs", () => {
    const short: Pass = { ...pass, knobs: { ...knobs, recheckMs: 60_000, askWaitMs: 45 * 60_000 } };
    const [t, first] = startTurn(approval, short);
    const [, cmds] = stepTurn(t, ok(first[0], "not_yet"), short);

    expect((cmds[0] as { text: string }).text).toContain("every 1 minute for the next 45 minutes");
  });

  it("for another park with a recipe, says the machine checks and no reply is needed for that", () => {
    const red: TaskView = { task: "issue", state: "blocked", cause: "head-ci-red", pr: PR, seq: 4 };
    const few: Pass = { ...pass, knobs: { ...knobs, rechecks: 0 } };
    const [t, first] = startTurn(red, few);
    const [asking, cmds] = stepTurn(t, ok(first[0], "not_yet"), few);

    expect(asking).toMatchObject({ phase: "asking", recheck: { tries: 1, asked: null } });
    expect((cmds[0] as { text: string }).text).toContain(
      `Its pull request is ${PR}. The machine checks every 5 minutes for the next 12 hours whether this has cleared, and carries on when it has. No reply is needed for that.`,
    );
  });

  it("with no recipe, says what it said before: a reply is the only signal", () => {
    const none = open({ task: "issue", state: "blocked", cause: null, pr: PR, seq: 4 });
    const novel = open(approval, "novel");

    expect(none.text).toBe(
      [
        `The lane on ${ISSUE} stopped at \`blocked\`. The park says no cause.`,
        "",
        `Its pull request is ${PR}.`,
        "",
        "The machine driving it cannot clear this itself, so it is waiting on you.",
        "",
        "Answer in words, or with one of these:",
        "- `/resume`: It is handled: carry on from where the lane stopped",
        "- `/more`: Give the work one more round of repairs, then carry on",
        "- `/leave`: Leave the lane parked: a person will take it from here",
      ].join("\n"),
    );
    expect(novel.text).toContain("Then answer `/resume` here.");
    expect(novel.text).not.toContain("every");
    expect([none.turn.recheck, novel.turn.recheck]).toEqual([null, null]);
  });
});

describe("an open question's two clocks", () => {
  it("runs its own limit and the recipe's next try side by side; a park with no recipe has the limit alone", () => {
    const { turn } = open(approval);

    expect(timerOf(turn, knobs)).toEqual({ ms: knobs.askWaitMs, msg: overdue });
    expect(recheckOf(turn, knobs)).toEqual({ ms: knobs.recheckMs, msg: clock(1) });

    const none = open({ task: "issue", state: "blocked", cause: null, pr: null, seq: 4 }).turn;
    expect(timerOf(none, knobs)).toEqual({ ms: knobs.askWaitMs, msg: overdue });
    expect(recheckOf(none, knobs)).toBeNull();
    expect(step(none, clock(1))).toEqual([none, []]);
  });

  it("tries the recipe when its clock comes round, and sets the next clock when the answer is not yet", () => {
    const { turn } = open(approval);
    const [flying, cmds] = step(turn, clock(1));

    expect(cmds).toEqual([unparkTask({ key: "issue", lane: "42", task: "issue", intent: "r1/3/issue/unpark2" })]);
    // The question's own limit is the same clock as before, so a try does not start the wait again.
    expect(timerOf(flying, knobs)).toEqual(timerOf(turn, knobs));
    expect(recheckOf(flying, knobs)).toBeNull();
    expect(turnInFlight(flying)).toEqual(cmds);

    const [waiting, none] = step(flying, ok(cmds[0], "not_yet"));
    expect(none).toEqual([]);
    expect(waiting).toMatchObject({ phase: "asking", ask: { phase: "waiting" }, recheck: { tries: 2, asked: null } });
    expect(recheckOf(waiting, knobs)).toEqual({ ms: knobs.recheckMs, msg: clock(2) });
  });

  it("leaves the question when the recipe clears the park, and counts the clearance once the lane shows it", () => {
    const { turn, asked } = trying();
    const [recording, cmds] = step(turn, ok(asked, "cleared"));

    expect(recording).toMatchObject({ phase: "recording", what: "the recipe's clearance" });
    // Nothing is posted and nothing is cleared a second time: the one Cmd is the read of the lane.
    expect(cmds).toEqual([readLane({ key: "issue", lane: "42" })]);
    const moved = { lane: "42", issue: ISSUE, status: "active", tasks: [{ ...approval, state: "ship", cause: null, seq: 5 }] };
    expect(step(recording, ok(cmds[0], moved))[0]).toMatchObject({ phase: "over", end: { kind: "moved" } });

    // What the question still had coming is nobody's now: a reply, a late clock, a Judge that could not be asked.
    for (const late of [reply("/leave"), clock(2), overdue, { type: parkAsk.judge.ask.errType, cmd: {}, error: {} } as Settle]) {
      expect(step(recording, late)).toEqual([recording, []]);
    }
  });

  it("takes a try that could not run, or found no recipe after all, for not yet: the person is still asked", () => {
    for (const settle of [(c: OperatorCmd) => err(c), (c: OperatorCmd) => ok(c, "novel")]) {
      const { turn, asked } = trying();
      const [waiting, cmds] = step(turn, settle(asked));

      expect(cmds).toEqual([]);
      expect(waiting).toMatchObject({ phase: "asking", ask: { phase: "waiting" }, recheck: { tries: 2, asked: null } });
      expect(recheckOf(waiting, knobs)).toEqual({ ms: knobs.recheckMs, msg: clock(2) });
      // A reply still works.
      const [recording, clear] = step(waiting, reply("/resume"));
      expect(recording).toMatchObject({ phase: "recording", what: "a person's clearance" });
      expect(clear[0]?.type).toBe(clearTask.cmdType);
    }
  });

  it("ignores a clock from an earlier try or an earlier turn, and an answer to a try that is not the one in flight", () => {
    const { turn } = open(approval);
    expect(step(turn, clock(0))).toEqual([turn, []]);
    expect(step(turn, clock(1, 3))).toEqual([turn, []]);

    const { turn: flying, asked } = trying();
    const earlier = unparkTask({ key: "issue", lane: "42", task: "issue", intent: "r1/3/issue/unpark1" });
    expect(step(flying, ok(earlier, "cleared"))).toEqual([flying, []]);
    expect(step(flying, err(earlier))).toEqual([flying, []]);
    expect(step(flying, clock(2))).toEqual([flying, []]);
    expect(asked).not.toEqual(earlier);
  });
});

describe("a reply and the recipe, racing", () => {
  it("a reply that settles first wins: the recipe's clock and a late answer of its try change nothing", () => {
    const { turn } = open(approval);
    const [recording, cmds] = step(turn, reply("/resume"));

    expect(recording).toMatchObject({ phase: "recording", what: "a person's clearance" });
    expect(cmds.map((c) => c.type)).toEqual([clearTask.cmdType]);
    expect(recheckOf(recording, knobs)).toBeNull();
    const stale = unparkTask({ key: "issue", lane: "42", task: "issue", intent: "r1/3/issue/unpark2" });
    for (const late of [clock(1), ok(stale, "cleared"), ok(stale, "not_yet"), err(stale)]) {
      expect(step(recording, late)).toEqual([recording, []]);
    }
  });

  it("holds a reply that lands while a try is in flight, and acts on it only if the try did not clear the park", () => {
    const { turn, asked } = trying();
    const [held, none] = step(turn, reply("/resume"));

    // Not two clearances at once: fabrika would take the first and refuse the second.
    expect(none).toEqual([]);
    expect(held).toMatchObject({ phase: "asking", ask: { phase: "answered", choice: "resume" } });

    const [byPerson, clear] = step(held, ok(asked, "not_yet"));
    expect(byPerson).toMatchObject({ phase: "recording", what: "a person's clearance" });
    expect(clear.map((c) => c.type)).toEqual([clearTask.cmdType]);

    const [byRecipe, read] = step(held, ok(asked, "cleared"));
    expect(byRecipe).toMatchObject({ phase: "recording", what: "the recipe's clearance" });
    expect(read.map((c) => c.type)).toEqual([readLane.cmdType]);
  });

  it("does not try the recipe while a reply in words is with the Judge, and tries again once it is read as unsure", () => {
    const { turn } = open(approval);
    const [reading, judge] = step(turn, reply("hmm, give me a minute"));

    expect(judge.map((c) => c.type)).toEqual([parkAsk.judge.ask.cmdType]);
    expect(recheckOf(reading, knobs)).toBeNull();
    expect(step(reading, clock(1))).toEqual([reading, []]);

    const [waiting] = step(reading, ok(judge[0], { choice: "more", confidence: 0.2 }));
    expect(waiting).toMatchObject({ phase: "asking", ask: { phase: "waiting" } });
    expect(recheckOf(waiting, knobs)).toEqual({ ms: knobs.recheckMs, msg: clock(1) });
  });

  it("holds the end of the wait while a try is in flight: a park the try clears is no park to end on", () => {
    const { turn, asked } = trying();
    const [held, none] = step(turn, overdue);

    expect(none).toEqual([]);
    expect(held).toMatchObject({ phase: "asking", recheck: { overdue: true } });
    expect(step(held, ok(asked, "cleared"))[0]).toMatchObject({ phase: "recording", what: "the recipe's clearance" });
    expect(step(held, ok(asked, "not_yet"))[0]).toMatchObject({
      phase: "over",
      end: { kind: "parked", why: `nobody answered in 720 minutes; the question is on ${ISSUE}` },
    });
    expect(step(held, err(asked))[0]).toMatchObject({ phase: "over", end: { kind: "parked" } });
  });
});
