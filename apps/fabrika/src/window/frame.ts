import { writerOf } from "@kampus/fabrika-old";
import { TicketNumber } from "@kampus/pipeline/tickets/ticket";
import { whenOf } from "@tea-fabrika/tracker/window";
import { Option, Schema } from "effect";
import type { Ask, AsksNow } from "../asks.ts";
import { activeOf, focusedOf, type Open, questionOf, tilesOf, type Workspace } from "../desk/desk.ts";
import { bindingFor, defaults, type Does, type File, type Key, type Keys } from "../desk/keymap.ts";
import { type Group, groupOf, type Show, wordOf } from "../desk/keys.ts";
import type { TileId, TileNode } from "../desk/layout/index.ts";
import type { HostNow, LedgerLink, LinkNow, ToWindow } from "../messages.ts";
import type { JobEnded, TileJobs } from "../tile-jobs.ts";
import { type Cap, capOf, capsOf, type Icon, type Piece, type Row, type Section, sentence } from "./pop.ts";

// The window's frame, in words: what the top bar, the bottom line, the asks list and the palette
// say, worked out from what the host sent (the desk, the keys, the programs, the asks) and what
// the app said of the link. Plain data, no React, so each word is tested (frame.test.ts); the
// page draws it (frame.tsx).
//
//   top      1 #7  2 tsh   tracker | ticket | trace                   2 ask you • · 1 agent · ✓
//   at rest  1 #7  2 tsh   tracker | ticket | trace                                         ✓
//   bottom   t2 ticket #7 · takes ticket · sends ticket · from tracker → trace       C-b ? keys
//   a job    t1 tsh · %3 seq --to 9 | tally 2m +1                                  C-b ? keys
//   Ctrl-B   PREFIX · N new · x close · z zoom · f fold · | split · ? keys        esc cancels
//   Ctrl-B x close t2? (y/n)                                                 y closes · n keeps it
//   C-b i    INFO · point at anything                           C-b i info · C-b ? keys · esc leaves
//
// The top bar is the whole desk; the bottom line is the tile you are in and the key you just
// pressed (the frame's research, rule 1). Its job item names the job the tile runs, by the host's
// table: `%3`, its line, how long it has run, and `+1` for each other job there. A job that just
// ended says so for a short while (`done in 4s`), then the item clears; with nothing running it
// says nothing. A click, or C-b J, lists the jobs: a row does not open its job's trace yet (the
// host keeps the record; opening it from here is a change of its own), so it does what tsh's
// `jobs` does. Only "asks you" takes the accent, and only a broken part takes the warning color,
// each with its word (rules 2 and 11). A part that works says nothing: no asks, no agents attached
// and a ledger in sync draw no item at all, each a word only while it matters (`2 ask you`, `1
// agent`, `syncing`, `ledger unreachable`). The one exception is the host's quiet icon while it is
// up: the host runs on your laptop, and its icon is where C-b H and a click land. Each opens a few
// lines under the bar's right end (C-b a, C-b A, C-b S, C-b H, or the tsh words `asks`, `agents`,
// `sync`, `host`), with or without its word. An agent's ask is never on the bottom line: that line
// is yours.
//
// What the page itself keeps (the list open, the palette, the info mode, the bars hidden) is a
// model and an update with no Cmd, Elm's `Browser.sandbox`: `frameUpdate` below. The desk's own
// state stays the host's.
//
// Info mode follows the modes guidelines (docs/direction/modes.md, M2 to M4): its state is one
// value (`InfoMode`); it is said in words on the bottom line, which stays with the bars hidden; one
// status region tells a screen reader it came on or went off, and nothing on each part explained;
// it explains what keyboard focus is on, from the moment it comes on, as well as what the pointer
// is over; and Escape leaves it, once what lies over the desk has closed.

/** What each program takes and sends, by its inputs' and outputs' names (host/serve.ts). */
interface Shape {
  readonly takes: readonly string[];
  readonly sends: readonly string[];
}

export type Shapes = ReadonlyMap<string, Shape>;

/** The ticket a tile's run shows, by the run's id: what the ticket program's view said. */
export type TicketsShown = ReadonlyMap<string, number>;

/** The one field of the ticket program's view the frame reads: the ticket it shows. */
const ShowsTicket = Schema.Struct({ number: Schema.NullOr(TicketNumber) });
const readShowsTicket = Schema.decodeUnknownOption(ShowsTicket);

/** The tickets the runs' views show now, by run: only the ticket program's views say one. */
export const ticketsShown = (views: Iterable<readonly [string, ToWindow]>): TicketsShown => {
  const shown = new Map<string, number>();

  for (const [run, view] of views) {
    if (view.program !== "ticket") {
      continue;
    }

    const read = readShowsTicket(view.data);

    if (Option.isSome(read) && read.value.number !== null) {
      shown.set(run, read.value.number);
    }
  }

  return shown;
};

// ---------------------------------------------------------------- the keys, in words

/** A key as the frame writes it: `C-h`, `←`, `Space`, or the character. */
export const keyWord = (key: string): string => {
  const arrows: Record<string, string> = {
    "<arrowleft>": "←",
    "<arrowright>": "→",
    "<arrowup>": "↑",
    "<arrowdown>": "↓",
  };
  const arrow = arrows[key];

  if (arrow !== undefined) {
    return arrow;
  }

  if (key === " ") {
    return "Space";
  }

  const mod = /^<((?:[casm]-)*)(.+)>$/.exec(key);

  if (mod === null) {
    return key;
  }

  return `${(mod[1] ?? "").toUpperCase()}${mod[2]}`;
};

