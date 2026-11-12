import { applyCell } from "@demlik/tea";
import { PICKS } from "@kampus/pipeline/stages/pipeline/machine";
import { type AskShown, askShownOf, blindDraw, sealAsk, Answer, Rec } from "@kampus/pipeline/tickets/ask";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DRAFT, NONE, NOW, policyFor } from "../../../fixtures/ask-desk/cases.ts";
import { property, ticketNumber } from "../../../fixtures/ask-desk/property.ts";
import { askMachine, askView, type AskView } from "./ask-window.tsx";

// P8/P12/P15/P16. Today's shared ask editor, not the later inbox program.
type Editor =
  | { _tag: "reading" }
  | { _tag: "picks" }
  | { _tag: "note"; pick: string; text: string }
  | { _tag: "saving"; answer: unknown };

type Model = {
  ticket: number;
  ask: AskShown;
  editor: Editor;
  needed?: boolean;
  took: { ms: number; opened: readonly string[] };
  failure: string | null;
  status?: string;
  evidence?: boolean;
};

type Msg =
  | { type: "do"; value: { _tag: "rec" | "not" | "picks" | "later" } }
  | { type: "pick"; pick: string }
  | { type: "note"; text: string }
  | { type: "submit"; key: string; now: number }
  | { type: "mark"; needed: boolean }
  | { type: "focus" | "active" | "visible"; value: boolean; now: number }
  | { type: "open"; name: string; now: number }
  | { type: "show"; ask: AskShown; now: number }
  | { type: "save_ok"; value: unknown }
  | { type: "save_err"; error: { why: string } }
  | { type: "tick"; now: number }
  | { type: "escape" };

type Cmd = { type: string; [key: string]: unknown };

const start = async (hidden = false, rec: unknown = DRAFT.rec, ticket = 117, picks = DRAFT.picks): Promise<Model> => {
  const ask = await Effect.runPromise(
    // Review 2, medium 2: an approve ask is never drawn blind, so a blind ask here is a step's.
    sealAsk({ ...DRAFT, rec, picks, ...(hidden ? { for: "step" } : {}) }, policyFor(DRAFT.ask, hidden, blindDraw)),
  );
  const [model]: [Model, readonly Cmd[]] = askMachine.init(null, {
    ticket,
    ask: askShownOf(ask),
    now: NOW,
  });
  return model;
};

const step = (model: Model, msg: Msg): readonly [Model, readonly Cmd[]] =>
  applyCell<Model, Msg, Cmd>(askMachine, model, msg);

const go = (model: Model, ...msgs: readonly Msg[]) => msgs.reduce((m, msg) => step(m, msg)[0], model);

