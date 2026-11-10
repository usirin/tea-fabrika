import { applyCell } from "@demlik/tea";
import { Result } from "effect";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Ask, AsksNow } from "../asks.ts";
import { activeOf, type Desk, type DeskCmd, type DeskMsg, deskMachine, type Open } from "../desk/desk.ts";
import { decodeKeys, defaults, Does, type Keys } from "../desk/keymap.ts";
import type { HostNow } from "../messages.ts";
import type { JobEnded } from "../tile-jobs.ts";
import {
  agentsWord,
  agoWord,
  asksSections,
  asksWord,
  bottomLineShows,
  clockWord,
  commandsOf,
  ENDED_SHOWN_MS,
  EXPLAIN_ON,
  FRAME,
  fileWord,
  focusFollows,
  type Frame,
  type FrameMsg,
  frameUpdate,
  hereWord,
  holdsWord,
  hostWord,
  INFO,
  type InfoMode,
  infoFor,
  jobItem,
  jobsList,
  keyGoesTo,
  keyWord,
  lineIn,
  matching,
  middleFree,
  nowhereNote,
  opensOf,
  prefixLine,
  questionWord,
  restartedWord,
  syncWord,
  ticketsShown,
  tileOfTicket,
  tookWord,
  workspaceName,
} from "./frame.ts";
import { BottomArea, BottomLine, type FrameProps, ModeStatus, Over } from "./frame.tsx";
import { capOf } from "./pop.ts";

// The frame's words, from a real desk folded by the real machine, and the keys file's real
// table (desk/keymap.ts): the defaults, or a file's.

const fold = (msgs: readonly DeskMsg[]): Open => {
  let s: Desk = deskMachine.init(null, undefined)[0];

  for (const m of msgs) {
    s = applyCell<Desk, DeskMsg, DeskCmd>(deskMachine, s, m)[0];
  }

  if (s.at !== "open") {
    throw new Error("the desk is over");
  }

  return s;
};

it("K18: moved keys update palette search, prefix hints, keycaps and spoken words", () => {
  const read = decodeKeys('prefix = "ctrl+a"\ntezgah.zoom = "<prefix>shift+f6"', true);

  if (Result.isFailure(read)) {
    throw new Error(read.failure.why);
  }

  const commands = commandsOf(read.success, 1);
  const zoom = commands.find((command) => command.runs === "tezgah.zoom");
  expect(zoom?.key).toMatch(/C-a.*(?:Shift|S-).*F6/i);
  expect(zoom?.caps).toEqual(["⌃A", expect.stringMatching(/⇧f6/i)]);
  expect(matching(commands, "shift+f6")).toContain(zoom);
  expect(prefixLine(read.success)).toContainEqual(
    expect.objectContaining({ name: "zoom", key: expect.stringMatching(/(?:Shift|S-).*F6/i) }),
  );
  expect(capOf("<s-m-w>")).toBe("⇧⌘W");
  expect(JSON.stringify(zoom)).not.toContain("C-b z");
});

/** The default prefix, as keyName spells it. */
const PREFIX = "<c-b>";

/** The keybindings file's table, one line per argument; a refusal fails the test. */
const table = (...lines: readonly string[]): Keys => {
  const answer = decodeKeys(lines.join("\n"), true);

  if (Result.isFailure(answer)) {
    throw new Error(`refused: ${answer.failure.why}`);
  }

  return answer.success;
};

const SHAPES = new Map([
  ["tracker", { takes: [], sends: ["ticket"] }],
  ["ticket", { takes: ["ticket"], sends: ["ticket"] }],
  ["trace", { takes: ["ticket"], sends: [] }],
]);

/** `tracker | ticket | trace` typed in t1, its windows in t2 and t3, t2 focused, showing #7. */
const lined = fold([
  {
    type: "covered",
    tile: "t1",
    runs: [
      { id: "tracker:1", program: "tracker" },
      { id: "ticket:1", program: "ticket" },
      { id: "trace:1", program: "trace" },
    ],
  },
  { type: "click", tile: "t2" },
]);

const SHOWN = new Map([["ticket:1", 7]]);

const now = (over: Partial<AsksNow> = {}): AsksNow => ({
  asks: [],
  later: [],
  reach: "ok",
  why: null,
  ...over,
});

const ask = (over: Partial<Ask> = {}): Ask => ({
  key: "7/a-1",
  ticket: 7,
  title: "Login fails",
  what: "approve plan",
  kind: "ask",
  at: 0,
  seen: false,
  ...over,
});

describe("the frame's keys", () => {
  it("writes keys as a person reads them", () => {
    expect(keyWord("<c-b>")).toBe("C-b");
    expect(keyWord("<c-h>")).toBe("C-h");
    expect(keyWord("<arrowleft>")).toBe("←");
    expect(keyWord(" ")).toBe("Space");
    expect(keyWord("|")).toBe("|");
  });

  it("lists every command once, by the desk's own table, and only the workspaces there are", () => {
    const commands = commandsOf(defaults, 2);
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("zoom");
    expect(names).toContain("workspace 2");
    expect(names).not.toContain("workspace 3");
    expect(commands.find((c) => c.name === "focus left")?.key).toBe("C-b h");
    // The palette runs a command by its word, not by its key (ticket 174).
    expect(commands.find((c) => c.name === "zoom")).toEqual({
      name: "zoom",
      group: "tile",
      key: "C-b z",
      caps: ["⌃B", "Z"],
      tsh: "zoom",
      runs: "tezgah.zoom",
    });
    expect(commands.find((c) => c.name === "new")?.caps).toEqual(["⌃B", "⇧N"]);
    expect(commands.find((c) => c.name === "agents")).toMatchObject({
      name: "agents",
      group: "window",
      key: "C-b A",
      caps: ["⌃B", "⇧A"],
      tsh: "agents",
    });
    const words: readonly string[] = Does.literals;
    expect(commands.every((c) => words.includes(c.runs))).toBe(true);
    expect(matching(commands, "zo").map((c) => c.name)).toEqual(["zoom"]);
    expect(matching(commands, "workspace 2").map((c) => c.name)).toEqual(["workspace 2"]);
    // The tsh word finds it too: `--to down` is split down's and focus down's.
    expect(matching(commands, "--to down").map((c) => c.name)).toEqual(["split down", "focus down"]);
  });

  it("groups the commands as the palette shows them: tile, focus, workspace, then the window's own", () => {
    const commands = commandsOf(defaults, 1);
    expect(commands.map((c) => c.name)).toEqual([
      "split",
      "split down",
      "turn",
      "fold",
      "zoom",
      "close",
      "focus left",
      "focus down",
      "focus up",
      "focus right",
      "focus next",
      "focus previous",
      "new",
      "previous workspace",
      "next workspace",
      "workspace 1",
      "asks",
      "jobs",
      "keys",
      "info",
      "bars",
      "agents",
      "sync",
      "host",
    ]);
  });

  it("shows the real keys after Ctrl-B", () => {
    expect(prefixLine(defaults)).toEqual([
      { key: "N", name: "new" },
      { key: "x", name: "close" },
      { key: "z", name: "zoom" },
      { key: "f", name: "fold" },
      { key: "|", name: "split" },
      { key: "?", name: "keys" },
    ]);
  });
});

