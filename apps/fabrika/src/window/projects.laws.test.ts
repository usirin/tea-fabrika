import { applyCell } from "@demlik/tea";
import { arbMsgSequence } from "@demlik/tea/pbt";
import * as fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { deskMachine, type Open } from "../desk/desk.ts";
import { defaults } from "../desk/keymap.ts";
import { readToApp } from "../messages.ts";
import { go, home, options, plant, repo, word } from "../project.test-support.ts";
import { projectsMachine, type Recent, restored, rows } from "../projects.ts";
import * as Frames from "./frame.ts";
import { FRAME, type Frame, type FrameMsg, frameUpdate, keyGoesTo, middleFree, projectRowsFor } from "./frame.ts";
import { type FrameProps, TopBar } from "./frame.tsx";

// The views, loaded as the other laws here load them.
const { Projects, Welcome } = await import("./projects.tsx");

/** Each Msg the frame is sent must be handled. */
const step =
  (update: (f: Frame, m: FrameMsg) => Frame) =>
  (frame: Frame, message: FrameMsg): Frame => {
    const next = update(frame, message);
    expect(next, `frame must handle ${message.type}`).toBeDefined();
    return next;
  };

/** Amendment 4's `focusBack(before, after)`: absent until the build adds it, and then the law runs on it. */
const focusBack = (): ((before: Frame, after: Frame) => string | null) => {
  const back = (Frames as { focusBack?: (before: Frame, after: Frame) => string | null }).focusBack;

  if (back === undefined) {
    throw new Error("frame.ts exports no focusBack");
  }

  return back;
};

const recentInput = fc.uniqueArray(fc.record({ name: word, at: fc.nat({ max: 1_000_000 }) }), {
  selector: (r) => r.name,
  maxLength: 8,
});

const recent = async (input: readonly { name: string; at: number }[]) => {
  const { Project } = await import("../project.ts");
  const app = home();
  return Promise.all(
    input.map(async (r) => ({
      ...r,
      project: await go(Project.check(repo(app, r.name))),
      path: `fixtures/${r.name}`,
      open: false,
    })),
  );
};

// The desk a fresh window starts with: open, as the frame's props need.
const openDesk = (): Open => {
  const desk = deskMachine.init(null, undefined)[0];

  if (desk.at !== "open") {
    throw new Error("a fresh desk is closed");
  }

  return desk;
};

const props = (extra = {}): FrameProps => ({
  desk: openDesk(),
  frame: FRAME,
  asks: { asks: [], later: [], reach: "ok", why: null },
  host: null,
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
  ...extra,
});

const welcomeCheck = (html: string, names: readonly string[]) => {
  expect(html).toContain("Open a folder to start");
  expect(html).toContain("Each folder opens in its own window, with its own agents and jobs.");
  expect(html).not.toContain("data-tile=");
  expect(html).not.toContain("tsh$");

  for (const name of names) {
    expect(html).toContain(name);
    expect(html.indexOf(name)).toBeLessThan(html.lastIndexOf("Open Folder…"));
  }

  expect(html).toContain("Open Folder…");
};

it("P20: welcome has exact text, faint paths and timestamps, and Open Folder… last even when empty", async () => {
  await fc.assert(
    fc.asyncProperty(recentInput, async (input) => {
      const facts = await recent(input);
      const html = renderToStaticMarkup(
        createElement(Welcome, {
          recent: facts,
          selected: facts[0]?.project.key ?? "folder",
          now: 2_000_000,
          onOpen: () => {},
          onFolder: () => {},
        }),
      );
      welcomeCheck(
        html,
        input.map((r) => r.name),
      );

      for (const fact of facts) {
        expect(html).toContain(fact.path);
        expect(html).toMatch(/class="[^"]*(?:faint|path)[^"]*"/);
        expect(html).toMatch(/ago|just now/);
      }
    }),
    options,
  );
});

// P20's plant, a tsh placeholder or no folder row, has no entry point to take it: Welcome draws
// the rows `rows()` gives. The tests report gives the hand edit to projects.tsx and its red.

/** A recent project as the app keeps it: no git needed, since the views read only these facts. */
const fakeRecent = fc
  .uniqueArray(fc.record({ name: word, at: fc.nat({ max: 1_000_000 }), open: fc.boolean() }), {
    selector: (r) => r.name,
    maxLength: 8,
  })
  .map((input) =>
    input.map((r) => ({
      ...r,
      project: { root: `/fixture/${r.name}`, key: `key-${r.name}` },
      path: `fixtures/${r.name}`,
    })),
  );

