// Today's app. The hook records native events; this module judges the complete history.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { Schema } from "effect";
import { _electron } from "playwright";

export const electronHookArgs = ["-r", resolve(import.meta.dirname, "electron-hook.cjs")] as const;

const Bounds = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});

const State = Schema.Struct({
  opacity: Schema.Finite,
  ignoresMouse: Schema.Boolean,
  focused: Schema.Boolean,
  bounds: Bounds,
  area: Bounds,
});

const result = {
  at: Schema.Finite,
  ok: Schema.Boolean,
  error: Schema.optional(Schema.String),
};

const Record = Schema.TaggedUnion({
  setup: { ...result, state: Schema.optional(State) },
  opacity: {
    ...result,
    setup: Schema.Boolean,
    requested: Schema.Finite,
    value: Schema.optional(Schema.Finite),
  },
  mouse: {
    ...result,
    setup: Schema.Boolean,
    requested: Schema.Boolean,
    value: Schema.optional(Schema.Boolean),
  },
  bounds: { ...result, state: Schema.optional(State) },
  focus: { at: Schema.Finite },
  closed: { at: Schema.Finite },
});

export const Report = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String.check(Schema.isMinLength(1)),
  pid: Schema.Int,
  installed: Schema.Boolean,
  complete: Schema.Boolean,
  windows: Schema.Array(Schema.Struct({ id: Schema.Int, closed: Schema.Boolean, records: Schema.Array(Record) })),
});

export type WindowReport = typeof Report.Type;

/** Also used independently of the recorder, so dropped history cannot pass unnoticed. */
const checkWindowReport = (input: unknown, id: string, complete: boolean, live: readonly number[] = []) => {
  function fail(why: string): never {
    throw new Error(`window law: ${why}`);
  }
  const report = Schema.decodeUnknownSync(Report)(input);

  if (report.id !== id || !report.installed || report.complete !== complete) {
    fail("missing hook, stale launch ID or unfinished report");
  }

  if (report.windows.length === 0) {
    fail("empty report");
  }

  const ids = report.windows.map((w) => w.id);

  if (new Set(ids).size !== ids.length || live.some((n) => !ids.includes(n))) {
    fail("missing or duplicate window");
  }

  for (const window of report.windows) {
    let setup = false;
    let opacity = false;
    let mouse = false;
    let closed = false;

    for (const record of window.records) {
      if (record._tag === "focus") {
        fail(`native focus on ${window.id}`);
      }

      if (record._tag === "closed") {
        closed = true;
        continue;
      }

      if (!record.ok || record.error !== undefined) {
        fail(`failed ${record._tag} on ${window.id}`);
      }

      if (record._tag === "opacity") {
        if (record.requested !== 0 || record.value !== 0) {
          fail("positive or unknown opacity");
        }

        opacity = true;
      } else if (record._tag === "mouse") {
        if (!record.requested || record.value !== true) {
          fail("mouse input enabled or unknown");
        }

        mouse = true;
      } else {
        const state = record.state;

        if (!state || state.opacity !== 0 || !state.ignoresMouse || state.focused) {
          fail("unsafe or missing window state");
        }

        if (state.bounds.x !== state.area.x || state.bounds.y !== state.area.y) {
          fail("window left the work area corner");
        }

        if (record._tag === "setup") {
          if (setup || !opacity || !mouse) {
            fail("missing initial setter evidence");
          }

          setup = true;
        } else if (!setup) {
          fail("bounds before setup");
        }
      }
    }

    if (!setup || window.closed !== closed) {
      fail("missing setup or closure evidence");
    }
  }

  return report;
};

interface LaunchInput {
  readonly home: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly cwd?: string;
}

interface LaunchOptions {
  readonly executablePath: string;
  readonly args: string[];
  readonly env: Record<string, string>;
  readonly cwd?: string;
}

interface Dependencies<A> {
  readonly launch: (options: LaunchOptions) => Promise<A>;
  readonly inspect: (app: A) => Promise<{ report: unknown; live: readonly number[] }>;
  readonly close: (app: A) => Promise<void>;
  readonly read: (path: string) => Promise<string>;
  readonly executable: () => string;
  readonly id: () => string;
}

