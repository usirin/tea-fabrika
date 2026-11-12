import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Ledger, memoryStorage, openJobs, streams, Traces } from "@kampus/fabrika-old";
import { layerSqliteSync } from "@kampus/fabrika-old/sqlite";
import { sealAsk } from "@kampus/pipeline/tickets/ask";
import { nameOf } from "@kampus/pipeline/tickets/ticket";
import { Author, pullRequestsOf } from "@tea-fabrika/tracker";
import { Effect, Exit, Layer, Scope, Stream } from "effect";
import { NetAddress } from "effect/net";
import { type Socket, SocketServer } from "effect/socket";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { DRAFT, OWNER } from "../../../fixtures/ask-desk/cases.ts";
import type { Ask, AsksNow } from "./asks.ts";
import { defaults } from "./desk/keymap.ts";
import { memoryHistory, sharedHistory } from "./editor/history.ts";
import { serve } from "./host/serve.ts";
import { readUp, type Down, type Up } from "./link.ts";

// Today's version, review 5 finding 5; plan: "Record each newly sent notice."
// Real main, host message handlers and SQLite. Electron and the socket are test doubles.
// Unrelated programs/terminals do not start. No OS notification, socket or focus is used.
// main starts on welcome and links a window to a host only once a project opens (ticket 276),
// so each run opens a git working tree first, as a person does: File > Open Folder….
type MenuTemplate = readonly {
  readonly label?: string;
  readonly submenu?: MenuTemplate;
  readonly click?: () => void;
}[];

const bridge = vi.hoisted(() => ({
  home: "",
  /** The folder the folder sheet answers: a git working tree. */
  folder: "",
  menu: null as MenuTemplate | null,
  toApp: null as ((msg: Down) => void) | null,
  toHost: null as ((msg: Up) => void) | null,
  focused: false,
  supported: true,
  shown: [] as { title: string; body: string }[],
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const app = Object.assign(new EventEmitter(), {
    whenReady: async () => {},
    getPath: () => bridge.home,
    setBadgeCount() {},
    requestSingleInstanceLock: () => true,
    dock: { setIcon() {} },
    quit: vi.fn(),
    exit: vi.fn(),
  });
  let ids = 0;
  class Window extends EventEmitter {
    static getFocusedWindow() {
      return null;
    }

    readonly id = ++ids;
    private closed = false;
    readonly webContents = { getURL: () => "", postMessage() {} };

    isFocused() {
      return bridge.focused;
    }

    isDestroyed() {
      return this.closed;
    }

    loadURL() {
      return Promise.resolve();
    }

    close() {
      if (!this.closed) {
        this.closed = true;
        this.emit("closed");
      }
    }
  }
  class Notification extends EventEmitter {
    static isSupported() {
      return bridge.supported;
    }

    constructor(readonly options: { title: string; body: string }) {
      super();
    }

    show() {
      bridge.shown.push(this.options);
    }
  }
  return {
    app,
    BrowserWindow: Window,
    Menu: {
      buildFromTemplate: (template: MenuTemplate) => {
        bridge.menu = template;
        return template;
      },
      setApplicationMenu() {},
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [bridge.folder] }),
    },
    Notification,
    ipcMain: new EventEmitter(),
    nativeTheme: { shouldUseDarkColors: true },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    shell: { openExternal: async () => {} },
  };
});

vi.mock("@kampus/fabrika-design", async (original) => ({
  ...(await original<typeof import("@kampus/fabrika-design")>()),
  frameColor: () => "#000000",
  followLook() {},
}));

// A fake owner's Electron process uses the test home. No foreground flag or real window.
vi.mock("./launch.ts", async (original) => ({
  ...(await original<typeof import("./launch.ts")>()),
  launchOf: () => ({ kind: "owner" }),
}));