describe("ask desk P8: honest editor actions", () => {
  property("rec is unavailable when hidden or absent", { hidden: Schema.Boolean }, async ({ hidden }) => {
    const model = await start(hidden, hidden ? DRAFT.rec : NONE);
    const [after, cmds] = step(model, { type: "do", value: { _tag: "rec" } });
    expect(cmds).toEqual([]);
    expect(after.editor._tag).not.toBe("saving");
  });
  describe.each([false, true])("an optional note with hidden=%s", (hidden) => {
    property(
      "waits after the pick, then Enter sends the optional note",
      { note: Answer.cases.against.fields.note },
      async ({ note }) => {
        for (const text of ["", "   ", "Keep the empty input test.", note]) {
          const model = await start(hidden, hidden ? DRAFT.rec : NONE);
          const [picked, early] = step(go(model, { type: "do", value: { _tag: "picks" } }), {
            type: "pick",
            pick: "approve",
          });
          expect(early).toEqual([]);
          expect(askView(picked).editor).toMatchObject({ _tag: "note", pick: "approve", text: "" });
          const draft = go(picked, { type: "note", text });
          const [saving, writes] = step(draft, { type: "submit", key: "Enter", now: NOW + 300 });
          const answer = {
            _tag: "chose",
            pick: "approve",
            ...(text.trim() ? { note: text.trim() } : {}),
          };
          expect(writes).toHaveLength(1);
          expect(writes[0]).toMatchObject({
            type: "save",
            ask: model.ask.ask,
            via: { _tag: "window", took: { key: "Enter", rec: hidden ? "hidden" : "none" } },
          });
          expect(writes[0]?.answer).toStrictEqual(answer);
          expect(saving.editor).toMatchObject({ _tag: "saving", answer });
          expect(askView(saving).shows.rec).toEqual(model.ask.shows.rec);
          const failed = step(saving, { type: "save_err", error: { why: "Try again" } })[0];
          expect(failed.editor).toEqual(draft.editor);
          expect(askView(failed).shows.rec).toEqual(model.ask.shows.rec);
        }
      },
    );
  });
  property(
    "n means against the rec, including a stop rec, and every-pick obeys the same rule",
    { sure: Rec.cases.pick.fields.sure },
    async ({ sure }) => {
      const model = await start(false, { ...DRAFT.rec, pick: "no", sure });
      expect(step(model, { type: "do", value: { _tag: "not" } })[0].editor).toEqual({
        _tag: "note",
        pick: "approve",
        text: "",
      });
      expect(go(model, { type: "do", value: { _tag: "picks" } }, { type: "pick", pick: "approve" }).editor).toEqual({
        _tag: "note",
        pick: "approve",
        text: "",
      });
      expect(go(model, { type: "do", value: { _tag: "picks" } }, { type: "pick", pick: "no" }).editor).toMatchObject({
        _tag: "saving",
        answer: { _tag: "rec" },
      });
    },
  );
});

describe("ask desk P12: wait for the save", () => {
  property(
    "keeps the selected ask and note through saving and failure; only acknowledgment completes it",
    { note: Answer.cases.against.fields.note },
    async ({ note }) => {
      const model = go(await start(), { type: "do", value: { _tag: "not" } }, { type: "note", text: note });
      const [saving, writes] = step(model, { type: "submit", key: "Enter", now: NOW + 300 });
      expect(saving.ask.ask).toBe(DRAFT.ask);
      expect(saving.editor).toMatchObject({
        _tag: "saving",
        answer: { _tag: "against", pick: "no", note },
      });
      expect(writes).toHaveLength(1);
      const failed = step(saving, { type: "save_err", error: { why: "The plan changed" } })[0];
      expect(failed.ask.ask).toBe(DRAFT.ask);
      expect(failed.editor).toEqual(model.editor);
      expect(failed.failure).toBe("The plan changed");
      const [saved, notices] = step(saving, { type: "save_ok", value: { ticket: 117 } });
      expect(saved.editor._tag).not.toBe("saving");
      expect(notices.some((cmd) => cmd.type === "answered")).toBe(true);
    },
  );
  property(
    "a blank note never writes, and a second press while saving never writes again",
    { text: Schema.String.check(Schema.isPattern(/^[ \t]*$/)) },
    async ({ text }) => {
      const model = go(await start(), { type: "do", value: { _tag: "not" } }, { type: "note", text });
      expect(step(model, { type: "submit", key: "Enter", now: NOW })[1]).toEqual([]);
      const saving = step(await start(), { type: "do", value: { _tag: "rec" } })[0];
      expect(step(saving, { type: "do", value: { _tag: "rec" } })[1]).toEqual([]);
    },
  );
});

