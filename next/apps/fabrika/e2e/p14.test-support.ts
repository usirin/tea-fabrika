// P14, next/ (Tier 1, ticket 286): the browser files' shared setup (the plan's "Browser checks,
// measurements and shots"). It starts the real `dev.ts` on a short private home with an explicit free
// port, a throwaway person key and a fresh Chromium profile; it grants a tab with the real grant
// command; it kills what the p17 checks name; it times and shoots. Tests drive the actual page: no
// replacement client is put in it, and no page is fulfilled by a test.
//
// What the built page must give a test to find (the build meets these; the tests read nothing else):
// - Waiting: `data-testid="grant-code"`, `"fingerprint"` and `"grant-command"` (the real command),
//   and a button named /copy/i.
// - Granted: each tile is a region whose accessible name starts with `counter`; inside it
//   `data-testid="count"` holds the number and three buttons are named by the program's inputs:
//   "Add one", "Take one away" and "Back to zero". The frame's `data-testid="connection"` holds one
//   of `online`, `offline`, `reconnecting`, and `data-testid="queue"` the number of waiting presses.
// - Removed: the words "This window was removed" and a button named /ask again/i.
// - The tab takes a fixed test arrangement from `?layout=one|row|col|grid` (the real counters under
//   unique tile ids; no product control for it).
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { revokeText } from "@kampus/libfabrika/access/Text";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const run = promisify(execFile);
export const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Polls `read` until it answers something other than undefined, or throws with `what`. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const until = async <T>(
  what: string,
  read: () => Promise<T | undefined> | T | undefined,
  ms = 30_000,
): Promise<T> => {
  const stop = Date.now() + ms;

  for (;;) {
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    const got = await Promise.resolve(read()).catch(() => undefined);

    if (got !== undefined) {
      return got;
    }

    if (Date.now() > stop) {
      throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    }

    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    await pause(50);
  }
};

const freePort = (): Promise<number> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const at = server.address();

      if (at === null || typeof at === "string") {
        return fail(new Error("no TCP port"));
      }

      server.close(() => done(at.port));
    });
  });

export interface Stage {
  readonly url: string;
  readonly home: string;
  readonly key: string;
  /** Where Alchemy writes each workerd config it serves (its `WORKERD_DUMP_CONFIG`), inside `home`.
   *  The stage makes its control bearer in memory and hands it to workerd only in that config, over
   *  workerd's stdin, so this is the one place a test can read it. A test reads it and never prints it. */
  readonly config: string;
  readonly output: () => string;
  /** Every process under the stage's parent, as `{pid, command}`. */
  readonly processes: () => ReadonlyArray<{ readonly pid: number; readonly command: string }>;
  readonly parent: () => number;
  /** Starts the stage again on the same port and home (after a kill or a stop). */
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly kill: (pid: number, signal: NodeJS.Signals) => void;
}