/** The rows a view drew, in order: each option's id and its name, path and time as shown. */
const drawnRows = (html: string) =>
  html
    .slice(0, html.includes('class="pop-count"') ? html.indexOf('class="pop-count"') : html.length)
    .split("<div")
    .filter((chunk) => /^[^>]*role="option"/.test(chunk))
    .map((chunk) => {
      const head = chunk.slice(0, chunk.indexOf(">"));
      const id = /(?:data-row="|id="pop-projects-o-)([^"]+)"/.exec(head)?.[1] ?? null;
      const marked = chunk
        .slice(chunk.indexOf(">") + 1)
        .replace(/<span class="([^"]*)">/g, (_, cls: string) => {
          const part = ["name", "path", "when"].find((p) => cls.split(" ").includes(p));
          return part === undefined ? "" : `\u0001${part}=`;
        })
        .replace(/<[^>]*>/g, "");
      const parts = Object.fromEntries(
        marked
          .split("\u0001")
          .slice(1)
          .map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]),
      );
      return { id, name: parts.name ?? null, path: parts.path ?? null, when: parts.when ?? null };
    });

const NOW = 2_000_000;

type RecentFacts = readonly Recent[];

/** P21's check: welcome and the box, each drawn by its real view, show the same row facts in order. */
const sameRows = (welcomeFacts: RecentFacts, boxFacts: RecentFacts, current: string | undefined) => {
  const welcome = drawnRows(
    renderToStaticMarkup(
      createElement(Welcome, {
        recent: welcomeFacts,
        selected: "folder",
        now: NOW,
        onOpen: () => {},
        onFolder: () => {},
      }),
    ),
  );
  const boxRows = rows(boxFacts, current);
  const box = drawnRows(
    renderToStaticMarkup(
      createElement(Projects, {
        rows: boxRows,
        query: "",
        selected: boxRows[0]!.id,
        now: NOW,
        onQuery: () => {},
        onMove: () => {},
        onOpen: () => {},
        onClose: () => {},
      }),
    ),
  );
  expect(welcome.map((r) => r.id)).toEqual([...welcomeFacts.map((r) => r.project.key), "folder"]);
  expect(box).toEqual(welcome.filter((r) => r.id !== current));
  expect(box.at(-1)).toMatchObject({ id: "folder", name: "Open Folder…" });

  for (const fact of boxFacts.filter((r) => r.project.key !== current)) {
    const row = box.find((r) => r.id === fact.project.key);
    expect(row).toMatchObject({ name: fact.name, path: fact.path });
    expect(row?.when === "open").toBe(fact.open);
  }
};

const shareInput = fc.record({ recent: fakeRecent, current: fc.nat() });

const currentOf = ({ recent, current }: { recent: RecentFacts; current: number }) =>
  recent[current % Math.max(1, recent.length)]?.project.key;

it("P21: welcome and the box, each drawn by its own view, show the same row facts in order, open included", () => {
  fc.assert(
    fc.property(shareInput, (input) => sameRows(input.recent, input.recent, currentOf(input))),
    options,
  );
});

// The plant: Welcome shows a time for an open project, as `at: r.at` in its own rows would.
plant(
  "P21 welcome shows a time for an open project",
  shareInput,
  (input) =>
    sameRows(
      input.recent.map((r) => ({ ...r, open: false })),
      input.recent,
      currentOf(input),
    ),
  Welcome,
  Projects,
  rows,
);

/** Two projects' rows, as the app sends them, and the same rows in another order (a late list). */
const twoFacts: RecentFacts = ["left", "right"].map((name, i) => ({
  name,
  at: i + 1,
  open: false,
  project: { root: `/fixture/${name}`, key: `key-${name}` },
  path: `fixtures/${name}`,
}));

const twoRows = rows(twoFacts);
const lateRows = rows([...twoFacts].reverse());

const press = fc.constantFrom("box", "button", "menu");
const opener = fc.constantFrom("tile:t1", "tile:t3", "input:filter", "button:project");

/**
 * The Msgs the product sends the frame (desk.tsx, frame.tsx): the projects box from each press and
 * opener, the prefix's `show`, Cmd-K's `palette`, typing, arrows, a late row list, Enter or a click
 * on a row, and every way the palette closes.
 */
