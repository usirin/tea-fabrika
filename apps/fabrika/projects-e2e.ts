import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import type { BaseWindow, MessageBoxOptions, OpenDialogOptions } from "electron";
import * as fc from "fast-check";
import type { ElectronApplication, Page } from "playwright";
import { deskMachine, savedOf } from "./src/desk/desk.ts";
import * as TestWindow from "./test-window.ts";

// Today's app, T276 PR 1. Real git projects and real windows. Only the native folder sheet's
// answer is supplied by the test. All navigation and changes use keys, buttons and menu items.
// Run through e2e.ts --projects. The builder owns the resulting images, not this test step.
// Every launch goes through test-window.ts, so each window stays out of the way, and its `close`
// fails the run when one took OS focus or was seen.

const prepareProject = async (home: string, root = join(home, "fixture-project")) => {
  const { Project } = await import("./src/project.ts");
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);
  const project = await Effect.runPromise(Project.check(root).pipe(Effect.provide(platform)));
  const paths = await Effect.runPromise(Project.paths(home, project).pipe(Effect.provide(platform)));
  return { project, paths, home: join(home, "projects", project.key) };
};

const prepared = new Map<string, ReturnType<typeof prepareProject>>();

export const testProject = (home: string, root?: string) => {
  const key = `${home}\0${root ?? ""}`;
  let project = prepared.get(key);

  if (!project) {
    project = prepareProject(home, root);
    prepared.set(key, project);
  }

  return project;
};

const layouts = ["one", "side", "stacked", "2x2", "small"] as const;
type Layout = (typeof layouts)[number];
type Look = "dark" | "light";

function check(ok: boolean, why: string): asserts ok {
  if (!ok) {
    throw new Error(why);
  }
}

const required = <A>(value: A | null | undefined): A => {
  if (value === null || value === undefined) {
    throw new Error("required test value is absent");
  }

  return value;
};

/**
 * Read until the value is accepted. `ms` is how long a wait may last: 10 s for what the page does
 * by itself, 30 s for what needs a new window, its host and its shell, which start slowly when the
 * machine is busy (the run is niced); a wait that the run's own state makes certain to fail
 * (`fail` returns a reason) stops at once with that reason instead of timing out.
 */
const until = async <A>(
  read: () => Promise<A>,
  accepts: (a: A) => boolean,
  ms = 10_000,
  fail: () => Promise<string | null> = async () => null,
): Promise<A> => {
  for (let i = 0; i < ms / 50; i++) {
    const value = await read();

    if (accepts(value)) {
      return value;
    }

    const why = await fail();

    if (why !== null) {
      throw new Error(why);
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("project check timed out");
};

const fixture = () => {
  const home = realpathSync(mkdtempSync("/tmp/fh."));
  const name = "fixture-project-with-a-long-name-that-must-stay-usable";
  // The app shows a folder under its `~` as `~/...`, so the run's HOME is its own home and the
  // projects sit at `~/work/<left|right>/<name>`: a short, neutral path, and no shot or row shows
  // this machine's account, its temp folder or its real home. FABRIKA_SETTINGS stays the run's too.
  const projects = [join(home, "work", "left", name), join(home, "work", "right", name)] as const;

  for (const [index, root] of projects.entries()) {
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, "a.txt"), `project-${index}\n`);
    writeFileSync(join(root, "b.txt"), "fixture\n");
  }

  const env: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !/API_KEY$/.test(name) && !["FABRIKA_FOREGROUND", "FABRIKA_REPO"].includes(name)) {
      env[name] = value;
    }
  }

  env.FABRIKA_HOME = home;
  env.HOME = home;
  return { home, projects, name, env };
};

type Fixture = ReturnType<typeof fixture>;

const launch = async (f: Fixture) => {
  try {
    return await TestWindow.launch({ home: f.home, env: f.env });
  } catch (error) {
    rmSync(f.home, { recursive: true, force: true });
    throw error;
  }
};

const openedPages = new WeakMap<ElectronApplication, Map<string, Page>>();

/** The project windows this app has shown, by each project's real root. */
const openedIn = (app: ElectronApplication) => {
  const known = openedPages.get(app) ?? new Map<string, Page>();
  openedPages.set(app, known);
  return known;
};

const button = (page: Page) => page.getByRole("button", { name: /^Project .+, switch project$/ });
const box = (page: Page) => page.getByRole("dialog", { name: "Open a project…", exact: true });
const tile = (page: Page) => page.locator('[data-tile][aria-current="true"]');
const screen = async (page: Page) => (await page.locator("[data-tile] .screen-text").allTextContents()).join("\n");

/**
 * The current tile shows its prompt, and has shown the same screen for 400 ms. A prompt read once
 * can be the old project's tile in a window that is still switching, or a shell that has drawn its
 * prompt but is not yet reading keys, so keys typed on it are lost; a screen that stands still is
 * the one the keys will reach.
 */
const prompt = async (page: Page) => {
  const read = () => tile(page).locator(".screen-text").textContent();
  let last: string | null | undefined;
  let still = 0;
  return until(
    async () => {
      const text = await read();
      still = text === last && text?.split("\n").at(-1) === "tsh$" ? still + 1 : 0;
      last = text;
      return still;
    },
    (n) => n >= 8,
    30_000,
  ).catch((error: unknown) => {
    throw new Error(
      `project check timed out: no settled tsh$ prompt; the screen last read was ${JSON.stringify(last)}`,
      { cause: error },
    );
  });
};

const command = async (page: Page, line: string) => {
  await prompt(page);
  await tile(page).click();
  await page.keyboard.type(line);
  await until(
    () => screen(page),
    (text) => text.includes(`tsh$ ${line}`),
    30_000,
  );
  await page.keyboard.press("Enter");
};

const prefix = async (page: Page, key: string) => {
  await page.keyboard.press("Control+b");
  await page.keyboard.press(key);
};

/** What the projects box looks like now, for a failure message: its options and the option's box. */
const boxState = async (page: Page, optionBox?: string) => {
  const dialog = box(page);
  const options = await dialog
    .getByRole("option")
    .allTextContents()
    .catch(() => []);
  const animations = await dialog
    .evaluate((el) => el.getAnimations({ subtree: true }).map((a) => `${a.playState}`))
    .catch(() => null);
  return `dialogs=${await page.getByRole("dialog").count()} box=${await dialog.count()} options=${JSON.stringify(options)} animations=${JSON.stringify(animations)} optionBox=${
    optionBox ??
    JSON.stringify(
      await dialog
        .getByRole("option", { name: /Open Folder…/ })
        .boundingBox()
        .catch(() => null),
    )
  }`;
};

