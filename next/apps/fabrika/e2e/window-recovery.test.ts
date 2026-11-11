// P14, next/ (Tier 1, ticket 286): check 2 and p17, on the real stage with real Chromium: two windows
// mirror, an offline press lands once, a narrow tab folds locally, and every named kill recovers
// (docs/plan "Browser checks, measurements and shots"). Written before the window, so each test is
// red until the built page exists. It kills real OS processes under the stage and reads the saved
// ledger afterward: one line per letter, never only a final visible count. Run it with:
//   nice -n 19 pnpm exec vitest run --maxWorkers=1 --root next/apps/fabrika/e2e --fileParallelism=false \
//     --testTimeout=120000 --hookTimeout=120000 window-recovery.test.ts
// Each kill is its own case, run five times; "the whole sequence" runs them all in one stage life,
// five times. `held restart` here is a second kill while the first restart is still being held back.
// Every test here is a scenario: a real workerd kill, a stage-parent kill, a held restart, a hung brain
// and a full stop/start need OS processes, real Chromium and the saved test home.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  connection,
  counts,
  grant,
  ledgerRows,
  openProfile,
  pause,
  readWaiting,
  runGrant,
  press,
  startStage,
  summary,
  timed,
  until,
  samples,
  type Stage,
  type Tab,
} from "./p14.test-support.ts";

let stage: Stage;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
  stage = await startStage("p14-recover");
}, 180_000);

afterAll(async () => {
  for (const close of closers.splice(0)) {
    await close().catch(() => undefined);
  }

  await stage?.stop();
  process.stdout.write(`${summary()}\n`);

  if (stage !== undefined) {
    cleanup(stage.home);
  }
});

/** A separately granted browser context with one tab on the stage. */
const window = async (
  query = "",
  size = { width: 1280, height: 800 },
): Promise<{
  tab: Tab;
  context: import("playwright").BrowserContext;
  close: () => Promise<void>;
}> => {
  const p = await openProfile();
  closers.push(p.close);
  const tab = await p.tab(`${stage.url}/${query}`, size);
  await grant(stage, tab);
  return { tab, context: p.context, close: p.close };
};

const first = async (tab: Tab): Promise<number> => (await counts(tab.page))[0] ?? Number.NaN;

/** Waits for the first count to read `n`. A timeout names `label` (the kill and the tab, when given),
 *  the count it waited for and the count it saw. */
const settled = (tab: Tab, n: number, ms = 60_000, label?: string) =>
  until(`the first count to read ${n}`, async () => ((await first(tab)) === n ? true : undefined), ms).catch(
    async (error: unknown) => {
      const seen = await first(tab).catch(() => Number.NaN);
      throw new Error(`${label === undefined ? "" : `${label}: `}${String(error)} (expected ${n}, seen ${seen})`, {
        cause: error,
      });
    },
  );

/** The inbox lines the stage saved for the counters: one `send` per letter, each id once. */
const letters = (): ReadonlyArray<string> =>
  ledgerRows(stage.home)
    .filter((r) => r.tag === "send" && r.stream.endsWith("/inbox"))
    .map((r) => r.id);

/**
 * The letters one case must leave saved: those in the ledger when it starts, plus the presses it
 * makes. Each case keeps its own, so a letter one case loses fails that case, by its label and its
 * counts, and not every case after it (the lead's run of 2026-11-10: one file-wide counter turned one
 * lost letter in "every kill in turn" run 5 into 15 later failures).
 */
const ledgerFor = (label: string) => {
  const before = letters().length;
  let pressed = 0;
  const want = (): number => before + pressed;
  return {
    /** Counts presses this case made, each of which the ledger must hold once. */
    pressed: (n = 1): void => {
      pressed += n;
    },
    /** Waits up to `ms` for the ledger to hold every letter, then checks each is saved once. */
    holds: async (ms = 30_000): Promise<void> => {
      await until(
        `${label}: the ledger to hold every accepted letter`,
        () => (letters().length === want() ? true : undefined),
        ms,
      ).catch(() => undefined);
      const ids = letters();
      const counts = `expected ${want()} (${before} before the case, ${pressed} pressed in it), seen ${ids.length}`;
      expect(new Set(ids).size, `${label}: no letter is saved twice; ${counts}`).toBe(ids.length);
      expect(ids.length, `${label}: every accepted letter is saved once; ${counts}`).toBe(want());
    },
  };
};

