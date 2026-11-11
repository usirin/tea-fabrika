import { defineMachine, noop } from "@demlik/tea";
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import type { Keys } from "./desk/keymap.ts";

// The app's projects: which folder each window shows, and how a person got there. Today's app,
// ticket 276, PR 1 (docs/direction/project-window.md). One parent in the app's main process holds
// every project window, as Elm's parent holds its children: a window is one project, a project is
// at most one window, and two presses on one folder make one window.
//
//   init(null)                                   welcome, no project, nothing started
//   open {project: demlik, source: "box", ...}   demlik reserved: start_host, open_window, a record
//   open {project: demlik, source: "menu", ...}  joined: the same opening, no second host
//   opened {key: demlik, window: "w2"}           demlik shows in w2; recent and restore know it
//   open {project: demlik, source: "dock", ...}  focus_window w2, and a record that says so
//   quit                                         save_session first, then close_window for each
//   closed {key: demlik}                         after quit: the saved restore list stays
//
// Closing a window or quitting never stops a host or a job: each project's host runs on, as a
// tmux server does when its client goes. PR 2 adds reopening the restore list at launch; PR 1
// keeps the list and reopens nothing by itself.

/** A project: one git working tree, checked (project.ts, `Project.check`). */
export const ProjectSchema = Schema.Struct({
  /** The real top folder of the working tree, links resolved. */
  root: Schema.String,
  /** The full SHA-256 of `root`, in hex: the project's name on disk. */
  key: Schema.String,
});

export type Project = typeof ProjectSchema.Type;

/** How a person asked for a project: the place the press came from, kept from the press on. */
export const Source = Schema.Literals(["welcome", "box", "button", "menu", "sheet", "dock"]);
export type Source = typeof Source.Type;

/** One project a person opened before, as welcome and the projects box list it. */
export const Recent = Schema.Struct({
  project: ProjectSchema,
  /** Its title: the folder's name, with parent folders when two share it (project.ts, `titles`). */
  name: Schema.String,
  /** Where it is, as a person reads it: under `~` when it is in their home. */
  path: Schema.String,
  /** When it was last opened, in milliseconds since 1970. */
  at: Schema.Number,
  /** Its window is open now. */
  open: Schema.Boolean,
});
export type Recent = typeof Recent.Type;

/** What the app keeps between launches: the recent projects, and the windows open at quit. */
export const Session = Schema.Struct({
  recent: Schema.Array(Recent),
  /** The keys of the projects whose windows were open when the app quit, for PR 2 to reopen. */
  restore: Schema.Array(Schema.String),
});
export type Session = typeof Session.Type;

/** One row of welcome or the projects box: a recent project, or Open Folder…, always last. */
export const ProjectRow = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("recent"),
    /** The project's key: a row is picked by it, never by where it is in the list. */
    id: Schema.String,
    name: Schema.String,
    path: Schema.String,
    /** When it was opened last, or `open` while its window is. */
    at: Schema.Union([Schema.Number, Schema.Literal("open")]),
    project: ProjectSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("folder"),
    id: Schema.Literal("folder"),
    name: Schema.Literal("Open Folder…"),
    /** Its key, as keycaps: none, since Cmd-O is Open Project… (P26). */
    caps: Schema.Array(Schema.String),
  }),
]);
export type ProjectRow = typeof ProjectRow.Type;

/** The row that opens the system's folder sheet. */
export const FOLDER_ROW: ProjectRow = {
  _tag: "folder",
  id: "folder",
  name: "Open Folder…",
  caps: [],
};

/**
 * The rows welcome and the projects box show, from one list: the box leaves out the project its
 * window shows (`current`). A project whose window is open says `open` where its time would be.
 *
 *   rows([demlik, manti])           [demlik, manti, Open Folder…]
 *   rows([demlik, manti], demlik)   [manti, Open Folder…]
 */
export const rows = (recent: readonly Recent[], current?: string): readonly ProjectRow[] => [
  ...recent
    .filter((r) => r.project.key !== current)
    .map((r): ProjectRow => ({
      _tag: "recent",
      id: r.project.key,
      name: r.name,
      path: r.path,
      at: r.open ? "open" : r.at,
      project: r.project,
    })),
  FOLDER_ROW,
];

/** One item of the File menu, for main.ts to hand to Electron's menu. */
export interface MenuItem {
  readonly label: "Open Project…" | "Open Folder…";
  /** Electron's accelerator, from the keys table: none when no key opens it. */
  readonly accelerator: string | undefined;
  readonly action: "projects" | "folder";
}