/** A binding's whole key, as pressed: the prefix, then its own key. */
const bindingWord = (prefix: string, key: string): string => `${keyWord(prefix)} ${keyWord(key)}`;

/**
 * The commands the bottom line shows after the prefix, the ones used most and then `?` for all of
 * them: by command, so a command you moved shows on its new key, and one you unbound not at all.
 */
const SHOWN_AFTER_PREFIX: readonly Does[] = [
  'tezgah."workspace --to new"',
  "tezgah.close",
  "tezgah.zoom",
  "tezgah.fold",
  "tezgah.split",
  "keys.open",
];

/** The bottom line while the prefix is down: each of the commands used most, on its first key after it. */
export const prefixLine = (keys: Keys): readonly { key: string; name: string }[] =>
  SHOWN_AFTER_PREFIX.flatMap((does) => {
    const name = bindingFor(does)?.name;
    const key = keys.rows.find((row) => row.does === does)?.keys.find((k) => k._tag === "after_prefix");
    return name === undefined || key === undefined ? [] : [{ key: keyWord(key.key), name }];
  });

/** The palette's groups, in the order it shows them (desk/keys.ts, `groupOf`). */
const GROUPS: readonly Group[] = ["tile", "focus", "workspace", "window"];

/** One command of the palette: its name, its group, its key, its tsh word, and its file word. */
export interface Command {
  readonly name: string;
  readonly group: Group;
  /**
   * As the bottom line writes it, after the palette ran it: `C-b z`, or `M-d` pressed alone. A
   * command no key runs says its tsh word instead: `zoom in tsh`.
   */
  readonly key: string;
  /** As keycaps, in the palette: `⌃B` `Z`, or `⌘D`. None for a command no key runs. */
  readonly caps: readonly Cap[];
  /** What to type in a tile's tsh for the same: `zoom`, `split --to down`. */
  readonly tsh: string;
  /** The command's word in the keys file: the palette runs it by this, bound to a key or not. */
  readonly runs: Does;
}

/** A key of the table as the frame writes it, after the prefix or alone. */
const keyText = (prefix: string, key: Key): string =>
  key._tag === "after_prefix" ? bindingWord(prefix, key.key) : keyWord(key.key);

/** A key of the table as keycaps, after the prefix or alone. */
const keyCaps = (prefix: string, key: Key): readonly Cap[] =>
  key._tag === "after_prefix" ? capsOf(prefix, key.key) : [capOf(key.key)];

/**
 * Every command there is, once each, by the keys file's table, grouped, on its first key: h and
 * the left arrow are one command. A workspace that is not there is not listed. A command no key
 * runs is listed still, as the palette and its tsh word run it. The palette's own is not: it is
 * what is open.
 */
export const commandsOf = (keys: Keys, workspaces: number): readonly Command[] => {
  const all = keys.rows.flatMap((row): Command[] => {
    const binding = bindingFor(row.does);

    if (binding === undefined) {
      return [];
    }

    const at = /^workspace (\d+)$/.exec(binding.name);

    if (at !== null && Number(at[1]) > workspaces) {
      return [];
    }

    const tsh = wordOf(binding.does);
    const [first] = row.keys;
    return [
      {
        name: binding.name,
        group: groupOf(binding.does),
        key: first === undefined ? `${tsh} in tsh` : keyText(keys.prefix, first),
        caps: first === undefined ? [] : keyCaps(keys.prefix, first),
        tsh,
        runs: row.does,
      },
    ];
  });
  return GROUPS.flatMap((g) => all.filter((c) => c.group === g));
};

/**
 * What the frame says of the keys file: nothing while it reads, or there is none; the line to look
 * at and why, while it is refused, as the keys go on as they were.
 */
export const fileWord = (file: File): string | null =>
  file._tag === "refused" ? `keybindings.toml line ${file.line}: ${file.why}` : null;

