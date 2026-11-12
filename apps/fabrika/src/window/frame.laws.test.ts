import { applyCell } from "@demlik/tea";
import { arbMsg, arbRecordMsg, propertyInvariant, stubCtxThrowingProxy, type Step } from "@demlik/tea/pbt";
import { askShownOf, sealAsk, Rec } from "@kampus/pipeline/tickets/ask";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DRAFT } from "../../../../fixtures/ask-desk/cases.ts";
import { property } from "../../../../fixtures/ask-desk/property.ts";
import type { AsksNow } from "../asks.ts";
import { type Desk, type DeskCmd, type DeskMsg, deskMachine, type Open } from "../desk/desk.ts";
import { defaults } from "../desk/keymap.ts";
import { asksMenuMachine, FRAME, type FrameMsg, frameUpdate } from "./frame.ts";
import { type FrameProps, Over, TopBar } from "./frame.tsx";
import type { PaletteProps } from "./pop.tsx";

// The laws of the asks menu's selection (asksMenuMachine), on tea's pbt: after every step of any
// list of Msgs, from the real init. The menu starts with nothing selected, and a select puts the
// row it names under the selection and asks for nothing: no answer, no later, no open (ask-desk
// plan, "Properties" row 10: one selection, drawn as it was picked). Each law has a planted mistake
// below that it catches.

type Machine = typeof asksMenuMachine;
type Model = { selected: string | null };
type Msg = { type: "select"; key: string };
type MenuStep = Step<Model, Msg, never>;

const keys = fc.constantFrom("1/a-1", "3/a-1", "1/a-2", "117/a-approve-8");

const lists = fc.array(arbMsg<Msg>({ select: arbRecordMsg("select", { key: keys }) }), {
  maxLength: 20,
  size: "max",
});

const OPTS = { numRuns: 150, seed: 119120 };
const ctx = stubCtxThrowingProxy<undefined>();

interface Law {
  readonly name: string;
  readonly check: (machine: Machine) => void;
}

const every = (name: string, law: (step: MenuStep) => boolean | string): Law => ({
  name,
  check: (machine) => propertyInvariant(machine, ctx, lists, law as never, OPTS),
});

const selectsWhatItNames = every("a select selects the row it names, and asks for nothing", (step) =>
  step.next.selected !== step.msg.key
    ? `selected ${step.next.selected}, not ${step.msg.key}`
    : step.cmds.length === 0 || "a select sent a command",
);

const LAWS = [selectsWhatItNames];

const plant = (update: Partial<Machine["update"]>): Machine => ({
  ...asksMenuMachine,
  update: { ...asksMenuMachine.update, ...update },
});

const PLANTS: readonly { readonly law: Law; readonly mistake: string; readonly machine: Machine }[] = [
  {
    law: selectsWhatItNames,
    mistake: "a second select keeps the first row",
    machine: plant({ select: (s, m) => [{ ...s, selected: s.selected ?? m.key }, []] }),
  },
];

describe("the asks menu's laws (asksMenuMachine)", () => {
  it("starts with nothing selected and asks for nothing", () => {
    fc.assert(
      fc.property(lists, (messages) => {
        expect(asksMenuMachine.init(undefined as never, ctx)).toEqual([{ selected: null }, []]);
        let [model] = asksMenuMachine.init(undefined as never, ctx);

        for (const msg of messages) {
          [model] = applyCell(asksMenuMachine, model, msg);
        }

        expect(model.selected).toBe(messages.at(-1)?.key ?? null);
      }),
      OPTS,
    );
  });

  it.each(LAWS.map((law) => [law.name, law] as const))("%s", (_, law) => {
    law.check(asksMenuMachine);
  });

  it.each(PLANTS.map((p) => [p.mistake, p] as const))("the planted mistake %s is caught", (_, { law, machine }) => {
    expect(() => law.check(machine)).toThrow();
  });

  it("every law has a planted mistake", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(LAWS, { minLength: LAWS.length }), (laws) => {
        expect(laws.filter((law) => !PLANTS.some((p) => p.law === law))).toEqual([]);
      }),
      OPTS,
    );
  });
});

const palette = vi.hoisted(() => ({ props: null as PaletteProps | null }));