describe("two windows mirror, press by press, and every press is measured", () => {
  it("scenario: a press shows in its own tab and the other window, five times", async () => {
    const a = await window();
    const b = await window();
    const saved = ledgerFor("same-tab click");
    // Every case on this stage presses counter:1, so each counts from the value it starts at.
    const base = await first(a.tab);

    for (let n = 1; n <= 5; n++) {
      await timed("same-tab click", async () => {
        await press(a.tab.page, "Add one", 0);
        await settled(a.tab, base + n);
      });
      saved.pressed();
      await timed("other-tab click", () => settled(b.tab, base + n));
      expect(await counts(b.tab.page)).toEqual(await counts(a.tab.page));
    }

    await saved.holds(20_000);
    samples["bundle bytes"] = [Buffer.byteLength(await (await fetch(`${stage.url}/window.js`)).text())];
  });

  it("scenario: a narrow tab folds locally; the other window and the saved layout keep every tile", async () => {
    const wide = await window("?layout=grid");
    const narrow = await window("?layout=grid", { width: 700, height: 500 });
    const all = await wide.tab.page.getByRole("region", { name: /^counter/i }).count();
    const some = await narrow.tab.page.getByRole("region", { name: /^counter/i }).count();
    expect(all).toBe(4);
    expect(some, "the narrow tab folds what does not fit").toBeLessThan(4);
    expect(some).toBeGreaterThan(0);
    await narrow.tab.page.setViewportSize({ width: 1280, height: 800 });
    await until("the tiles to unfold", async () =>
      (await narrow.tab.page.getByRole("region", { name: /^counter/i }).count()) === 4 ? true : undefined,
    );
    expect(
      await wide.tab.page.getByRole("region", { name: /^counter/i }).count(),
      "another tab's size never changes this one",
    ).toBe(4);
  });
});

describe("an offline press lands once", () => {
  it("scenario: three presses while the browser is offline wait, show in the queue, and land once each", async () => {
    const a = await window();
    const b = await window();
    const saved = ledgerFor("offline press");
    const base = await first(a.tab);
    await a.context.setOffline(true);
    await until("the frame to say offline", async () =>
      /offline|reconnecting/i.test(await connection(a.tab.page)) ? true : undefined,
    );

    for (let n = 0; n < 3; n++) {
      await press(a.tab.page, "Add one", 0);
    }

    saved.pressed(3);
    await expect.poll(() => a.tab.page.getByTestId("queue").innerText(), { timeout: 30_000 }).toMatch(/3/);
    expect(await first(b.tab), "nothing reached the other window yet").toBe(base);
    await a.context.setOffline(false);
    await settled(a.tab, base + 3);
    await settled(b.tab, base + 3);
    await until("the queue to empty", async () =>
      (await a.tab.page.getByTestId("queue").innerText()).match(/\d+/)?.[0] === "0" ? true : undefined,
    );
    await saved.holds(0); // checked at once, as soon as the queue is empty
  });
});

type Kill = {
  readonly name: string;
  readonly run: (s: Stage) => Promise<void>;
  readonly label: string;
};

const workerd = (s: Stage) => {
  // edge: finds workerd with `ps` under the stage, since Alchemy's runtime has no form to list or crash it from outside, not reported, 0042 amendment 2026-11-09
  const found = s.processes().find((p) => /workerd/.test(p.command));

  if (found === undefined) {
    throw new Error(
      `no workerd under the stage: ${s
        .processes()
        .map((p) => p.command.slice(0, 60))
        .join(" | ")}`,
    );
  }

  return found.pid;
};

const KILLS: ReadonlyArray<Kill> = [
  {
    name: "workerd is killed",
    label: "loss detection",
    // edge: kills workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
    run: async (s) => s.kill(workerd(s), "SIGKILL"),
  },
  {
    name: "the stage parent is killed and started again",
    label: "restart",
    run: async (s) => {
      // edge: kills the local stage's parent by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
      s.kill(s.parent(), "SIGKILL");
      await pause(1_000);
      await s.start();
    },
  },
  {
    name: "a restart is held back by a second kill",
    label: "reconnect",
    run: async (s) => {
      // edge: kills workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
      s.kill(workerd(s), "SIGKILL");
      await pause(300);

      try {
        // edge: kills the restarted workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
        s.kill(workerd(s), "SIGKILL");
      } catch {
        /* the first restart has not made a new one yet */
      }
    },
  },
  {
    name: "a hung brain is stopped and continued",
    label: "hang detection",
    run: async (s) => {
      const pid = workerd(s);
      // edge: stops workerd by signal to hang the brain, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
      s.kill(pid, "SIGSTOP");
      await pause(8_000);
      // edge: continues the stopped workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
      s.kill(pid, "SIGCONT");
    },
  },
  {
    name: "the whole stage stops and starts on the same home",
    label: "full restart",
    run: async (s) => {
      await s.stop();
      await s.start();
    },
  },
];