/** The commands whose name or tsh word holds every word typed, in the table's order. */
export const matching = (commands: readonly Command[], query: string): readonly Command[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) => {
    const spelling = c.key.replace(
      /([CASM])-/g,
      (_, mod: string) => ({ C: "ctrl+", A: "alt+", S: "shift+", M: "cmd+" })[mod] ?? "",
    );
    const text = `${c.name} ${c.tsh} ${c.key} ${c.runs} ${spelling}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
};

// ---------------------------------------------------------------- the top bar

/** The ticket a tile shows, when its run is the ticket program's and the view named one. */
const ticketOn = (tile: TileNode, tickets: TicketsShown): number | undefined =>
  tile.shows.run === null ? undefined : tickets.get(tile.shows.run.id);

/** A tile's program, as the frame names it: `ticket #7`, `tracker`, or `tsh`. */
export const tileWord = (tile: TileNode, tickets: TicketsShown): string => {
  const run = tile.shows.run;

  if (run === null) {
    return "tsh";
  }

  const n = ticketOn(tile, tickets);
  return n === undefined ? run.program : `${run.program} #${n}`;
};

/**
 * A workspace's name, from what it holds: the ticket it shows, `#7`; else the program its line
 * starts with; else `tsh`. No name is made up: the desk has no names of its own yet.
 */
export const workspaceName = (ws: Workspace, tickets: TicketsShown): string => {
  const all = tilesOf(ws);

  for (const tile of all) {
    const n = ticketOn(tile, tickets);

    if (n !== undefined) {
      return `#${n}`;
    }
  }

  const head = all.find((t) => t.shows.kind === "line") ?? all.find((t) => t.shows.run !== null);
  return head?.shows.run?.program ?? "tsh";
};

/** One program of a line, with the tile it is shown in. */
interface Segment {
  readonly program: string;
  readonly tile: TileId;
  readonly focused: boolean;
}

/**
 * The line of the workspace, in its order: the focused tile's line, or the first one in reading
 * order. Empty when the workspace has no line.
 */
export const lineIn = (ws: Workspace): readonly Segment[] => {
  const all = tilesOf(ws);
  const focused = all.find((t) => t.id === ws.focused);
  const shown = (t: TileNode) => (t.shows.kind === "tsh" ? null : t.shows.line.id);
  const id = (focused === undefined ? null : shown(focused)) ?? all.map(shown).find((l) => l !== null);

  if (id === undefined || id === null) {
    return [];
  }

  return all.flatMap((t) =>
    shown(t) === id && t.shows.run !== null
      ? [{ program: t.shows.run.program, tile: t.id, focused: t.id === ws.focused }]
      : [],
  );
};

/**
 * The asks' item: `1 asks you`, `3 ask you`, or `null` when nothing asks you, as the Dock badge
 * shows no `0`. Nothing to answer is not news; C-b a still opens the empty list.
 */
export const asksWord = (n: number): string | null => (n === 0 ? null : `${n} ask${n === 1 ? "s" : ""} you`);

/** A part of the frame that says how a part of the app is, and whether that part is broken. */
interface Said {
  readonly word: string;
  readonly broken: boolean;
}

/**
 * The agents' item: how many agents are at work on this desk now, or `null` when none is: those
 * the person summoned here (tsh's `summon`), and those attached to the host's agents' socket, each
 * driving the app's programs as tools (host/agents.ts). No agent attached is not news, on a host where one could attach or on one
 * with no agents' socket (an older host's); C-b A still opens lines that say which.
 */
export const agentsWord = (host: HostNow): string | null => {
  const n = (host.agents?.length ?? 0) + (host.summoned?.length ?? 0);
  return n === 0 ? null : `${n} agent${n === 1 ? "" : "s"}`;
};

/**
 * Who restarted the host before this one, how long ago and why, for the host's lines (C-b H):
 * `restarted by claude 4s ago: pick up the new build`. An agent goes by its name, as the agents'
 * lines name it; the person at the window is `you`, as the asks say it. The person's own restart,
 * from the window, has no why, and the line ends at the time. A host that started fresh, or one
 * of an older build that says nothing of it: `null`.
 */
export const restartedWord = (host: HostNow, now: number): string | null => {
  const restarted = host.restarted ?? null;

  if (restarted === null) {
    return null;
  }

  const writer = writerOf(restarted.by);
  const who = writer === null ? restarted.by : writer.kind === "agent" ? writer.id : "you";
  const why = restarted.why === null ? "" : `: ${restarted.why}`;
  return `restarted by ${who} ${agoWord(Math.max(0, now - restarted.at))}${why}`;
};

/**
 * The sync item, or `null` while the ledger is in sync. A ledger server's says `syncing` until
 * the first read is in, then nothing: every write goes straight to the server, so none waits
 * here. The home's own file has nothing to sync and says nothing. Either one that failed its last
 * read says `ledger unreachable`, in red. C-b S opens its lines either way.
 */
export const syncWord = (now: AsksNow, ledger: LedgerLink): Said | null => {
  if (now.reach === "failed") {
    return { word: "ledger unreachable", broken: true };
  }

  if (ledger.kind === "own" || now.reach === "ok") {
    return null;
  }

  return { word: "syncing", broken: false };
};

/**
 * The shapes the host's item wears when something is wrong, each its own shape, never color
 * alone: waiting (a dashed ring), needs a look (`!`), down (`x`). None is the up state's ring and
 * check, so a host that is not up never looks up.
 */
type HostShape = Extract<Icon, "later" | "stuck" | "failed">;

/**
 * The host's item. Up, it is a quiet icon and no word: a host that works is not news. Else it is
 * a word, with a shape that says the kind of wrong, red only where it is broken. There is no value
 * for an up host with a word, or a word with the up icon.
 */
type HostItem =
  | { readonly kind: "up" }
  | {
      readonly kind: "word";
      readonly word: string;
      readonly broken: boolean;
      readonly shape: HostShape;
    };

/** A host that is not up, said in a word with its shape. */
const wrong = (word: string, broken: boolean, shape: HostShape): HostItem => ({
  kind: "word",
  word,
  broken,
  shape,
});

/**
 * The host's item, one branch per kind of link: a kind left out does not compile. Only a host
 * down or one that speaks another version is broken. Its lines say what to do.
 */
export const hostWord = (link: LinkNow, attachedOnce: boolean): HostItem => {
  switch (link.kind) {
    case "up":
      return { kind: "up" };
    case "build":
      return wrong("host older", false, "stuck");
    case "version":
      return wrong("host speaks another version", true, "stuck");
    case "reconnecting":
      return attachedOnce ? wrong("host down", true, "failed") : wrong("connecting", false, "later");
    case "stopped":
      return wrong("host down", true, "failed");
    case "restarting":
      return wrong("host restarting", false, "later");
  }
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A time on the local clock: `14:02` on the day of `now`, `Oct 29, 14:02` before it. */
export const clockWord = (at: number, now: number): string => {
  const t = new Date(at);
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return t.toDateString() === new Date(now).toDateString() ? hm : `${MONTHS[t.getMonth()]} ${t.getDate()}, ${hm}`;
};

/** What the host holds now, from the desk it sent: `3 tiles · 1 job running`. */
export const holdsWord = (desk: Open): string => {
  const tiles = desk.workspaces.reduce((n, ws) => n + tilesOf(ws).length, 0);
  const running = Object.values(desk.jobs).reduce((n, j) => n + j.running.length, 0);
  return `${tiles} tile${tiles === 1 ? "" : "s"} · ${running} job${running === 1 ? "" : "s"} running`;
};

// ---------------------------------------------------------------- the bottom line

/** The tile a ticket is shown in, if any: an ask names it, and picking the ask focuses it. */
export const tileOfTicket = (desk: Open, ticket: number, tickets: TicketsShown): TileId | undefined =>
  desk.workspaces
    .flatMap((ws) => tilesOf(ws))
    .find((t) => t.shows.run !== null && tickets.get(t.shows.run.id) === ticket)?.id;

/** The tracker on the desk, to turn to a ticket no tile shows: the active workspace's first, else any. */
const trackerOn = (desk: Open): TileNode | undefined => {
  const isTracker = (t: TileNode) => t.shows.run?.program === "tracker";
  return tilesOf(activeOf(desk)).find(isTracker) ?? desk.workspaces.flatMap((ws) => tilesOf(ws)).find(isTracker);
};

/**
 * Where Enter on an ask goes: the tile that shows its ticket; else the tracker, turned to that
 * ticket's page (its window's own `query`), which the line then carries on; else nowhere, and the
 * bottom line says so. Never a dead key.
 */
type Opens =
  | { readonly kind: "tile"; readonly tile: TileId }
  | { readonly kind: "tracker"; readonly tile: TileId; readonly run: string }
  | { readonly kind: "none" };

export const opensOf = (desk: Open | null, ticket: number, tickets: TicketsShown): Opens => {
  if (desk === null) {
    return { kind: "none" };
  }

  const tile = tileOfTicket(desk, ticket, tickets);

  if (tile !== undefined) {
    return { kind: "tile", tile };
  }

  const tracker = trackerOn(desk);
  const run = tracker?.shows.run;
  return tracker === undefined || run == null ? { kind: "none" } : { kind: "tracker", tile: tracker.id, run: run.id };
};

/** What the bottom line says when Enter on an ask has nowhere to go. */
export const nowhereNote = (ticket: number): string => `no tile shows #${ticket} · the tracker opens it`;

/**
 * One ask as a row: what it asks, in sentence case; its ticket, title and tile under it; its time
 * at the right. `Approve plan` over `#1 Login fails on Safari · t2`, at `11:13`.
 */
const askRowOf = (ask: Ask, tile: TileId | undefined, now: number, later: boolean): Row => ({
  id: ask.key,
  icon: later ? "later" : ask.kind,
  title: sentence(ask.kind === "stuck" ? `stuck: ${ask.what}` : ask.what),
  sub: `#${ask.ticket} ${ask.title}${tile === undefined ? "" : ` · ${tile}`}`,
  side: whenOf(ask.at, now),
  second: later ? { name: "Bring back", cap: "H" } : { name: "Later", cap: "H" },
});

/** The asks list's sections: the live asks, then the ones set aside, under `Later`, which folds. */
export const asksSections = (
  asks: AsksNow,
  desk: Open | null,
  tickets: TicketsShown,
  now: number,
): readonly Section[] => {
  const tileOf = (ticket: number) => (desk === null ? undefined : tileOfTicket(desk, ticket, tickets));
  return [
    {
      id: "asks",
      title: null,
      fold: false,
      rows: asks.asks.map((a) => askRowOf(a, tileOf(a.ticket), now, false)),
    },
    ...(asks.later.length === 0
      ? []
      : [
          {
            id: "later",
            title: "Later",
            fold: true,
            rows: asks.later.map((a) => askRowOf(a, tileOf(a.ticket), now, true)),
          },
        ]),
  ];
};

/**
 * The focused tile, said at the bottom left: its name, what it takes and sends, and its
 * neighbors in its line. `t2 ticket #7 · takes ticket · sends ticket · from tracker → trace`.
 */
export const hereWord = (desk: Open, shapes: Shapes, tickets: TicketsShown): string => {
  const tile = focusedOf(desk);

  if (tile === null) {
    return "";
  }

  const ws = activeOf(desk);
  const parts = [`${tile.id} ${tileWord(tile, tickets)}`];
  const program = tile.shows.run?.program;
  const shape = program === undefined ? undefined : shapes.get(program);

  if (shape !== undefined) {
    parts.push(`takes ${shape.takes.join(", ") || "nothing"}`);
    parts.push(`sends ${shape.sends.join(", ") || "nothing"}`);
  }

  const line = lineIn(ws);
  const at = line.findIndex((s) => s.tile === tile.id);

  if (at !== -1) {
    const [before, after] = [line[at - 1]?.program, line[at + 1]?.program];
    const near = [before === undefined ? "" : `from ${before}`, after === undefined ? "" : `→ ${after}`];
    const said = near.filter(Boolean).join(" ");

    if (said !== "") {
      parts.push(said);
    }
  }

  if (ws.layout.zoomed === tile.id) {
    parts.push("zoomed");
  }

  return parts.join(" · ");
};

// ---------------------------------------------------------------- the job item

/**
 * How long, said calmly: `14s` under a minute, `2m` under an hour, then `1h 5m`. Seconds only
 * while they are most of it, so the line ticks each second for the first minute, then once a
 * minute: Ghostty writes durations as `1h30m` and `45s`, and tmux shows none at all, so nothing
 * ticks seconds on a job that has run for an hour.
 */
export const tookWord = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));

  if (s < 60) {
    return `${s}s`;
  }

  const m = Math.floor(s / 60);

  if (m < 60) {
    return `${m}m`;
  }

  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
};

