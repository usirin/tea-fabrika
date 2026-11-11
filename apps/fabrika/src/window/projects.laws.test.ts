import { arbMsgSequence } from "@demlik/tea/pbt";
import * as fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { deskMachine, type Open } from "../desk/desk.ts";
import { defaults } from "../desk/keymap.ts";
import { go, home, options, plant, repo, word } from "../project.test-support.ts";
import { FRAME, frameUpdate, keyGoesTo, middleFree } from "./frame.ts";
import { type FrameProps, TopBar } from "./frame.tsx";

const step: typeof frameUpdate = (frame, message) => {
  const next = frameUpdate(frame, message);
  expect(next, `frame must handle ${message.type}`).toBeDefined();
  return next;
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
  const { Welcome } = await import("./projects.tsx");
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

plant("P20 render a tsh placeholder or omit the folder row", recentInput, (input) =>
  welcomeCheck(
    "tsh$",
    input.map((r) => r.name),
  ),
);

it("P21: welcome and box share row facts; the box omits current and labels open projects open", async () => {
  const { rows } = await import("../projects.ts");
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        recent: recentInput,
        current: fc.nat(),
        open: fc.array(fc.boolean(), { maxLength: 8 }),
      }),
      async (input) => {
        const facts = (await recent(input.recent)).map((r, i) => ({
          ...r,
          open: input.open[i] ?? false,
        }));
        const current = facts[input.current % Math.max(1, facts.length)]?.project.key;
        const welcome = rows(facts);
        const box = rows(facts, current);
        expect(box).toEqual(welcome.filter((row) => row.id !== current));
        expect(box.at(-1)).toMatchObject({ _tag: "folder", id: "folder" });

        for (const fact of facts) {
          const row = welcome.find((r) => r.id === fact.project.key);
          expect(row).toMatchObject({ name: fact.name, path: fact.path });

          if (fact.open) {
            expect(row).toMatchObject({ _tag: "recent", at: "open" });
          }
        }
      },
    ),
    options,
  );
});

plant("P21 show now instead of open", fc.record({ open: fc.constant(true) }), () => expect("now").toBe("open"));

const rowOps = fc.array(
  fc.record({
    action: fc.constantFrom("query", "move", "late", "enter"),
    query: fc.constantFrom("", "left", "right", "no-match"),
    by: fc.constantFrom(-1, 1),
  }),
  { minLength: 1, maxLength: 30 },
);

it("P22: queries and late rows keep selection by ID, and Enter acts on that ID only", async () => {
  const { rows } = await import("../projects.ts");
  const facts = await recent([
    { name: "left", at: 1 },
    { name: "right", at: 2 },
  ]);
  fc.assert(
    fc.property(rowOps, (flow) => {
      expect(flow.length).toBeGreaterThan(0);
      let frame = step(FRAME, { type: "projects", rows: rows(facts), focus: "tile:t1" });

      for (const op of flow) {
        if (op.action === "late") {
          const selected = frame.over.kind === "palette" ? frame.over.selected : "";
          frame = frameUpdate(frame, { type: "project_rows", rows: rows([...facts].reverse()) });

          if (frame.over.kind === "palette") {
            expect(frame.over.selected).toBe(selected);
          }
        } else if (op.action === "query") {
          frame = frameUpdate(frame, { type: "query", query: op.query });
        } else if (op.action === "move") {
          frame = frameUpdate(frame, { type: "move", by: op.by, of: 3 });
        } else {
          if (frame.over.kind !== "palette") {
            throw new Error("projects box closed before Enter");
          }

          const selected = frame.over.selected;
          const next = frameUpdate(frame, { type: "project_enter" });
          expect(next.opening).toBe(selected);
          frame = frameUpdate(next, { type: "projects", rows: rows(facts), focus: "tile:t1" });
        }

        const over = frame.over;

        if (over.kind === "palette") {
          expect(over.rows.some((row) => row.id === over.selected)).toBe(true);
        }
      }
    }),
    options,
  );
});

plant("P22 retain a row index after reversal", rowOps, () => expect(["right", "left"][0]).toBe("left"));

const replacements = fc.array(fc.constantFrom("commands", "keys", "projects"), {
  minLength: 1,
  maxLength: 20,
});

it("P23: Esc closes the box and retains the original tile, input or button focus target across replacements", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          opener: fc.constantFrom("tile:t1", "input:filter", "button:project"),
          sources: replacements,
        }),
        { minLength: 1, maxLength: 10 },
      ),
      (flows) => {
        for (const flow of flows) {
          let frame = step(FRAME, { type: "projects", rows: [], focus: flow.opener });

          for (const source of flow.sources) {
            frame = step(frame, { type: "palette_source", source, focus: `field:${source}` });
          }

          const closed = frameUpdate(frame, { type: "escape", desk: { armed: false, asking: false } });
          expect(closed.over.kind).toBe("none");
          expect(closed.returnTo).toBe(flow.opener);
        }
      },
    ),
    options,
  );
});

