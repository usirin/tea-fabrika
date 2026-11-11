import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { refuse as refuseSaved } from "@demlik/tea";
import { run } from "@demlik/tea/effect";
import { backoffDelay, defaultRng } from "@demlik/tea/retry-backoff";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { followLook, frameColor } from "@kampus/fabrika-design";
import { Cause, Effect, Exit, type FileSystem, Layer, Path, Schema, Scope, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  MessageChannelMain,
  type MessagePortMain,
  nativeTheme,
  Notification,
  protocol,
  screen,
  session,
  shell,
} from "electron";
import { type AsksNow, keysOf, newAsks, noticeOf } from "./asks.ts";
import { attach, NoHello, NoHost, restart } from "./attach.ts";
import { isPortName, PORT_CHANNEL } from "./bridge.ts";
import { defaults } from "./desk/keymap.ts";
import { answer, DESK, isDesk, isOurs, SCHEME } from "./files.ts";
import { settingsFolder } from "./host/settings.ts";
import { pathsOf, reach } from "./host/socket.ts";
import { NotStopped, stopHost } from "./host/stop.ts";
import { type Launch, launchOf, QUIET_SWITCHES } from "./launch.ts";
import type { Down, Up } from "./link.ts";
import { type LinkNow, readAsks, readToApp, type ToPage, type WindowLook } from "./messages.ts";
import { Browser, NotOpened, openOutside } from "./outside.ts";
import { hasLegacy, MigrationRefused, migrated, migrateProject } from "./project-migration.ts";
import { Project, ProjectRefused } from "./project.ts";
import {
  type ProjectRecord,
  type Projects,
  type ProjectsMsg,
  projectMenu,
  projectsMachine,
  type Recent,
  restored,
  rows,
  Session,
  type Source,
} from "./projects.ts";
import { noteOf, POLICY, reconnectMachine, type Tried } from "./reconnect.ts";
import { startHost } from "./start-host.ts";
import { Unattached, type Wire } from "./wire.ts";

// The Electron edge: the main process. It runs nothing of fabrika's own: every tile's tsh, every
// program, the desk, the jobs and the ledger are in a project's host, a process of its own
// (host/main.ts), as tmux's server is. This process is a client of each, and a thin relay between
// a host's socket and its window's ports. Electron and Node are named here and in preload.ts,
// and nowhere else in the app's own process.
//
// A window is one project (ticket 276, docs/direction/project-window.md). The projects machine
// (projects.ts) is the parent of them all: which project each window shows, the recent list, the
// restore list saved at quit, and the Dock badge. This file runs its Cmds:
//
//   launch          one welcome window: recent projects and Open Folder…, no host started
//   open            a recent row, the projects box or the folder sheet names a folder, checked
//                   (project.ts). The old desk moves into its project first if this app home
//                   has one (project-migration.ts). Then a window shows it: the welcome window
//                   that asked becomes it, or a new one opens, and its link reaches or starts
//                   the project's host
//   focus           a project open already: its window comes forward, and no second host starts
//   close, quit     close windows only. Every project's host runs on with its jobs. Quit saves
//                   the restore list before its windows close. PR 2 reopens it at launch
//
// Each project window has its own link to its own host, on that project's short runtime socket
// (project.ts, `Project.paths`), its own ports and its own reconnect machine:
//
//   start           connect to the project's host. None answers: start one, detached, wait for
//                   its socket, then connect. A socket left by a crash: the same
//   hello           both sides say which version of the link they speak, and which project
//                   (link.ts): another project's host is never attached. Another version: the
//                   app does not attach, names both versions, and leaves that host running
//   restart         either way, the window offers "Stop the old host and start this one"
//   the page        it loads and says hello: it is told what it shows, then the host is told
//                   `page`, and sends the desk, its Ctrl-B table and a port for every tile
//   a port          what the page sends on one goes to the window's own host as {type: "on"}
//   the link drops  the reconnect machine waits a moment and attaches again
//
// What this file does, by Electron's security checklist
// (https://www.electronjs.org/docs/latest/tutorial/security):
//
//   one copy        `requestSingleInstanceLock`; a second start brings a window forward
//   windows         each sandboxed, context isolation, no Node, and a preload that gives only
//                   send, onMessage and forget. A hello is answered only from a window's own top
//                   frame, on the desk page of our own files, and its ports go only to that page
//   own files       over the app's own scheme (`protocol.handle`, files.ts): no `file://`
//   no way out      navigation, redirects, new windows, webviews and permissions are refused
//   links           an http or https URL the desk page asked for goes to the person's browser
//   a port each     a MessageChannelMain for the desk, one per tile and one per run, per window.
//                   Only a plain JSON value goes on, and only to that window's own host
//
// Closing and quitting follow the platform's own rules:
//
//   close button    closes the window only. Its host is told `away`, and runs on. On macOS the
//                   app stays in the Dock; elsewhere closing every window quits the app
//   dock icon       `activate` with no window: a welcome window
//   Cmd-Q           quits the app, and only the app: every host runs on
//
// A start on a home of its own is quiet (launch.ts): an agent or a test. On macOS it is an
// accessory app, with no Dock icon, never the active app. Its windows are drawn while hidden,
// made fully transparent and click-through in a corner of the screen, shown without focus and
// never focused, so they never take the person's keys or pointer (AGENTS.md, "Go easy on the
// machine"). FABRIKA_FOREGROUND=1 shows them as the owner's.
//
// The app's home is Electron's userData folder: FABRIKA_HOME, when set, or Electron's own folder.
// Its own records are `<home>/records/projects.jsonl`, and its session `<home>/session.json`.