/** How long an ended job stays on the bottom line, in ms: a short while, then it clears. */
export const ENDED_SHOWN_MS = 5000;

/**
 * A job in the foreground that ran less than this, in ms, ended under the person's eyes: tsh
 * printed how in the tile, so the bottom line says nothing of it. Ghostty's and kitty's "command
 * finished" notices wait for the same 5 seconds.
 */
const QUICK_MS = 5000;

/**
 * How a job's end reads: `done in 14s`, `failed after 2m`, `stopped after 1h 5m`, and
 * `failed at once` for one that ended within its first second, where `after 0s` reads oddly.
 */
const endWord = (ended: JobEnded): string => {
  const ms = ended.at - ended.since;

  if (ms < 1000) {
    return `${ended.how} at once`;
  }

  const took = tookWord(ms);
  return ended.how === "done" ? `done in ${took}` : `${ended.how} after ${took}`;
};

/**
 * How long ago something ended, in the same calm form as `tookWord`: `14s ago`, `2m ago`. Under
 * a second it is `just now`, where `0s ago` reads oddly.
 */
export const agoWord = (ms: number): string => (ms < 1000 ? "just now" : `${tookWord(ms)} ago`);

/** Is this end still news at `now`: said a short while after, and only when it was not seen happen. */
const fresh = (ended: JobEnded | null, now: number): ended is JobEnded =>
  ended !== null && now - ended.at < ENDED_SHOWN_MS && (!ended.foreground || ended.at - ended.since >= QUICK_MS);