describe("the frame's keys, from the keys file (ticket 174)", () => {
  /**
   * Today's palette with no file, frozen before this change: each command's name, group, key
   * as the bottom line writes it, keycaps and tsh word, with nine workspaces (p1).
   */
  const TODAY = [
    ["split", "tile", "C-b |", ["⌃B", "|"], "split"],
    ["split down", "tile", "C-b -", ["⌃B", "-"], "split --to down"],
    // The desk word is `turn-container`: `turn` is the plan's program for one said line.
    ["turn", "tile", "C-b Space", ["⌃B", "Space"], "turn-container"],
    ["fold", "tile", "C-b f", ["⌃B", "F"], "fold"],
    ["zoom", "tile", "C-b z", ["⌃B", "Z"], "zoom"],
    ["close", "tile", "C-b x", ["⌃B", "X"], "close-tile"],
    ["focus left", "focus", "C-b h", ["⌃B", "H"], "focus --to left"],
    ["focus down", "focus", "C-b j", ["⌃B", "J"], "focus --to down"],
    ["focus up", "focus", "C-b k", ["⌃B", "K"], "focus --to up"],
    ["focus right", "focus", "C-b l", ["⌃B", "L"], "focus --to right"],
    ["focus next", "focus", expect.stringMatching(/f6/i), [expect.stringMatching(/f6/i)], "focus --to next"],
    [
      "focus previous",
      "focus",
      expect.stringMatching(/(?:Shift|S-).*f6/i),
      [expect.stringMatching(/⇧f6/i)],
      "focus --to previous",
    ],
    ["new", "workspace", "C-b N", ["⌃B", "⇧N"], "workspace --to new"],
    ["previous workspace", "workspace", "C-b C-h", ["⌃B", "⌃H"], "workspace --to previous"],
    ["next workspace", "workspace", "C-b C-l", ["⌃B", "⌃L"], "workspace --to next"],
    ...Array.from(
      { length: 9 },
      (_, i) =>
        [`workspace ${i + 1}`, "workspace", `C-b ${i + 1}`, ["⌃B", `${i + 1}`], `workspace --to ${i + 1}`] as const,
    ),
    ["asks", "window", "C-b a", ["⌃B", "A"], "asks"],
    ["jobs", "window", "C-b J", ["⌃B", "⇧J"], "jobs"],
    ["keys", "window", "C-b ?", ["⌃B", "?"], "keys"],
    ["info", "window", "C-b i", ["⌃B", "I"], "info"],
    ["bars", "window", "C-b B", ["⌃B", "⇧B"], "bars"],
    ["agents", "window", "C-b A", ["⌃B", "⇧A"], "agents"],
    ["sync", "window", "C-b S", ["⌃B", "⇧S"], "sync"],
    ["host", "window", "C-b H", ["⌃B", "⇧H"], "host"],
  ];
  const shown = (keys: Keys, workspaces = 9) =>
    commandsOf(keys, workspaces).map((c) => [c.name, c.group, c.key, c.caps, c.tsh]);
  const zoomOf = (keys: Keys) => commandsOf(keys, 1).find((c) => c.name === "zoom");

  it("lists with no file the palette it lists today (p1)", () => {
    expect(shown(defaults)).toEqual(TODAY);
    expect(shown(table(""))).toEqual(TODAY);
  });

  it("writes your prefix in every key and keycap of the palette (p2, p10)", () => {
    const keys = table('prefix = "ctrl+a"');
    expect(zoomOf(keys)).toMatchObject({ key: "C-a z", caps: ["⌃A", "Z"] });
    expect(commandsOf(keys, 1).every((c) => !c.key.includes("C-b"))).toBe(true);
  });

  it("shows a moved command on its new key, in the palette and after the prefix (p10)", () => {
    const keys = table('tezgah.zoom = "<prefix>m"');
    expect(zoomOf(keys)).toMatchObject({ key: "C-b m", caps: ["⌃B", "M"], runs: "tezgah.zoom" });
    expect(prefixLine(keys)).toContainEqual({ key: "m", name: "zoom" });
    expect(prefixLine(keys)).not.toContainEqual({ key: "z", name: "zoom" });
    // The prefix line goes by command, not by key: none of its six is a literal key.
    const moved = table('tezgah.close = "<prefix>q"', 'tezgah.split = "<prefix>s"');
    expect(prefixLine(moved)).toEqual([
      { key: "N", name: "new" },
      { key: "q", name: "close" },
      { key: "z", name: "zoom" },
      { key: "f", name: "fold" },
      { key: "s", name: "split" },
      { key: "?", name: "keys" },
    ]);
  });

  it("still lists an unbound command, with no keycaps, and runs it by its word (p4)", () => {
    const keys = table("tezgah.zoom = []");
    expect(zoomOf(keys)).toMatchObject({
      name: "zoom",
      group: "tile",
      caps: [],
      tsh: "zoom",
      runs: "tezgah.zoom",
    });
    expect(matching(commandsOf(keys, 1), "zoom").map((c) => c.name)).toEqual(["zoom"]);
    // The bottom line after the prefix shows only keys there are.
    expect(prefixLine(keys).map((k) => k.name)).not.toContain("zoom");
  });

  it("shows a command pressed alone with its own keycap, and no prefix (p5)", () => {
    const keys = table('tezgah.split = "cmd+d"');
    const split = commandsOf(keys, 1).find((c) => c.name === "split");
    expect(split?.caps).toEqual(["⌘D"]);
    expect(split?.runs).toBe("tezgah.split");
    expect(prefixLine(keys).map((k) => k.name)).not.toContain("split");
  });

  it("names the bad line of a refused file, and says nothing of one that read (p8)", () => {
    expect(fileWord({ _tag: "refused", line: 2, why: "tezgah.zom is not a command" })).toBe(
      "keybindings.toml line 2: tezgah.zom is not a command",
    );
    expect(fileWord({ _tag: "read" })).toBeNull();
    expect(fileWord({ _tag: "none" })).toBeNull();
  });
});