const frameMsg: fc.Arbitrary<FrameMsg> = fc.oneof(
  fc.record({ type: fc.constant("projects" as const), rows: fc.constant(twoRows), focus: opener, press }),
  fc.record({
    type: fc.constant("show" as const),
    what: fc.constantFrom("projects", "keys", "palette", "asks", "jobs", "bars"),
  }),
  fc.constant({ type: "palette" as const }),
  fc.record({ type: fc.constant("query" as const), query: fc.constantFrom("", "left", "right", "no-match") }),
  fc.record({ type: fc.constant("move" as const), by: fc.constantFrom(-1, 1), of: fc.constant(3) }),
  fc.record({ type: fc.constant("project_rows" as const), rows: fc.constantFrom(twoRows, lateRows) }),
  fc.record(
    { type: fc.constant("project_enter" as const), id: fc.constantFrom("key-left", "key-right", "folder") },
    { requiredKeys: ["type"] },
  ),
  fc.constant({ type: "close" as const }),
  fc.record({
    type: fc.constant("escape" as const),
    desk: fc.record({ armed: fc.boolean(), asking: fc.boolean() }),
  }),
  fc.record({ type: fc.constant("ran" as const), key: fc.constant("C-b z") }),
  fc.record({ type: fc.constant("say" as const), note: fc.constant("fixture note") }),
);

const frameFlows = arbMsgSequence(frameMsg, { minLength: 1, maxLength: 40 });

type Update = (f: Frame, m: FrameMsg) => Frame;

/** The press of a Msg that shows the projects source, else `null`. */
const pressOf = (m: FrameMsg): string | null =>
  m.type === "projects"
    ? ((m as { press?: string }).press ?? null)
    : m.type === "show" && m.what === "projects"
      ? "box"
      : null;

/** P17's frame half: each Enter leaves `opening` naming its row and the press that showed the box. */
const opensWithPress = (update: Update, flow: readonly FrameMsg[]) => {
  let frame = FRAME;
  let shownBy: string | null = null;

  for (const m of flow) {
    const before = frame;
    frame = step(update)(frame, m);
    shownBy = pressOf(m) ?? shownBy;

    const entered =
      m.type === "project_enter" &&
      before.over.kind === "palette" &&
      before.over.source._tag === "projects" &&
      frame.over.kind === "none";
    const shown = before.over.kind === "palette" ? projectRowsFor(before.over.rows, before.over.query) : [];
    const picked = before.over.kind === "palette" ? before.over.selected : "";
    const id = m.type === "project_enter" && m.id !== undefined && shown.some((r) => r.id === m.id) ? m.id : picked;
    // An Enter that opens names its row (when one was picked) and the press that showed the box.
    expect(entered ? factsOf(frame.opening, id) : null).toEqual(entered ? { id, source: shownBy } : null);
  }
};

/** The id and source an opening names, read as data: `id` stays the pick's when none was picked. */
const factsOf = (opening: unknown, id: string) => ({
  id: id === "" ? "" : typeof opening === "object" && opening !== null && "id" in opening ? opening.id : opening,
  source: typeof opening === "object" && opening !== null && "source" in opening ? opening.source : null,
});

it("P17: every Enter in the projects box records the press that showed it, through the frame's real Msgs", () => {
  fc.assert(
    fc.property(frameFlows, (flow) => opensWithPress(frameUpdate, flow)),
    options,
  );
});

it("P17: the page's open and folder messages keep each page source", () => {
  fc.assert(
    fc.property(fc.constantFrom("welcome", "box", "button", "menu"), word, (source, key) => {
      for (const sent of [
        { type: "open", key, source },
        { type: "folder", source },
      ]) {
        const read = readToApp(sent);
        expect(read.kind).toBe("read");

        if (read.kind === "read") {
          expect(read.msg).toEqual(sent);
        }
      }
    }),
    options,
  );
});

// The plant: ProjectsBox sends `box` for every pick, as frame.tsx did at 00426744.
plant("P17 the box sends box for every pick", frameFlows, (flow) =>
  opensWithPress(
    (f, m) => {
      const next = frameUpdate(f, m);
      return m.type === "project_enter" && next.opening !== f.opening
        ? Object.assign({}, next, { opening: { id: f.over.kind === "palette" ? f.over.selected : "", source: "box" } })
        : next;
    },
    [
      { type: "projects", rows: twoRows, focus: "tile:t1", press: "button" } as FrameMsg,
      { type: "project_enter" },
      ...flow,
    ],
  ),
);

const rowOps = fc.array(
  fc.record({
    action: fc.constantFrom("query", "move", "late", "enter"),
    query: fc.constantFrom("", "left", "right", "no-match"),
    by: fc.constantFrom(-1, 1),
    press,
  }),
  { minLength: 1, maxLength: 30 },
);

