import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRefine, type RefineMsg, type RefineState, sentBack } from "./refine.ts";

// A toy use of the loop: the writer drafts lines of a poem on a topic; the
// checker counts each line's words; a line over five words is a problem.

const Brief = z.object({ topic: z.string() });
type Brief = z.infer<typeof Brief>;
const Draft = z.object({ lines: z.array(z.string()) });
type Draft = z.infer<typeof Draft>;
const Verdict = z.object({ words: z.array(z.number()) });

const poem = createRefine({
  name: "poem",
  brief: Brief,
  draft: Draft,
  verdict: Verdict,
  problemsOf: (draft, verdict) =>
    verdict.words.flatMap((n, i) => (n > 5 ? [`Line ${i + 1} ("${draft.lines[i]}") has ${n} words; keep it to five.`] : [])),
});

type State = RefineState<Brief, Draft>;
type Cmd = ReturnType<typeof poem.write> | ReturnType<typeof poem.check>;
type AnyMsg = { readonly type: string };

/** Step the machine the way a parent does, with `applyCell`. */
const step = <M extends AnyMsg>(s: State, msg: M) => applyCell<State, AnyMsg, Cmd>(poem.machine, s, msg);

const brief: Brief = { topic: "tea" };
const start: RefineMsg<Brief> = { type: "start", brief, session: null, note: "Rhyme, please.", limit: 2 };
const long: Draft = { lines: ["the kettle sings a long and winding song"] };
const short: Draft = { lines: ["the kettle sings"] };

/** The writer's answer to the Cmd it was sent. */
const wrote = (cmds: readonly Cmd[], draft: Draft, session = "poet-1") => {
  const cmd = cmds[0];
  if (cmd?.type !== "poem_write") throw new Error(`expected a write, got ${cmd?.type}`);
  return poem.write.ok(cmd, { draft, session }, 1);
};
/** The checker's answer to the Cmd it was sent. */
const checked = (cmds: readonly Cmd[], words: number[]) => {
  const cmd = cmds[0];
  if (cmd?.type !== "poem_check") throw new Error(`expected a check, got ${cmd?.type}`);
  return poem.check.ok(cmd, { words }, 2);
};

/** Walk from idle through `start`, then the writer and checker answers in order. */
function walk(answers: readonly ((cmds: readonly Cmd[]) => AnyMsg)[]) {
  let [state, cmds] = step({ phase: "idle" }, start);
  const sent: Cmd[] = [...cmds];
  for (const answer of answers) {
    [state, cmds] = step(state, answer(cmds));
    sent.push(...cmds);
  }
  return { state, cmds, sent };
}