describe("the top bar", () => {
  it("names a workspace by the ticket it shows, and draws its line in order", () => {
    const ws = activeOf(lined);
    expect(workspaceName(ws, SHOWN)).toBe("#7");
    expect(workspaceName(ws, new Map())).toBe("tracker");
    expect(lineIn(ws)).toEqual([
      { program: "tracker", tile: "t1", focused: false },
      { program: "ticket", tile: "t2", focused: true },
      { program: "trace", tile: "t3", focused: false },
    ]);
    const plain = fold([]);
    expect(workspaceName(activeOf(plain), SHOWN)).toBe("tsh");
    expect(lineIn(activeOf(plain))).toEqual([]);
  });

  it("counts asks in words, and says nothing when nothing asks you", () => {
    expect(asksWord(0)).toBeNull();
    expect(asksWord(1)).toBe("1 asks you");
    expect(asksWord(3)).toBe("3 ask you");
  });

  it("counts the agents attached, and says nothing while none is", () => {
    const host = (agents: HostNow["agents"]): HostNow => ({
      pid: 4242,
      since: 0,
      build: null,
      ledger: { kind: "own" },
      agents,
    });
    expect(agentsWord(host([]))).toBeNull();
    expect(agentsWord(host(null))).toBeNull();
    expect(agentsWord(host([{ name: "claude", since: 0, tile: null }]))).toBe("1 agent");
    expect(
      agentsWord(
        host([
          { name: "claude", since: 0, tile: "t2" },
          { name: "codex", since: 1, tile: null },
        ]),
      ),
    ).toBe("2 agents");
  });

  it("says in the host's lines who restarted the host, how long ago and why, and nothing for a host that just started (185b PR 5)", () => {
    const host: HostNow = { pid: 4242, since: 0, build: null, ledger: { kind: "own" }, agents: [] };
    // made up: `restartedWord`, beside `agentsWord`; `HostNow.restarted` is the plan's name, its
    // fields restart.json's `{by, why, at}`. The ago is `agoWord`'s, as the jobs list says it.
    const restarted = (by: string, why: string | null, at: number) =>
      ({ ...host, restarted: { by, why, at } }) as HostNow;
    expect(restartedWord(restarted("agent:claude for:owner", "pick up the new build", 1_000), 5_000)).toBe(
      "restarted by claude 4s ago: pick up the new build",
    );
    // A person's restart from the window has no why: the line ends at the time.
    const person = restartedWord(restarted("user:owner", null, 1_000), 5_000);
    expect(person).toMatch(/^restarted by \S.* 4s ago$/);
    // The person at the window is "you", whatever their login (owed by PR 382's mutation step).
    expect(person).toBe("restarted by you 4s ago");
    expect(restartedWord(restarted("user:ana", null, 1_000), 5_000)).toBe("restarted by you 4s ago");
    // A host that started fresh, or one of an older build that says nothing of it.
    expect(restartedWord({ ...host, restarted: null } as HostNow, 5_000)).toBeNull();
    expect(restartedWord(host, 5_000)).toBeNull();
  });

  it("says a server's ledger syncing until read, nothing once in sync, and a failed read broken", () => {
    const server = { kind: "server", address: "https://ledger.example/w1", login: "owner" } as const;
    expect(syncWord(now({ reach: "reading" }), server)).toEqual({ word: "syncing", broken: false });
    expect(syncWord(now(), server)).toBeNull();
    expect(syncWord(now({ reach: "reading" }), { kind: "own" })).toBeNull();
    expect(syncWord(now(), { kind: "own" })).toBeNull();
    const failed = { word: "ledger unreachable", broken: true };
    expect(syncWord(now({ reach: "failed", why: "refused" }), server)).toEqual(failed);
    expect(syncWord(now({ reach: "failed", why: "locked" }), { kind: "own" })).toEqual(failed);
  });

  it("writes a time as a clock today and with its day before, and what the host holds", () => {
    const at = new Date(2026, 9, 30, 9, 5).getTime();
    expect(clockWord(at, new Date(2026, 9, 30, 17, 0).getTime())).toBe("09:05");
    expect(clockWord(at, new Date(2026, 9, 31, 8, 0).getTime())).toBe("Oct 30, 09:05");
    expect(holdsWord(fold([]))).toBe("1 tile · 0 jobs running");
    expect(holdsWord(lined)).toBe("3 tiles · 0 jobs running");
    const two = [1, 2].map((n) => ({ n, text: "sleep --ms 9000", since: 0, foreground: false }));
    expect(holdsWord(fold([{ type: "jobs", tile: "t1", jobs: { running: two, ended: null } }]))).toBe(
      "1 tile · 2 jobs running",
    );
  });

  it("shows no word for a host that is up, and a word with its own shape for the rest", () => {
    expect(hostWord({ kind: "up" }, true)).toEqual({ kind: "up" });
    expect(hostWord({ kind: "up" }, false)).toEqual({ kind: "up" });
    const word = (word: string, broken: boolean, shape: string) => ({
      kind: "word",
      word,
      broken,
      shape,
    });
    expect(hostWord({ kind: "build", theirs: "a1", ours: "b2" }, true)).toEqual(word("host older", false, "stuck"));
    expect(hostWord({ kind: "version", theirs: 0, ours: 1 }, true)).toEqual(
      word("host speaks another version", true, "stuck"),
    );
    expect(hostWord({ kind: "reconnecting", why: "gone" }, true)).toEqual(word("host down", true, "failed"));
    expect(hostWord({ kind: "reconnecting", why: "gone" }, false)).toEqual(word("connecting", false, "later"));
    expect(hostWord({ kind: "stopped", why: "gone" }, true)).toEqual(word("host down", true, "failed"));
    expect(hostWord({ kind: "restarting" }, true)).toEqual(word("host restarting", false, "later"));
  });
});

describe("the bottom line and the asks list", () => {
  it("says the focused tile, what it takes and sends, and its neighbors", () => {
    expect(hereWord(lined, SHAPES, SHOWN)).toBe("t2 ticket #7 · takes ticket · sends ticket · from tracker → trace");
    expect(hereWord(fold([]), SHAPES, SHOWN)).toBe("t1 tsh");
  });

  it("asks your own close at the bottom, as tmux does", () => {
    const asking = fold([
      { type: "key", key: "<c-b>", at: 0 },
      { type: "key", key: "x", at: 1 },
    ]);
    expect(questionWord(asking)).toBe("close t1? (y/n)");
    expect(questionWord(fold([]))).toBeNull();
  });

  it("reads the ticket a run shows off the ticket program's view only", () => {
    const shown = ticketsShown([
      ["ticket:1", { type: "view", program: "ticket", data: { ready: true, number: 7, page: null } }],
      ["ticket:2", { type: "view", program: "ticket", data: { ready: false, number: null } }],
      ["counter:1", { type: "view", program: "counter", data: { number: 3 } }],
      ["ticket:3", { type: "view", program: "ticket", data: "not a view" }],
    ]);
    expect([...shown]).toEqual([["ticket:1", 7]]);
  });

  it("makes one row per ask: what it asks, its ticket and tile under it, its time", () => {
    const at = new Date(2026, 9, 30, 11, 13).getTime();
    const asks = now({
      asks: [
        ask({ at }),
        ask({
          key: "8/stuck/r-1",
          ticket: 8,
          title: "Dark mode",
          kind: "stuck",
          what: "checks red",
          at,
        }),
      ],
      later: [ask({ key: "9/a-1", ticket: 9, title: "Login broken", what: "is it a duplicate of #7?", at })],
    });
    const [live, later] = asksSections(asks, lined, SHOWN, at);
    expect(live).toMatchObject({ id: "asks", title: null, fold: false });
    expect(live?.rows).toEqual([
      {
        id: "7/a-1",
        icon: "ask",
        title: "Approve plan",
        sub: "#7 Login fails · t2",
        side: "11:13",
        second: { name: "Later", cap: "H" },
      },
      {
        id: "8/stuck/r-1",
        icon: "stuck",
        title: "Stuck: checks red",
        sub: "#8 Dark mode",
        side: "11:13",
        second: { name: "Later", cap: "H" },
      },
    ]);
    expect(later).toMatchObject({ id: "later", title: "Later", fold: true });
    expect(later?.rows[0]).toMatchObject({
      icon: "later",
      title: "Is it a duplicate of #7?",
      second: { name: "Bring back", cap: "H" },
    });
    // Nothing set aside: no Later section at all.
    expect(asksSections(now({ asks: [ask()] }), lined, SHOWN, at)).toHaveLength(1);
  });

  it("opens an ask in the tile that shows its ticket, else turns the tracker to it, else says so", () => {
    expect(tileOfTicket(lined, 7, SHOWN)).toBe("t2");
    expect(tileOfTicket(lined, 8, SHOWN)).toBeUndefined();
    expect(opensOf(lined, 7, SHOWN)).toEqual({ kind: "tile", tile: "t2" });
    expect(opensOf(lined, 8, SHOWN)).toEqual({ kind: "tracker", tile: "t1", run: "tracker:1" });
    expect(opensOf(fold([]), 8, SHOWN)).toEqual({ kind: "none" });
    expect(opensOf(null, 7, SHOWN)).toEqual({ kind: "none" });
    expect(nowhereNote(8)).toBe("no tile shows #8 · the tracker opens it");
  });
});