/** The job the bottom line names: its `%n` and line, how long or how it ended, and how many more run. */
export interface JobItem {
  readonly n: number;
  readonly text: string;
  /** `2m` while it runs; `done in 2m` once it ended. */
  readonly said: string;
  readonly ended: boolean;
  /** The tile's other jobs that run: `+2`. */
  readonly more: number;
}

/**
 * The focused tile's job item at `now`: a job that just ended, for a short while; else the job tsh
 * waits for, as tmux's status line names a pane's foreground command; else the newest, as bash's
 * current job `%+`. `null` when nothing runs and nothing just ended: the line says nothing.
 */
export const jobItem = (jobs: TileJobs | undefined, now: number): JobItem | null => {
  if (jobs === undefined) {
    return null;
  }

  const { running, ended } = jobs;

  if (fresh(ended, now)) {
    return { n: ended.n, text: ended.text, said: endWord(ended), ended: true, more: running.length };
  }

  const shown = running.findLast((j) => j.foreground) ?? running.at(-1);

  if (shown === undefined) {
    return null;
  }

  return {
    n: shown.n,
    text: shown.text,
    said: tookWord(now - shown.since),
    ended: false,
    more: running.length - 1,
  };
};

/** A job's `%n` and its tile, as a row's muted line says them: `%3 · t2`, the `%3` typed. */
const whereOf = (n: number, tile: TileId, more = ""): readonly Piece[] => [
  { text: `%${n}`, typed: true },
  { text: ` · ${tile}${more}`, typed: false },
];

/** A running job as a row: its line as typed, `%n` and its tile under it, how long at the right. */
const runningRow = (tile: TileId, job: TileJobs["running"][number], now: number): Row => ({
  id: `${tile}/%${job.n}`,
  icon: "running",
  title: [{ text: job.text, typed: true }],
  sub: whereOf(job.n, tile),
  side: tookWord(now - job.since),
  second: null,
});

/** The jobs list: its sections, the tile each row's Enter focuses, and the count at its head. */
interface JobsList {
  readonly sections: readonly Section[];
  readonly tiles: ReadonlyMap<string, TileId>;
  /**
   * The running jobs the list shows, on the whole desk: `Jobs 3`. `null` when none runs, so the
   * head says only `Jobs` over its calm line, never `Jobs 0`.
   */
  readonly count: number | null;
}