vi.mock("./attach.ts", async (original) => {
  const actual = await original<typeof import("./attach.ts")>();
  return {
    ...actual,
    attach: (options: { deliver: (msg: Down) => void }) =>
      Effect.sync(() => {
        bridge.toApp = options.deliver;
        return {
          found: { kind: "up" },
          wire: {
            send: (msg: Up) => {
              const read = readUp(msg);

              if (read.kind !== "read") {
                throw new Error(read.why);
              }

              bridge.toHost?.(read.msg);
            },
            ended: Effect.never,
          },
        };
      }),
  };
});

vi.mock("./wire.ts", async (original) => ({
  ...(await original<typeof import("./wire.ts")>()),
  hostWire: (_socket: unknown, deliver: (msg: Up) => void) =>
    Effect.sync(() => {
      bridge.toHost = deliver;
      return {
        send: (msg: Down) => bridge.toApp?.(msg),
        ended: Effect.never,
        state: () => ({ at: "up" }),
      };
    }),
}));

vi.mock("./tsh.ts", () => ({ appPrograms: () => [], tshList: () => [] }));
vi.mock("./tiles.ts", () => ({ startTiles: () => Effect.succeed({ open: () => Effect.void }) }));

// The property sends exact snapshots to main. Ledger polling is unrelated to recording a send.
vi.mock("./asks.ts", async (original) => ({
  ...(await original<typeof import("./asks.ts")>()),
  asksOptions: (ctx: unknown) => ({
    ctx,
    interpret: { load: () => Effect.succeed({ entries: [], last: 0 }) },
    subscribe: { poll: () => Stream.never, clock: () => Stream.never },
  }),
}));

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** File > Open Folder…, from main's own menu: the folder sheet answers `bridge.folder`. */
const openFolder = () => {
  const file = bridge.menu?.find((item) => item.label === "File")?.submenu;
  const item = file?.find((entry) => entry.label === "Open Folder…");

  if (item?.click === undefined) {
    throw new Error("main built no File > Open Folder… item");
  }

  item.click();
};

const snapshot = (asks: readonly Ask[]): Down => ({
  type: "to",
  port: "desk",
  m: { type: "asks", now: { asks, later: [], reach: "ok", why: null } satisfies AsksNow },
});

const contains = (value: unknown, wanted: unknown): boolean =>
  value === wanted ||
  (typeof value === "object" && value !== null && Object.values(value).some((child) => contains(child, wanted)));