export const openFixtureProject = async (app: ElectronApplication, from: Page, root: string | null) => {
  // A fresh window has not drawn yet: wait for the welcome's option or the project button.
  await until(
    async () => (await from.getByRole("option", { name: /Open Folder…/ }).count()) + (await button(from).count()),
    (n) => n > 0,
  );
  const wasWelcome = (await button(from).count()) === 0;
  // In a project window the option sits in the projects box, whose pop-in animation moves and
  // resizes it for a moment; a click then lands where the option no longer is and does nothing.
  // Ready is the box with its option, every animation under the box finished, and the option's
  // box the same on two reads in a row. In the welcome the option itself is the signal.
  const option = (wasWelcome ? from : box(from)).getByRole("option", { name: /Open Folder…/ });

  if (!wasWelcome) {
    let lastBox: string | undefined;
    await until(
      async () => {
        if ((await box(from).count()) === 0 || (await option.count()) === 0) {
          return false;
        }

        const settled = await box(from)
          .evaluate((el) => el.getAnimations({ subtree: true }).every((a) => a.playState === "finished"))
          .catch(() => false);
        const now = JSON.stringify(await option.boundingBox().catch(() => null));
        const same = now === lastBox && now !== "null";
        lastBox = now;
        return settled && same;
      },
      (ready) => ready,
    ).catch(async (error: unknown) => {
      throw new Error(`the projects box never became ready: ${await boxState(from, lastBox)}`, {
        cause: error,
      });
    });
  }

  const known = openedIn(app);
  await app.evaluate(({ dialog, BrowserWindow }, folder) => {
    // The sheet takes its window first, or only its options: the test's answer is for the first.
    dialog.showOpenDialog = async (...args: [BaseWindow, OpenDialogOptions] | [OpenDialogOptions]) => {
      const [parent, options] = args.length === 2 ? args : [undefined, args[0]];
      // A refusal thrown here reaches no one: the product's ask fails inside the app and no
      // window ever opens, which the test would see only as a timeout. The reason is kept where
      // the test reads it, so its wait stops with it.
      const refuse = (why: string): never => {
        Reflect.set(globalThis, "projectSheetRefusal", why);
        throw new Error(why);
      };
      Reflect.set(globalThis, "projectSheetRefusal", null);

      if (!options.properties?.includes("openDirectory")) {
        return refuse("not a folder sheet");
      }

      const requester = BrowserWindow.getAllWindows().find((window) => window === parent);

      if (requester === undefined) {
        return refuse("sheet has no requesting window");
      }

      const dialogs = await requester.webContents.executeJavaScript(
        "document.querySelectorAll('[role=\"dialog\"]').length",
      );

      if (dialogs !== 0) {
        return refuse("P28: sheet stacked over projects box");
      }

      return { canceled: folder === null, filePaths: folder === null ? [] : [folder] };
    };
    // Not asked yet: the wait after the click reads this slot.
    Reflect.set(globalThis, "projectSheetRefusal", undefined);
  }, root);
  const before = new Set(app.windows());
  const folder = from.getByRole("option", { name: /Open Folder…/ });

  if (await folder.count()) {
    await folder.click();
  } else {
    await from.getByRole("button", { name: "Open Folder…", exact: true }).click();
  }

  // The click must have asked for the sheet (the handler sets the slot to null or a reason;
  // undefined is never asked). A box still open with no ask is a click that did not act.
  if (!wasWelcome) {
    await until(
      async () => ({
        asked: await app.evaluate(() => Reflect.get(globalThis, "projectSheetRefusal") !== undefined),
        open: await box(from).count(),
      }),
      (seen) => seen.asked || seen.open === 0,
      5_000,
    ).catch(async (error: unknown) => {
      throw new Error(`the click on Open Folder… did not ask for the folder sheet; ${await boxState(from)}`, {
        cause: error,
      });
    });
  }

  if (root === null) {
    await until(
      () => box(from).count(),
      (n) => n === 0,
    );
    return from;
  }

  const canonical = realpathSync(root);
  const appHome = await app.evaluate(() => process.env.FABRIKA_HOME);

  if (!appHome) {
    throw new Error("project test has no private app home");
  }

  await testProject(appHome, canonical);
  const existing = known.get(canonical);
  const page = await until(
    async () => {
      if (existing && !existing.isClosed() && (await box(from).count()) === 0) {
        return existing;
      }

      for (const page of app.windows()) {
        if (!before.has(page) && (await button(page).count())) {
          return page;
        }
      }

      if (wasWelcome && !from.isClosed() && (await button(from).count())) {
        return from;
      }

      return null;
    },
    (page) => page !== null,
    30_000,
    () =>
      app.evaluate(() => {
        const why: unknown = Reflect.get(globalThis, "projectSheetRefusal");
        return typeof why === "string" ? why : null;
      }),
  ).catch(async (error: unknown) => {
    const windows = await Promise.all(
      app
        .windows()
        .filter((p) => !p.isClosed())
        .map(async (p) => ({
          title: await p.title(),
          button: await button(p).count(),
          alerts: await p.getByRole("alert").allTextContents(),
          new: !before.has(p),
        })),
    );
    const asked: unknown = await app.evaluate(() => Reflect.get(globalThis, "projectSheetRefusal"));
    throw new Error(
      `no window showed the picked project; sheet ${JSON.stringify(asked)}, windows ${JSON.stringify(windows)}, ${await boxState(from)}`,
      { cause: error },
    );
  });
  const found = required(page);
  known.set(canonical, found);
  return found;
};

const switchTo = async (page: Page, parent: "left" | "right") => {
  await page.keyboard.press("Meta+o");
  await box(page).waitFor();
  const row = box(page).getByRole("option").filter({ hasText: parent });
  await row.click();
  await until(
    () => box(page).count(),
    (n) => n === 0,
  );
};

/** Is this process still there? Signal 0 only asks. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Close the window, stop this run's hosts and remove its home. A window that got in the way fails
 * the run, but only after the hosts are stopped and the home is gone.
 */