/**
 * The jobs list, as tsh's `jobs` lists the host's table: the focused tile's jobs, the one the
 * bottom line names first; then its last to end, however long ago, so the list still says it once
 * the bottom line has cleared; then each other tile's, by tile. Enter on a row focuses its tile.
 * The right side is always time from now: how long a job has run, or how long ago it ended.
 *
 *   Jobs 3
 *   ◐ sleep --ms 9000                 2m
 *     %5 · t2
 *   Last ended
 *   ✓ seq --to 9 | tally          1m ago
 *     %3 · t2 · done in 1m
 *   Other tiles
 *   ◐ counter                         2m
 *     %1 · t1
 *
 * A section with no rows is left out, this tile's own too: when only other tiles run something,
 * the list opens on `Other tiles`, which already says this one runs nothing. With no row at all,
 * the menu shows its calm line instead.
 */
export const jobsList = (desk: Open, now: number): JobsList => {
  const here = focusedOf(desk)?.id;
  const tiles = new Map<string, TileId>();
  const at = (tile: TileId, row: Row): Row => {
    tiles.set(row.id, tile);
    return row;
  };
  const mine = here === undefined ? undefined : desk.jobs[here];
  const hereRows: Row[] = [];
  const endedRows: Row[] = [];

  if (here !== undefined && mine !== undefined) {
    const first = jobItem({ running: mine.running, ended: null }, now)?.n;
    const lead = mine.running.filter((j) => j.n === first);

    for (const j of [...lead, ...mine.running.filter((j) => j.n !== first)]) {
      hereRows.push(at(here, runningRow(here, j, now)));
    }

    const { ended } = mine;

    if (ended !== null) {
      endedRows.push(
        at(here, {
          id: `${here}/ended`,
          icon: ended.how,
          title: [{ text: ended.text, typed: true }],
          sub: whereOf(ended.n, here, ` · ${endWord(ended)}`),
          side: agoWord(now - ended.at),
          second: null,
        }),
      );
    }
  }

  const otherRows = Object.keys(desk.jobs)
    .filter((tile) => tile !== here)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .flatMap((tile) => (desk.jobs[tile]?.running ?? []).map((j) => at(tile, runningRow(tile, j, now))));
  const sections: readonly Section[] = [
    { id: "here", title: null, fold: false, rows: hereRows },
    { id: "ended", title: "Last ended", fold: false, rows: endedRows },
    { id: "others", title: "Other tiles", fold: false, rows: otherRows },
  ];
  const running = hereRows.length + otherRows.length;
  return {
    sections: sections.filter((s) => s.rows.length > 0),
    tiles,
    count: running === 0 ? null : running,
  };
};

/** The question you asked with a key, said where you look: the bottom line. */
export const questionWord = (desk: Open): string | null => (desk.ask === null ? null : questionOf(desk, desk.ask));

/**
 * A command's first key in the table, as the frame writes it (`C-a z`, `M-p`), or what runs it
 * when no key does.
 */
const keyIn = (keys: Keys, does: Does, otherwise: string): string => {
  const first = keys.rows.find((row) => row.does === does)?.keys[0];
  return first === undefined ? otherwise : keyText(keys.prefix, first);
};

/** What info mode says of each part of the frame that names no key, in plain words. */
const SAID = {
  segment: "a program in this workspace's line, shown in the tile named. A click focuses it.",
  pipe: "a pipe: what the program before it sends goes into the one after it.",
  asks: "asks: what agents ask you, and runs that are stuck. One count, the same as the Dock badge. A dot is one you have not seen. A click opens the list.",
  agents: "agents: the agents attached to this host now, each driving the app's programs as tools. A click names them.",
  sync: "sync: the ledger server this home reads, and whether it answers. Unreachable, the asks count is the last one read. A click says more.",
  host: "host: the process that runs every tile and job. Down, nothing new runs, and the tiles keep their last state. A click says more, and what to do.",
  again: "try again: the app stopped reaching for the host after five minutes. A click starts it reaching again.",
  drag: "an empty stretch to move the window by. A double-click zooms the window, as macOS does.",
  here: "the tile you are in: what it takes in, what it sends out, and its neighbors in its line.",
  job: "a job in this tile: its number, its line, and how long it has run. +2 is two more. A job that ended says how, for a few seconds. A click lists them, as tsh's jobs does.",
  strip: "a folded tile: a click opens it again.",
} as const;

/**
 * What info mode says of each part of the frame. A part that names a key names it from the table
 * in use, so a key you moved is said on its new key, and none is a literal here (p10).
 */
export const infoFor = (keys: Keys) => ({
  ...SAID,
  workspace: `a workspace, named by what it holds. ${keyIn(keys, 'tezgah."workspace --to 1"', "workspace --to 1 in tsh")} goes to the first, and so on to 9; ${keyIn(keys, 'tezgah."workspace --to new"', "workspace --to new in tsh")} makes one.`,
  keys: `keys: press ${keyWord(keys.prefix)}, then one key. ${keyIn(keys, "keys.open", "keys in tsh")} lists them all. ${keyIn(keys, "palette.open", "The palette")} finds any command by name.`,
  info: `info: explains what the pointer or focus is on. Escape or ${keyIn(keys, "tezgah.info", "info in tsh")} leaves.`,
  titlebar: `title bar: a click focuses the tile, a double-click folds it into a strip. ${keyIn(keys, "tezgah.fold", "fold in tsh")} folds too.`,
});

/**
 * Info mode's words with the shipped keys. A part that names no key reads the same in any table;
 * a part that names one is drawn from `infoFor` and the table in use.
 */