describe("draft and vet", () => {
  it("names its Cmds after its use, so two uses in one parent never share a Msg", () => {
    const other = createRefine({ name: "summary", brief: Brief, draft: Draft, verdict: Verdict, problemsOf: () => [] });

    expect([poem.write.cmdType, poem.check.cmdType, poem.write.okType]).toEqual(["poem_write", "poem_check", "poem_write_ok"]);
    expect([other.write.cmdType, other.check.errType]).toEqual(["summary_write", "summary_check_err"]);
  });

  it("is done when the first draft passes, with the writer told the parent's note", () => {
    const { state, sent } = walk([(c) => wrote(c, short), (c) => checked(c, [3])]);

    expect(sent).toEqual([
      { type: "poem_write", brief, note: "Rhyme, please.", session: null },
      { type: "poem_check", brief, draft: short },
    ]);
    expect(state).toEqual({ phase: "done", draft: short, session: "poet-1", tries: 1, checked: true });
  });

  it("sends the checker's problems back to the writer in its own conversation, and is done once they are fixed", () => {
    const { state, sent } = walk([(c) => wrote(c, long), (c) => checked(c, [8]), (c) => wrote(c, short), (c) => checked(c, [3])]);
    const problems = [`Line 1 ("${long.lines[0]}") has 8 words; keep it to five.`];

    expect(sent[2]).toEqual({ type: "poem_write", brief, note: sentBack(problems), session: "poet-1" });
    expect(state).toEqual({ phase: "done", draft: short, session: "poet-1", tries: 2, checked: true });
  });

  it("stops out of tries with the last draft and its problems; more tries go on in the same conversation", () => {
    const { state: stopped } = walk([(c) => wrote(c, long), (c) => checked(c, [8]), (c) => wrote(c, long), (c) => checked(c, [8])]);

    expect(stopped).toMatchObject({ phase: "out_of_tries", draft: long, tries: 2, limit: 2, session: "poet-1" });
    expect(poem.isOver(stopped)).toBe(true);

    const [more, cmds] = step(stopped, { type: "answer", answer: { kind: "more", tries: 1 } });
    expect(more).toMatchObject({ phase: "writing", tries: 3, limit: 3, session: "poet-1" });
    expect(cmds).toEqual([
      { type: "poem_write", brief, note: sentBack([`Line 1 ("${long.lines[0]}") has 8 words; keep it to five.`]), session: "poet-1" },
    ]);
    const [done] = step(step(more, wrote(cmds, short))[0], { type: "poem_check_ok", value: { words: [3] }, at: 3 });
    expect(done).toMatchObject({ phase: "done", draft: short, tries: 3, checked: true });
  });

  it("takes the last draft as it is when the parent accepts it, and says it was not checked through", () => {
    const { state: stopped } = walk([(c) => wrote(c, long), (c) => checked(c, [8]), (c) => wrote(c, long), (c) => checked(c, [8])]);
    const [accepted, cmds] = step(stopped, { type: "answer", answer: { kind: "accept" } });

    expect(accepted).toEqual({ phase: "done", draft: long, session: "poet-1", tries: 2, checked: false });
    expect(cmds).toEqual([]);
    // An answer that does not fit where it stopped changes nothing.
    expect(step(stopped, { type: "answer", answer: { kind: "retry" } })).toEqual([stopped, []]);
    expect(step(stopped, { type: "answer", answer: { kind: "more", tries: 0 } })).toEqual([stopped, []]);
  });

  it("stops when the writer or the checker fails, and a retry asks again with the same input", () => {
    const [writing, first] = step({ phase: "idle" }, start);
    const writeCmd = first[0];
    if (writeCmd?.type !== "poem_write") throw new Error("expected a write");
    const [failed] = step(writing, poem.write.err(writeCmd, { _tag: "agent_failed" }, 1));

    expect(failed).toMatchObject({ phase: "write_failed", note: "Rhyme, please.", tries: 1 });
    expect(step(failed, { type: "answer", answer: { kind: "retry" } })[1]).toEqual([writeCmd]);

    const [checking, second] = step(writing, wrote(first, short));
    const checkCmd = second[0];
    if (checkCmd?.type !== "poem_check") throw new Error("expected a check");
    const [unchecked] = step(checking, poem.check.err(checkCmd, { _tag: "could_not_run" }, 2));

    expect(unchecked).toMatchObject({ phase: "check_failed", draft: short });
    expect(step(unchecked, { type: "answer", answer: { kind: "retry" } })[1]).toEqual([checkCmd]);
    expect(step(unchecked, { type: "answer", answer: { kind: "accept" } })[0]).toMatchObject({ phase: "done", checked: false });
  });

  it("asks again, after a restart, whatever was in flight: a draft being written or one being checked", () => {
    const { state: writing, cmds: writeCmds } = walk([(c) => wrote(c, long), (c) => checked(c, [8])]);
    const { state: checking, cmds: checkCmds } = walk([(c) => wrote(c, short)]);
    const reread = (s: State) => JSON.parse(JSON.stringify(s)) as State;

    expect(step(reread(writing), { type: "resume" })).toEqual([writing, writeCmds]);
    expect(step(reread(checking), { type: "resume" })).toEqual([checking, checkCmds]);
    // Nothing is in flight once it is done.
    const { state: done } = walk([(c) => wrote(c, short), (c) => checked(c, [1])]);
    expect(step(done, { type: "resume" })).toEqual([done, []]);
  });

  it("ignores a late answer in a phase it does not belong to", () => {
    const { state: done, cmds } = walk([(c) => wrote(c, short), (c) => checked(c, [1])]);

    expect(step(done, { type: "poem_check_ok", value: { words: [9] }, at: 9 })).toEqual([done, cmds]);
    expect(step(done, start)).toEqual([done, []]);
  });
});