const dispose = async (win: TestWindow.TestWindow, f: Fixture) => {
  const inWay = await win.close().then(
    () => null,
    (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
  );
  // Only hosts this run started, from its own private project homes. Never pgrep or a key file.
  const projects = join(f.home, "projects");
  let keys: string[] = [];

  try {
    keys = readdirSync(projects);
  } catch {}

  const pids: number[] = [];

  for (const key of keys) {
    try {
      const record = JSON.parse(readFileSync(join(projects, key, "project.json"), "utf8"));

      if (!f.projects.includes(record.root)) {
        continue;
      }

      const selected = await testProject(f.home, record.root);
      const pid = Number(readFileSync(selected.paths.pid, "utf8").trim());

      if (Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid) {
        process.kill(pid, "SIGTERM");
        pids.push(pid);
      }
    } catch {}
  }

  // A host still writes (its log, its ledger, its records) until it has exited: the home goes only
  // after every host this run signalled is gone, 10 s at most, then it is killed and waited for.
  for (let i = 0; i < 200 && pids.some(alive); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  for (const pid of pids.filter(alive)) {
    process.kill(pid, "SIGKILL");
  }

  for (let i = 0; i < 40 && pids.some(alive); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  rmSync(f.home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });

  if (inWay !== null) {
    throw inWay;
  }
};

const e1 = async () => {
  const f = fixture();
  let win = await launch(f);
  let { app } = win;

  try {
    const welcome = await app.firstWindow();
    await welcome.getByRole("heading", { name: "Open a folder to start", exact: true }).waitFor();
    check((await welcome.locator("[data-tile]").count()) === 0, "P5: welcome started a tile");
    const pages = [];

    for (const [index, root] of f.projects.entries()) {
      const from = index === 0 ? welcome : required(pages[0]);

      if (index !== 0) {
        await from.keyboard.press("Meta+o");
      }

      const chosen = process.env.PROJECT_PLANT === "shared-host" && index === 1 ? f.projects[0] : root;
      const page = await openFixtureProject(app, from, chosen);
      pages.push(page);
      await command(page, "counter");

      for (let count = 0; count <= index; count++) {
        await page.getByRole("button", { name: "+1", exact: true }).click();
      }

      await prefix(page, "|");
      await command(page, "summon fake as scout");
      await prompt(page);
      await command(page, "@scout read a.txt");
      await until(
        () => screen(page),
        (text) => text.includes(`project-${index}`),
      );
      check(!(await screen(page)).includes(`project-${1 - index}`), "E1: harness read sibling work");
    }

    await switchTo(required(pages[1]), "left");
    await required(pages[0]).keyboard.press("Meta+o");
    await openFixtureProject(app, required(pages[0]), null);
    check(app.windows().length === 2, "E1: cancel changed project windows");

    for (const page of pages) {
      await page.close();
    }

    await win.close();
    win = await launch(f);
    ({ app } = win);
    let recent = await app.firstWindow();
    await recent.getByRole("heading", { name: "Open a folder to start" }).waitFor();
    check(app.windows().length === 1, "E1: PR 1 automatically reopened projects");

    for (const [index, parent] of ["left", "right"].entries()) {
      const currentApp = app;
      const before = new Set(app.windows());
      await recent.getByRole("option").filter({ hasText: parent }).click();
      const page = await until(
        async () => {
          for (const page of currentApp.windows()) {
            if ((!before.has(page) || page === recent) && (await button(page).count())) {
              return page;
            }
          }

          return null;
        },
        (p) => p !== null,
      );
      check(page !== null, "E1: recent did not open project");
      await page.getByRole("button", { name: "+1", exact: true }).waitFor();
      check((await page.locator(".counter-n").textContent()) === String(index + 1), "E1: counter work was lost");
      await command(page, "agents");
      await until(
        () => screen(page),
        (text) => /scout.*idle/.test(text),
      );
      await page.close();
      await win.close();
      win = await launch(f);
      ({ app } = win);
      recent = await app.firstWindow();
      await recent.getByRole("heading", { name: "Open a folder to start" }).waitFor();
    }

    console.log("ok E1: open, switch, cancel, close, and reopen from recents kept independent work");
  } finally {
    await dispose(win, f);
  }
};

interface RecordedProjectFlow {
  readonly credential: string;
  readonly refusal: boolean;
  readonly failure: "git" | "migration" | "host" | "summon";
  readonly order: readonly string[];
}

const recordText = (folder: string): string[] => {
  let files: string[];

  try {
    files = readdirSync(folder);
  } catch {
    return [];
  }

  const text: string[] = [];

  for (const file of files) {
    const path = join(folder, file);

    if (/\.(sqlite|db)$/.test(file)) {
      const db = new DatabaseSync(path, { readOnly: true });

      try {
        for (const table of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
          const name = String(table.name).replaceAll('"', '""');

          for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) {
            text.push(JSON.stringify(row));
          }
        }
      } finally {
        db.close();
      }
    } else if (/\.(json|jsonl)$/.test(file)) {
      text.push(readFileSync(path, "utf8"));
    }
  }

  return text;
};

const observe = async (win: TestWindow.TestWindow, f: Fixture) => {
  const { app } = win;
  const captures = await app.evaluate(
    () => Reflect.get(globalThis, "projectTestOutputs") as { urls: string[]; errors: string[] },
  );
  const labels: string[] = [];
  const errors = [...captures.errors];

  for (const page of app.windows()) {
    labels.push(await page.title(), ...(await page.getByRole("option").allTextContents()));
    errors.push(...(await page.getByRole("alert").allTextContents()));
  }

  await win.close();
  let keys: string[] = [];

  try {
    keys = readdirSync(join(f.home, "projects"));
  } catch {}

  const records = recordText(join(f.home, "records"));
  const logs: string[] = [];
  const spans: string[] = [];

  for (const key of keys) {
    const folder = join(f.home, "projects", key);
    records.push(...recordText(join(folder, "records")));
    // sqliteRecords keeps the real tracer's rows in these same private databases.
    spans.push(...recordText(join(folder, "records")));

    try {
      logs.push(readFileSync(join(folder, "host", "log"), "utf8"));
    } catch {}
  }

  return {
    "app records": records,
    "host logs": logs,
    spans,
    "outgoing URLs": captures.urls,
    "visible errors": errors,
    "public capture labels": labels,
  };
};

// The property tests call this real outside route. There is no product-only testing API and
// no fabricated output list. It reads only this run's record databases, JSON records and logs.
const observeProjectFlow = async (flow: RecordedProjectFlow) => {
  const f = fixture();
  f.env.FABRIKA_REPO = `https://fixture:${encodeURIComponent(flow.credential)}@fixture.invalid/repo`;
  f.env.OPENAI_API_KEY = flow.credential; // Made up, and only the fake agent is ever selected.
  const win = await launch(f);
  const { app } = win;

  try {
    await app.evaluate(({ shell, dialog }) => {
      const outputs = { urls: [] as string[], errors: [] as string[] };
      Reflect.set(globalThis, "projectTestOutputs", outputs);
      shell.openExternal = async (url) => {
        outputs.urls.push(url);
      };
      dialog.showMessageBox = async (...args: [BaseWindow, MessageBoxOptions] | [MessageBoxOptions]) => {
        const options = args.length === 2 ? args[1] : args[0];
        outputs.errors.push(options.message ?? "", options.detail ?? "");
        return { response: options.cancelId ?? 0, checkboxChecked: false };
      };
    });
    let page = await app.firstWindow();
    await page.getByRole("heading", { name: "Open a folder to start" }).waitFor();
    page = await openFixtureProject(app, page, f.projects[0]);
    await command(page, "summon fake as scout");
    await prompt(page);
    await command(page, "@scout read a.txt");
    await prompt(page);

    for (const action of flow.order) {
      if (action === "close") {
        continue;
      } // The final close below flushes records before reading.

      if (action === "refuse" || (flow.refusal && action === "retry")) {
        await page.keyboard.press("Meta+o");
        await app.evaluate(
          ({ dialog }, root) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
          },
          join(f.home, `rejected-${encodeURIComponent(flow.credential)}`),
        );
        await box(page)
          .getByRole("option", { name: /Open Folder…/ })
          .click();
        await until(
          () => box(page).count(),
          (n) => n === 0,
        );
      } else if (action === "cancel") {
        await page.keyboard.press("Meta+o");
        await openFixtureProject(app, page, null);
      } else if (action === "open" || action === "retry" || action === "focus") {
        await page.keyboard.press("Meta+o");
        page = await openFixtureProject(app, page, f.projects[1]);
        await prompt(page);
      }
    }

    if (flow.failure === "summon") {
      await command(page, "summon fake ultra as refused");
      await prompt(page);
    }

    if (flow.failure === "git") {
      const rejected = join(f.home, `not-git-${encodeURIComponent(flow.credential)}`);
      mkdirSync(rejected, { recursive: true });
      await page.keyboard.press("Meta+o");
      await app.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      }, rejected);
      await box(page)
        .getByRole("option", { name: /Open Folder…/ })
        .click();
    }

    if (flow.failure === "host") {
      // A root that disappeared after being recorded must produce a safe visible refusal.
      rmSync(f.projects[0], { recursive: true, force: true });
      await page.keyboard.press("Meta+o");
      const old = box(page).getByRole("option").filter({ hasText: "left" });

      if (await old.count()) {
        await old.click();
      } else {
        await page.keyboard.press("Escape");
      }
    }

    if (flow.failure === "migration") {
      writeFileSync(join(f.home, "desk.json"), `{"unknownSavedShape":${JSON.stringify(flow.credential)}}`);
      await page.keyboard.press("Meta+o");
      await openFixtureProject(app, page, f.projects[1]);
    }

    return await observe(win, f);
  } finally {
    await dispose(win, f);
  }
};