export const INFO = infoFor(defaults);

// ---------------------------------------------------------------- the page's own frame state

/**
 * What lies over the desk: the asks list, the jobs list, the palette, or one item's few lines.
 * One value, so two can never be open at once (Apple's HIG: one popover at a time).
 */
type Over =
  | { readonly kind: "none" }
  | { readonly kind: "asks" }
  | { readonly kind: "jobs" }
  | {
      readonly kind: "palette";
      readonly title: "commands" | "keys";
      readonly query: string;
      readonly at: number;
    }
  | { readonly kind: "item"; readonly what: Part };

/** A part of the app the top bar names, whose few lines open under it: a click, its key or its tsh word. */
export type Part = "agents" | "sync" | "host";

/** Where something sits along the top bar. */
interface Span {
  readonly left: number;
  readonly right: number;
}

/** The least empty space either side of the bar's mark and name. */
const NAME_ROOM = 24;

/** The mark and name keep the middle of the bar only while nothing else comes near them. */
export const middleFree = (name: Span, items: readonly Span[]): boolean =>
  items.every((at) => at.right + NAME_ROOM <= name.left || name.right + NAME_ROOM <= at.left);

/**
 * Info mode, as one value (docs/direction/modes.md, M2). `never`: it has not come on, so the status
 * region says nothing, since no mode is not news. `on`: the bottom line explains whatever the
 * pointer is over or keyboard focus is on; `explained` is what it says now, or `null` when nothing
 * there has words. `off`: it was on and was left, so the region says it is off until it comes on
 * again.
 */
export type InfoMode =
  | { readonly kind: "never" }
  | { readonly kind: "on"; readonly explained: string | null }
  | { readonly kind: "off" };

export interface Frame {
  readonly over: Over;
  readonly info: InfoMode;
  /** Both bars hidden; a thin band stays for the window's buttons. */
  readonly bare: boolean;
  /** A short note at the bottom right, as after the palette ran a command: `next time: C-b z`. */
  readonly note: string | null;
}

export const FRAME: Frame = {
  over: { kind: "none" },
  info: { kind: "never" },
  bare: false,
  note: null,
};

/** What the window's status region says of the mode: a screen reader reads it as it changes. */
export const modeWord = (f: Frame): string => {
  switch (f.info.kind) {
    case "never":
      return "";
    case "on":
      return "Info mode on. Escape leaves.";
    case "off":
      return "Info mode off.";
  }
};

/** Is the desk mid-key: Ctrl-B armed, or its own question (`close t2? (y/n)`) waiting. */
export interface MidKey {
  readonly armed: boolean;
  readonly asking: boolean;
}

/**
 * The window events info mode explains on: the pointer moving over a part, and keyboard focus
 * moving to one, so what a pointer can learn, a keyboard can too (WCAG 2.1.1).
 */
export const EXPLAIN_ON = ["pointerover", "focusin"] as const;

/**
 * Whether the bottom line shows. With both bars hidden it still does while you are mid-key (the
 * prefix armed, or the desk's own question waiting), while a note is up, and in info mode, whose
 * word is said there: a mode is always seen (docs/direction/modes.md, M3).
 */
export const bottomLineShows = (f: Frame, desk: MidKey): boolean =>
  !f.bare || desk.armed || desk.asking || f.note !== null || f.info.kind === "on";

export type FrameMsg =
  /** A key after Ctrl-B asked the frame to show something (desk.ts, `show`), but info mode. */
  | { readonly type: "show"; readonly what: Exclude<Show, "info"> }
  /**
   * C-b i, or a click on the info item: info mode comes on or goes off. Coming on, it explains
   * at once what keyboard focus is on: `focus` is those words, or `null` when it has none.
   */
  | { readonly type: "info"; readonly focus: string | null }
  | { readonly type: "palette" }
  | { readonly type: "item"; readonly what: Part }
  | { readonly type: "query"; readonly query: string }
  | { readonly type: "move"; readonly by: number; readonly of: number }
  | { readonly type: "ran"; readonly key: string }
  /** What lies over the desk closes, and the bottom line says why nothing happened. */
  | { readonly type: "say"; readonly note: string }
  | { readonly type: "explain"; readonly text: string | null }
  | { readonly type: "unnote" }
  | { readonly type: "close" }
  /** Escape, as the page hands it on (desk.tsx, `onKey`), with the desk mid-key or not: see `escaped`. */
  | { readonly type: "escape"; readonly desk: MidKey };

/** A thing over the desk opens, or closes when it is open already, as a menu does. */
const toggle = (f: Frame, over: Over): Frame =>
  f.over.kind === over.kind ? { ...f, over: { kind: "none" } } : { ...f, over };

/** An item's lines open, or close when they are open already. */
const itemLines = (f: Frame, what: Part): Frame =>
  f.over.kind === "item" && f.over.what === what
    ? { ...f, over: { kind: "none" } }
    : { ...f, over: { kind: "item", what } };

/** Info mode goes off, and the status region says so. */
const leaveInfo = (f: Frame): Frame => ({ ...f, info: { kind: "off" } });

/** Info mode goes off when it is on, and comes on otherwise, explaining what `focus` is on. */
const toggleInfo = (f: Frame, focus: string | null): Frame =>
  f.info.kind === "on" ? leaveInfo(f) : { ...f, info: { kind: "on", explained: focus } };