/** A key name of the keys table as Electron's accelerator spells it: `<m-o>` is `Command+O`. */
const acceleratorOf = (name: string, mac: boolean): string | undefined => {
  const found = /^<((?:[cam]-)+)(.+)>$/.exec(name);

  if (found === null) {
    return undefined;
  }

  const [, mods = "", key = ""] = found;
  const words = [
    ...(mods.includes("c-") ? ["Control"] : []),
    ...(mods.includes("a-") ? ["Alt"] : []),
    ...(mods.includes("m-") ? [mac ? "Command" : "Control"] : []),
  ];
  return [...words, key.length === 1 ? key.toUpperCase() : key].join("+");
};

/**
 * The File menu's two openings (P26). Cmd-O is Open Project…, the projects box, as the keys
 * table binds `projects.open`; Open Folder… has no key, so the two never share one.
 */
export const projectMenu = (keys: Keys, mac: boolean): readonly MenuItem[] => {
  const key = keys.rows.find((row) => row.does === "projects.open")?.keys.find((k) => k._tag === "alone")?.key;
  return [
    {
      label: "Open Project…",
      accelerator: key === undefined ? undefined : acceleratorOf(key, mac),
      action: "projects",
    },
    { label: "Open Folder…", accelerator: undefined, action: "folder" },
  ];
};

/** What one window shows: welcome, or one project with its name. */
export const Look = Schema.TaggedUnion({
  /** No project: welcome, its recent rows, and the row selected (`folder` when there are none). */
  welcome: { selected: Schema.String },
  project: { project: ProjectSchema, name: Schema.String },
});
export type Look = typeof Look.Type;

/** The opening of a project, from the press: who asked, from where, and on their own clock. */
interface Asked {
  readonly id: string;
  readonly source: Source;
  readonly said: number;
  readonly by: string;
}

/** One project the app knows now: its window, an opening still under way, and its asks. */
export interface Entry {
  readonly project: Project;
  /** Its window's id, or none: not open yet, or closed while its host runs on. */
  readonly window: string | null;
  /** The opening under way: its host and window are being made. */
  readonly opening: Asked | null;
  /** Why its window is being closed, until it has: the press's source, or none. */
  readonly closing: string | null;
  /** The asks its host counts now. */
  readonly asks: number;
}

export interface Projects {
  /** What the welcome window shows, or the project in front. */
  readonly look: Look;
  /** Every project the app knows now, by key. */
  readonly projects: Readonly<Record<string, Entry>>;
  readonly recent: readonly Recent[];
  /** The projects to reopen at the next launch: PR 2 does that. */
  readonly restore: readonly string[];
  /** The asks of every project, the Dock's badge. */
  readonly badge: number;
  /** The app is quitting: its windows close, and the restore list saved before stays. */
  readonly quitting: boolean;
  /** The records written so far, for each record's own id. */
  readonly written: number;
}

/** One record of the app's own, in `<appHome>/records/projects.jsonl` (main.ts adds `at`). */
export const ProjectRecord = Schema.TaggedUnion({
  opening: {
    id: Schema.String,
    project: Schema.String,
    root: Schema.String,
    window: Schema.NullOr(Schema.String),
    source: Source,
    by: Schema.String,
    said: Schema.Number,
    /** When it was written, by the app's clock: main.ts sets it as it writes. */
    at: Schema.NullOr(Schema.Number),
    result: Schema.Literals(["started", "joined", "opened", "focused", "failed"]),
    why: Schema.NullOr(Schema.String),
  },
  close: {
    id: Schema.String,
    project: Schema.String,
    window: Schema.NullOr(Schema.String),
    source: Schema.String,
    at: Schema.NullOr(Schema.Number),
    outcome: Schema.Literals(["closed", "quit"]),
  },
});
export type ProjectRecord = typeof ProjectRecord.Type;

const Key = Schema.Struct({ key: Schema.String });
const Done = Schema.Null;

/** Start the project's host, or reach the one that runs (start-host.ts). */
export const start_host = Cmd.make("start_host", {
  input: Schema.Struct({ project: ProjectSchema }),
  ok: Done,
  err: [],
});

/** Make the project's window, with its own ports and link. */
export const open_window = Cmd.make("open_window", {
  input: Schema.Struct({ key: Schema.String, project: ProjectSchema }),
  ok: Done,
  err: [],
});