describe("keys while something lies over the desk", () => {
  const quiet = { armed: false, asking: false };
  const asks: Frame["over"] = { kind: "asks" };
  const palette: Frame["over"] = { kind: "palette", title: "commands", query: "", at: 0 };

  it("sends every key to the desk when nothing is open", () => {
    for (const key of ["<arrowdown>", "a", "<c-b>"]) {
      expect(keyGoesTo({ kind: "none" }, key, PREFIX, quiet)).toBe("desk");
    }
  });

  it("never lets an arrow, Enter or a letter reach a tile while a popover is open", () => {
    const jobs: Frame["over"] = { kind: "jobs" };

    for (const over of [asks, jobs, palette, { kind: "item", what: "host" } as const]) {
      for (const key of ["<arrowdown>", "<arrowup>", "<arrowleft>", "<enter>", "h", "j", "x", " "]) {
        expect(keyGoesTo(over, key, PREFIX, quiet)).toBe("over");
      }
    }
  });

  it("lets Ctrl-B and the key after it reach the desk over a menu, so C-b a closes it", () => {
    expect(keyGoesTo(asks, PREFIX, PREFIX, quiet)).toBe("desk");
    expect(keyGoesTo(asks, "a", PREFIX, { armed: true, asking: false })).toBe("desk");
    expect(keyGoesTo(asks, "y", PREFIX, { armed: false, asking: true })).toBe("desk");
    expect(keyGoesTo({ kind: "jobs" }, "J", PREFIX, { armed: true, asking: false })).toBe("desk");
  });

  it("keeps every key in the palette, a modal dialog, even Ctrl-B", () => {
    expect(keyGoesTo(palette, PREFIX, PREFIX, quiet)).toBe("over");
    expect(keyGoesTo(palette, "a", PREFIX, { armed: true, asking: true })).toBe("over");
  });
});

describe("the job item and the jobs list", () => {
  const job = (n: number, text: string, since: number, foreground = false) => ({
    n,
    text,
    since,
    foreground,
  });
  const ended = (over: Partial<JobEnded> = {}): JobEnded => ({
    n: 3,
    text: "seq --to 9 | tally",
    how: "done",
    since: 0,
    at: 60_000,
    foreground: true,
    ...over,
  });

  it("says how long, calmly: seconds in the first minute, then minutes, then hours", () => {
    expect(tookWord(-5)).toBe("0s");
    expect(tookWord(14_999)).toBe("14s");
    expect(tookWord(134_000)).toBe("2m");
    expect(tookWord(3_600_000)).toBe("1h");
    expect(tookWord(3_900_000)).toBe("1h 5m");
  });

  it("names the job tsh waits for, else the newest, with how many more run; nothing when none runs", () => {
    const jobs = {
      running: [job(1, "counter", 0), job(2, "tracker | ticket", 1000, true), job(4, "tally", 2000)],
      ended: null,
    };
    expect(jobItem(jobs, 135_000)).toEqual({
      n: 2,
      text: "tracker | ticket",
      said: "2m",
      ended: false,
      more: 2,
    });
    const background = { running: [job(1, "counter", 0), job(4, "tally", 2000)], ended: null };
    expect(jobItem(background, 16_000)).toMatchObject({ n: 4, said: "14s", more: 1 });
    expect(jobItem({ running: [], ended: null }, 0)).toBeNull();
    expect(jobItem(undefined, 0)).toBeNull();
  });

  it("says an end plainly for a short while, then clears; a quick one in the foreground not at all", () => {
    const done = { running: [], ended: ended() };
    expect(jobItem(done, 60_000)).toEqual({
      n: 3,
      text: "seq --to 9 | tally",
      said: "done in 1m",
      ended: true,
      more: 0,
    });
    expect(jobItem(done, 60_000 + ENDED_SHOWN_MS)).toBeNull();
    const failed = { running: [job(1, "counter", 0)], ended: ended({ how: "failed", since: 46_000 }) };
    expect(jobItem(failed, 61_000)).toMatchObject({ said: "failed after 14s", more: 1 });
    // Seen happen: tsh printed it in the tile, and the bottom line names what still runs.
    const quick = { running: [job(1, "counter", 0)], ended: ended({ since: 59_000 }) };
    expect(jobItem(quick, 60_000)).toMatchObject({ n: 1, ended: false });
    // In the background it ended out of sight, however quick.
    const behind = { running: [], ended: ended({ since: 59_000, foreground: false, how: "stopped" }) };
    expect(jobItem(behind, 60_000)?.said).toBe("stopped after 1s");
    const instant = { running: [], ended: ended({ since: 59_400, foreground: false, how: "failed" }) };
    expect(jobItem(instant, 60_000)?.said).toBe("failed at once");
  });

  it("lists the focused tile's jobs first and its last end, then each other tile's", () => {
    const desk: Open = {
      ...lined,
      jobs: {
        t1: { running: [job(1, "counter", 0)], ended: null },
        t2: {
          running: [job(2, "tally", 0), job(5, "sleep --ms 9000", 60_000, true)],
          ended: ended(),
        },
      },
    };
    const list = jobsList(desk, 120_000);
    const typed = (text: string) => ({ text, typed: true });
    const plain = (text: string) => ({ text, typed: false });
    expect(list.count).toBe(3);
    expect(list.sections).toEqual([
      {
        id: "here",
        title: null,
        fold: false,
        rows: [
          {
            id: "t2/%5",
            icon: "running",
            title: [typed("sleep --ms 9000")],
            sub: [typed("%5"), plain(" · t2")],
            side: "1m",
            second: null,
          },
          {
            id: "t2/%2",
            icon: "running",
            title: [typed("tally")],
            sub: [typed("%2"), plain(" · t2")],
            side: "2m",
            second: null,
          },
        ],
      },
      {
        id: "ended",
        title: "Last ended",
        fold: false,
        rows: [
          {
            id: "t2/ended",
            icon: "done",
            title: [typed("seq --to 9 | tally")],
            sub: [typed("%3"), plain(" · t2 · done in 1m")],
            side: "1m ago",
            second: null,
          },
        ],
      },
      {
        id: "others",
        title: "Other tiles",
        fold: false,
        rows: [
          {
            id: "t1/%1",
            icon: "running",
            title: [typed("counter")],
            sub: [typed("%1"), plain(" · t1")],
            side: "2m",
            second: null,
          },
        ],
      },
    ]);
    // Enter on a row focuses the tile it runs in.
    expect(list.tiles.get("t1/%1")).toBe("t1");
    expect(list.tiles.get("t2/ended")).toBe("t2");
  });

  it("leaves out a section with no rows, and counts nothing when nothing runs", () => {
    // This tile runs nothing: the list opens on Other tiles, and the count is theirs.
    const desk: Open = { ...lined, jobs: { t1: { running: [job(1, "counter", 0)], ended: null } } };
    const others = jobsList(desk, 1000);
    expect(others.count).toBe(1);
    expect(others.sections.map((s) => [s.id, s.rows.length])).toEqual([["others", 1]]);
    // Only an end: the row shows, and the head has no count.
    const ends = jobsList({ ...lined, jobs: { t2: { running: [], ended: ended() } } }, 120_000);
    expect(ends.count).toBeNull();
    expect(ends.sections.map((s) => s.id)).toEqual(["ended"]);
    // Nothing at all: no section, so the menu shows its calm line under a bare `Jobs`.
    expect(jobsList({ ...lined, jobs: {} }, 0)).toEqual({
      sections: [],
      tiles: new Map(),
      count: null,
    });
  });

  it("says how long ago an end was in the bottom line's calm form", () => {
    expect(agoWord(400)).toBe("just now");
    expect(agoWord(14_000)).toBe("14s ago");
    expect(agoWord(134_000)).toBe("2m ago");
  });

  it("opens and closes the jobs list as a menu, by its key", () => {
    const open = frameUpdate(FRAME, { type: "show", what: "jobs" });
    expect(open.over).toEqual({ kind: "jobs" });
    expect(frameUpdate(open, { type: "show", what: "jobs" }).over).toEqual({ kind: "none" });
    expect(commandsOf(defaults, 1).find((c) => c.name === "jobs")?.key).toBe("C-b J");
  });
});