/**
 * Each press P17 drives in the built app, and the source and picked pair its opening records must
 * carry (T276 amendment 4): the box from Cmd-O, the project button or File > Open Project…, then a
 * row or its Open Folder…; File > Open Folder…; and a welcome row or welcome's Open Folder….
 */
const PRESS_RECORDS = {
  "cmd-o row": { source: "box", picked: "recent" },
  "button row": { source: "button", picked: "recent" },
  "menu row": { source: "menu", picked: "recent" },
  "cmd-o folder": { source: "box", picked: "folder" },
  "button folder": { source: "button", picked: "folder" },
  "menu folder": { source: "menu", picked: "folder" },
  "file folder": { source: "sheet", picked: "folder" },
  "welcome row": { source: "welcome", picked: "recent" },
  "welcome folder": { source: "welcome", picked: "folder" },
} as const;

/** A press P17 drives in the built app: how the box was shown, or the sheet or welcome, then what was picked. */
type ProjectPress = keyof typeof PRESS_RECORDS;

/** The app's own opening records so far, in the order it wrote them (`<home>/records/projects.jsonl`). */
const openingRecords = (home: string): Record<string, unknown>[] => {
  let text = "";

  try {
    text = readFileSync(join(home, "records", "projects.jsonl"), "utf8");
  } catch {
    return [];
  }

  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record._tag === "opening");
};

/** File's item with this label, clicked as the menu clicks it: main.ts sends it to the window in front. */
const clickFileItem = (app: ElectronApplication, label: "Open Project…" | "Open Folder…") =>
  app.evaluate(({ Menu }, wanted) => {
    const all = (items: readonly Electron.MenuItem[]): Electron.MenuItem[] =>
      items.flatMap((item) => [item, ...(item.submenu ? all(item.submenu.items) : [])]);
    const item = all(Menu.getApplicationMenu()?.items ?? []).find((i) => i.label === wanted);

    if (item === undefined) {
      throw new Error(`the File menu has no ${wanted}`);
    }

    item.click();
  }, label);

/** The project window main.ts treats as in front when none is focused: the last one made. */
const front = async (app: ElectronApplication): Promise<Page> =>
  required(
    await until(
      async () => {
        for (const page of [...app.windows()].reverse()) {
          if (!page.isClosed() && (await button(page).count())) {
            return page;
          }
        }

        return null;
      },
      (page) => page !== null,
      30_000,
    ),
  );

/** The window that shows this project: its title names the project's parent folder. */
const windowOf = async (app: ElectronApplication, parent: "left" | "right"): Promise<Page> =>
  required(
    await until(
      async () => {
        for (const page of app.windows()) {
          if (!page.isClosed() && (await button(page).count()) && (await page.title()).includes(parent)) {
            return page;
          }
        }

        return null;
      },
      (page) => page !== null,
      30_000,
    ),
  );

/**
 * P17's built-app route: each press, by keys, clicks and menu items in the real app, and the opening
 * records it wrote. Welcome's press comes first, since only a fresh window shows welcome; a welcome
 * row needs a recent project, so the app opens one from welcome's Open Folder…, quits and launches
 * again. A row needs the other project among the recents, so a folder press comes before the first
 * row. Those setup presses are steps too: each step names the press it made.
 */