/** Bring the project's window forward: restored when minimized, never focused on a quiet start. */
export const focus_window = Cmd.make("focus_window", { input: Key, ok: Done, err: [] });
/** Close the project's window. Its host runs on. */
export const close_window = Cmd.make("close_window", { input: Key, ok: Done, err: [] });

/** Write the session beside its file, then move it over (main.ts). */
export const save_session = Cmd.make("save_session", {
  input: Schema.Struct({ session: Session }),
  ok: Done,
  err: [],
});

/** Keep one record. */
export const record = Cmd.make("record", {
  input: Schema.Struct({ record: ProjectRecord }),
  ok: Done,
  err: [],
});

/** A message from a project's own page, for that project's host alone. */
export const to_host = Cmd.make("to_host", {
  input: Schema.Struct({ key: Schema.String, m: Schema.Unknown }),
  ok: Done,
  err: [],
});

/** Move welcome's selection to one row: Cmd-O on welcome (P27). */
export const focus_row = Cmd.make("focus_row", {
  input: Schema.Struct({ id: Schema.String }),
  ok: Done,
  err: [],
});

/** Show the system's folder sheet over the window that asked. */
export const choose_folder = Cmd.make("choose_folder", {
  input: Schema.Struct({}),
  ok: Done,
  err: [],
});

/** Tell the Dock the asks of every project. */
export const badge = Cmd.make("badge", {
  input: Schema.Struct({ count: Schema.Int }),
  ok: Done,
  err: [],
});

export type ProjectsCmd =
  | ReturnType<typeof start_host>
  | ReturnType<typeof open_window>
  | ReturnType<typeof focus_window>
  | ReturnType<typeof close_window>
  | ReturnType<typeof save_session>
  | ReturnType<typeof record>
  | ReturnType<typeof to_host>
  | ReturnType<typeof focus_row>
  | ReturnType<typeof choose_folder>
  | ReturnType<typeof badge>;

export type ProjectsMsg =
  | {
      readonly type: "open";
      readonly project: Project;
      readonly source: Source;
      /** When the person pressed, by the writer's own clock. */
      readonly said: number;
      /** Who pressed, as a writer's text. */
      readonly by: string;
    }
  /** The project's window is made and shows it. */
  | { readonly type: "opened"; readonly key: string; readonly window: string }
  /** Its host or its window could not be made. */
  | { readonly type: "open_failed"; readonly key: string; readonly why: string }
  | { readonly type: "focus"; readonly key: string; readonly source: Source }
  /** A person asked to close its window. */
  | { readonly type: "close"; readonly key: string; readonly source: string }
  /** Its window closed. */
  | { readonly type: "closed"; readonly key: string }
  | { readonly type: "quit" }
  | { readonly type: "launch" }
  | { readonly type: "choose_folder" }
  /** The folder sheet was cancelled: nothing changes. */
  | { readonly type: "cancel" }
  /** Cmd-O, File > Open Project… */
  | { readonly type: "projects" }
  | { readonly type: "asks"; readonly key: string; readonly asks: readonly unknown[] }
  /** A notification of the project's was clicked. */
  | { readonly type: "notification"; readonly key: string }
  /** A page's message: `sender` is the window it came from. */
  | { readonly type: "page"; readonly key: string; readonly sender: string; readonly m: unknown };

type Step = readonly [Projects, readonly ProjectsCmd[]];

/** The name a window and a row say: the root's last folder. */
const nameOf = (project: Project, recent: readonly Recent[]): string =>
  recent.find((r) => r.project.key === project.key)?.name ??
  project.root
    .split("/")
    .filter((s) => s !== "")
    .at(-1) ??
  project.root;

const welcome = (recent: readonly Recent[]): Look =>
  Look.cases.welcome.make({ selected: recent[0]?.project.key ?? "folder" });

const session = (s: Projects): ReturnType<typeof save_session> =>
  save_session({ session: { recent: s.recent, restore: s.restore } });

/** The next record's id, and the model that has counted it. */
const nextId = (s: Projects, kind: string): readonly [Projects, string] => [
  { ...s, written: s.written + 1 },
  `${kind}-${s.written + 1}`,
];