/** The real `dev.ts` on a short private home. `home` keeps a stage's files across `start` calls. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const startStage = async (name: string, shared?: { home: string; port: number }): Promise<Stage> => {
  const home = shared?.home ?? mkdtempSync(join(tmpdir(), "p14-"));
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const port = shared?.port ?? (await freePort());
  const key = join(home, "person");

  if (shared === undefined) {
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  }

  const founder = readFileSync(`${key}.pub`, "utf8").trim();
  const url = `http://127.0.0.1:${port}`;
  const config = join(home, "workerd-config");
  const env = { ...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1", WORKERD_DUMP_CONFIG: config };

  for (const secret of ["TYPESAFE_API_KEY", "FABRIKA_FOREGROUND", "CLOUDFLARE_API_TOKEN"]) {
    delete env[secret];
  }

  let child: ChildProcess | undefined;
  let output = "";
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const start = async (): Promise<void> => {
    child = spawn(
      process.execPath,
      [join(APP, "dev.ts"), "--port", String(port), "--name", name, "--person", PERSON, "--founder", founder],
      { env, cwd: APP, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout?.on("data", (b: Buffer) => (output += b.toString()));
    child.stderr?.on("data", (b: Buffer) => (output += b.toString()));
    const mine = child;
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    await until(
      "the stage to answer",
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
      async () => {
        if (mine.exitCode !== null) {
          throw new Error(`dev.ts exited: ${output}`);
        }

        // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
        return (await fetch(url)).ok ? true : undefined;
      },
      90_000,
    );
  };
  const processes = () =>
    // edge: finds workerd and the stage's other processes with `ps`, since Alchemy's runtime has no form to list or crash them from outside, not reported, 0042 amendment 2026-11-09
    execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
      .split("\n")
      .flatMap((line) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return m === null ? [] : [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? "" }];
      })
      .filter((p, _i, all) => {
        const mine = new Set<number>([child?.pid ?? -1]);

        for (let grew = true; grew;) {
          grew = false;

          for (const q of all) {
            if (mine.has(q.ppid) && !mine.has(q.pid)) {
              mine.add(q.pid);
              grew = true;
            }
          }
        }

        return mine.has(p.pid);
      });
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  await start();
  return {
    url,
    home,
    key,
    config,
    output: () => output,
    processes,
    parent: () => child?.pid ?? -1,
    start,
    // edge: kills workerd or the stage parent by signal for the p17 kill cases, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
    kill: (pid, signal) => process.kill(pid, signal),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    stop: async () => {
      const mine = child;

      if (mine === undefined || mine.exitCode !== null) {
        return;
      }

      // edge: stops the local stage by signal for the full stop and start case, since Alchemy's runtime has no form to stop it from outside, not reported, 0042 amendment 2026-11-09
      mine.kill("SIGTERM");
      // edge: kills the local stage by signal when it does not stop, since Alchemy's runtime has no form to stop it from outside, not reported, 0042 amendment 2026-11-09
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
      await until(
        "the stage to stop",
        () => (mine.exitCode !== null || mine.signalCode !== null ? true : undefined),
        20_000,
      ).catch(() => mine.kill("SIGKILL"));
    },
  };
};

export interface Tab {
  readonly page: Page;
  readonly console: ReadonlyArray<string>;
  readonly urls: ReadonlyArray<string>;
}

/** A browser, its context (a persistent profile when `dir` is given) and a way to open tabs on it. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const openProfile = async (
  dir?: string,
): Promise<{
  readonly browser: Browser | undefined;
  readonly context: BrowserContext;
  readonly tab: (url: string, size?: { width: number; height: number }) => Promise<Tab>;
  readonly close: () => Promise<void>;
}> => {
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const browser = dir === undefined ? await chromium.launch({ headless: true }) : undefined;
  const context =
    browser === undefined
      ? // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
        await chromium.launchPersistentContext(dir ?? "", { headless: true })
      : // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
        await browser.newContext();
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const tab = async (url: string, size = { width: 1280, height: 800 }): Promise<Tab> => {
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    const page = await context.newPage();
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    await page.setViewportSize(size);
    const log: Array<string> = [];
    const urls: Array<string> = [];
    page.on("console", (m) => log.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
    page.on("request", (r) => urls.push(r.url()));
    page.on("websocket", (w) => urls.push(w.url()));
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    await page.goto(url);
    return { page, console: log, urls };
  };
  return {
    browser,
    context,
    tab,
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
    close: async () => {
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
      await context.close();
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
      await browser?.close();
    },
  };
};

export interface Granted {
  readonly code: string;
  readonly fingerprint: string;
  readonly command: string;
  /** The window key as the stage knows it, and the project it was granted into: what a revoke names. */
  readonly key: string;
  readonly to: string;
}

/** A fresh throwaway key file under `home`, for a signer the person never trusted. */
export const otherKey = (home: string, name: string): string => {
  const file = join(home, name);
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", file]);
  return file;
};

/** Reads the waiting screen's code and fingerprint, then runs the real grant command with `key`. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const readWaiting = async (
  stage: Stage,
  tab: Tab,
): Promise<Omit<Granted, "key" | "to"> & { readonly target: { readonly key: string; readonly to: string } }> => {
  const read = (id: string) => tab.page.getByTestId(id).first();
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const code = (await read("grant-code").innerText({ timeout: 30_000 })).trim();
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const fingerprint = (await read("fingerprint").innerText()).trim();
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const command = (await read("grant-command").innerText()).trim();
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const response = await fetch(
    `${stage.url}/grant/client/${encodeURIComponent(fingerprint)}?code=${encodeURIComponent(code)}`,
  );
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const target = (await response.json()) as { key: string; to: string };
  return { code, fingerprint, command, target: { key: target.key, to: target.to } };
};

export const runGrant = (stage: Stage, fingerprint: string, code: string, key: string) =>
  run(process.execPath, [join(APP, "grant.ts"), "client", stage.url, fingerprint, `--code=${code}`, `--key=${key}`], {
    cwd: APP,
    env: { ...process.env, FABRIKA_HOME: stage.home },
  });

/** Grants a waiting tab with the real command and waits for its counters. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const grant = async (stage: Stage, tab: Tab): Promise<Granted> => {
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const w = await readWaiting(stage, tab);
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  await runGrant(stage, w.fingerprint, w.code, stage.key);
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  await tab.page
    .getByRole("region", { name: /^counter/i })
    .first()
    .waitFor({ timeout: 30_000 });
  return {
    code: w.code,
    fingerprint: w.fingerprint,
    command: w.command,
    key: w.target.key,
    to: w.target.to,
  };
};

/** Removes a granted window key: the person's key signs the removal, as the door's tests do. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const revoke = async (stage: Stage, granted: Granted): Promise<void> => {
  const text = revokeText({
    id: `revoke-${Date.now()}`,
    key: granted.key,
    for: PERSON,
    to: granted.to,
    saw: { label: "Browser", where: "test", how: "panel", check: "touch" },
    sentAt: new Date().toISOString(),
  });
  const armored = execFileSync("ssh-keygen", ["-Y", "sign", "-n", "fabrika-client", "-f", stage.key], {
    input: text,
    encoding: "utf8",
  });
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const response = await fetch(`${stage.url}/grant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, armored }),
  });

  if (!response.ok) {
    throw new Error(`revoke refused: ${response.status}`);
  }
};

// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const counts = async (page: Page): Promise<ReadonlyArray<number>> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  (await page.getByTestId("count").allInnerTexts()).map((t) => Number(t.replace(/[^\d-]/g, "")));

export const press = (page: Page, action: "Add one" | "Take one away" | "Back to zero", tile = 0) =>
  page
    .getByRole("region", { name: /^counter/i })
    .nth(tile)
    .getByRole("button", { name: action })
    .click();

export const connection = (page: Page): Promise<string> => page.getByTestId("connection").first().innerText();

/** Times `work` in ms and keeps the sample under `runs/p14/<label>.jsonl`, which is private (ignored by git). */
export const samples: Record<string, Array<number>> = {};

// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const timed = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
  const t0 = performance.now();
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  const out = await work();
  (samples[label] ??= []).push(Math.round(performance.now() - t0));
  return out;
};

export const summary = (): string => {
  const dir = join(ROOT, "runs/p14");
  mkdirSync(dir, { recursive: true });
  const rows = Object.entries(samples).map(([label, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    writeFileSync(join(dir, `${label.replaceAll(/\W+/g, "-")}.json`), JSON.stringify(list));
    return `${label}: n=${list.length} min=${sorted[0]} median=${sorted[Math.floor(sorted.length / 2)]} worst=${sorted.at(-1)}`;
  });
  return rows.join("\n");
};

/** Saves a screenshot of the built page where the plan names: `<dir>/<state>-<layout>.png`. */
// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
export const shot = async (page: Page, where: "frame" | "counter", state: string, layout: string): Promise<void> => {
  const dir = where === "frame" ? join(APP, "docs/p14") : join(ROOT, "next/programs/counter/docs/p14");
  mkdirSync(dir, { recursive: true });
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright, fetch, child processes and timers hand back Promises; the browser files await them
  await page.screenshot({ path: join(dir, `${state}-${layout}.png`) });
};

/** Every ledger entry the stage has saved, read from its SQLite files under `home` (read only). */
export const ledgerRows = (
  home: string,
): ReadonlyArray<{
  readonly stream: string;
  readonly id: string;
  readonly tag: string;
  readonly body: string;
}> => {
  // The stage writes its files while this reads them: it renames a `.tmp` file away, or drops a
  // folder, between the listing and the read (0036: the lead's run of 2026-11-10 threw ENOENT on
  // `brain.pending.jsonl.tmp`). A name gone by then holds no ledger for this read, so it is
  // skipped; any other failure still throws.
  const gone = (error: unknown): boolean =>
    typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
  const isLedger = (path: string): boolean => {
    try {
      return statSync(path).size > 100 && readFileSync(path).subarray(0, 15).toString() === "SQLite format 3";
    } catch (error) {
      if (gone(error)) {
        return false;
      }

      throw error;
    }
  };
  const files = (dir: string): ReadonlyArray<string> => {
    let entries: ReadonlyArray<Dirent>;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (gone(error)) {
        return [];
      }

      throw error;
    }

    return entries.flatMap((e) => {
      const path = join(dir, e.name);
      return e.isDirectory() ? files(path) : isLedger(path) ? [path] : [];
    });
  };
  const rows: Array<{ stream: string; id: string; tag: string; body: string }> = [];

  for (const file of files(home)) {
    let db: DatabaseSync;

    try {
      db = new DatabaseSync(file, { readOnly: true });
    } catch (error) {
      // The same race as in `files`: a ledger file gone since the listing is skipped.
      if (!existsSync(file)) {
        continue;
      }

      throw error;
    }

    try {
      const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entries'").get();

      if (has === undefined) {
        continue;
      }

      for (const r of db.prepare("SELECT stream, id, _tag AS tag, body FROM entries ORDER BY rev").all()) {
        rows.push({
          stream: String(r["stream"]),
          id: String(r["id"]),
          tag: String(r["tag"]),
          body: String(r["body"]),
        });
      }
    } catch {
      // A file that is not a readable ledger (a lock or a half-written page) holds none for this read.
    } finally {
      db.close();
    }
  }

  return rows;
};

export const cleanup = (...homes: ReadonlyArray<string>): void => {
  for (const h of homes) {
    rmSync(h, { recursive: true, force: true });
  }
};