/** One kill, with a press made during the outage and one after: all must be counted, once. */
const survive = async (kill: Kill): Promise<void> => {
  const a = await window();
  const b = await window();

  try {
    await recover(kill, a, b);
  } finally {
    await a.close().catch(() => undefined);
    await b.close().catch(() => undefined);
  }
};

const recover = async (
  kill: Kill,
  a: Awaited<ReturnType<typeof window>>,
  b: Awaited<ReturnType<typeof window>>,
): Promise<void> => {
  const saved = ledgerFor(kill.label);
  const base = await first(a.tab);
  await press(a.tab.page, "Add one", 0);
  saved.pressed();
  await settled(b.tab, base + 1, undefined, `${kill.label}, before the kill, tab b`);
  await timed(kill.label, async () => {
    await kill.run(stage);
    await press(a.tab.page, "Add one", 0); // pressed in the outage when there is one: it waits and resends
    saved.pressed();
    await settled(a.tab, base + 2, 100_000, `${kill.label}, tab a`);
    await settled(b.tab, base + 2, 100_000, `${kill.label}, tab b`);
  });
  await saved.holds(30_000);
};

// The stage's restart budget: the local runtime restarts a dead workerd at most 3 times within 60 s
// on one stage life, and past that it stops it for good, the brain `braked` (Alchemy's runtime as
// patched here, patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.84.patch; terminal by design, as
// past an OTP supervisor's intensity the parent decides). The lead's run of 2026-11-10 killed
// workerd a fourth time inside 60 s on the one life the whole file shared, so run 4 of the first
// kill found a braked brain, and every case after it found no page. So each kill case, and each run
// of the whole sequence, starts on a fresh stage life: the same home, port, ledger and letters, and
// a fresh budget. One life then sees at most 2 workerd deaths (a held restart; the sequence's lives
// are split by its own parent kill and full stop), inside the budget, and a case that fails leaves
// no dead stage for the next one.
const freshLife = async (): Promise<void> => {
  await stage.stop();
  await stage.start();
};

describe("every named kill recovers, five times each", () => {
  beforeEach(freshLife, 180_000);

  for (const kill of KILLS) {
    for (let n = 1; n <= 5; n++) {
      it(`scenario: ${kill.name} (run ${n} of 5)`, () => survive(kill));
    }
  }
});

describe("the whole recovery sequence, five times", () => {
  beforeEach(freshLife, 180_000);

  for (let n = 1; n <= 5; n++) {
    it(`scenario: every kill in turn on one stage life (run ${n} of 5)`, async () => {
      for (const kill of KILLS) {
        await survive(kill);
      }
    });
  }
});

// Review 1, A (p17 and p5): a brain call in flight must not hold the window's loop. The brain hangs
// while a call is out, the hang is held past the 10 s detection bound (BEAT + BEAT,
// `transport/link.ts`), and the frame must leave `online` within it. scenario: only the built tab on
// the real stage shows whether a Cmd handler that waits on the brain holds tea's serial loop; the
// pure half is the window and link laws' hang law. The press case hangs the real workerd with
// SIGSTOP. The open and knock cases need the hang to start at one exact call, so Playwright's
// WebSocket route stands between the tab and the stage and stops passing the brain's frames from
// that call on (or drops that one call's answer): the page, its client and its socket are the real
// ones, and no client driver is installed in the page.
const DETECTION = 10_000;
const SLACK = 5_000;

/** Waits for the frame to leave `online`, and answers how long that took since `from`. */
const leftOnline = async (tab: Tab, from: number): Promise<number> => {
  await until(
    "the frame to leave online while the brain hangs",
    async () => (/^online/i.test((await connection(tab.page)).trim()) ? undefined : true),
    DETECTION + SLACK,
  );
  return performance.now() - from;
};