const opening = (
  s: Projects,
  entry: Entry,
  asked: Asked,
  result: "started" | "joined" | "opened" | "focused" | "failed",
  why: string | null,
): readonly [Projects, ReturnType<typeof record>] => {
  const [next, id] = nextId(s, "opening");
  return [
    next,
    record({
      record: ProjectRecord.cases.opening.make({
        id,
        project: entry.project.key,
        root: entry.project.root,
        window: entry.window,
        source: asked.source,
        by: asked.by,
        said: asked.said,
        at: null,
        result,
        why,
      }),
    }),
  ];
};

/** Is the window `key` open: the recent list says `open` while it is. */
const marked = (recent: readonly Recent[], key: string, open: boolean, at?: number) =>
  recent.map((r) => (r.project.key === key ? { ...r, open, ...(at === undefined ? {} : { at }) } : r));

/** The project to the front of the recent list, added when it is new. */
const toFront = (s: Projects, project: Project, at: number): readonly Recent[] => {
  const known = s.recent.find((r) => r.project.key === project.key);
  const entry: Recent = known ?? {
    project,
    name: nameOf(project, s.recent),
    path: project.root,
    at,
    open: false,
  };
  return [{ ...entry, at }, ...s.recent.filter((r) => r.project.key !== project.key)];
};

const totalAsks = (projects: Readonly<Record<string, Entry>>) =>
  Object.values(projects).reduce((n, e) => n + e.asks, 0);

const withEntry = (s: Projects, key: string, entry: Entry | null): Projects => {
  const { [key]: _gone, ...rest } = s.projects;
  return { ...s, projects: entry === null ? rest : { ...rest, [key]: entry } };
};

const openProject = (s: Projects, m: Extract<ProjectsMsg, { type: "open" }>): Step => {
  if (s.quitting) {
    return [s, []];
  }

  const key = m.project.key;
  const asked = { id: "", source: m.source, said: m.said, by: m.by };
  const found = s.projects[key];

  if (found?.window != null) {
    const [next, kept] = opening(s, found, asked, "focused", null);
    return [next, [focus_window({ key }), kept]];
  }

  if (found?.opening != null) {
    const [next, kept] = opening(s, found, asked, "joined", null);
    return [next, [kept]];
  }

  const [counted, id] = nextId(s, "press");
  const entry: Entry = {
    project: m.project,
    window: null,
    opening: { ...asked, id },
    closing: null,
    asks: found?.asks ?? 0,
  };
  const reserved = { ...withEntry(counted, key, entry), recent: toFront(counted, m.project, m.said) };
  const [next, kept] = opening(reserved, entry, asked, "started", null);
  return [next, [start_host({ project: m.project }), open_window({ key, project: m.project }), kept]];
};

const opened = (s: Projects, m: Extract<ProjectsMsg, { type: "opened" }>): Step => {
  const entry = s.projects[m.key];

  if (entry?.opening == null) {
    return [s, []];
  }

  const shown: Entry = { ...entry, window: m.window, opening: null };
  const placed: Projects = {
    ...withEntry(s, m.key, shown),
    look: Look.cases.project.make({ project: entry.project, name: nameOf(entry.project, s.recent) }),
    recent: marked(s.recent, m.key, true),
    restore: s.restore.includes(m.key) ? s.restore : [...s.restore, m.key],
  };
  const [next, kept] = opening(placed, shown, entry.opening, "opened", null);
  return [next, [kept, session(next)]];
};

const failed = (s: Projects, m: Extract<ProjectsMsg, { type: "open_failed" }>): Step => {
  const entry = s.projects[m.key];

  if (entry?.opening == null) {
    return [s, []];
  }

  const left = withEntry(s, m.key, entry.window === null ? null : { ...entry, opening: null });
  const [next, kept] = opening(left, entry, entry.opening, "failed", m.why);
  return [next, [kept]];
};

const closed = (s: Projects, key: string): Step => {
  const entry = s.projects[key];

  if (entry?.window == null) {
    return [s, []];
  }

  const [counted, id] = nextId(s, "close");
  const kept = record({
    record: ProjectRecord.cases.close.make({
      id,
      project: key,
      window: entry.window,
      source: entry.closing ?? "window",
      at: null,
      outcome: s.quitting ? "quit" : "closed",
    }),
  });
  const others = Object.values(s.projects).some((e) => e.project.key !== key && e.window !== null);
  // Quitting, the list saved before the windows closed stays. Otherwise a closed project leaves
  // it while another window remains; the last one stays for the next Dock activation.
  const restore = s.quitting || !others ? s.restore : s.restore.filter((k) => k !== key);
  const left = withEntry(counted, key, { ...entry, window: null, closing: null });
  const next: Projects = {
    ...left,
    recent: marked(s.recent, key, false),
    restore,
    look: others ? s.look : welcome(s.recent),
  };
  return [next, s.quitting ? [kept] : [kept, session(next)]];
};