/** The bundle's folder: main.mjs, host.mjs, preload.cjs and the page's own files, side by side. */
const DIST = import.meta.dirname;

const launch = launchOf(process.env);

if (launch.kind !== "owner") {
  app.setPath("userData", launch.home);
}

// Before `ready`, so no Dock icon shows even for a moment, and Chromium starts with the switches.
if (launch.kind === "quiet") {
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory");
  }

  for (const name of QUIET_SWITCHES) {
    app.commandLine.appendSwitch(name);
  }
}

// Before `ready`, as Electron asks: a standard, secure scheme, so the page's own files have
// an origin of their own and run as on https.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);

/** The person's own browser: Electron hands the URL to the system, which opens its default one. */
const browser = Browser.of({
  open: (url) =>
    Effect.tryPromise({
      try: () => shell.openExternal(url),
      catch: (cause) => new NotOpened({ url, why: String(cause) }),
    }),
});

/** Refuse every way out of the app's own files, for every web contents it ever makes. */
const guard = () => {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (e) => e.preventDefault());
    contents.on("will-redirect", (e) => e.preventDefault());
    contents.on("will-attach-webview", (e) => e.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      Effect.runFork(
        openOutside({ url, from: contents.getURL() }).pipe(
          Effect.provideService(Browser, browser),
          Effect.match({
            onFailure: (e) => console.warn(`fabrika: the browser did not open ${e.url}: ${e.why}`),
            onSuccess: (out) => {
              if (out.kind === "refused") {
                console.warn(`fabrika: refused to open ${url}: ${out.why}`);
              }
            },
          }),
        ),
      );
      return { action: "deny" };
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
};

/**
 * The window's frame on macOS: no title bar of its own, the page's top bar in its place, and the
 * system's three buttons kept, set in that bar. Other platforms keep the system's frame.
 */
const FRAME =
  process.platform === "darwin"
    ? ({ titleBarStyle: "hiddenInset", trafficLightPosition: { x: 14, y: 11 } } as const)
    : {};

/**
 * One window, with the same safe settings the app's windows always had. Quiet, it is drawn
 * hidden, then made transparent and click-through in the work area's corner, and shown without
 * taking focus: an agent reads it over the DevTools protocol, and the person never sees it.
 */
const deskWindow = (preload: string, icon: string, launch: Launch) => {
  const quiet = launch.kind === "quiet";
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    title: "fabrika",
    icon,
    // The desk's color in the system's look, so the window shows no other color before its page.
    backgroundColor: frameColor(nativeTheme),
    ...FRAME,
    show: !quiet,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: !quiet,
      preload,
    },
  });
  followLook(nativeTheme, window);

  if (quiet) {
    window.setOpacity(0);
    window.setIgnoreMouseEvents(true);
    const area = screen.getPrimaryDisplay().workArea;
    window.setPosition(area.x + area.width - 1, area.y + area.height - 1);
    window.showInactive();
  }

  window.loadURL(DESK).catch((cause) => console.error(`fabrika: the window could not load ${DESK}`, cause));
  return window;
};

/** The sender is the window's own top frame, showing the desk page of our files. */
const fromItsPage = (window: BrowserWindow, event: IpcMainEvent) => {
  const frame = event.senderFrame;
  return (
    event.sender === window.webContents &&
    frame !== null &&
    frame.parent === null &&
    isOurs(frame.url) &&
    isDesk(frame.url)
  );
};

/** How deep a page's message may nest: deeper is refused, as no message of the app's is. */
const DEEPEST = 32;

/**
 * Is `v` a plain JSON value: what goes on a host's socket as one line. A port carries far more
 * (a Map, a cycle, a BigInt), and one of those must not end the link for every tile.
 */
