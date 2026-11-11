import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { App, BrowserWindow } from "electron";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { corner, quietEnv } from "./src/launch.ts";

// The one door for a test window, today's version: every e2e script launches the app through
// `launch`, and nothing else imports Playwright's `_electron` (.oxlintrc.json). A test window
// stays out of the way of the person at the laptop (AGENTS.md, "Go easy on the machine"):
//
//   the home        its own, short: a fresh one under the temp root, or the one given. An empty
//                   home, or one whose socket path passes macOS's limit, is refused before
//                   Electron starts
//   the env         the parent's, less FABRIKA_FOREGROUND (launch.ts, `quietEnv`), so the start
//                   is quiet and the app hides the window itself before it is ever shown
//   the size        `size` only: content size, then back to the work area's corner. A test never
//                   moves a window by hand
//   the watch       loaded into the main process with Electron's `-r`, before the app's own first
//                   line and so before `ready` and the first window: every OS focus and every
//                   window shown. `close` fails on any focus, or on a window seen above opacity 0
//
// Playwright's API is promises, and this file stays in it, as e2e.ts does.

const here = import.meta.dirname;
const electronPath: string = createRequire(import.meta.url)("electron");

/** One thing the watch saw in the main process: a window taking OS focus, or shown. */
interface Seen {
  readonly event: "focus" | "show";
  readonly window: number;
  readonly opacity: number;
  readonly at: string;
}

export interface TestWindow {
  readonly app: ElectronApplication;
  readonly home: string;
  readonly page: () => Promise<Page>;
  /** setContentSize, then back to the corner: a test never moves a window by hand. */
  readonly size: (width: number, height: number) => Promise<void>;
  /** Fails when any window took OS focus or was seen with opacity above 0, then closes. */
  readonly close: () => Promise<void>;
}

/** The env for a test window on this home, or a plain error before anything starts. */
const envFor = (parent: Readonly<Record<string, string | undefined>>, home: string) => {
  const made = quietEnv(parent, home);

  if (made.kind === "long") {
    throw new Error(`a test window's home is too long for the host's socket: ${made.home}`);
  }

  if (made.kind === "empty") {
    throw new Error("a test window needs a home: an empty FABRIKA_HOME starts the owner's app");
  }

  return made.env;
};

/**
 * The watch, as the main process runs it: Electron loads it with `-r` before the app's code, so it
 * sees every window from the moment it is made, and keeps its list on `globalThis` for `close`. It
 * goes over as source, as `evaluate`'s functions do, so it reads nothing from this file's scope.
 */
const watch = ({ app }: { readonly app: App }) => {
  const seen: Seen[] = [];
  const note = (event: Seen["event"], window: BrowserWindow) =>
    seen.push({ event, window: window.id, opacity: window.getOpacity(), at: new Date().toISOString() });
  app.on("browser-window-focus", (_event, window) => note("focus", window));
  app.on("browser-window-created", (_event, window) => window.on("show", () => note("show", window)));
  Object.assign(globalThis, { testWindowSeen: seen });
};

/** The watch as a file for `-r`, in a folder of its own that `close` removes. */
const watchFile = async () => {
  const folder = await mkdtemp(join(tmpdir(), "fw-"));
  const file = join(folder, "watch.cjs");
  await writeFile(file, `(${String(watch)})(require("electron"));\n`);
  return { folder, file };
};

/** What the watch saw, or null when it never loaded. */
const seenBy = (app: ElectronApplication) =>
  app.evaluate((): Seen[] | null => (globalThis as { testWindowSeen?: Seen[] }).testWindowSeen ?? null);

/** Every window as it is now, and the work area they sit in. */
const read = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, screen }) => ({
    area: screen.getPrimaryDisplay().workArea,
    windows: BrowserWindow.getAllWindows().map((w) => ({ window: w.id, opacity: w.getOpacity(), ...w.getBounds() })),
  }));

export const launch = async (options: {
  readonly prefix?: string;
  readonly home?: string;
  readonly cwd?: string;
  /** The parent env to start from, in place of this process's own. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<TestWindow> => {
  const home = options.home ?? (await mkdtemp(join(tmpdir(), options.prefix ?? "fh-")));
  const env = envFor(options.env ?? process.env, home);
  const watching = await watchFile();
  const app = await _electron
    .launch({
      executablePath: electronPath,
      args: ["-r", watching.file, here],
      env,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    })
    .catch(async (e: unknown) => {
      await rm(watching.folder, { recursive: true, force: true });
      throw e;
    });

  const size = async (width: number, height: number) => {
    const bounds = await app.evaluate(
      ({ BrowserWindow }, to) => {
        const [window] = BrowserWindow.getAllWindows();

        if (window === undefined) {
          throw new Error("no app window to size");
        }

        window.setContentSize(to.width, to.height);
        return window.getBounds();
      },
      { width, height },
    );
    const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    await app.evaluate(
      ({ BrowserWindow }, at) => BrowserWindow.getAllWindows()[0]?.setPosition(at.x, at.y),
      corner(area, bounds),
    );
  };

  const close = async () => {
    const now = await Promise.all([seenBy(app), read(app)]).then(
      ([seen, windows]) => (seen === null ? { failed: "the watch never loaded" } : { seen, ...windows }),
      (e: unknown) => ({ failed: String(e) }),
    );
    await app.close().catch(() => {});
    await rm(watching.folder, { recursive: true, force: true });

    if ("failed" in now) {
      throw new Error(`the test window on ${home} could not be read before it closed: ${now.failed}`);
    }

    const focus = now.seen.filter((s) => s.event === "focus");
    const shown = now.seen.filter((s) => s.opacity !== 0);
    const open = now.windows.filter((w) => w.opacity !== 0);
    console.log(
      `window: ${home}, area ${JSON.stringify(now.area)}, windows ${JSON.stringify(now.windows)}, focus ${focus.length}`,
    );

    if (focus.length > 0 || shown.length > 0 || open.length > 0) {
      throw new Error(
        `the test window on ${home} got in the way: ${JSON.stringify({ focus, shown, open, seen: now.seen })}`,
      );
    }
  };

  return { app, home, page: () => app.firstWindow(), size, close };
};

/** e2e.ts's second copy on the same home, through the same quietEnv: it must bring the first forward and quit. */
export const secondCopy = (home: string): Promise<"quit" | "failed"> =>
  promisify(execFile)(electronPath, [here], { env: envFor(process.env, home), timeout: 20_000 }).then(
    () => "quit" as const,
    (e: unknown) => {
      console.error(`the second copy failed: ${String(e)}`);
      return "failed" as const;
    },
  );