describe("the bar's mark and name", () => {
  const name = { left: 500, right: 560 };

  it("keeps the middle with room either side", () => {
    expect(middleFree(name, [{ left: 0, right: 476 }])).toBe(true);
    expect(middleFree(name, [{ left: 584, right: 700 }])).toBe(true);
    expect(middleFree(name, [])).toBe(true);
  });

  it("goes when the bar's words come within 24 of it", () => {
    expect(middleFree(name, [{ left: 0, right: 477 }])).toBe(false);
    expect(middleFree(name, [{ left: 583, right: 700 }])).toBe(false);
  });

  it("goes when anything lies over it or across it", () => {
    expect(middleFree(name, [{ left: 510, right: 550 }])).toBe(false);
    expect(middleFree(name, [{ left: 0, right: 900 }])).toBe(false);
  });

  it("goes if one item of many is too near", () => {
    expect(
      middleFree(name, [
        { left: 0, right: 100 },
        { left: 570, right: 600 },
      ]),
    ).toBe(false);
  });
});

describe("the frame's own state", () => {
  it("opens and closes the asks list as a menu, and the palette with its query", () => {
    const open = frameUpdate(FRAME, { type: "show", what: "asks" });
    expect(open.over).toEqual({ kind: "asks" });
    expect(frameUpdate(open, { type: "show", what: "asks" }).over).toEqual({ kind: "none" });
    const palette = frameUpdate(FRAME, { type: "palette" });
    const typed = frameUpdate(palette, { type: "query", query: "zo" });
    expect(typed.over).toEqual({ kind: "palette", title: "commands", query: "zo", at: 0 });
    expect(frameUpdate(typed, { type: "move", by: -1, of: 3 }).over).toMatchObject({ at: 2 });
  });

  it("opens one thing at a time: the next one takes the place of the last", () => {
    const asks = frameUpdate(FRAME, { type: "show", what: "asks" });
    expect(frameUpdate(asks, { type: "palette" }).over.kind).toBe("palette");
    expect(frameUpdate(asks, { type: "item", what: "host" }).over).toEqual({
      kind: "item",
      what: "host",
    });
    expect(frameUpdate(asks, { type: "show", what: "keys" }).over).toMatchObject({ title: "keys" });
    const palette = frameUpdate(FRAME, { type: "palette" });
    expect(frameUpdate(palette, { type: "show", what: "asks" }).over).toEqual({ kind: "asks" });
    expect(frameUpdate(asks, { type: "close" }).over).toEqual({ kind: "none" });
  });

  it("closes and says why when an ask has nowhere to open", () => {
    const said = frameUpdate(frameUpdate(FRAME, { type: "show", what: "asks" }), {
      type: "say",
      note: nowhereNote(8),
    });
    expect(said.over).toEqual({ kind: "none" });
    expect(said.note).toBe("no tile shows #8 · the tracker opens it");
  });

  it("says the key for next time after the palette ran a command", () => {
    const ran = frameUpdate(frameUpdate(FRAME, { type: "palette" }), { type: "ran", key: "C-b z" });
    expect(ran.over).toEqual({ kind: "none" });
    expect(ran.note).toBe("next time: C-b z");
    expect(frameUpdate(ran, { type: "unnote" }).note).toBeNull();
  });

  it("explains only in info mode, and hides both bars and back", () => {
    expect(frameUpdate(FRAME, { type: "explain", text: "x" })).toBe(FRAME);
    const info = frameUpdate(FRAME, { type: "info", focus: null });
    expect(frameUpdate(info, { type: "explain", text: "x" }).info).toEqual({
      kind: "on",
      explained: "x",
    });
    const bare = frameUpdate(FRAME, { type: "show", what: "bars" });
    expect(bare.bare).toBe(true);
    expect(frameUpdate(bare, { type: "show", what: "bars" }).bare).toBe(false);
  });

  it("opens an item's lines by its key or a click, and the same again closes them", () => {
    const agents = frameUpdate(FRAME, { type: "show", what: "agents" });
    expect(agents.over).toEqual({ kind: "item", what: "agents" });
    const host = frameUpdate(agents, { type: "item", what: "host" });
    expect(host.over).toEqual({ kind: "item", what: "host" });
    expect(frameUpdate(host, { type: "show", what: "host" }).over).toEqual({ kind: "none" });
    expect(frameUpdate(FRAME, { type: "show", what: "sync" }).over).toEqual({
      kind: "item",
      what: "sync",
    });
  });
});