const plain = (v: unknown, depth = 0): boolean => {
  if (depth > DEEPEST) {
    return false;
  }

  if (v === null || typeof v === "string" || typeof v === "boolean") {
    return true;
  }

  if (typeof v === "number") {
    return Number.isFinite(v);
  }

  if (Array.isArray(v)) {
    return v.every((x) => plain(x, depth + 1));
  }

  if (typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype) {
    return false;
  }

  return Object.values(v).every((x) => plain(x, depth + 1));
};

/**
 * The ports handed to one window's page, by name: one per name, and a new one closes the old.
 * With the page gone, there is no port, and what would go on one is dropped: the next page is
 * shown everything again by its host.
 */
const portsFor = (window: BrowserWindow) => {
  const ports = new Map<string, MessagePortMain>();
  const push = (name: string, heard: (raw: unknown) => void) => {
    if (!isPortName(name) || window.isDestroyed() || !isDesk(window.webContents.getURL())) {
      return;
    }

    ports.get(name)?.close();
    const { port1, port2 } = new MessageChannelMain();
    port1.on("message", (message) => heard(message.data));
    port1.start();
    ports.set(name, port1);
    window.webContents.postMessage(PORT_CHANNEL, name, [port2]);
  };
  const post = (name: string, m: unknown) => ports.get(name)?.postMessage(m);
  const gone = (name: string) => {
    ports.get(name)?.close();
    ports.delete(name);
  };
  /** The page was loaded again, or its window closed: every port it had is dead. */
  const reset = () => {
    for (const port of ports.values()) {
      port.close();
    }

    ports.clear();
  };
  return { push, post, gone, reset };
};

/** What one try to attach came to, from why it failed, in words for the window. */
const triedOf = (e: unknown): Tried => {
  if (e instanceof NoHost) {
    return { kind: "lost", why: `The host did not start: ${e.why}.` };
  }

  if (e instanceof NoHello) {
    return { kind: "lost", why: `The host did not answer: it said no hello within ${e.within}.` };
  }

  if (e instanceof NotStopped) {
    return { kind: "lost", why: `The old host did not stop: ${e.why}.` };
  }

  if (!(e instanceof Unattached)) {
    return { kind: "lost", why: `The host could not be started: ${String(e)}.` };
  }

  if (e.why.kind === "version") {
    return { kind: "version", theirs: e.why.theirs, ours: e.why.ours };
  }

  if (e.why.kind === "project") {
    return { kind: "lost", why: "Another project's host answered on this project's socket." };
  }

  return { kind: "lost", why: `The host did not answer: ${e.why.what}.` };
};

/** The link that is up now, and the scope it lives in: closed once the link ends. */
type Held = { readonly wire: Wire<Up>; readonly scope: Scope.Closeable };

/** Is what a window shows now the same as what it was told last? Each is plain data. */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A folder as a person reads it: under `~` when it is in their home. Kept in private state only. */
const shownPath = (root: string): string => {
  const mine = homedir();
  return root === mine || root.startsWith(`${mine}/`) ? `~${root.slice(mine.length)}` : root;
};

type Refusal = Extract<WindowLook, { readonly _tag: "welcome" }>["refusal"];

/** One window: welcome (`key` null) or one project's, with its own ports, link and asks. */
interface Win {
  readonly id: string;
  readonly window: BrowserWindow;
  readonly ports: ReturnType<typeof portsFor>;
  /** The project it shows, by key; `null` on welcome. */
  key: string | null;
  /** Its page said hello, and is to be shown the desk once its link is up. */
  paged: boolean;
  held: Held | null;
  /** What its page was told of the link last. */
  said: LinkNow | null;
  /** What its page was told it shows last, and its project rows. */
  look: WindowLook | null;
  rows: unknown;
  /** Why the last folder or move this welcome window asked for was refused. */
  refusal: Refusal;
  /** The ask keys its host's last count knew; `null` before its first count. */
  known: ReadonlySet<string> | null;
  /** The scope its link lives in, closed with the window. */
  link: Scope.Closeable | null;
  /** Its reconnect machine's dispatch, once its link is made. */
  again: ((m: { readonly type: "again" | "restart" }) => void) | null;
}

/** Who presses in this app: the person at the window. */
const PERSON = "user:owner";