/** Explicit I/O lets the unit laws run without resolving an Electron binary. */
export const createElectronRunner = <A>(io: Dependencies<A>) => {
  type Launch = { id: string; path: string; app?: A; errors: unknown[] };
  let launches: Launch[] | undefined;
  const launchElectron = async ({ home, env, cwd }: LaunchInput): Promise<A> => {
    if (!launches) {
      throw new Error("window law: launch outside runE2e");
    }

    if (!home.trim()) {
      throw new Error("window law: explicit test home required");
    }

    const id = io.id();
    const entry: Launch = { id, path: join(home, `window-${id}.json`), errors: [] };
    launches.push(entry); // Register before launch, including a launch the caller catches.
    const testEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined) {
        testEnv[key] = value;
      }
    }

    Object.assign(testEnv, {
      FABRIKA_HOME: home,
      FABRIKA_E2E_REPORT: entry.path,
      FABRIKA_E2E_ID: id,
    });
    delete testEnv.FABRIKA_FOREGROUND;

    // oxlint-disable-next-line fabrika/no-raw-try-catch -- Playwright uses Promises; startup failure must close the app
    try {
      const app = await io.launch({
        executablePath: io.executable(),
        args: [...electronHookArgs, resolve(import.meta.dirname, "../..")],
        env: testEnv,
        ...(cwd === undefined ? {} : { cwd }),
      });
      entry.app = app;
      const { report, live } = await io.inspect(app);
      checkWindowReport(report, id, false, live);
      return app;
    } catch (error) {
      entry.errors.push(error);

      if (entry.app !== undefined) {
        // oxlint-disable-next-line fabrika/no-raw-try-catch -- Keep a cleanup error beside the startup error
        try {
          await io.close(entry.app);
        } catch (close) {
          entry.errors.push(close);
        }
      }

      throw error;
    }
  };
  const runE2e = async (body: () => Promise<void>) => {
    if (launches) {
      throw new Error("window law: nested runE2e");
    }

    const current: Launch[] = [];
    launches = current;
    const errors: unknown[] = [];

    // oxlint-disable-next-line fabrika/no-raw-try-catch -- Body failure must still reach final window checks
    try {
      await body();
    } catch (error) {
      errors.push(error);
    }

    for (const entry of current) {
      errors.push(...entry.errors);

      if (entry.app !== undefined) {
        // oxlint-disable-next-line fabrika/no-raw-try-catch -- One close failure must not skip another launch
        try {
          await io.close(entry.app);
        } catch (error) {
          errors.push(error);
        }
      }
    }

    for (const entry of current) {
      // oxlint-disable-next-line fabrika/no-raw-try-catch -- Missing and malformed reports fail after all cleanup
      try {
        checkWindowReport(JSON.parse(await io.read(entry.path)), entry.id, true);
      } catch (error) {
        errors.push(new Error(`window law: report ${entry.id}`, { cause: error }));
      }
    }

    launches = undefined;

    if (errors.length) {
      throw new AggregateError(errors, "window law: e2e failed after cleanup");
    }

    console.log(`window law: green (${current.length} launches)`);
  };
  return { launchElectron, runE2e };
};

const runner = createElectronRunner({
  launch: (options) => _electron.launch(options),
  inspect: async (app) => {
    await app.firstWindow();
    return app.evaluate(({ BrowserWindow }) => {
      // The CJS hook owns this process-local report function.
      const hook = Reflect.get(globalThis, "__fabrikaE2E");
      return { report: hook?.report?.(), live: BrowserWindow.getAllWindows().map((w) => w.id) };
    });
  },
  close: async (app) => {
    if (app.process().exitCode === null && app.process().signalCode === null) {
      await app.close();
    }
  },
  read: (path) => readFile(path, "utf8"),
  executable: () => createRequire(import.meta.url)("electron"),
  id: randomUUID,
});

export const { launchElectron, runE2e } = runner;