// Today's info mode (C-b i) by the modes guidelines (docs/direction/modes.md, M2 to M4): one value
// for its state, seen with the bars hidden, told to a screen reader, explained from the keyboard,
// and left with Escape.
describe("info mode", () => {
  const quiet = { armed: false, asking: false };
  /** C-b i, or a click on its item, with nothing in focus that has words. */
  const toggle: FrameMsg = { type: "info", focus: null };
  const escape: FrameMsg = { type: "escape", desk: quiet };
  // Built as values, not stepped to, so what is drawn is checked apart from how it is reached.
  const on: Frame = { ...FRAME, info: { kind: "on", explained: null } };
  const off: Frame = { ...FRAME, info: { kind: "off" } };
  const explaining = (text: string): Frame => ({ ...FRAME, info: { kind: "on", explained: text } });
  const bare = frameUpdate(FRAME, { type: "show", what: "bars" });
  const bareOn: Frame = { ...bare, info: { kind: "on", explained: null } };
  const noop = () => {};
  const props = (frame: Frame): FrameProps => ({
    desk: fold([]),
    frame,
    asks: null,
    host: null,
    link: { kind: "up" },
    attachedOnce: true,
    keys: defaults,
    shapes: SHAPES,
    tickets: SHOWN,
    armed: false,
    toHost: noop,
    toApp: noop,
    toRun: noop,
    step: noop,
  });
  /** The words a markup shows, its tags dropped. */
  const words = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const line = (frame: Frame) => renderToStaticMarkup(createElement(BottomLine, props(frame)));
  const agentsPanel = (summoned: NonNullable<HostNow["summoned"]>) =>
    renderToStaticMarkup(
      createElement(Over, {
        ...props({ ...FRAME, over: { kind: "item", what: "agents" } }),
        host: { pid: 4242, since: 0, build: null, ledger: { kind: "own" }, agents: [], summoned },
      }),
    );

  it("shows no summoned section when no agent is summoned", () => {
    const html = agentsPanel([]);
    expect(words(html)).toContain("No agent is attached");
    expect(words(html)).not.toContain("summoned here");
  });

  it("shows a summoned agent's model and effort, and the icon for its state", () => {
    const html = agentsPanel([
      { name: "scout", agent: "fake", model: "fake-large", effort: "high", state: "idle", since: 0 },
      { name: "researcher", agent: "claude", model: null, effort: null, state: "down", since: 0 },
    ]);
    expect(words(html)).toContain("fake · fake-large · high · idle");
    expect(words(html)).toContain("claude · down");
    expect(html.match(/class="ic ic-running"/g)).toHaveLength(1);
    expect(html.match(/class="ic ic-stuck"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Dismiss scout"');
  });
  /** The words of one side of the bottom line: `left` or `right`. */
  const side = (frame: Frame, which: "left" | "right") => {
    const html = line(frame);
    const at = html.indexOf(`<div class="${which}">`);
    expect(at).toBeGreaterThanOrEqual(0);
    const rest = html.slice(at);
    return words(which === "left" ? rest.slice(0, rest.indexOf('<div class="right">')) : rest);
  };
  /** The bottom line's info item: the button it draws, its attributes and its name. */
  const infoItem = (frame: Frame) => {
    const items = [...line(frame).matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)]
      .map((m) => ({ attrs: m[1] ?? "", name: words(m[2] ?? "") }))
      .filter((b) => /\binfo( off)?$/.test(b.name));
    expect(items).toHaveLength(1);
    const [item] = items;

    if (item === undefined) {
      throw new Error("no info item");
    }

    return item;
  };
  /**
   * The bottom line's items as it builds them, with what each is given: its name, whether its
   * tooltip is kept quiet, and its click. Markup drops a click and a tooltip that has not shown yet,
   * so the line is read as elements, inside a render so its hooks run.
   */
  const itemsOf = (frame: Frame, step: FrameProps["step"] = noop) => {
    const items: { readonly name: unknown; readonly quiet: unknown; readonly onClick: unknown }[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const kid of node) {
          walk(kid);
        }

        return;
      }

      if (!isValidElement(node)) {
        return;
      }

      const given = node.props;

      if (typeof given !== "object" || given === null) {
        return;
      }

      if ("name" in given && "quiet" in given && "onClick" in given) {
        items.push({ name: given.name, quiet: given.quiet, onClick: given.onClick });
      }

      if ("children" in given) {
        walk(given.children);
      }
    };
    function Read(): ReactNode {
      const line = BottomLine({ ...props(frame), step });
      walk(line);
      return line;
    }
    renderToStaticMarkup(createElement(Read));
    expect(items.map((i) => i.name)).toEqual(["info", "keys"]);
    return items;
  };
  /** What the window's one status region says. It is drawn whatever the bars, so it is never gone. */
  const said = (frame: Frame) => {
    const html = renderToStaticMarkup(createElement(ModeStatus, props(frame)));
    expect(html).toContain('role="status"');
    return words(html);
  };

  it("says a refused keys file's line on the bottom line, and the prefix line by your keys (p8, p10)", () => {
    const bad = {
      ...defaults,
      file: { _tag: "refused", line: 2, why: "tezgah.zom is not a command" },
    } as const satisfies Keys;
    const html = renderToStaticMarkup(createElement(BottomLine, { ...props(FRAME), keys: bad }));
    expect(words(html)).toContain("keybindings.toml line 2: tezgah.zom is not a command");
    expect(words(line(FRAME))).not.toContain("keybindings.toml");
    const moved = table('tezgah.zoom = "<prefix>m"');
    const armed = renderToStaticMarkup(createElement(BottomLine, { ...props(FRAME), keys: moved, armed: true }));
    expect(words(armed)).toContain("m zoom");
    expect(words(armed)).not.toContain("z zoom");
  });

  it("keeps the bottom line with the bars hidden while it is on, as the armed prefix does", () => {
    expect(bottomLineShows(FRAME, quiet)).toBe(true);
    expect(bottomLineShows(bare, quiet)).toBe(false);
    expect(bottomLineShows(bare, { armed: true, asking: false })).toBe(true);
    expect(bottomLineShows(bare, { armed: false, asking: true })).toBe(true);
    expect(bottomLineShows(frameUpdate(bare, { type: "say", note: "x" }), quiet)).toBe(true);
    expect(bottomLineShows(bareOn, quiet)).toBe(true);
    expect(bottomLineShows({ ...bare, info: { kind: "off" } }, quiet)).toBe(false);
    expect(bottomLineShows(frameUpdate(bare, toggle), quiet)).toBe(true);
  });

  it("tells a screen reader when it turns on and off, and nothing on each hover", () => {
    expect(said(FRAME)).toBe("");
    expect(said(on)).toBe("Info mode on. Escape leaves.");
    expect(said(explaining(INFO.asks))).toBe("Info mode on. Escape leaves.");
    expect(said(off)).toBe("Info mode off.");
    expect(said(frameUpdate(on, { type: "explain", text: INFO.asks }))).toBe("Info mode on. Escape leaves.");
    expect(said(frameUpdate(on, toggle))).toBe("Info mode off.");
  });

  // The hint promises only what works: Tab cannot reach most parts it explains (the tiles' title
  // bars, the pipes, the empty stretch), so it does not say "tab to it".
  it("hints at pointing, and promises no Tab it cannot keep", () => {
    expect(side(on, "left")).toBe("INFO · point at anything");
  });

  // What keyboard focus is on is explained the moment info mode comes on, not only once focus moves.
  it("explains what has focus at once when it turns on", () => {
    expect(frameUpdate(FRAME, { type: "info", focus: INFO.keys }).info).toEqual({
      kind: "on",
      explained: INFO.keys,
    });
    expect(frameUpdate(FRAME, toggle).info).toEqual({ kind: "on", explained: null });
    const left = frameUpdate(explaining(INFO.keys), { type: "info", focus: INFO.keys });
    expect(left.info).toEqual({ kind: "off" });
    expect(frameUpdate(left, { type: "info", focus: INFO.here }).info).toEqual({
      kind: "on",
      explained: INFO.here,
    });
    expect(side(frameUpdate(FRAME, { type: "info", focus: INFO.keys }), "left")).toBe(`INFO · ${INFO.keys}`);
  });

  it("leaves on Escape, once what lies over the desk has closed, and says so", () => {
    const left = frameUpdate(on, escape);
    expect(left.info).toEqual({ kind: "off" });
    expect(said(left)).toBe("Info mode off.");
    expect(frameUpdate(explaining(INFO.keys), escape).info).toEqual({ kind: "off" });
    const closed = frameUpdate(frameUpdate(on, { type: "show", what: "asks" }), escape);
    expect(closed.over).toEqual({ kind: "none" });
    expect(closed.info).toEqual({ kind: "on", explained: null });
    expect(frameUpdate(closed, escape).info).toEqual({ kind: "off" });
    // No mode and nothing over the desk: Escape is not the frame's, and goes on to the tile.
    expect(frameUpdate(FRAME, escape)).toBe(FRAME);
    expect(frameUpdate(off, escape)).toBe(off);
    expect(side(on, "right")).toMatch(/^esc leaves · /);
  });

  // At 1024 wide the explanation was cut off: the right side never shrinks (`flex: none`), so the
  // left gave way. The left wraps instead (window.css, checked at 1024 by 700 in e2e.ts), and the
  // right side keeps its items: hiding one under the pointer would explain it away, and a focused
  // one would drop focus.
  it("keeps the right side's items while something is explained", () => {
    const right = side(on, "right");
    expect(right).toMatch(/^esc leaves · .* info · .* keys$/);
    expect(side(explaining(INFO.info), "right")).toBe(right);
    expect(side(explaining(INFO.keys), "right")).toBe(right);
    expect(side(FRAME, "right")).not.toContain("esc leaves");
    expect(side(off, "right")).not.toContain("esc leaves");
  });

  // The right side is pinned to the window's right edge, so a word added after the items would push
  // them left: the info item would jump as the mode comes on, and a second click there would land
  // on keys. The way out goes first, so the items stay put (checked in pixels in e2e.ts).
  it("puts the way out first on the right while it is on, so the items after it stay put", () => {
    const right = (frame: Frame) => {
      const html = line(frame);
      return html.slice(html.indexOf('<div class="right">') + '<div class="right">'.length);
    };
    expect(right(on)).toMatch(/^<span class="quiet">esc leaves<\/span>/);
    expect(right(explaining(INFO.keys))).toMatch(/^<span class="quiet">esc leaves<\/span>/);
    // The items' own words end the line the same, on or off.
    const items = side(FRAME, "right");
    expect(side(on, "right").endsWith(items)).toBe(true);
    expect(side(off, "right")).toBe(items);
  });

  // The ARIA APG's toggle button: a name that stays, and `aria-pressed` for the state. A name that
  // flips to "info off" says the state twice, and a screen reader hears a new button.
  it("keeps its item's name and says on or off with aria-pressed", () => {
    const never = infoItem(FRAME);
    expect(never.name).toMatch(/ info$/);
    expect(infoItem(on).name).toBe(never.name);
    expect(infoItem(off).name).toBe(never.name);
    expect(never.attrs).toContain('aria-pressed="false"');
    expect(infoItem(on).attrs).toContain('aria-pressed="true"');
    expect(infoItem(off).attrs).toContain('aria-pressed="false"');
  });

  // While info mode is on, the bottom line explains the item, so its tooltip would say it twice
  // (pop.tsx, useTip: a quiet tooltip never shows). Off, with nothing over the desk, it shows.
  it("keeps every item's tooltip quiet while it is on, and only then", () => {
    expect(itemsOf(on).map((i) => i.quiet)).toEqual([true, true]);
    expect(itemsOf(explaining(INFO.keys)).map((i) => i.quiet)).toEqual([true, true]);
    expect(itemsOf(FRAME).map((i) => i.quiet)).toEqual([false, false]);
    expect(itemsOf(off).map((i) => i.quiet)).toEqual([false, false]);
  });

  it("says where focus is on the left while it is off, and INFO only while it is on", () => {
    const here = hereWord(fold([]), SHAPES, SHOWN);

    for (const frame of [FRAME, off]) {
      expect(line(frame)).not.toContain('class="info"');
      expect(line(frame)).toContain('class="here"');
      expect(side(frame, "left")).toBe(here);
    }

    expect(line(on)).toContain('class="info"');
    expect(line(on)).not.toContain('class="here"');
  });

  // A click on the item is pointed at it, so the item is what info mode explains first.
  it("turns on from its item's click, explaining the item", () => {
    const stepped: FrameMsg[] = [];
    const [info] = itemsOf(FRAME, (m) => stepped.push(m));

    if (typeof info?.onClick !== "function") {
      throw new Error("the info item has no click");
    }

    info.onClick();
    expect(stepped).toEqual([{ type: "info", focus: INFO.info }]);
  });

  it("K17: the keys button names its dialog and opens it on a click", () => {
    const html = line(FRAME);
    const button = /<button[^>]*data-item="keys"[^>]*>/.exec(html)?.[0];
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-controls="pop-palette"');
    const stepped: FrameMsg[] = [];
    const key = itemsOf(FRAME, (m) => stepped.push(m))[1];

    if (typeof key?.onClick !== "function") {
      throw new Error("keys has no click handler");
    }

    key.onClick();
    expect(stepped).toEqual([{ type: "show", what: "keys" }]);
  });

  // M2: the mode is one value. Never on, on with what it explains, or off after it was on: an
  // explanation with the mode off, or "left" while it is on, cannot be built.
  it("keeps its state in one value, so the impossible mixes cannot be built", () => {
    expect(FRAME.info).toEqual({ kind: "never" });
    expect(Object.keys(FRAME).sort()).toEqual(["bare", "info", "note", "over"]);
    const modes: readonly InfoMode[] = [
      { kind: "never" },
      { kind: "on", explained: null },
      { kind: "on", explained: INFO.keys },
      { kind: "off" },
    ];
    expect(modes.map((m) => m.kind)).toEqual(["never", "on", "on", "off"]);
    // @ts-expect-error off explains nothing
    const offExplains: InfoMode = { kind: "off", explained: INFO.keys };
    // @ts-expect-error before it ever came on, it explains nothing
    const neverExplains: InfoMode = { kind: "never", explained: null };
    // @ts-expect-error on says what it explains, if only null
    const onSaysNothing: InfoMode = { kind: "on" };
    // @ts-expect-error no explanation beside the mode
    const beside: Frame = { ...FRAME, explained: null };
    // @ts-expect-error no "left once" flag beside the mode: `off` is that
    const leftFlag: Frame = { ...FRAME, leftInfo: true };
    // @ts-expect-error info mode comes on only with what focus explains: C-b i is no plain show
    const plainShow: FrameMsg = { type: "show", what: "info" };
    expect([offExplains, neverExplains, onSaysNothing, beside, leftFlag, plainShow]).toHaveLength(6);
  });

  // Escape is one key with three owners. What lies over the desk closes first; then, while the
  // desk is mid-key, the desk cancels its prefix or its question; only then does info mode go.
  // The same frame back means the frame did not take it, and the key goes on.
  it("lets the desk cancel its prefix or its question with Escape before info mode goes", () => {
    const asks = frameUpdate(on, { type: "show", what: "asks" });

    for (const desk of [
      { armed: true, asking: false },
      { armed: false, asking: true },
    ]) {
      expect(frameUpdate(on, { type: "escape", desk })).toBe(on);
      const closed = frameUpdate(asks, { type: "escape", desk });
      expect(closed.over).toEqual({ kind: "none" });
      expect(closed.info).toEqual({ kind: "on", explained: null });
    }
  });

  it("explains on keyboard focus wherever it explains on the pointer (WCAG 2.1.1)", () => {
    expect(EXPLAIN_ON).toEqual(["pointerover", "focusin"]);
  });

  /** A desk asking its own question: Ctrl-B x on t1. */
  const asking = fold([
    { type: "key", key: "<c-b>", at: 0 },
    { type: "key", key: "x", at: 1 },
  ]);
  /**
   * The desk's bottom area as drawn: whether its bottom line shows, and what its one status region
   * says. The region is checked to be there, and outside the bottom line, in every case.
   */
  const area = (frame: Frame, over: Partial<FrameProps> & { readonly instead?: boolean } = {}) => {
    const html = renderToStaticMarkup(createElement(BottomArea, { ...props(frame), instead: false, ...over }));
    const line = /<footer class="bottomline">[\s\S]*<\/footer>/.exec(html)?.[0] ?? null;
    expect(line ?? "").not.toContain('role="status"');
    const rest = line === null ? html : html.replace(line, "");
    const status = [...rest.matchAll(/<(\w+)[^>]*role="status"[^>]*>([\s\S]*?)<\/\1>/g)];
    expect(status).toHaveLength(1);
    return { line: line !== null, said: words(status[0]?.[2] ?? "") };
  };

  it("draws its status region apart from the bottom line, whatever the bars and the link", () => {
    expect(area(FRAME)).toEqual({ line: true, said: "" });
    expect(area(on)).toEqual({ line: true, said: "Info mode on. Escape leaves." });
    expect(area(bare)).toEqual({ line: false, said: "" });
    expect(area(bareOn)).toEqual({ line: true, said: "Info mode on. Escape leaves." });
    // The bars hidden and info mode just left: the bottom line goes, and "off" is still heard.
    expect(area(frameUpdate(bareOn, toggle))).toEqual({
      line: false,
      said: "Info mode off.",
    });
    expect(area(bare, { armed: true }).line).toBe(true);
    expect(area(bare, { desk: asking }).line).toBe(true);
    // A page in place of the desk (another link version): no bottom line, the region still there.
    expect(area(on, { instead: true })).toEqual({ line: false, said: "Info mode on. Escape leaves." });
  });
});