describe("ask desk P12: the saved line says what was saved", () => {
  const picks = [...new Set(Object.values(PICKS).flat())];
  // Review 3, advice 3; round 10. Plant: show a raw pick id instead of its person-facing label.
  property(
    "names every saved pick by its person-facing label, with Approved. for approve",
    { pick: Schema.Literals(picks) },
    async ({ pick }) => {
      const offered = picks.map((pick, index) => ({ pick, does: `Use option ${index + 1}` }));

      for (const rec of [NONE, { ...DRAFT.rec, pick }]) {
        const model = await start(false, rec, 117, offered);
        const saving =
          rec._tag === "pick"
            ? step(model, { type: "do", value: { _tag: "rec" } })[0]
            : go(
                model,
                { type: "do", value: { _tag: "picks" } },
                { type: "pick", pick },
                { type: "submit", key: "Enter", now: NOW },
              );
        expect(saving.editor._tag).toBe("saving");
        const [saved, notices] = step(saving, { type: "save_ok", value: { ticket: 117 } });
        const label = offered.find((option) => option.pick === pick)!.does;
        const said = pick === "approve" ? "Approved." : `You chose ${label}.`;
        expect(saved.status).toBe(said);
        expect(notices).toContainEqual({ type: "answered", ticket: 117, said });
      }
    },
  );
});