/** P22's check: a query, a move or a late list keeps the pick by id, and Enter opens that id. */
const keepsPick = (update: Update, flow: typeof rowOps extends fc.Arbitrary<infer A> ? A : never) => {
  const open = (p: string): FrameMsg => ({ type: "projects", rows: twoRows, focus: "tile:t1", press: p }) as FrameMsg;
  let frame = step(update)(FRAME, open("box"));

  for (const op of flow) {
    if (op.action === "late") {
      const selected = frame.over.kind === "palette" ? frame.over.selected : null;
      frame = step(update)(frame, {
        type: "project_rows",
        rows: frame.over.kind === "palette" && frame.over.rows === lateRows ? twoRows : lateRows,
      });
      expect(frame.over.kind === "palette" ? frame.over.selected : null).toBe(selected);
    } else if (op.action === "query") {
      frame = step(update)(frame, { type: "query", query: op.query });
    } else if (op.action === "move") {
      frame = step(update)(frame, { type: "move", by: op.by, of: 3 });
    } else {
      if (frame.over.kind !== "palette") {
        throw new Error("projects box closed before Enter");
      }

      const selected = frame.over.selected;
      const next = step(update)(frame, { type: "project_enter" });
      expect(next.opening).toMatchObject({ id: selected });
      frame = step(update)(next, open(op.press));
    }

    const over = frame.over;
    expect(over.kind !== "palette" || over.rows.some((row) => row.id === over.selected)).toBe(true);
  }
};

it("P22: queries and late rows keep selection by ID, and Enter acts on that ID only", () => {
  fc.assert(
    fc.property(rowOps, (flow) => keepsPick(frameUpdate, flow)),
    options,
  );
});

// The plant: a late list keeps the pick's place, not its id.
plant("P22 keep only a row index", rowOps, (flow) =>
  keepsPick(
    (f, m) => {
      const next = frameUpdate(f, m);

      if (m.type !== "project_rows" || f.over.kind !== "palette" || next.over.kind !== "palette") {
        return next;
      }

      const over = f.over;
      const at = projectRowsFor(over.rows, over.query).findIndex((r) => r.id === over.selected);
      const kept = projectRowsFor(m.rows, over.query)[Math.max(0, at)]?.id ?? next.over.selected;
      return { ...next, over: { ...next.over, selected: kept } };
    },
    [...flow, { action: "late", query: "", by: 1, press: "box" }],
  ),
);

/** The focus a Msg names when it opens the palette from none: only the projects box names one. */
const focusOf = (m: FrameMsg): string | null => (m.type === "projects" ? m.focus : null);

type Back = (before: Frame, after: Frame) => string | null;

/**
 * P23's check, from FRAME and on across closes: each step from a palette to none gives focus back
 * to the opener of that palette, the focus of the Msg that opened it from none (or `null` when that
 * Msg named none); every other step gives none back.
 */
const givesFocusBack = (update: Update, back: Back, flow: readonly FrameMsg[]) => {
  let frame = FRAME;
  let openedBy: string | null = null;

  for (const m of flow) {
    const before = frame;
    frame = step(update)(frame, m);

    if (before.over.kind !== "palette" && frame.over.kind === "palette") {
      openedBy = focusOf(m);
    }

    const expected = before.over.kind === "palette" && frame.over.kind === "none" ? openedBy : null;
    expect(back(before, frame), `after ${m.type}`).toBe(expected);
  }
};

const p23Flows = arbMsgSequence(frameMsg, { minLength: 1, maxLength: 40 });

// Review 2's case: the box from t3, Esc, the keys palette (`C-b ?`), Esc gives t3 nothing back.
const review2: readonly FrameMsg[] = [
  { type: "projects", rows: twoRows, focus: "tile:t3", press: "box" } as FrameMsg,
  { type: "escape", desk: { armed: false, asking: false } },
  { type: "show", what: "keys" },
  { type: "escape", desk: { armed: false, asking: false } },
];

it("P23: Esc gives focus back only to the palette's own opener, across closes and reopenings", () => {
  fc.assert(
    fc.property(p23Flows, (flow) => givesFocusBack(frameUpdate, focusBack(), flow)),
    { ...options, examples: [[review2]] },
  );
});

