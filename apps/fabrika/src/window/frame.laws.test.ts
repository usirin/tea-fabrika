import { applyCell } from "@demlik/tea";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AsksNow } from "../asks.ts";
import { type Desk, type DeskCmd, type DeskMsg, deskMachine, type Open } from "../desk/desk.ts";
import { defaults } from "../desk/keymap.ts";
import { FRAME, type FrameMsg, frameUpdate } from "./frame.ts";
import { type FrameProps, Over, TopBar } from "./frame.tsx";
import type { PaletteProps } from "./pop.tsx";

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