vi.mock("./pop.tsx", async (original) => {
  const real = await original<typeof import("./pop.tsx")>();
  return {
    ...real,
    Palette: (props: PaletteProps) => {
      palette.props = props;
      return createElement(real.Palette, props);
    },
  };
});

const fold = (...msgs: DeskMsg[]): Open => {
  let desk = deskMachine.init(null, undefined)[0];

  for (const msg of msgs) {
    desk = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, desk, msg)[0];
  }

  if (desk.at !== "open") {
    throw new Error("desk ended");
  }

  return desk;
};

const host = { pid: 42, since: 0, build: "current", ledger: { kind: "own" }, agents: [] } as const;
const asks: AsksNow = { asks: [], later: [], reach: "ok", why: null };

const props = (over: Partial<FrameProps> = {}): FrameProps => ({
  desk: fold(),
  frame: FRAME,
  asks,
  host,
  link: { kind: "up" },
  attachedOnce: true,
  keys: defaults,
  shapes: new Map(),
  tickets: new Map(),
  armed: false,
  toHost: () => {},
  toApp: () => {},
  toRun: () => {},
  step: () => {},
  ...over,
});

const show = (over: Partial<FrameProps>) => renderToStaticMarkup(createElement(Over, props(over)));

describe("today's frame display laws", () => {
  property(
    "draws only the selected sealed ask, with its actions and the separate ask and stop counts",
    { sure: Rec.cases.pick.fields.sure },
    async ({ sure }) => {
      const sealed = askShownOf(await Effect.runPromise(sealAsk({ ...DRAFT, rec: { ...DRAFT.rec, sure } })));
      const row = {
        key: "7/a-1",
        ticket: 7,
        title: "Keys",
        what: DRAFT.what,
        kind: "ask" as const,
        at: 0,
        seen: false,
        sealed,
      };
      const html = show({
        frame: { ...FRAME, over: { kind: "asks" } },
        asks: {
          ...asks,
          asks: [
            row,
            { ...row, key: "8/a-2", ticket: 8 },
            {
              key: "9/stuck/r-3",
              ticket: 9,
              kind: "stuck",
              title: "Build",
              what: "Read failed",
              at: 0,
              seen: false,
            },
          ],
        },
      });
      expect(html.match(/data-ask-place="menu"/g)).toHaveLength(1);
      expect(html).toContain("Recommended");
      expect(html).toContain("Open ticket");
      expect(html.replace(/<!-- -->|<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("2 asks · 1 stop");
    },
  );
  property("a stop has reachable Open lane and Later actions", { later: Schema.Boolean }, ({ later }) => {
    const row = {
      key: "7/stuck/r-1",
      ticket: 7,
      title: "Keys",
      what: "Read failed",
      kind: "stuck" as const,
      at: 0,
      seen: false,
    };
    const html = show({
      frame: { ...FRAME, over: { kind: "asks" } },
      asks: { ...asks, asks: later ? [] : [row], later: later ? [row] : [] },
    });
    const buttons = [...html.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([button]) => button);

    for (const label of ["Open lane", later ? "Bring back" : "Later"]) {
      const button = buttons.find((b) => b.includes(label));
      expect(button, label).toBeDefined();
      expect(button).not.toContain('tabindex="-1"');
    }
  });
  it("shows attached agents only after the host answers, and marks only the active workspace", () => {
    const desk = fold({ type: "run", does: 'tezgah."workspace --to new"' });
    const html = renderToStaticMarkup(createElement(TopBar, props({ desk, host: null })));
    expect(
      [...html.matchAll(/data-item="workspace (\d+)"[^>]*aria-current="([^"]+)"/g)].map((match) => [
        match[1],
        match[2],
      ]),
    ).toEqual([
      ["1", "false"],
      ["2", "true"],
    ]);
    expect(html).not.toContain('data-item="agents"');
    const attached = renderToStaticMarkup(
      createElement(
        TopBar,
        props({
          host: { ...host, agents: [{ name: "helper", since: 0, tile: null }] },
        }),
      ),
    );
    expect(attached).toContain("1 agent");
  });

  it("a program in the top bar names the tsh command that focuses its tile", () => {
    const desk = fold({
      type: "covered",
      tile: "t1",
      runs: [
        { id: "tracker:1", program: "tracker" },
        { id: "ticket:1", program: "ticket" },
        { id: "trace:1", program: "trace" },
      ],
    });
    const words: unknown[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
        }

        return;
      }

      if (!isValidElement<Record<string, unknown>>(node)) {
        return;
      }

      if (node.props.name === "ticket") {
        words.push(node.props.word);
      }

      walk(node.props.children);
    };
    function Read(): ReactNode {
      const node = TopBar(props({ desk }));
      walk(node);
      return node;
    }
    renderToStaticMarkup(createElement(Read));
    expect(words).toEqual(["focus --to t2"]);
  });

  it("the asks and jobs menus display their navigation and close keys", () => {
    const html = show({
      frame: { ...FRAME, over: { kind: "asks" } },
      asks: {
        ...asks,
        asks: [
          {
            key: "7/ask-1",
            ticket: 7,
            title: "Keys",
            what: "approve plan",
            kind: "ask",
            at: 0,
            seen: false,
          },
        ],
      },
    });
    expect(html).toMatch(/↑<\/kbd>/);
    expect(html).toMatch(/↓<\/kbd>/);
    expect(html).toMatch(/↵<\/kbd>[\s\S]*?Open/);
    const jobs = show({
      frame: { ...FRAME, over: { kind: "jobs" } },
      desk: {
        ...fold(),
        jobs: { t1: { running: [{ n: 1, text: "counter", since: 0, foreground: true }], ended: null } },
      },
    });
    expect(jobs).toMatch(/Esc<\/kbd>[\s\S]*?Close/);
  });

  // pinned: review 2, low 5's "1 asks / 1 stops" bug, kept at the exact singular boundary.
  it("pinned: the asks menu counts one ask and one stop in the singular (ask desk review 2, low 5)", () => {
    const html = show({
      frame: { ...FRAME, over: { kind: "asks" } },
      asks: {
        ...asks,
        asks: [
          {
            key: "7/a-1",
            ticket: 7,
            title: "Keys",
            what: "approve plan",
            kind: "ask",
            at: 0,
            seen: false,
          },
          {
            key: "8/stuck/r-3",
            ticket: 8,
            title: "Login",
            what: "read_failed",
            kind: "stuck",
            at: 0,
            seen: false,
          },
        ],
      },
    });
    const head = html
      .replace(/<!-- -->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(head).toContain("1 ask · 1 stop");
    expect(head).not.toMatch(/\b1 (asks|stops)\b/);
  });

  it("the sync explanation keeps the failure reason and an older host names its build", () => {
    expect(
      show({
        frame: { ...FRAME, over: { kind: "item", what: "sync" } },
        asks: { ...asks, reach: "failed", why: "connection refused" },
      }),
    ).toContain('<code class="pop-why">connection refused</code>');
    expect(
      show({
        frame: { ...FRAME, over: { kind: "item", what: "host" } },
        link: { kind: "build", ours: "current", theirs: "older" },
      }),
    ).toContain("It is build <code>older</code>");
  });

  it("K17: the palette opens before a desk arrives and running a command gives its key hint", () => {
    const stepped: FrameMsg[] = [];
    const sent: FrameProps["toHost"] extends (msg: infer M) => void ? M[] : never = [];
    const frame = frameUpdate(FRAME, { type: "palette" });
    expect(show({ frame, desk: null })).toContain('<span class="chip">Keyboard shortcuts</span>');
    show({ frame, step: (msg) => stepped.push(msg), toHost: (msg) => sent.push(msg) });
    const drawn = palette.props;

    if (drawn === null) {
      throw new Error("palette did not render");
    }

    const options = drawn.sections.flatMap((section) => section.options);
    const zoom = options.findIndex((option) => option.name === "zoom");
    expect(zoom).toBeGreaterThanOrEqual(0);
    drawn.onRun(zoom);
    expect(sent).toEqual([{ type: "run", does: "tezgah.zoom" }]);
    expect(stepped).toEqual([{ type: "ran", key: "C-b z" }]);
  });
});