plant("P23 restore focus to the last source's field", replacements, (sources) =>
  expect(`field:${sources.at(-1)}`).toBe("tile:t1"),
);

const paletteMessages = arbMsgSequence(
  fc.oneof(
    fc.constant({ type: "close" } as const),
    fc.record({
      type: fc.constant("palette_source" as const),
      source: fc.constantFrom("commands", "keys", "projects"),
      focus: fc.constant("tile:t1"),
    }),
  ),
  { minLength: 1, maxLength: 30 },
);

it("P24: Cmd-K, Cmd-O and the button replace one palette; covered tiles receive no keys", () => {
  fc.assert(
    fc.property(paletteMessages, (messages) => {
      expect(messages.length).toBeGreaterThan(0);
      let frame = FRAME;

      for (const message of messages) {
        frame = step(frame, message);

        if (message.type === "close") {
          expect(frame.over.kind).toBe("none");
        } else {
          expect(frame.over).toMatchObject({ kind: "palette", source: { _tag: message.source } });

          for (const key of ["a", "<c-b>", "<m-o>", "<arrowdown>"]) {
            expect(keyGoesTo(frame.over, key, "<c-b>", { armed: true, asking: false })).toBe("over");
          }
        }
      }
    }),
    options,
  );
  // Pointer blocking and actual desk inertness are checked on Electron in E2.
});

plant("P24 independent projects flag stacks two palettes", paletteMessages, () =>
  expect(["commands", "projects"]).toHaveLength(1),
);

it("P25: the project button has a full accessible name, chevron, title and dialog state", async () => {
  const { Project } = await import("../project.ts");
  await fc.assert(
    fc.asyncProperty(fc.record({ name: word, open: fc.boolean() }), async ({ name, open }) => {
      const app = home();
      const project = await go(Project.check(repo(app, name)));
      const frame = open ? frameUpdate(FRAME, { type: "projects", rows: [], focus: "button:project" }) : FRAME;
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

plant("P25 unnamed clickable span", word, (name) =>
  expect(`<span>${name}</span>`).toContain(`aria-label="Project ${name}, switch project"`),
);

it("P27: Cmd-O on welcome focuses its first row without a second box", async () => {
  const { projectsMachine, restored } = await import("../projects.ts");
  await fc.assert(
    fc.asyncProperty(recentInput, async (input) => {
      const facts = await recent(input);
      const { applyCell } = await import("@demlik/tea");
      const model = projectsMachine.init(restored({ recent: facts, restore: [] }), undefined)[0];
      const [next, cmds] = applyCell(projectsMachine, model, { type: "projects" });
      expect(next.look._tag).toBe("welcome");
      expect(cmds.filter((c) => c.type === "focus_row")).toEqual([
        expect.objectContaining({ id: facts[0]?.project.key ?? "folder" }),
      ]);
      expect(cmds.filter((c) => /open_dialog|start_host/.test(c.type))).toEqual([]);
    }),
    options,
  );
});

plant("P27 open a second dialog over welcome", recentInput, () => expect("dialog").toBe("welcome"));

it("P28: the project box names its dialog, combobox, active option and live count", async () => {
  const { Projects } = await import("./projects.tsx");
  const { rows } = await import("../projects.ts");
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

plant("P28 hide the result count", recentInput, () =>
  expect("<div hidden>1 result</div>").toContain('aria-live="polite"'),
);

it("P30: project orientation participates in the brand's 24px give-way rule", () => {
  fc.assert(
    fc.property(
      fc.record({
        name: word,
        workspaces: fc.integer({ min: 1, max: 9 }),
        width: fc.integer({ min: 300, max: 1600 }),
      }),
      ({ name, workspaces, width }) => {
        const brand = { left: width / 2 - 50, right: width / 2 + 50 };
        const html = renderToStaticMarkup(
          createElement(TopBar, props({ name, project: { root: `/fixture/${name}`, key: "fixture" } })),
        );
        expect(html).toContain(`aria-label="Project ${name}, switch project"`);
        const project = { left: 84, right: 84 + name.length * 8 };
        const work = { left: project.right, right: project.right + workspaces * 32 };
        const expected = [project, work].every(
          (item) => item.right + 24 <= brand.left || brand.right + 24 <= item.left,
        );
        expect(middleFree(brand, [project, work])).toBe(expected);
        // E2 measures the actual button rectangle, brand visibility and draggable-region styles.
      },
    ),
    options,
  );
});

plant("P30 omit the project button from overlap", word, () =>
  expect(middleFree({ left: 200, right: 300 }, [])).toBe(false),
);