// The plant: `close` and `escape` keep returnTo, and a palette opened from none without a focus
// keeps the old one, as frame.ts did at 00426744.
plant(
  "P23 close keeps returnTo",
  p23Flows,
  (flow) =>
    givesFocusBack(
      (f, m) => {
        const next = frameUpdate(f, m);
        return next.over.kind !== "palette" || focusOf(m) === null
          ? { ...next, returnTo: f.returnTo ?? next.returnTo }
          : next;
      },
      focusBack(),
      [...review2, ...flow],
    ),
  (Frames as { focusBack?: unknown }).focusBack,
);

/** The source each palette Msg shows, or `none` when it closes the palette. */
const expectedSource = (before: Frame, m: FrameMsg): string | null => {
  if (m.type === "projects" || (m.type === "show" && m.what === "projects")) {
    return "projects";
  }

  if (m.type === "show" && m.what === "keys") {
    return "keys";
  }

  if (m.type === "show" && m.what === "palette") {
    return "commands";
  }

  if (m.type === "palette") {
    return before.over.kind === "palette" ? null : "commands";
  }

  return null;
};

const paletteMessages = arbMsgSequence(
  fc.oneof(
    fc.record({ type: fc.constant("projects" as const), rows: fc.constant(twoRows), focus: opener, press }),
    fc.record({ type: fc.constant("show" as const), what: fc.constantFrom("projects", "keys", "palette") }),
    fc.constant({ type: "palette" as const }),
    fc.constant({ type: "close" as const }),
    fc.record({
      type: fc.constant("escape" as const),
      desk: fc.record({ armed: fc.boolean(), asking: fc.boolean() }),
    }),
  ) as fc.Arbitrary<FrameMsg>,
  { minLength: 1, maxLength: 30 },
);

/** P24's check: each Cmd-K, Cmd-O, button, menu or prefix Msg leaves one palette slot, and it takes every key. */
const oneSlot = (update: Update, messages: readonly FrameMsg[]) => {
  let frame = FRAME;

  for (const message of messages) {
    const source = expectedSource(frame, message);
    frame = step(update)(frame, message);

    expect(frame.over.kind === "palette" ? frame.over.source._tag : frame.over.kind).toBe(source ?? "none");

    for (const key of ["a", "<c-b>", "<m-o>", "<arrowdown>"]) {
      const to = keyGoesTo(frame.over, key, "<c-b>", { armed: true, asking: false });
      expect(source === null || to === "over").toBe(true);
    }
  }
};

it("P24: Cmd-K, Cmd-O, the button and the menu replace one palette; covered tiles receive no keys", () => {
  fc.assert(
    fc.property(paletteMessages, (messages) => oneSlot(frameUpdate, messages)),
    options,
  );
  // Pointer blocking and actual desk inertness are checked on Electron in E2.
});

// The plant: the projects box is a flag of its own, so the palette under it stays as it was.
plant("P24 an independent projects modal flag", paletteMessages, (messages) =>
  oneSlot(
    (f, m) => (m.type === "projects" ? ({ ...f, projectsOpen: true } as Frame) : frameUpdate(f, m)),
    [{ type: "projects", rows: twoRows, focus: "tile:t1", press: "box" } as FrameMsg, ...messages],
  ),
);