const observePresses = async (
  presses: readonly ProjectPress[],
): Promise<readonly { readonly press: ProjectPress; readonly records: readonly Record<string, unknown>[] }[]> => {
  const f = fixture();
  const parents = ["left", "right"] as const;
  const steps: { press: ProjectPress; records: Record<string, unknown>[] }[] = [];
  let win = await launch(f);
  let { app } = win;

  /** Run one press and keep the opening records it wrote, waiting for the one that ends it. */
  const recorded = async (press: ProjectPress, act: () => Promise<void>) => {
    const before = openingRecords(f.home).length;
    await act();
    const records = await until(
      async () => openingRecords(f.home).slice(before),
      (rows) => rows.some((row) => ["opened", "focused", "failed"].includes(String(row.result))),
      30_000,
    );
    steps.push({ press, records });
  };

  try {
    let page = await app.firstWindow();
    await page.getByRole("heading", { name: "Open a folder to start" }).waitFor();
    const welcomeFirst = presses.find((p) => p.startsWith("welcome")) ?? "welcome folder";
    await recorded("welcome folder", async () => {
      page = await openFixtureProject(required(app), page, f.projects[0]);
    });

    if (welcomeFirst === "welcome row") {
      await win.close();
      win = await launch(f);
      ({ app } = win);
      const again = await app.firstWindow();
      await again.getByRole("heading", { name: "Open a folder to start" }).waitFor();
      await recorded("welcome row", async () => {
        await again.getByRole("option").filter({ hasText: parents[0] }).click();
      });
      // One recent project, so its title has no parent folder to tell it by (project.ts `titles`):
      // the one project window is the one in front. A later press that picks this project again
      // finds it as open, as one opened through Open Folder… is.
      page = await front(app);
      openedIn(app).set(realpathSync(f.projects[0]), page);
    }

    let current: 0 | 1 = 0;
    const rest = presses.filter((p) => !p.startsWith("welcome"));
    const ordered: ProjectPress[] = rest[0]?.endsWith("row") === true ? ["cmd-o folder", ...rest] : [...rest];

    for (const press of ordered) {
      const other: 0 | 1 = current === 0 ? 1 : 0;
      const live = required(app);
      const [by, pick] = press.split(" ") as [string, string];

      if (by === "file") {
        await live.evaluate(({ dialog }, root) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
        }, f.projects[other]);
        await recorded(press, () => clickFileItem(live, "Open Folder…"));
        page = await windowOf(live, parents[other]);
        current = other;
        continue;
      }

      // File > Open Project… goes to the window in front, so the press starts there.
      const from = by === "menu" ? await front(live) : page;
      current = (await from.title()).includes(parents[1]) ? 1 : 0;
      const target: 0 | 1 = current === 0 ? 1 : 0;
      await recorded(press, async () => {
        if (by === "cmd-o") {
          await from.keyboard.press("Meta+o");
        } else if (by === "button") {
          await button(from).click();
        } else {
          await clickFileItem(live, "Open Project…");
        }

        await box(from).waitFor();

        if (pick === "row") {
          await box(from).getByRole("option").filter({ hasText: parents[target] }).click();
        } else {
          await openFixtureProject(live, from, f.projects[target]);
        }
      });
      page = await windowOf(live, parents[target]);
      current = target;
    }

    await win.close();
    return steps;
  } finally {
    await dispose(win, f);
  }
};

// P17's and P29's built-app halves. They launch the built app, so they run here, in the e2e run
// that builds it first (`pnpm e2e`, CI's e2e job), and not in vitest's test job, which never
// builds it. projects.laws.test.ts keeps their machine halves and plants, and reads the field
// list, the outputs, the credentials and the leak check from here, so a plant breaks the very
// check this run makes on the real app.

/** The shared seed (AGENTS.md); each property below is 3 real launches of about 15 s each. */
const BUILT = { seed: 119120, numRuns: 3 };

/** The fields each kind of record keeps (P17). */
export const RECORD_FIELDS = {
  opening: ["id", "project", "root", "window", "source", "picked", "by", "said", "at", "result", "why"],
  migration: ["format", "project", "rule", "files", "digests", "phase", "at", "result"],
  host: ["project", "root", "build", "pid", "settings", "reason"],
  summon: ["project", "name", "folder", "run", "model", "effort", "by", "input", "output", "cost"],
  turn: ["project", "name", "folder", "run", "model", "effort", "by", "input", "output", "cost"],
  close: ["project", "window", "source", "at", "outcome"],
} as const;

/** Every object in some record or log lines, JSON inside strings included. */
const objectsIn = (texts: readonly string[]) => {
  const objects: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      try {
        visit(JSON.parse(value));
      } catch {}

      return;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        visit(child);
      }

      return;
    }

    if (value === null || typeof value !== "object") {
      return;
    }

    objects.push(value as Record<string, unknown>);

    for (const child of Object.values(value)) {
      visit(child);
    }
  };

  for (const text of texts) {
    for (const line of text.split("\n")) {
      visit(line);
    }
  }

  return objects;
};

/** P29's named outputs: each must exist, and none may hold the credential in any form. */
export const SECRET_OUTPUTS = [
  "app records",
  "host logs",
  "spans",
  "outgoing URLs",
  "visible errors",
  "public capture labels",
] as const;

const word = fc.stringMatching(/^[a-z][a-z0-9-]{0,14}$/);

/** P29's generated flows: a made-up credential, a refusal or not, one failure and an order of operations. */
export const CREDENTIALS = fc.record({
  credential: fc.tuple(word, word).map(([a, b]) => `made-up-${a}:${b}@pass /?&%`),
  refusal: fc.boolean(),
  failure: fc.constantFrom("git", "migration", "host", "summon"),
  order: fc.array(fc.constantFrom("open", "cancel", "refuse", "retry", "focus", "close"), {
    minLength: 1,
    maxLength: 16,
  }),
});

const forms = (credential: string) => [
  credential,
  encodeURI(credential),
  encodeURIComponent(credential),
  encodeURIComponent(encodeURIComponent(credential)),
  new URLSearchParams({ key: credential }).toString().slice(4),
  Buffer.from(credential).toString("base64"),
  Buffer.from(credential).toString("base64url"),
];

/** P29's check: throws when an output is missing or holds the credential, plain or encoded. */
export const secretsCheck = (credential: string, observed: Readonly<Record<string, unknown>>) => {
  for (const output of SECRET_OUTPUTS) {
    check(output in observed, `P29: no ${output} was read`);
    const text = JSON.stringify(observed[output]);

    for (const [i, form] of forms(credential).entries()) {
      check(!text.includes(form), `P29: the credential reached ${output}, in form ${i}`);
    }
  }
};

/** P17 and P29 on the real built app, each a property over generated flows. */
export const builtLaws = async () => {
  // P17: the built app's records keep each host, summon, turn and close.
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom("open", "focus", "cancel", "close"), { minLength: 1, maxLength: 6 }),
      async (order) => {
        const observed = await observeProjectFlow({
          credential: "made-up-fixture-key",
          refusal: false,
          failure: "summon",
          order,
        });
        const objects = objectsIn([...observed["app records"], ...observed["host logs"]]);

        for (const kind of ["host", "summon", "turn", "close"] as const) {
          const fields: readonly string[] = RECORD_FIELDS[kind];
          check(
            objects.some((row) => fields.every((field) => field in row)),
            `P17: missing real ${kind} record`,
          );
        }
      },
    ),
    BUILT,
  );
  // P17: each press's opening records keep its source and picked pair. At most one welcome press:
  // only a fresh window shows welcome.
  await fc.assert(
    fc.asyncProperty(
      fc
        .tuple(
          fc.constantFrom("welcome row", "welcome folder"),
          fc.shuffledSubarray(
            (Object.keys(PRESS_RECORDS) as ProjectPress[]).filter((press) => !press.startsWith("welcome")),
            { minLength: 1 },
          ),
        )
        .map(([welcome, rest]): ProjectPress[] => [welcome, ...rest]),
      async (presses) => {
        const steps = await observePresses(presses);
        check(
          presses.every((press) => steps.some((step) => step.press === press)),
          `P17: a press was not driven: ${presses.join(", ")}`,
        );

        for (const step of steps) {
          check(step.records.length > 0, `P17: ${step.press} wrote no opening record`);

          for (const record of step.records) {
            const fields: readonly string[] = RECORD_FIELDS.opening;
            const missing = fields.filter((field) => !(field in record));
            check(missing.length === 0, `P17: ${step.press}'s opening record lacks ${missing.join(", ")}`);
            const wanted = PRESS_RECORDS[step.press];
            check(
              record.source === wanted.source && record.picked === wanted.picked,
              `P17: ${step.press} recorded ${String(record.source)}/${String(record.picked)}`,
            );
          }
        }
      },
    ),
    BUILT,
  );
  console.log("ok P17: the built app's records keep each host, summon, turn and close, and each press's pair");
  // P29: generated refusals, failures and operation orders keep every named output clean.
  await fc.assert(
    fc.asyncProperty(CREDENTIALS, async (flow) => {
      const observed = await observeProjectFlow(flow);
      secretsCheck(flow.credential, observed);

      for (const output of ["app records", "host logs", "spans", "public capture labels"] as const) {
        check(observed[output].length > 0, `P29: ${output} is empty`);
      }
    }),
    BUILT,
  );
  console.log("ok P29: [secrets] generated refusals, failures and orders keep every named output clean");
};