const quit = (s: Projects): Step => {
  const open = Object.values(s.projects).filter((e) => e.window !== null);
  const next: Projects = { ...s, quitting: true, restore: open.map((e) => e.project.key) };
  return [next, [session(next), ...open.map((e) => close_window({ key: e.project.key }))]];
};

const asks = (s: Projects, m: Extract<ProjectsMsg, { type: "asks" }>): Step => {
  const entry = s.projects[m.key];

  if (entry === undefined) {
    return [s, []];
  }

  const next = withEntry(s, m.key, { ...entry, asks: m.asks.length });
  const total = totalAsks(next.projects);
  return [{ ...next, badge: total }, total === s.badge ? [] : [badge({ count: total })]];
};

/** A notification's click: the project that sent it, focused, or opened again if its window closed. */
const noticed = (s: Projects, key: string): Step => {
  const entry = s.projects[key];

  if (entry === undefined || s.quitting) {
    return [s, []];
  }

  if (entry.window !== null) {
    return [s, [focus_window({ key })]];
  }

  if (entry.opening !== null) {
    return [s, []];
  }

  const [counted, id] = nextId(s, "press");
  const asked: Asked = { id, source: "dock", said: 0, by: "user:owner" };
  const reopening: Entry = { ...entry, opening: asked };
  const placed = withEntry(counted, key, reopening);
  const [next, kept] = opening(placed, reopening, asked, "started", null);
  return [next, [open_window({ key, project: entry.project }), kept]];
};

/**
 * The app as a launch finds it: the session kept at the last quit, every window closed, nothing
 * started. PR 1 reopens none of the restore list; it only keeps it.
 */
export const restored = (saved: Session): Projects => {
  const recent = saved.recent.map((r) => ({ ...r, open: false }));
  return {
    look: welcome(recent),
    projects: {},
    recent,
    restore: saved.restore,
    badge: 0,
    quitting: false,
    written: 0,
  };
};

export const projectsMachine = defineMachine({
  types: {
    model: {} as Projects,
    msg: {} as ProjectsMsg,
  },
  cmds: [
    start_host,
    open_window,
    focus_window,
    close_window,
    save_session,
    record,
    to_host,
    focus_row,
    choose_folder,
    badge,
  ],
  init: (loaded: Projects | null): Step => [restored(loaded ?? { recent: [], restore: [] }), []],
  update: {
    open: openProject,
    opened,
    open_failed: failed,
    focus: (s, m): Step => (s.projects[m.key]?.window != null ? [s, [focus_window({ key: m.key })]] : [s, []]),
    close: (s, m): Step => {
      const entry = s.projects[m.key];

      if (entry?.window == null) {
        return [s, []];
      }

      return [withEntry(s, m.key, { ...entry, closing: m.source }), [close_window({ key: m.key })]];
    },
    closed: (s, m): Step => closed(s, m.key),
    quit,
    launch: (s): Step => [s, []],
    choose_folder: (s): Step => (s.quitting ? [s, []] : [s, [choose_folder({})]]),
    cancel: (s): Step => [s, []],
    projects: (s): Step =>
      s.look._tag === "welcome" ? [s, [focus_row({ id: s.recent[0]?.project.key ?? "folder" })]] : [s, []],
    asks,
    notification: (s, m): Step => noticed(s, m.key),
    page: (s, m): Step => {
      const entry = s.projects[m.key];
      return entry?.window != null && entry.window === m.sender ? [s, [to_host({ key: m.key, m: m.m })]] : [s, []];
    },
    // Each Cmd's answer: what it did is already in the model, so none changes it.
    start_host_ok: noop,
    start_host_err: noop,
    open_window_ok: noop,
    open_window_err: noop,
    focus_window_ok: noop,
    focus_window_err: noop,
    close_window_ok: noop,
    close_window_err: noop,
    save_session_ok: noop,
    save_session_err: noop,
    record_ok: noop,
    record_err: noop,
    to_host_ok: noop,
    to_host_err: noop,
    focus_row_ok: noop,
    focus_row_err: noop,
    choose_folder_ok: noop,
    choose_folder_err: noop,
    badge_ok: noop,
    badge_err: noop,
  },
});