it("P25: the project button has a full accessible name, chevron, title and dialog state", async () => {
  const { Project } = await import("../project.ts");
  await fc.assert(
    fc.asyncProperty(fc.record({ name: word, open: fc.boolean() }), async ({ name, open }) => {
      const app = home();
      const project = await go(Project.check(repo(app, name)));
      const frame = open
        ? frameUpdate(FRAME, { type: "projects", rows: [], focus: "button:project", press: "button" } as FrameMsg)
        : FRAME;
      const html = renderToStaticMarkup(createElement(TopBar, props({ project, name, frame })));
      expect(html).toContain(`aria-label="Project ${name}, switch project"`);
      expect(html).toContain('aria-haspopup="dialog"');
      expect(html).toContain(`aria-expanded="${open}"`);
      expect(html).toContain(`title="${name}"`);
      expect(html).toMatch(/chevron|[⌄▾]/);
      expect(html).toMatch(/<button[^>]+aria-label="Project /);
    }),
    options,
  );
});

// P25's plant, an unnamed clickable span, has no entry point to take it: TopBar draws its own
// button. The tests report gives the hand edit to frame.tsx and its red.

type Projects = ReturnType<typeof restored>;
type Press = (model: Projects) => readonly [Projects, readonly { readonly type: string; readonly id?: string }[]];

/** Cmd-O on the real machine: its `projects` Msg. */
const cmdO: Press = (model) => applyCell(projectsMachine, model, { type: "projects" });

/** P27's check: Cmd-O on welcome focuses its first row, and opens no dialog and no host. */
const welcomeFocus = async (press: Press, input: readonly { name: string; at: number }[]) => {
  const facts = await recent(input);
  const model = projectsMachine.init(restored({ recent: facts, restore: [] }), undefined)[0];
  const [next, cmds] = press(model);
  expect(next.look._tag).toBe("welcome");
  expect(cmds.filter((c) => c.type === "focus_row")).toEqual([
    expect.objectContaining({ id: facts[0]?.project.key ?? "folder" }),
  ]);
  expect(cmds.filter((c) => /open_dialog|start_host/.test(c.type))).toEqual([]);
};

it("P27: Cmd-O on welcome focuses its first row without a second box", async () => {
  await fc.assert(
    fc.asyncProperty(recentInput, (input) => welcomeFocus(cmdO, input)),
    options,
  );
});

// The plant: the machine's `projects` opens a dialog over welcome too.
plant("P27 open a second dialog over welcome", recentInput, (input) =>
  welcomeFocus((model) => {
    const [next, cmds] = cmdO(model);
    return [next, [...cmds, { type: "open_dialog" }]];
  }, input),
);

it("P28: the project box names its dialog, combobox, active option and live count", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("", "left", "none", "ArrowDown", "Escape", "folder"), {
        minLength: 1,
        maxLength: 16,
      }),
      async (flow) => {
        const facts = await recent([{ name: "left", at: 1 }]);

        for (const query of flow.filter((q) => !["Escape", "folder", "ArrowDown"].includes(q))) {
          const shown = rows(facts).filter((r) => r._tag === "folder" || r.name.includes(query));
          const html = renderToStaticMarkup(
            createElement(Projects, {
              rows: shown,
              query,
              selected: shown[0]!.id,
              onQuery: () => {},
              onMove: () => {},
              onOpen: () => {},
              onClose: () => {},
            }),
          );
          expect(html).toContain('role="dialog"');
          expect(html).toContain("Open a project…");
          expect(html).toContain('role="combobox"');
          expect(html).toContain('role="listbox"');
          const active = /aria-activedescendant="([^"]+)"/.exec(html)?.[1];
          expect(active).toBeTruthy();
          expect(html).toContain(`id="${active}"`);
          expect(html).toContain('aria-live="polite"');
          expect(html).toMatch(new RegExp(`${shown.length} (?:project|result)`));
          expect(html).not.toMatch(/hidden[^>]*>[^<]*\d+ (?:project|result)/);
        }
      },
    ),
    options,
  );
  // E2 checks the native sheet's callback sees the box already closed.
});

// P28's plant, a hidden count, has no entry point to take it: Projects draws its own count. The
// tests report gives the hand edit to projects.tsx and its red.

const barInput = fc.record({
  name: word,
  workspaces: fc.integer({ min: 1, max: 9 }),
  width: fc.integer({ min: 300, max: 1600 }),
  // Where the project button starts and how wide it draws: a long name pushes the workspaces past
  // the brand while the button itself still covers it.
  start: fc.integer({ min: 0, max: 600 }),
  wide: fc.integer({ min: 24, max: 480 }),
});

/** P30's check: the brand keeps the middle only while the project button and workspaces leave it room. */
const givesWay = (
  free: typeof middleFree,
  { name, workspaces, width, start, wide }: typeof barInput extends fc.Arbitrary<infer A> ? A : never,
) => {
  const brand = { left: width / 2 - 50, right: width / 2 + 50 };
  const html = renderToStaticMarkup(
    createElement(TopBar, props({ name, project: { root: `/fixture/${name}`, key: "fixture" } })),
  );
  expect(html).toContain(`aria-label="Project ${name}, switch project"`);
  const project = { left: start, right: start + wide };
  const work = { left: project.right, right: project.right + workspaces * 32 };
  const expected = [project, work].every((item) => item.right + 24 <= brand.left || brand.right + 24 <= item.left);
  expect(free(brand, [project, work])).toBe(expected);
  // E2 measures the actual button rectangle, brand visibility and draggable-region styles.
};

it("P30: project orientation participates in the brand's 24px give-way rule", () => {
  fc.assert(
    fc.property(barInput, (input) => givesWay(middleFree, input)),
    options,
  );
});

// The plant: the overlap check leaves the project button out.
plant("P30 leave the project button out of the overlap check", barInput, (input) =>
  givesWay((brand, items) => middleFree(brand, items.slice(1)), input),
);