describe("ask desk P16: attention belongs to the ask", () => {
  property(
    "counts only focused, visible time in an active window and preserves it on handoff",
    { offset: ticketNumber },
    async ({ offset }) => {
      const at = NOW + offset;
      const model = go(
        await start(),
        { type: "focus", value: true, now: at },
        { type: "tick", now: at + 100 },
        { type: "active", value: false, now: at + 100 },
        { type: "tick", now: at + 1000 },
        { type: "active", value: true, now: at + 1000 },
        { type: "visible", value: false, now: at + 1100 },
        { type: "tick", now: at + 2000 },
        { type: "visible", value: true, now: at + 2000 },
        { type: "focus", value: false, now: at + 2100 },
        { type: "open", name: "questions", now: at + 2200 },
        { type: "open", name: "plan", now: at + 2300 },
        { type: "show", ask: (await start()).ask, now: at + 3000 },
        { type: "focus", value: true, now: at + 3000 },
        { type: "tick", now: at + 3100 },
      );
      expect(model.took).toMatchObject({ ms: 400, opened: ["questions", "plan"] });
      const another = { ...model.ask, ask: "a-different-ask" };
      expect(go(model, { type: "show", ask: another, now: at + 3100 }).took).toMatchObject({
        ms: 0,
        opened: [],
      });
    },
  );
  it("never counts paused gaps of any length", async () => {
    const initial = await start();
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (gap) => {
        const model = go(
          initial,
          { type: "focus", value: true, now: NOW },
          { type: "focus", value: false, now: NOW + 20 },
          { type: "tick", now: NOW + 20 + gap },
        );
        expect(model.took.ms).toBe(20);
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
});

describe("ask desk P17: optional marks in the editor", () => {
  property(
    "starts unset, toggles each mark off, and lets an unmarked answer through",
    { n: ticketNumber },
    async ({ n }) => {
      const model = await start(false, DRAFT.rec, n);
      expect(model.needed).toBeUndefined();

      for (const needed of [true, false]) {
        const marked = go(model, { type: "mark", needed });
        expect(marked.needed).toBe(needed);
        expect(go(marked, { type: "mark", needed }).needed).toBeUndefined();
      }

      expect(step(model, { type: "do", value: { _tag: "rec" } })[1]).toHaveLength(1);
    },
  );
});

property("hands the later inbox the shared view identity and display data", { n: ticketNumber }, async ({ n }) => {
  const draw: (model: Model) => AskView = askView;
  const view = draw(await start(false, DRAFT.rec, n));
  expect(view).toMatchObject({ key: `${n}/${DRAFT.ask}`, ticket: n });
  expect(view.shows).toMatchObject({ what: DRAFT.what, picks: DRAFT.picks });
});

describe("ask desk review 2, medium 3: the note editor names the pick it sends", () => {
  property(
    "against the rec, the label and the send button say the pick",
    { sure: Rec.cases.pick.fields.sure },
    async ({ sure }) => {
      const against = step(await start(false, { ...DRAFT.rec, sure }), {
        type: "do",
        value: { _tag: "not" },
      })[0];
      expect(against.editor).toMatchObject({ _tag: "note", pick: "no" });
      expect(askView(against)).toMatchObject({
        note: { label: expect.stringMatching(/\bno\b/), send: expect.stringMatching(/\bno\b/) },
      });
    },
  );
  property(
    "with no rec, the label and the send button say the pick chosen",
    { pick: Schema.Literals(["approve", "no"]) },
    async ({ pick }) => {
      const chose = go(await start(false, NONE), { type: "do", value: { _tag: "picks" } }, { type: "pick", pick });
      expect(askView(chose)).toMatchObject({
        note: {
          label: expect.stringMatching(new RegExp(`\\b${pick}\\b`)),
          send: expect.stringMatching(new RegExp(`\\b${pick}\\b`)),
        },
      });
    },
  );
});

describe("ask desk review 2, low 2: only opening the evidence counts as opened", () => {
  property("opening then closing the evidence records it once", { gap: ticketNumber }, async ({ gap }) => {
    const model = go(
      await start(),
      { type: "open", name: "evidence", now: NOW },
      { type: "open", name: "evidence", now: NOW + gap },
    );
    expect(model.took.opened).toEqual(["evidence"]);
  });
  property("opening a different part leaves the evidence closed", { gap: ticketNumber }, async ({ gap }) => {
    const model = go(await start(), { type: "open", name: "plan", now: NOW + gap });
    expect(model.evidence).not.toBe(true);
    expect(model.took.opened).toEqual(["plan"]);
  });
});

describe("ask desk mutation: the view keeps the answer's words through each editor state", () => {
  property(
    "a hidden rec explains when it will show, and an absent rec keeps its reason",
    { sure: Rec.cases.pick.fields.sure },
    async ({ sure }) => {
      expect(askView(await start(true)).line).toBe("Your pick first: the rec shows once you answer");
      expect(askView(await start(false, NONE)).line).toBe(NONE.why);
      expect(askView(await start(false, { ...DRAFT.rec, sure: null })).line).toBe(
        "Recommended Approve · sureness unknown",
      );
      expect(askView(await start()).line).toBe("Recommended Approve · 95% sure");
      expect(askView(await start(false, { ...DRAFT.rec, sure })).line).toBe(
        sure === null ? "Recommended Approve · sureness unknown" : `Recommended Approve · ${sure}% sure`,
      );
    },
  );
  property("a saving view without a note draft has no note editor", { n: ticketNumber }, async ({ n }) => {
    const initial = await start(false, DRAFT.rec, n);
    expect(askView({ ...initial, editor: { _tag: "saving", answer: { _tag: "rec" } } }).note).toBeUndefined();
  });
  property(
    "keeps the note's labels while saving and closes it on Escape",
    { shown: Schema.Boolean, note: Answer.cases.against.fields.note },
    async ({ shown, note }) => {
      const initial = await start(false, shown ? DRAFT.rec : NONE);
      const noting = shown
        ? go(initial, { type: "do", value: { _tag: "not" } })
        : go(initial, { type: "do", value: { _tag: "picks" } }, { type: "pick", pick: "no" });
      const draft = go(noting, { type: "note", text: note });
      const expected = { label: shown ? "Why no?" : "Note on no (optional)", send: "Send no" };
      expect(askView(draft).note).toEqual(expected);
      const saving = go(draft, { type: "submit", key: "Enter", now: NOW });
      expect(askView(saving)).toMatchObject({ busy: true, marks: true, note: expected });
      const failed = go(saving, { type: "save_err", error: { why: "Try again" } });
      expect(askView(failed).note).toEqual(expected);
      const closed = go(failed, { type: "escape" });
      expect(askView(closed).note).toBeUndefined();
      expect(askView(initial).note).toBeUndefined();
      expect(askView(go(initial, { type: "do", value: { _tag: "rec" } })).note).toBeUndefined();
    },
  );
});