const main = Effect.gen(function* () {
  yield* Effect.tryPromise({
    try: () => app.whenReady(),
    catch: (cause) => new Error("Electron did not get ready", { cause }),
  });
  guard();
  const path = yield* Path.Path;
  const icon = path.join(DIST, "icon.png");

  // A quiet start has no Dock icon to set. An unpackaged app has no icon of its own otherwise.
  if (launch.kind !== "quiet") {
    app.dock?.setIcon(icon);
  }

  const files = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  protocol.handle(SCHEME, (request) => Effect.runPromiseWith(files)(answer(DIST, request.url)));
  const home = app.getPath("userData");
  const scope = yield* Effect.scope;
  const clock = yield* Effect.clockWith(Effect.succeed);
  const now = () => clock.currentTimeMillisUnsafe();
  const ctx = yield* Effect.context<ChildProcessSpawner.ChildProcessSpawner | Path.Path | FileSystem.FileSystem>();
  /** Run one piece of work in the background, with the app's platform. */
  const fork = <A, E>(
    body: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Path.Path | FileSystem.FileSystem>,
  ) => Effect.runFork(body.pipe(Effect.provideContext(ctx)));

  // ------------------------------------------------------------ the app's own files

  const recordsFile = path.join(home, "records", "projects.jsonl");
  /** One record of the app's own, with the app's clock, written before the call returns. */
  const keep = (record: ProjectRecord) => {
    try {
      mkdirSync(path.dirname(recordsFile), { recursive: true, mode: 0o700 });
      appendFileSync(recordsFile, `${JSON.stringify({ ...record, at: now() })}\n`, { mode: 0o600 });
    } catch (cause) {
      console.warn(`fabrika: a record was not kept: ${String(cause)}`);
    }
  };
  const sessionFile = path.join(home, "session.json");
  const decodeSession = Schema.decodeUnknownExit(Schema.fromJsonString(Session));
  /** The session, written beside its file and moved over, so it is never read half written. */
  const saveSession = (s: Session) => {
    try {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(`${sessionFile}.new`, JSON.stringify(s), { mode: 0o600 });
      renameSync(`${sessionFile}.new`, sessionFile);
    } catch (cause) {
      console.warn(`fabrika: the session was not saved: ${String(cause)}`);
    }
  };

  // ------------------------------------------------------------ windows

  const windows = new Map<string, Win>();
  /** A project's window, by its key. */
  const windowOf = (key: string): Win | undefined => [...windows.values()].find((w) => w.key === key);
  /** The window that asked for each project still opening: welcome becomes it. */
  const askedFrom = new Map<string, string>();
  /**
   * Projects whose opening the old desk's move refused. The machine learns of it by a message
   * that lands after this opening's `open_window` already reads the model, so the window must
   * not depend on the model for that: a refused opening makes no window.
   */
  const refusedOpening = new Set<string>();
  /** The opening a refused move waits on, for Try Again. */
  let retryable: { readonly project: Project; readonly source: Source } | null = null;
  /** The projects machine's model, as it last changed. */
  let model: Projects | null = null;

  /** The recent list as windows show it: each name distinct (project.ts, `titles`), paths short. */
  const named = (recent: readonly Recent[]): readonly Recent[] => {
    const titled = Project.titles(
      recent.map((r) => r.project),
      400,
    );
    return recent.map((r, i) => ({
      ...r,
      name: titled[i]?.full ?? r.name,
      path: shownPath(r.project.root),
    }));
  };
  const toPage = (win: Win, m: ToPage) => win.ports.post("desk", m);
  /** Tell a window what it shows, and its project rows, when either changed. */
  const tell = (win: Win) => {
    if (model === null || !win.paged) {
      return;
    }

    const recent = named(model.recent);
    const mine = win.key === null ? undefined : recent.find((r) => r.project.key === win.key);
    const look: WindowLook =
      mine === undefined
        ? { _tag: "welcome", recent, refusal: win.refusal }
        : { _tag: "project", project: mine.project, name: mine.name };

    if (!same(look, win.look)) {
      win.look = look;
      toPage(win, { type: "window", look });
    }

    const shown = mine === undefined ? null : rows(recent, mine.project.key);

    if (shown !== null && !same(shown, win.rows)) {
      win.rows = shown;
      toPage(win, { type: "project_rows", rows: shown });
    }
  };

  /** Bring a window forward. Quiet, it is only shown, never focused (launch.ts). */
  const bringForward = (win: Win) => {
    if (win.window.isDestroyed()) {
      return;
    }

    if (launch.kind === "quiet") {
      return win.window.showInactive();
    }

    if (win.window.isMinimized()) {
      win.window.restore();
    }

    win.window.focus();
  };

  /** The window in front, or the one made last. */
  const focusedWin = (): Win | undefined => {
    const front = BrowserWindow.getFocusedWindow();
    const all = [...windows.values()];
    return all.find((w) => w.window === front) ?? all.at(-1);
  };

  // ------------------------------------------------------------ one project's link

  /** Start a project's host: the app's own binary as Node, detached, let go (start-host.ts). */
  const startOne = (project: Project) =>
    Effect.gen(function* () {
      return yield* startHost({
        binary: process.execPath,
        entry: path.join(DIST, "host.mjs"),
        home: yield* Project.home(home, project),
        paths: yield* Project.paths(home, project),
        project,
        settings: settingsFolder(launch, app.getPath("home")),
      });
    });

  const toHost = (win: Win, m: Up) => win.held?.wire.send(m);
  const onTo = (win: Win, name: string) => (raw: unknown) => {
    if (plain(raw)) {
      toHost(win, { type: "on", port: name, m: raw });
    } else {
      console.warn(`fabrika: refused a message on ${name} that is no plain JSON`);
    }
  };
  /** A port whose messages go to the window's own host, under its name. */
  const relay = (win: Win, name: string) => win.ports.push(name, onTo(win, name));

  /** Notifications shown, held so their click is still heard. */
  const notices = new Set<Notification>();
  /**
   * A project host's count of asks, on its way to the page: the projects machine totals them for
   * the Dock's badge. A new ask is told by the system's notification only when its window is not
   * in front, and never on a quiet start; a click on it brings that project's window back.
   */
  const heardAsks = (win: Win, asks: AsksNow) => {
    const key = win.key;

    if (key === null) {
      return;
    }

    dispatch({ type: "asks", key, asks: asks.asks });
    const fresh = newAsks(win.known, asks);
    win.known = keysOf(asks);
    const [first, ...rest] = fresh;

    if (first === undefined || launch.kind === "quiet" || win.window.isFocused()) {
      return;
    }

    if (!Notification.isSupported()) {
      return;
    }

    const notice = new Notification(noticeOf([first, ...rest]));
    notices.add(notice);
    notice.on("close", () => notices.delete(notice));
    notice.on("click", () => {
      notices.delete(notice);
      dispatch({ type: "notification", key });
      const shown = windowOf(key);

      if (shown !== undefined) {
        toPage(shown, { type: "show", what: "asks" });
      }
    });
    notice.show();
  };

  /** What a project's host sends one window: the asks read on the way, ports made as it asks. */
  const fromHost = (win: Win) => (m: Down) => {
    switch (m.type) {
      case "hello":
        return;
      // The desk's port is this process's own: it is made on the page's hello.
      case "port":
        if (m.port !== "desk") {
          relay(win, m.port);
        }

        return;
      case "to": {
        if (m.port === "desk") {
          const asks = readAsks(m.m);

          if (asks.kind === "read") {
            heardAsks(win, asks.msg.now);
          }
        }

        return win.ports.post(m.port, m.m);
      }
      case "gone":
        return win.ports.gone(m.port);
      case "close":
        return win.window.close();
    }
  };

  /** A window's link to its project's host: its own reconnect machine, in a scope of its own. */
  const linkUp = (win: Win, project: Project) =>
    Effect.gen(function* () {
      const link = yield* Scope.fork(scope);
      win.link = link;
      const options = {
        home: yield* Project.home(home, project),
        deliver: fromHost(win),
        start: startOne(project),
        project: { key: project.key, paths: yield* Project.paths(home, project) },
      };
      /** One try, in a scope of its own that lives as long as the link it makes. */
      const tryWith = (how: typeof attach | typeof restart) =>
        Effect.gen(function* () {
          const one = yield* Scope.fork(link);
          const exit = yield* how(options).pipe(Scope.provide(one), Effect.provideContext(ctx), Effect.exit);

          if (Exit.isFailure(exit)) {
            yield* Scope.close(one, exit);
            return triedOf(Cause.squash(exit.cause));
          }

          win.held = { wire: exit.value.wire, scope: one };
          // A new link's first count tells of no ask: those were known, or are old news.
          win.known = null;

          if (win.paged) {
            exit.value.wire.send({ type: "page" });
          }

          return exit.value.found satisfies Tried;
        });
      /** The person confirmed the restart: this window lets go of the old host's link first. */
      const tryRestart = Effect.gen(function* () {
        const held = win.held;
        win.held = null;

        if (held !== null) {
          yield* Scope.close(held.scope, Exit.void);
        }

        return yield* tryWith(restart);
      });
      const watch = Effect.gen(function* () {
        const held = win.held;
        const why = held === null ? "it was not there" : yield* held.wire.ended;

        if (win.held === held) {
          win.held = null;
        }

        if (held !== null) {
          yield* Scope.close(held.scope, Exit.void);
        }

        return { type: "ended", why: `The link to the host ended: ${why}.`, at: now() } as const;
      });
      const reconnect = yield* run(reconnectMachine, {
        interpret: {
          attach: () => tryWith(attach),
          restart: () => tryRestart,
          jitter: (c) => Effect.sync(() => backoffDelay(c.attempt, POLICY, defaultRng)),
        },
        subscribe: { link: () => Stream.fromEffect(watch) },
        clock: now,
      }).pipe(Scope.provide(link));
      // The window hears of the link only when what it would say changes: not on every wait.
      reconnect.observe((_, s) => {
        const note = noteOf(s);

        if (same(note, win.said)) {
          return;
        }

        win.said = note;

        if (note !== null) {
          toPage(win, { type: "link", now: note });
        }
      });
      win.again = (m) => {
        Effect.runFork(reconnect.dispatch(m).pipe(Effect.ignore));
      };
    });

  /** A new window: welcome until a project is opened in it. */
  const newWindow = (): Win => {
    const window = deskWindow(path.join(DIST, "preload.cjs"), icon, launch);
    const win: Win = {
      id: String(window.id),
      window,
      ports: portsFor(window),
      key: null,
      paged: false,
      held: null,
      said: null,
      look: null,
      rows: null,
      refusal: null,
      known: null,
      link: null,
      again: null,
    };
    windows.set(win.id, win);
    window.once("closed", () => {
      windows.delete(win.id);
      win.ports.reset();
      // Nothing stops: the host only stops showing this window anything.
      toHost(win, { type: "away" });
      const link = win.link;

      if (link !== null) {
        Effect.runFork(Scope.close(link, Exit.void));
      }

      if (win.key !== null) {
        dispatch({ type: "closed", key: win.key });
      }

      if (windows.size === 0) {
        closedAll?.();
      }
    });
    return win;
  };
  /** Told once the last window has closed, while the app quits. */
  let closedAll: (() => void) | null = null;

  // ------------------------------------------------------------ opening

  /** Say why an opening was refused: in welcome's own words, or over the project's window. */
  const refuse = (win: Win, refusal: NonNullable<Refusal>) => {
    if (win.key === null) {
      win.refusal = refusal;
      return tell(win);
    }

    dialog
      .showMessageBox(win.window, {
        type: "warning",
        message: refusal.why,
        buttons: ["OK"],
        defaultId: 0,
        cancelId: 0,
      })
      .catch((cause) => console.warn(`fabrika: the refusal was not shown: ${String(cause)}`));
  };

  /** Open a checked project, from the window that asked. */
  const openChecked = (win: Win, project: Project, source: Source) => {
    win.refusal = null;

    if (windowOf(project.key) === undefined) {
      askedFrom.set(project.key, win.id);
    }

    dispatch({ type: "open", project, source, said: Date.now(), by: PERSON });
  };

  /** A folder, checked: a project, or a refusal in words (none names the folder). */
  const checked = (folder: string, win: Win, source: Source) =>
    fork(
      Project.check(folder).pipe(
        Effect.match({
          onFailure: (e) => refuse(win, { _tag: "folder", why: e instanceof ProjectRefused ? e.why : String(e) }),
          onSuccess: (project) => openChecked(win, project, source),
        }),
      ),
    );

  /** A recent row: its root is checked again, so a folder that moved is refused and its row stays. */
  const openRecent = (win: Win, key: string, source: Source) => {
    const known = model?.recent.find((r) => r.project.key === key);

    if (known !== undefined) {
      checked(known.project.root, win, source);
    }
  };

  /** The system's folder sheet, over the window that asked. */
  const chooseFolder = (win: Win) => {
    dialog
      .showOpenDialog(win.window, { properties: ["openDirectory"], buttonLabel: "Open" })
      .then((picked) => {
        const [folder] = picked.filePaths;

        if (picked.canceled || folder === undefined) {
          return dispatch({ type: "cancel" });
        }

        checked(folder, win, "sheet");
      })
      .catch((cause) => console.warn(`fabrika: the folder sheet did not open: ${String(cause)}`));
  };

  /** Try Again, after the old desk did not move: the same opening, from the same window. */
  const retry = (win: Win) => {
    const waiting = retryable;

    if (waiting === null) {
      return;
    }

    retryable = null;
    openChecked(win, waiting.project, waiting.source);
  };

  /**
   * Before a project's host first starts on this app home: the old single desk, if there is one,
   * moves into its project. A live old host is stopped only once the person accepts.
   */
  const moveOldDesk = (project: Project) =>
    Effect.gen(function* () {
      if ((yield* migrated(home)) || !(yield* hasLegacy(home))) {
        return;
      }

      const legacy = yield* pathsOf(home);
      const live = () => reach(legacy.sock).pipe(Effect.map((r) => r === "live"));
      const accepted = (yield* live())
        ? yield* Effect.promise(() =>
            dialog
              .showMessageBox({
                type: "question",
                message: "Move your saved work into this project?",
                detail: "The old host still runs. Restarting it stops its running jobs; their saved work stays.",
                buttons: ["Restart and Move", "Not Now"],
                defaultId: 0,
                cancelId: 1,
              })
              .then((r) => r.response === 0),
          )
        : true;
      yield* migrateProject({
        home,
        legacy: home,
        project,
        restart: accepted ? "accepted" : "refused",
        live,
        stop: () => stopHost(home, legacy).pipe(Effect.ignore, Effect.provideContext(ctx)),
      });
    });

  /** The desk's port of one window: the app's own requests stay here; the rest go to its host. */
  const deskPort = (win: Win) => {
    win.ports.push("desk", (raw) => {
      const own = readToApp(raw);

      if (own.kind !== "read") {
        // A page's message goes to its own project's host, through the parent, and no other.
        if (win.key !== null) {
          dispatch({ type: "page", key: win.key, sender: win.id, m: raw });
        }

        return;
      }

      const m = own.msg;

      switch (m.type) {
        case "again":
        case "restart":
          return win.again?.({ type: m.type });
        case "open":
          return openRecent(win, m.key, m.source);
        case "folder":
          return chooseFolder(win);
        case "retry":
          return retry(win);
      }
    });
  };

  /**
   * Where the projects machine is kept between launches: the session file. The machine's own
   * `save_session` writes it when the recent or restore list changes, and before quit closes a
   * window, so the store only reads it back at launch.
   */
  const store = {
    load: () =>
      Promise.resolve(
        (() => {
          try {
            return readFileSync(sessionFile, "utf8");
          } catch {
            return null;
          }
        })(),
      ),
    save: () => Promise.resolve(),
    migrate: (raw: unknown) => {
      if (raw === null) {
        return null;
      }

      const read = decodeSession(raw);
      return Exit.isSuccess(read) ? restored(read.value) : refuseSaved("session.json does not read");
    },
  };

  /** The Cmds of the projects machine. */
  const projects = yield* run(projectsMachine, {
    store,
    interpret: {
      // The old desk moves first; the window's link reaches or starts the host itself.
      start_host: (c) =>
        Effect.sync(() => refusedOpening.delete(c.project.key)).pipe(
          Effect.andThen(moveOldDesk(c.project)),
          Effect.as(null),
          Effect.catch((e) =>
            Effect.sync(() => {
              const why = e instanceof MigrationRefused ? e.why : String(e);
              const from = windows.get(askedFrom.get(c.project.key) ?? "");
              askedFrom.delete(c.project.key);
              retryable = { project: c.project, source: "welcome" };
              refusedOpening.add(c.project.key);
              dispatch({ type: "open_failed", key: c.project.key, why });

              if (from !== undefined) {
                refuse(from, { _tag: "migration", why });
              }

              return null;
            }),
          ),
          Effect.provideContext(ctx),
        ),
      open_window: (c) =>
        Effect.sync(() => {
          // A refused move already failed this opening: nothing to show.
          if (refusedOpening.delete(c.key) || model?.projects[c.key]?.opening == null) {
            return null;
          }

          const from = windows.get(askedFrom.get(c.key) ?? "");
          askedFrom.delete(c.key);
          const win = from !== undefined && from.key === null ? from : newWindow();
          win.key = c.key;
          win.refusal = null;
          fork(linkUp(win, c.project));
          dispatch({ type: "opened", key: c.key, window: win.id });
          return null;
        }),
      focus_window: (c) =>
        Effect.sync(() => {
          const win = windowOf(c.key);

          if (win !== undefined) {
            bringForward(win);
          }

          return null;
        }),
      close_window: (c) =>
        Effect.sync(() => {
          windowOf(c.key)?.window.close();
          return null;
        }),
      save_session: (c) =>
        Effect.sync(() => {
          saveSession(c.session);
          return null;
        }),
      record: (c) =>
        Effect.sync(() => {
          keep(c.record);
          return null;
        }),
      to_host: (c) =>
        Effect.sync(() => {
          const win = windowOf(c.key);

          if (win !== undefined && plain(c.m)) {
            toHost(win, { type: "on", port: "desk", m: c.m });
          }

          return null;
        }),
      focus_row: () =>
        Effect.sync(() => {
          for (const win of windows.values()) {
            if (win.key === null) {
              toPage(win, { type: "projects" });
            }
          }

          return null;
        }),
      choose_folder: () =>
        Effect.sync(() => {
          const win = focusedWin();

          if (win !== undefined) {
            chooseFolder(win);
          }

          return null;
        }),
      badge: (c) =>
        Effect.sync(() => {
          app.setBadgeCount(c.count);
          return null;
        }),
    },
  }).pipe(Scope.provide(scope));
  // subscribe hears each transition before its Cmds run, so a Cmd's interpreter reads the state
  // that made it (observe would hear only after them). It does not hear boot: the first state,
  // read back from session.json, is read once the machine is up.
  let up: { getState: () => Projects } | null = null;
  projects.subscribe(() => {
    if (up === null) {
      return;
    }

    model = up.getState();

    for (const win of windows.values()) {
      tell(win);
    }
  });
  up = yield* projects.ready;
  model = up.getState();

  for (const win of windows.values()) {
    tell(win);
  }

  const dispatch = (m: ProjectsMsg) => {
    Effect.runFork(projects.dispatch(m).pipe(Effect.ignore));
  };

  // ------------------------------------------------------------ the menu

  /**
   * The app's menu: the platform's own, with File's two openings (projects.ts, `projectMenu`).
   * Cmd-O is Open Project…, the projects box; Open Folder… shows the folder sheet.
   */
  const mac = process.platform === "darwin";
  const file: MenuItemConstructorOptions[] = [
    ...projectMenu(defaults, mac).map((item): MenuItemConstructorOptions => ({
      label: item.label,
      ...(item.accelerator === undefined ? {} : { accelerator: item.accelerator }),
      click: () => {
        const win = focusedWin();

        if (win === undefined) {
          return;
        }

        if (item.action === "folder") {
          return chooseFolder(win);
        }

        if (win.key === null) {
          return dispatch({ type: "projects" });
        }

        toPage(win, { type: "projects" });
      },
    })),
    { type: "separator" },
    mac ? { role: "close" } : { role: "quit" },
  ];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" as const }] : []),
      { label: "File", submenu: file },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );

  // ------------------------------------------------------------ pages

  ipcMain.on(PORT_CHANNEL, (event) => {
    const win = [...windows.values()].find((w) => fromItsPage(w.window, event));

    if (win === undefined) {
      console.warn(`fabrika: refused a hello from ${event.senderFrame?.url ?? "a frame that is gone"}`);
      return;
    }

    // A hello is a page load: the ports of the page before are dead, and it is shown everything again.
    win.ports.reset();
    win.paged = true;
    win.look = null;
    win.rows = null;
    deskPort(win);
    tell(win);

    if (win.said !== null) {
      toPage(win, { type: "link", now: win.said });
    }

    if (win.held !== null) {
      win.held.wire.send({ type: "page" });
    }
  });

  /** The window in front or made last, or a new welcome window when there is none. */
  const showSome = () => {
    const win = focusedWin();

    if (win !== undefined) {
      return bringForward(win);
    }

    newWindow();
  };
  app.on("second-instance", showSome);
  app.on("activate", showSome);
  // Electron's own pattern: on macOS the app stays with no window; elsewhere it quits.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  newWindow();

  // Until the app is asked to quit: Cmd-Q, or the last window closed off macOS.
  yield* Effect.callback<void>((resume) => {
    const asked = (event: { preventDefault: () => void }) => {
      event.preventDefault();
      resume(Effect.void);
    };
    app.once("before-quit", asked);
    return Effect.sync(() => app.off("before-quit", asked));
  });
  // The restore list is saved, then the windows close; each close is kept as a record before
  // the scope closes and every link with it. The hosts run on.
  yield* Effect.callback<void>((resume) => {
    if (windows.size === 0) {
      return resume(Effect.void);
    }

    closedAll = () => resume(Effect.void);
    dispatch({ type: "quit" });

    for (const win of windows.values()) {
      if (win.key === null) {
        win.window.close();
      }
    }
  }).pipe(Effect.timeout("3 seconds"), Effect.ignore);
  yield* Effect.sleep("100 millis");
}).pipe(
  Effect.scoped,
  Effect.provide(
    NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
  ),
);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  Effect.runFork(
    main.pipe(
      Effect.matchCause({
        onFailure: (cause) => {
          console.error(Cause.pretty(cause));
          app.exit(1);
        },
        // Asked once already: this time nothing holds the quit back. Not from inside the
        // `before-quit` that asked: a quit asked within that event is undone when the
        // event's own preventDefault returns. On the next turn.
        onSuccess: () => {
          setImmediate(() => app.quit());
        },
      }),
    ),
  );
}