// Plant present: notice.show() sends the OS notice but neither main nor the host keeps a record.
it("every newly sent notice has one lasting record tied to its ask and ticket", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 100_000 }),
      fc.integer({ min: 1, max: 4 }),
      async (firstTicket, total) => {
        vi.resetModules();
        bridge.home = mkdtempSync("/tmp/fn-");
        bridge.folder = join(bridge.home, "repo");
        execFileSync("git", ["init", "-q", bridge.folder]);
        vi.stubEnv("FABRIKA_HOME", bridge.home);
        vi.stubEnv("TYPESAFE_API_KEY", undefined);
        bridge.menu = null;
        bridge.toApp = null;
        bridge.toHost = null;
        bridge.shown = [];
        bridge.focused = false;
        bridge.supported = true;
        const scope = Effect.runSync(Scope.make());
        const sqlite = layerSqliteSync({ path: join(bridge.home, "ledger.sqlite") });
        const context = await Effect.runPromise(Layer.build(sqlite).pipe(Scope.provide(scope)));
        const onLedger = <A, E>(effect: Effect.Effect<A, E, Ledger>) =>
          Effect.runPromise(effect.pipe(Effect.provideContext(context)));
        let app: (typeof import("electron"))["app"] | undefined;

        try {
          const socketServer = SocketServer.SocketServer.of({
            address: NetAddress.unixPathAddress("in-process"),
            // hostWire above supplies the transport. The real server owns the receive callback.
            run: (handler) => handler({} as Socket.Socket).pipe(Effect.andThen(Effect.never), Effect.orDie),
          });
          await Effect.runPromise(
            Effect.gen(function* () {
              const jobs = yield* openJobs(memoryStorage());
              const history = yield* sharedHistory(memoryHistory());
              const keys = { version: "test", keys: defaults, changes: [] };
              yield* serve({
                jobs,
                history,
                pid: process.pid,
                ledger: { kind: "own" },
                desk: { kept: null, save: () => Effect.void, forget: Effect.void },
                asks: { kept: null, save: () => Effect.void },
                keybindings: {
                  current: Effect.succeed(keys),
                  changes: Stream.make(keys),
                  edit: () => Effect.succeed(keys),
                },
              }).pipe(Effect.forkIn(scope));
            }).pipe(
              Scope.provide(scope),
              Effect.provideContext(context),
              Effect.provideService(Author, OWNER),
              Effect.provide(pullRequestsOf([])),
              Effect.provideService(Traces, { read: () => Effect.never, watch: () => Stream.never }),
              Effect.provideService(SocketServer.SocketServer, socketServer),
            ),
          );
          await vi.waitFor(() => expect(bridge.toHost).not.toBeNull());
          ({ app } = await import("electron"));
          await import("./main.ts");
          await vi.waitFor(() => expect(bridge.menu).not.toBeNull());
          openFolder();
          await vi.waitFor(() => expect(bridge.toApp).not.toBeNull());
          // Let main keep the attachment before its first count.
          await settle();
          bridge.toApp!(snapshot([]));
          const rows: Ask[] = [];

          for (let index = 0; index < total; index++) {
            const ticket = firstTicket + index;
            const ask = `a-notice-${ticket}`;
            await onLedger(
              Effect.gen(function* () {
                const ledger = yield* Ledger;
                yield* ledger.register(nameOf(ticket), "user:owner");
                const sealed = yield* sealAsk({ ...DRAFT, ask });
                yield* ledger.send(streams(nameOf(ticket)).inbox, ask, {
                  kind: "asked",
                  writer: "agent:plan for:owner",
                  data: sealed,
                });
              }),
            );
            rows.push({
              key: `${ticket}/${ask}`,
              ticket,
              title: `Ticket ${ticket}`,
              kind: "ask",
              what: DRAFT.what,
              at: index,
              seen: false,
            });
            bridge.toApp!(snapshot(rows));
            bridge.toApp!(snapshot(rows)); // A repeated count sends and records nothing extra.
          }

          expect(bridge.shown).toHaveLength(total);
          const readNotices = Effect.gen(function* () {
            const ledger = yield* Ledger;
            return (yield* ledger.read(0, 1000)).filter((row) => /notic|notif/.test(row.kind));
          });
          await vi.waitFor(async () =>
            expect(await onLedger(readNotices), "OS notices were sent without lasting notice records").toHaveLength(
              total,
            ),
          );
          // Stop both clients, close SQLite, then read with a fresh connection.
          app.emit("before-quit", { preventDefault() {} });
          await settle();
          await Effect.runPromise(Scope.close(scope, Exit.void));
          const recorded = await Effect.runPromise(readNotices.pipe(Effect.provide(sqlite), Effect.scoped));
          expect(recorded).toHaveLength(total);

          for (const row of rows) {
            const matching = recorded.filter((record) => {
              const data: unknown = JSON.parse(record.data);
              return contains(data, row.key) || contains(data, `a-notice-${row.ticket}`);
            });
            expect(matching).toHaveLength(1);
            const record = matching[0]!;
            const data: unknown = JSON.parse(record.data);
            expect(Number.isFinite(record.at)).toBe(true);
            expect(record.stream.startsWith(nameOf(row.ticket)) || contains(data, row.ticket)).toBe(true);
          }
        } finally {
          app?.emit("before-quit", { preventDefault() {} });
          await settle();
          await Effect.runPromise(Scope.close(scope, Exit.void));
          vi.unstubAllEnvs();
          rmSync(bridge.home, { recursive: true, force: true });
        }
      },
    ),
    { seed: 119120, numRuns: 20 },
  );
});