// Round 2b, PR 373 (p10): info mode names the keys of the table in use, so none is a literal in
// frame.ts. `infoFor(keys)` is a made-up name for INFO built from the table; rename it freely.

describe("info mode's words, from the keys file (p10)", () => {
  /** The parts of the frame whose words name a key. */
  const NAMING = ["workspace", "keys", "info", "titlebar"] as const;

  it("K17: an unbound keys command points to its tsh word", () => {
    expect(infoFor(table("keys.open = []")).keys).toContain("keys in tsh lists them all");
  });

  it("names your prefix, and never Ctrl-B, once the prefix is ctrl+a", () => {
    const said = infoFor(table('prefix = "ctrl+a"'));

    for (const part of NAMING) {
      expect(said[part], part).toContain(keyWord("<c-a>"));
      expect(said[part], part).not.toContain(keyWord(PREFIX));
      expect(said[part], part).not.toContain("Ctrl-B");
    }
  });

  it("names your palette key, and never Cmd-K, once the palette is on cmd+p", () => {
    const said = infoFor(table('palette.open = "cmd+p"'));
    expect(said.keys).toContain(keyWord("<m-p>"));
    expect(said.keys).not.toContain("Cmd-K");
    expect(said.keys).not.toContain(keyWord("<m-k>"));
  });

  it("names a moved command on its new key: info mode and fold", () => {
    const said = infoFor(table('tezgah.info = "<prefix>o"', 'tezgah.fold = "<prefix>g"'));
    expect(said.info).toContain(`${keyWord(PREFIX)} o`);
    expect(said.info).not.toContain(`${keyWord(PREFIX)} i`);
    expect(said.titlebar).toContain(`${keyWord(PREFIX)} g`);
    expect(said.titlebar).not.toContain(`${keyWord(PREFIX)} f`);
  });

  it("says each part in words with the defaults, as today's info mode does", () => {
    const said = infoFor(defaults);

    for (const part of NAMING) {
      expect(said[part], part).toContain(keyWord(PREFIX));
    }

    expect(Object.values(said).every((text) => text.length > 0)).toBe(true);
  });
});

it("focus follows a zoom: zooming or unzooming the focused tile is a change that moves focus", () => {
  const split = fold([{ type: "typed", tile: "t1", does: { kind: "split", orientation: "vertical" } }]);
  const zoomed = fold([
    { type: "typed", tile: "t1", does: { kind: "split", orientation: "vertical" } },
    { type: "typed", tile: "t2", does: { kind: "zoom" } },
  ]);
  const back = fold([
    { type: "typed", tile: "t1", does: { kind: "split", orientation: "vertical" } },
    { type: "typed", tile: "t2", does: { kind: "zoom" } },
    { type: "typed", tile: "t2", does: { kind: "zoom" } },
  ]);
  expect(activeOf(zoomed).layout.zoomed).toBe("t2");
  expect(focusFollows(zoomed)).not.toBe(focusFollows(split));
  expect(focusFollows(back)).toBe(focusFollows(split));
  expect(focusFollows(null)).toBe("");
});