/** In info mode, what the pointer is over or focus moved to is explained; out of it, nothing changes. */
const explain = (f: Frame, text: string | null): Frame =>
  f.info.kind === "on" && f.info.explained !== text ? { ...f, info: { kind: "on", explained: text } } : f;

/**
 * What Escape does, one layer at a time, as Apple's HIG has one dismissed before the next: it
 * closes what lies over the desk; then, while the desk is mid-key, it is the desk's, to cancel its
 * prefix or its question; only then does it leave info mode. When it is not the frame's, the same
 * frame comes back, so the key goes on: to the desk, or to the tile.
 */
const escaped = (f: Frame, desk: MidKey): Frame => {
  if (f.over.kind !== "none") {
    return { ...f, over: { kind: "none" } };
  }

  if (desk.armed || desk.asking) {
    return f;
  }

  return f.info.kind === "on" ? leaveInfo(f) : f;
};

/**
 * How a key reaches the frame: `fresh`, pressed just now, or `passed`, released by the hold after
 * the host's answer. It is call-local: a fresh key finds the host's outstanding key ahead of it, a
 * passed one already had its turn.
 */
export type Delivery = "fresh" | "passed";

/**
 * What the frame makes of a key before any tile has it: the same frame when the key goes on, else
 * the frame it changed, and the key is consumed. Only Escape is the frame's today, through
 * `escaped`. `actual` is the desk's own prefix and question; `waiting` is the hold's outstanding
 * key, which makes a fresh key queue behind it (the desk is mid-key) and never a passed one.
 */
export const frameKey = (f: Frame, key: string, actual: MidKey, waiting: boolean, delivery: Delivery): Frame =>
  key === "Escape"
    ? frameUpdate(f, {
        type: "escape",
        desk: delivery === "fresh" ? { armed: actual.armed || waiting, asking: actual.asking } : actual,
      })
    : f;

/**
 * What a key after Ctrl-B shows: the asks list, the jobs list, every key, no bars, or an item's
 * lines. Info mode is a message of its own (`info`), since it needs what focus is on.
 */
const shown = (f: Frame, what: Exclude<Show, "info">): Frame => {
  switch (what) {
    case "agents":
    case "sync":
    case "host":
      return itemLines(f, what);
    case "asks":
      return toggle(f, { kind: "asks" });
    case "jobs":
      return toggle(f, { kind: "jobs" });
    case "keys":
      return { ...f, over: { kind: "palette", title: "keys", query: "", at: 0 } };
    case "palette":
      return { ...f, over: { kind: "palette", title: "commands", query: "", at: 0 } };
    case "bars":
      return { ...f, bare: !f.bare, over: { kind: "none" } };
  }
};

/**
 * Who a key goes to while something lies over the desk: the over, or the desk as always. The
 * palette is a modal dialog, so it takes every key. A menu or an item's lines take every key but
 * Ctrl-B and the key after it, so `C-b a` still closes the asks list. A key the desk's own
 * question waits on (`close t2? (y/n)`) goes to the desk. A key that goes to the over never
 * reaches a tile: not its terminal, not its view.
 */
export const keyGoesTo = (over: Over, key: string, prefix: string, desk: MidKey): "over" | "desk" => {
  if (over.kind === "none") {
    return "desk";
  }

  if (over.kind === "palette") {
    return "over";
  }

  return key === prefix || desk.armed || desk.asking ? "desk" : "over";
};

export const frameUpdate = (f: Frame, m: FrameMsg): Frame => {
  switch (m.type) {
    case "show":
      return shown(f, m.what);
    case "palette":
      return toggle(f, { kind: "palette", title: "commands", query: "", at: 0 });
    case "item":
      return itemLines(f, m.what);
    case "query":
      return f.over.kind === "palette" ? { ...f, over: { ...f.over, query: m.query, at: 0 } } : f;
    case "move": {
      if (f.over.kind !== "palette" || m.of === 0) {
        return f;
      }

      const at = (f.over.at + m.by + m.of) % m.of;
      return { ...f, over: { ...f.over, at } };
    }
    case "ran":
      return { ...f, over: { kind: "none" }, note: `next time: ${m.key}` };
    case "say":
      return { ...f, over: { kind: "none" }, note: m.note };
    case "info":
      return toggleInfo(f, m.focus);
    case "explain":
      return explain(f, m.text);
    case "unnote":
      return { ...f, note: null };
    case "close":
      return { ...f, over: { kind: "none" } };
    case "escape":
      return escaped(f, m.desk);
  }
};

/**
 * What keyboard focus follows on the desk: the workspace, its focused tile, what that tile shows
 * and the zoom. When it changes, focus moves to the tile. A zoom moves the tile's terminal into
 * another box, so it counts too, or focus would fall to the page.
 *
 *   focusFollows(open)    "ws1/t2/tsh/"     zoomed: "ws1/t2/tsh/t2"
 */
export const focusFollows = (open: Open | null): string => {
  if (open === null) {
    return "";
  }

  const ws = activeOf(open);
  const tile = focusedOf(open);
  return tile === null ? "" : `${ws.id}/${tile.id}/${tile.shows.run?.id ?? "tsh"}/${ws.layout.zoomed ?? ""}`;
};