const setLook = async (app: ElectronApplication, page: Page, look: Look) => {
  await app.evaluate(({ nativeTheme }, look) => {
    nativeTheme.themeSource = look;
  }, look);
  await page.emulateMedia({ colorScheme: look });
  await until(
    () => page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches),
    (light) => light === (look === "light"),
  );
};

// A window just launched may still take its first size after this one is set: one welcome shot
// came out 1584x1752 when the size was set once and only the small one was checked. So the size
// is set until the window holds it, and a shot is never taken at another size. It is sized through
// the test window (`size`), which puts it back in the corner each time.
const resize = async (win: TestWindow.TestWindow, page: Page, small: boolean) => {
  const contents = await win.app.browserWindow(page);
  const want = { width: small ? 1024 : 1400, height: small ? 700 : 900 };
  await until(
    async () => {
      await win.size(want.width, want.height, page);
      return contents.evaluate((window) => window.getContentSize());
    },
    ([width, height]) => width === want.width && height === want.height,
    5_000,
  ).catch((error: unknown) => {
    throw new Error(`E2 requires a real ${want.width}x${want.height} window`, { cause: error });
  });
};

const tileBounds = (page: Page) =>
  page.locator("[data-tile]").evaluateAll((tiles) =>
    tiles.map((tile) => {
      const r = tile.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );

const geometry = async (page: Page, layout: Layout | "normal", hostless: boolean) => {
  const expected = hostless ? 0 : layout === "2x2" ? 4 : layout === "side" || layout === "stacked" ? 2 : 1;
  // A split shows its tile 10 to 40 ms after the key, so the count is read until it equals the
  // expected one, or has stood still for 300 ms (a wrong count that stays is the law's red), or
  // 5 s have passed. The law (the count and the places) is checked on what the page settled on.
  let bounds = await tileBounds(page);
  let still = 0;

  for (let i = 0; i < 200 && bounds.length !== expected && still < 12; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const next = await tileBounds(page);
    still = next.length === bounds.length ? still + 1 : 0;
    bounds = next;
  }

  if (bounds.length === expected) {
    bounds = await tileBounds(page);
  }

  check(bounds.length === expected, `E2 ${layout}: wrong tile count`);

  if (hostless) {
    return;
  }

  for (const r of bounds) {
    check(r.w > 0 && r.h > 0, "E2: zero-size tile");
  }

  if (layout === "side") {
    const first = required(bounds[0]);
    const second = required(bounds[1]);
    check(Math.abs(first.y - second.y) < 2 && first.x < second.x, "E2: not side by side");
  }

  if (layout === "stacked") {
    const first = required(bounds[0]);
    const second = required(bounds[1]);
    check(Math.abs(first.x - second.x) < 2 && first.y < second.y, "E2: not stacked");
  }

  if (layout === "2x2") {
    check(
      new Set(bounds.map((r) => Math.round(r.x))).size === 2 && new Set(bounds.map((r) => Math.round(r.y))).size === 2,
      "E2: not a 2x2 grid",
    );
  }
};

const shot = async (
  win: TestWindow.TestWindow,
  page: Page,
  shots: string,
  state: string,
  layout: Layout | "normal",
  look: Look,
  hostless: boolean,
  verify: () => Promise<void>,
) => {
  await resize(win, page, layout === "small");
  await setLook(win.app, page, look);
  await geometry(page, layout, hostless);
  await verify();
  check(await page.evaluate((look) => matchMedia(`(prefers-color-scheme: ${look})`).matches, look), "E2: wrong look");
  await page.screenshot({ path: join(shots, `${state}-${layout}-${look}.png`) });
};

const layoutWithKeys = async (page: Page, layout: Layout) => {
  if (layout === "side" || layout === "2x2") {
    await prefix(page, "|");
  }

  if (layout === "stacked" || layout === "2x2") {
    await prefix(page, "-");
  }

  if (layout === "2x2") {
    await prefix(page, "h");
    await prefix(page, "-");
  }

  await geometry(page, layout, false);
};

const orientation = async (page: Page) => {
  const project = button(page);
  check((await project.isVisible()) && (await project.isEnabled()), "P30: project button unusable");
  const buttonBox = await project.boundingBox();
  check(buttonBox !== null && buttonBox.width > 20, "P30: project button collapsed");
  check(
    (await project.evaluate((node) => getComputedStyle(node).getPropertyValue("-webkit-app-region"))) === "no-drag",
    "P30: button is a drag region",
  );
  const brand = page.locator(".topbar .brand");

  if ((await brand.count()) && (await brand.isVisible())) {
    const brandBox = await brand.boundingBox();
    check(
      brandBox !== null && buttonBox.x + buttonBox.width + 24 <= brandBox.x,
      "P30: centered brand overlaps project",
    );
  }
};

const boxChecks = async (page: Page) => {
  await box(page).waitFor();
  const input = box(page).getByRole("combobox");
  check(await input.evaluate((node) => node === document.activeElement), "P28: combobox lost focus");
  const active = await input.getAttribute("aria-activedescendant");
  check(
    active !== null && (await page.locator(`[id="${active}"][role="option"]`).count()) === 1,
    "P28: invalid active option",
  );
  check(await box(page).getByRole("status").isVisible(), "P28: count is hidden");
  check(
    await page.locator("[data-tile]").evaluateAll((nodes) => nodes.every((node) => node.closest("[inert]") !== null)),
    "P24: covered tiles are not inert",
  );
};

const openingKeys = async (app: ElectronApplication, page: Page) => {
  await app.evaluate(({ app, BrowserWindow }) => {
    const calls: string[] = [];
    Reflect.set(globalThis, "projectFocusCalls", calls);
    app.focus = () => {
      calls.push("app.focus");
    };
    BrowserWindow.prototype.focus = function () {
      calls.push("window.focus");
    };
    BrowserWindow.prototype.show = function () {
      calls.push("window.show");
    };
  });

  for (const target of ["terminal", "popover", "prefix"] as const) {
    await tile(page).click();
    const original = await page.evaluateHandle(() => document.activeElement);

    if (target === "popover") {
      await prefix(page, "A");
      // A missed prefix fails here, with its own message and the screen, not 30 s later.
      await page
        .getByRole("dialog", { name: "The agents", exact: true })
        .waitFor({ timeout: 5_000 })
        .catch(async () => {
          throw new Error(`P18: C-b A did not open the agents popover; screen ${JSON.stringify(await screen(page))}`);
        });
    }

    if (target === "prefix") {
      await page.keyboard.press("Control+b");
    }

    await page.keyboard.press("Meta+o");
    await boxChecks(page);
    await page.keyboard.press("Meta+k");
    check((await page.getByRole("dialog").count()) === 1, "P24: commands stacked a second palette");
    await page.keyboard.press("Meta+o");
    await box(page).waitFor();
    const before = await screen(page);
    await page.keyboard.press("x");
    await page.keyboard.press("Control+b");
    const bounds = await tile(page).boundingBox();

    if (bounds) {
      await page.mouse.click(bounds.x + 4, bounds.y + bounds.height - 4);
    }

    check((await screen(page)) === before, "P24: a key or outside click reached a covered tile");

    if (await box(page).count()) {
      await page.keyboard.press("Escape");
    }

    check(await original.evaluate((node) => node === document.activeElement), "P23: original terminal focus was lost");
    await original.dispose();

    if (target === "popover") {
      // The popover opened (checked above), so the line is the shell's own to clear: leave it
      // `tsh$` for the next round and the captures after.
      await tile(page).click();
      await page.keyboard.press("Control+u");
      await prompt(page);
    }
  }

  check(
    await app.evaluate(() => (Reflect.get(globalThis, "projectFocusCalls") as string[]).length === 0),
    "P18: quiet opening took OS focus",
  );
};

const rejectFolder = async (app: ElectronApplication, page: Page, path: string) => {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, path);
  const folder = page.getByRole("option", { name: /Open Folder…/ });

  if (await folder.count()) {
    await folder.click();
  } else {
    await page.getByRole("button", { name: "Open Folder…", exact: true }).click();
  }

  await page.getByText("Choose a folder in a git repository", { exact: true }).waitFor();
  check(
    await page.getByRole("button", { name: /Choose Folder/ }).isEnabled(),
    "rejected folder has no recovery action",
  );
};

const migrationCaptures = async (shots: string) => {
  const desk = deskMachine.init(null, undefined)[0];

  if (desk.at !== "open") {
    throw new Error("fixture desk closed");
  }

  const saved = JSON.stringify(savedOf(desk));

  for (const failed of [false, true]) {
    const f = fixture();
    // These are real saved host formats. No seeded renderer or fake tile is used.
    writeFileSync(join(f.home, "desk.json"), failed ? '{"unknownSavedShape":true}' : saved);
    writeFileSync(join(f.home, "history"), "fixture-migration-history\n");
    const win = await launch(f);
    const { app } = win;

    try {
      const welcome = await app.firstWindow();

      if (failed) {
        await app.evaluate(({ dialog }, path) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
        }, f.projects[0]);
        await welcome.getByRole("option", { name: /Open Folder…/ }).click();
        await welcome.getByText(/saved work.*(?:read|move|unknown)|(?:read|move).*saved work/i).waitFor();

        for (const size of ["normal", "small"] as const) {
          for (const look of ["dark", "light"] as const) {
            await shot(win, welcome, shots, "migration-failed", size, look, true, async () => {
              check(
                await welcome.getByRole("button", { name: /Try Again|Retry/ }).isEnabled(),
                "migration failure has no retry",
              );
              check(
                readFileSync(join(f.home, "history"), "utf8") === "fixture-migration-history\n",
                "migration lost original history",
              );
            });
          }
        }

        writeFileSync(join(f.home, "desk.json"), saved);
        await welcome.getByRole("button", { name: /Try Again|Retry/ }).click();
        await until(
          () => button(welcome).count(),
          (n) => n === 1,
        );
        await prompt(welcome);
      } else {
        const page = await openFixtureProject(app, welcome, f.projects[0]);
        await prompt(page);

        for (const layout of layouts) {
          if (layout !== "one") {
            await prefix(page, "N");
            await prompt(page);
          }

          await layoutWithKeys(page, layout);

          for (const look of ["dark", "light"] as const) {
            await shot(win, page, shots, "migration-ready", layout, look, false, async () => {
              await orientation(page);
              await page.keyboard.press("ArrowUp");
              // The redraw after ArrowUp is async: wait for the history line on the current tile.
              let seen: string | null = null;
              const read = async () => {
                seen = await tile(page).locator(".screen-text").textContent();
                return seen ?? "";
              };

              try {
                await until(read, (text) => text.includes("fixture-migration-history"));
              } catch {
                throw new Error(`migration history did not reach the real desk; screen=${JSON.stringify(seen)}`);
              }

              // Down walks back to the typed (empty) line and ends the recall, as a person
              // would; Ctrl+u keeps the recall, so the next ArrowUp would go past the only
              // entry. Wait for the settled empty prompt before the next shot.
              await page.keyboard.press("ArrowDown");
              await prompt(page);
            });
          }
        }
      }
    } finally {
      await dispose(win, f);
    }
  }
};