type Route = {
  /** From the next frame the tab sends that names `method`, the brain says nothing more on that socket. */
  hangAt: (method: string) => void;
  /** Drop the answer to the next call the tab sends that names `method`; every other frame passes. */
  dropAnswer: (method: string) => void;
  /** How many frames the tab sent that name `method`. */
  sent: (method: string) => number;
  /** Ends every routed socket from the brain's side, as a dropped connection does. */
  cut: () => void;
};

/** Puts a WebSocket route between the context's tabs and the stage. */
const routed = async (context: import("playwright").BrowserContext): Promise<Route> => {
  let hang: string | null = null;
  let drop: string | null = null;
  const counts = new Map<string, number>();
  const open = new Set<{ close: () => void }>();
  await context.routeWebSocket(/\/client\//, (ws) => {
    const server = ws.connectToServer();
    const end = { close: () => void ws.close({ code: 1000, reason: "cut" }) };
    open.add(end);
    let hung = false;
    const dropped = new Set<unknown>();
    ws.onMessage((message) => {
      const text = String(message);
      const call = text.startsWith("{") ? (JSON.parse(text) as { id?: unknown; method?: string }) : {};

      if (call.method !== undefined) {
        counts.set(call.method, (counts.get(call.method) ?? 0) + 1);
      }

      if (hang !== null && call.method === hang) {
        hang = null;
        hung = true;
      }

      if (drop !== null && call.method === drop) {
        drop = null;
        dropped.add(call.id);
      }

      server.send(message);
    });
    server.onMessage((message) => {
      const text = String(message);
      const id = text.startsWith("{") ? (JSON.parse(text) as { id?: unknown }).id : undefined;

      if (!hung && !(id !== undefined && dropped.has(id))) {
        ws.send(message);
      }
    });
    ws.onClose((code, reason) => {
      open.delete(end);
      void server.close({ code, reason });
    });
    server.onClose((code, reason) => void ws.close({ code, reason }));
  });
  return {
    hangAt: (method) => {
      hang = method;
    },
    dropAnswer: (method) => {
      drop = method;
    },
    sent: (method) => counts.get(method) ?? 0,
    cut: () => {
      for (const end of [...open]) {
        end.close();
      }
    },
  };
};

describe("a brain call in flight does not hold the window, five times each (review 1, A)", () => {
  beforeEach(freshLife, 180_000);

  for (let n = 1; n <= 5; n++) {
    it(`scenario: a press in flight while workerd hangs past 10 s takes the frame off online, and lands once after (run ${n} of 5)`, async () => {
      const a = await window();
      const b = await window();
      const saved = ledgerFor("hang detection, a send in flight");
      const base = await first(a.tab);
      const pid = workerd(stage);
      // edge: stops workerd by signal to hang the brain, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
      stage.kill(pid, "SIGSTOP");

      try {
        const t0 = performance.now();
        await press(a.tab.page, "Add one", 0); // process.send goes out; no answer comes
        saved.pressed();
        const took = await leftOnline(a.tab, t0);
        (samples["hang detection, a send in flight"] ??= []).push(took);
        expect(took, "the hang is seen within BEAT + BEAT").toBeLessThanOrEqual(DETECTION + SLACK);
        await pause(Math.max(0, DETECTION + SLACK - took)); // the hang is held past the bound
      } finally {
        // edge: continues the stopped workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
        stage.kill(pid, "SIGCONT");
      }

      await settled(a.tab, base + 1, 100_000, "hang detection, a send in flight, tab a");
      await settled(b.tab, base + 1, 100_000, "hang detection, a send in flight, tab b");
      await saved.holds(30_000);
    });

    it(`scenario: a view.open in flight while the brain hangs past 10 s takes the frame off online, and the next dial shows the count (run ${n} of 5)`, async () => {
      const p = await openProfile();
      closers.push(p.close);
      const route = await routed(p.context);
      const tab = await p.tab(stage.url);
      await grant(stage, tab);
      const saved = ledgerFor("hang detection, an open in flight");
      const base = await first(tab);
      const opens = route.sent("view.open");
      route.hangAt("view.open");
      // A new dial opens its views again (p4): end this one, and the next one hangs at its open.
      route.cut();
      await until("the next dial's view.open", () => (route.sent("view.open") > opens ? true : undefined), 60_000);
      const t0 = performance.now();
      const took = await leftOnline(tab, t0);
      (samples["hang detection, an open in flight"] ??= []).push(took);
      expect(took, "the hang is seen within BEAT + BEAT").toBeLessThanOrEqual(DETECTION + SLACK);
      await pause(Math.max(0, DETECTION + SLACK - took));
      // The brain is back on the next dial: the count shows and a press lands once.
      await until(
        "the frame to be online again",
        async () => (/^online/i.test(await connection(tab.page)) ? true : undefined),
        60_000,
      );
      expect(await first(tab)).toBe(base);
      await press(tab.page, "Add one", 0);
      saved.pressed();
      await settled(tab, base + 1, undefined, "hang detection, an open in flight");
      await saved.holds(30_000);
    });

    it(`scenario: a renewed door.knock whose answer never comes does not hold the grant wait: the grant still takes the tab online (run ${n} of 5)`, async () => {
      const p = await openProfile();
      closers.push(p.close);
      const route = await routed(p.context);
      const tab = await p.tab(stage.url);
      const w = await readWaiting(stage, tab);
      const knocks = route.sent("door.knock");
      // The link knocks again every 30 s while it waits; the brain never answers that one.
      route.dropAnswer("door.knock");
      await until(
        "the grant wait to knock again",
        () => (route.sent("door.knock") > knocks ? true : undefined),
        45_000,
      );
      await pause(DETECTION + SLACK); // the knock is held past the bound
      await runGrant(stage, w.fingerprint, w.code, stage.key);
      await tab.page
        .getByRole("region", { name: /^counter/i })
        .first()
        .waitFor({ timeout: 30_000 });
      expect((await connection(tab.page)).trim()).toMatch(/^online/i);
    });
  }
});

// Review 1, B (the plan's plant "lose the last update"): a valid key edit saved while the brain
// restarts reaches the window. The stage's reader publishes it through the trusted control call;
// that call fails while workerd is down, and the edit must still arrive once the brain is back.
// scenario: only the real stage, its file watcher and a killed workerd show it.
describe("a key edit saved while the brain restarts reaches the window, five times", () => {
  beforeEach(freshLife, 180_000);

  for (const [n, key] of ["j", "k", "l", "m", "n"].entries()) {
    it(`scenario: counter.inc rebound to ${key} while workerd restarts takes effect after it (run ${n + 1} of 5)`, async () => {
      const a = await window();
      const saved = ledgerFor(`key rebind to ${key}`);
      const base = await first(a.tab);
      const dead = workerd(stage);
      // edge: kills workerd by signal, since Alchemy's runtime has no form to crash it from outside, not reported, 0042 amendment 2026-11-09
      stage.kill(dead, "SIGKILL");
      writeFileSync(join(stage.home, "keybindings.toml"), `[keys]\n"counter.inc" = [${JSON.stringify(key)}]\n`);
      // Right after the kill the frame can still say online, on the dial that just died, so an
      // online check alone can pass before the restart began (run 4 of the lead's 2026-11-10 run).
      // The restart is seen first: a workerd other than the killed one runs under the stage.
      await until(
        "a new workerd under the stage",
        () =>
          // edge: finds workerd with `ps` under the stage, since Alchemy's runtime has no form to list or crash it from outside, not reported, 0042 amendment 2026-11-09
          stage.processes().some((p) => /workerd/.test(p.command) && p.pid !== dead) ? true : undefined,
        100_000,
      );
      await until(
        "the frame to be online again",
        async () => (/^online/i.test(await connection(a.tab.page)) ? true : undefined),
        100_000,
      );
      // Give the tile focus without pressing anything, then press the new key, once per try, for
      // up to a minute: the edit reaches the tab after the brain takes it and the tab reads it.
      const tile = a.tab.page.getByRole("region", { name: /^counter/i }).first();
      const stop = Date.now() + 60_000;
      let took = false;

      while (!took && Date.now() < stop) {
        await tile.getByRole("button", { name: "Take one away" }).focus();
        await a.tab.page.keyboard.press(key);

        try {
          took = await until(
            `the ${key} key to add one`,
            async () => ((await first(a.tab)) > base ? true : undefined),
            2_000,
          );
        } catch {
          took = false;
        }
      }

      expect(took, `the edit saved during the restart rebinds counter.inc to ${key}`).toBe(true);
      await pause(3_000); // a press that lands late still counts
      saved.pressed((await first(a.tab)) - base);
      await saved.holds(30_000);
    });
  }
});