const captures = async (shots: string) => {
  for (const layout of layouts) {
    const f = fixture();
    let win = await launch(f);
    let { app } = win;

    try {
      let page = await app.firstWindow();
      await page.getByRole("heading", { name: "Open a folder to start" }).waitFor();
      check(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isFocused())),
        "P18: quiet launch took OS focus",
      );

      if (layout === "one" || layout === "small") {
        for (const look of ["dark", "light"] as const) {
          const size = layout === "one" ? "normal" : "small";
          await shot(win, page, shots, "welcome-empty", size, look, true, async () => {
            check(
              await page.getByText("Open Folder…", { exact: true }).isVisible(),
              "empty welcome lacks folder action",
            );
          });
          await page.keyboard.press("Meta+o");
          await shot(win, page, shots, "welcome-selection", size, look, true, async () => {
            check((await page.getByRole("dialog").count()) === 0, "P27: Cmd-O stacked a welcome dialog");
            const selected = () =>
              page
                .getByRole("option")
                .first()
                .evaluate((node) => node === document.activeElement || node.getAttribute("aria-selected") === "true");
            // The row is marked after the key lands: wait for it, then name the miss.
            await until(selected, Boolean, 5_000).catch(() => {
              throw new Error("welcome first row not selected");
            });
          });
        }
      }

      if (layout === "one" || layout === "small") {
        const invalid = join(f.home, "work", "not-a-git-project");
        mkdirSync(invalid);
        await rejectFolder(app, page, invalid);

        for (const look of ["dark", "light"] as const) {
          await shot(
            win,
            page,
            shots,
            "welcome-rejected",
            layout === "one" ? "normal" : "small",
            look,
            true,
            async () => {
              check(
                await page.getByText("Choose a folder in a git repository", { exact: true }).isVisible(),
                "rejection missing",
              );
            },
          );
        }
      }

      page = await openFixtureProject(app, page, f.projects[0]);
      await prompt(page);
      await layoutWithKeys(page, layout);
      await openingKeys(app, page);

      for (const state of [
        "project-opened",
        "long-duplicate-name",
        "fake-agent-summoned",
        "second-project-independent",
      ] as const) {
        if (state === "long-duplicate-name" || state === "second-project-independent") {
          await page.keyboard.press("Meta+o");
          const second = await openFixtureProject(app, page, f.projects[1]);
          await prompt(second);

          if (state === "second-project-independent") {
            page = second;
            await layoutWithKeys(page, layout);
            await command(page, "counter &");
            await prompt(page);
          } else {
            check((await page.title()) !== (await second.title()), "P15: duplicate native titles");
            await switchTo(second, "left");
          }
        }

        if (state === "fake-agent-summoned") {
          await command(page, "summon fake as scout");
          await prompt(page);
        }

        const currentApp = app;

        if (process.env.PROJECT_PLANT === "seeded-dom" && state === "project-opened") {
          await page.setContent('<main><div data-tile="t1">fixture</div></main>');
        }

        for (const look of ["dark", "light"] as const) {
          await shot(win, page, shots, state, layout, look, false, async () => {
            await orientation(page);
            const native = await currentApp.browserWindow(page);
            const chrome = await native.evaluate((window) => ({
              title: window.getTitle(),
              close: window.isClosable(),
              minimize: window.isMinimizable(),
              maximize: window.isMaximizable(),
            }));
            check(
              chrome.title === (await page.title()) && chrome.close && chrome.minimize && chrome.maximize,
              "native title or window buttons missing",
            );
            check((await page.title()).includes(f.name), "E2: document title lacks project");

            if (state === "fake-agent-summoned") {
              await until(
                () => screen(page),
                (text) => text.includes("scout"),
                5_000,
              ).catch(() => {
                throw new Error("E2: fake summon absent");
              });
            }

            if (state === "second-project-independent") {
              await until(
                () => screen(page),
                (text) => text.includes("counter"),
                5_000,
              ).catch(() => {
                throw new Error("E2: second project's job absent");
              });
            }
          });
        }
      }

      for (const mode of ["selection", "filtering", "already-open"] as const) {
        for (const look of ["dark", "light"] as const) {
          await button(page).click();

          if (mode === "selection") {
            await page.keyboard.press("ArrowDown");
          }

          if (mode === "filtering") {
            await box(page).getByRole("combobox").fill("left");
          }

          await shot(win, page, shots, `projects-box-${mode}`, layout, look, false, async () => {
            if (mode === "already-open") {
              await until(
                () => box(page).getByText("open", { exact: true }).count(),
                (n) => n > 0,
                5_000,
              ).catch(() => {
                throw new Error("E2: open state absent");
              });
            }

            await boxChecks(page);
          });
          await page.keyboard.press("Escape");
          await until(() => button(page).evaluate((node) => node === document.activeElement), Boolean, 5_000).catch(
            () => {
              throw new Error("P23: Esc did not return to project button");
            },
          );
        }
      }

      // Native File menu is inspected independently of page captures.
      const menu = await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          ?.items.find((item) => item.label === "File")
          ?.submenu?.items.map((item) => ({ label: item.label, accelerator: item.accelerator })),
      );
      check(
        menu?.some((item) => item.label === "Open Project…" && /Command|Cmd|Meta/.test(String(item.accelerator))) ===
          true,
        "P26: native menu shortcut absent",
      );
      check(menu?.some((item) => item.label === "Open Folder…" && !item.accelerator) === true, "P26: folder has Cmd-O");
      await win.close();
      win = await launch(f);
      ({ app } = win);
      page = await app.firstWindow();

      if (layout === "one" || layout === "small") {
        for (const look of ["dark", "light"] as const) {
          await shot(
            win,
            page,
            shots,
            "welcome-populated",
            layout === "one" ? "normal" : "small",
            look,
            true,
            async () => {
              // The welcome loads its recents after the window shows: wait for all three rows.
              let seen: string[] = [];

              try {
                await until(
                  async () => {
                    seen = await page.getByRole("option").allTextContents();
                    return seen.length;
                  },
                  (n) => n === 3,
                );
              } catch {
                throw new Error(`welcome lost recents; options last seen ${JSON.stringify(seen)}`);
              }
            },
          );
        }
      }
    } finally {
      await dispose(win, f);
    }
  }
};

export const runProjectChecks = async (only?: "flow" | "captures") => {
  if (only !== "captures") {
    await e1();
    const credential = "made-up-project-fixture-only";
    const outputs = await observeProjectFlow({
      credential,
      refusal: true,
      failure: "summon",
      order: ["open", "cancel", "refuse", "focus"],
    });

    for (const [name, output] of Object.entries(outputs)) {
      check(!JSON.stringify(output).includes(credential), `scenario: P29 credential in ${name}`);
    }

    // scenario: P17's presses, every one once, each opening record with its source and picked pair.
    const presses = Object.keys(PRESS_RECORDS) as ProjectPress[];

    for (const welcome of ["welcome row", "welcome folder"] as const) {
      for (const step of await observePresses([welcome, ...presses.filter((p) => !p.startsWith("welcome"))])) {
        const wanted = PRESS_RECORDS[step.press];
        check(step.records.length > 0, `scenario: P17 ${step.press} wrote no opening record`);

        for (const record of step.records) {
          check(
            record.source === wanted.source && record.picked === wanted.picked,
            `scenario: P17 ${step.press} recorded ${String(record.source)}/${String(record.picked)}`,
          );
        }
      }
    }

    await builtLaws();
  }

  if (only === "flow") {
    return;
  }

  const shots = process.env.SHOTS ?? mkdtempSync("/tmp/project-shots.");
  mkdirSync(shots, { recursive: true });
  await captures(shots);
  await migrationCaptures(shots);
  console.log("E2: capture steps complete. VoiceOver still needs a real Mac run.");
};
