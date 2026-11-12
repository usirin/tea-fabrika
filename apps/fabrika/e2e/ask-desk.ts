import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Ledger, streams } from "@kampus/fabrika-old";
import { layerSqliteSync } from "@kampus/fabrika-old/sqlite";
import { blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
import { nameOf } from "@kampus/pipeline/tickets/ticket";
import { Effect } from "effect";
import { build } from "esbuild";
import type { ElectronApplication, Locator, Page } from "playwright";
import {
  CANONICAL_INPUT,
  CANONICAL_TEXT,
  DRAFT,
  FILED,
  HEAD,
  NONE,
  policyFor,
  type Sealed,
} from "../../../fixtures/ask-desk/cases.ts";
import { testProject } from "../projects-e2e.ts";

// Today's app. The amendment excludes a new inbox, glance, Open all and content-tile placement.
// Run only on purpose through e2e.ts --ask-desk; never through Vitest. No agent or key is needed.
type Tools = {
  launch: (home: string) => Promise<ElectronApplication>;
  prompted: (page: Page, tile: string) => Promise<unknown>;
  run: (page: Page, tile: string, line: string) => Promise<unknown>;
  prefixed: (page: Page, key: string) => Promise<unknown>;
  focusOn: (page: Page, tile: string) => Promise<unknown>;
  tilesAre: (page: Page, ids: string[]) => Promise<unknown>;
  lookIs: (app: ElectronApplication, page: Page, look: "dark" | "light") => Promise<unknown>;
  hostPid: (home: string) => Promise<number | null>;
  stop: (pid: number) => Promise<unknown>;
  shots: string;
};

// ASK_DESK_SOFT=1 logs a failed check and goes on, so the shots still get taken; the run then
// lists every failure and exits nonzero. Without it, the first failure stops the run.
const soft = process.env.ASK_DESK_SOFT === "1";
const failed: string[] = [];
let watched: Page | null = null;
let failShots: string | null = null;

const check = (what: string, yes: boolean, seen?: unknown) => {
  if (!yes && !soft) {
    throw new Error(`${what}: ${JSON.stringify(seen)}`);
  }

  if (!yes) {
    failed.push(`${what}: ${JSON.stringify(seen)}`);

    // What the window showed when the check failed, beside the shots, for whoever reads them.
    if (watched !== null && failShots !== null) {
      void watched.screenshot({ path: join(failShots, `failed-${failed.length}.png`) }).catch(() => {});
    }
  }

  console.log(`${yes ? "ok  " : "FAIL"} ask desk ${what}`);
};

// In soft mode, a step that throws (a wait that times out) is a failed check, and the run goes on.
const attempt = (what: string, step: () => Promise<unknown>) => {
  if (!soft) {
    return step();
  }

  return step().catch(async (e: unknown) => {
    if (watched !== null && failShots !== null) {
      await watched
        .screenshot({ path: join(failShots, `${what.replaceAll(/[^a-z0-9]+/gi, "-")}.png`) })
        .catch(() => {});
    }

    check(what, false, e instanceof Error ? e.message.split("\n")[0] : e);
  });
};

const until = async <A>(what: string, read: () => Promise<A>, ok: (value: A) => boolean) => {
  let value = await read();

  for (let i = 0; i < 200 && !ok(value); i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }

  if (!ok(value) && watched !== null && failShots !== null) {
    await watched.screenshot({ path: join(failShots, `${what.replaceAll(/[^a-z0-9]+/gi, "-")}.png`) }).catch(() => {});
  }

  check(what, ok(value), value);
  return value;
};

/** Capture a menu only after its fade has reached the final frame. */
const finishAnimations = (locator: Locator) =>
  locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });

/**
 * Takes the window off the screen for good: a hidden window is one no window manager (yabai, a
 * tiling one) can move or size. The quiet launch (FABRIKA_HOME, launch.ts) draws it hidden and
 * keeps its page awake (`paintWhenInitiallyHidden`, no background throttling), so it still lays
 * out, runs its frames and takes Playwright's screenshots. It shows for a moment at launch, before
 * this runs; nothing here changes the app, only this test's window.
 */
const hide = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());

/** Sizes the hidden window's page to exactly `want`, whatever the displays, and waits for it. */
const sizeTo = async (
  app: ElectronApplication,
  page: Page,
  want: { readonly width: number; readonly height: number },
) => {
  await app.evaluate(
    ({ BrowserWindow }, want) => BrowserWindow.getAllWindows()[0]?.setContentSize(want.width, want.height),
    want,
  );
  await until(
    `the hidden window's page is ${want.width} by ${want.height}`,
    () => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    (size) => size.width === want.width && size.height === want.height,
  );
};

const seal: (draft: unknown, policy: { seed: number }) => Effect.Effect<Sealed, unknown> = sealAsk;

/** Runs `program` on the fixture project's own ledger: since ticket 276 the host reads it there. */
const on = async <A, E>(home: string, program: Effect.Effect<A, E, Ledger>) => {
  const projectHome = (await testProject(home)).home;
  await mkdir(projectHome, { recursive: true, mode: 0o700 });
  return Effect.runPromise(
    program.pipe(Effect.provide(layerSqliteSync({ path: join(projectHome, "ledger.sqlite") })), Effect.scoped),
  );
};

const seedAsk = (
  home: string,
  ticket: number,
  hidden = false,
  rec: unknown = DRAFT.rec,
  id = `a-approve-${ticket}`,
  what: string = DRAFT.what,
) =>
  on(
    home,
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      const inbox = streams(nameOf(ticket)).inbox;
      yield* ledger.register(nameOf(ticket), "user:owner");
      yield* ledger.send(inbox, "file", { kind: "filed", writer: "user:owner", data: FILED });
      yield* ledger.send(inbox, "plan/2", {
        kind: "planned",
        writer: "agent:lane for:owner",
        data: { type: "planned", version: 2, tasks: [] },
      });
      // A blind ask is a step's: an approve ask is never drawn blind (review 2, medium 2).
      const draft = { ...DRAFT, ask: id, rec, what, ...(hidden ? { for: "step" } : {}) };
      const ask = yield* seal(draft, policyFor(id, hidden, blindDraw));
      yield* ledger.send(inbox, id, { kind: "asked", writer: "agent:lane for:owner", data: ask });
      return ask;
    }),
  );

const answers = (home: string, ticket: number) =>
  on(
    home,
    Effect.gen(function* () {
      const all = yield* (yield* Ledger).readStream(streams(nameOf(ticket)).inbox);
      return all.filter((r) => r.kind === "answered").map((row): Record<string, unknown> => JSON.parse(row.data));
    }),
  );

const seedFacts = (
  home: string,
  ticket: number,
  facts: readonly { readonly type: string; readonly [key: string]: unknown }[],
) =>
  on(
    home,
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      const inbox = streams(nameOf(ticket)).inbox;
      yield* ledger.register(nameOf(ticket), "user:owner");

      for (const [i, fact] of [FILED, ...facts].entries()) {
        yield* ledger.send(inbox, `state/${i}`, {
          kind: fact.type,
          writer: i === 0 ? "user:owner" : "agent:lane for:owner",
          data: fact,
        });
      }
    }),
  );

/** The open ask's view in `tile`, found by its question. */
const box = (page: Page, tile = "t1", what: string = DRAFT.what) =>
  page.locator(`[data-tile="${tile}"]`).getByRole("region", { name: `ask: ${what}`, exact: true });

const button = (where: Locator, name: string) => where.getByRole("button", { name: new RegExp(`^${name}`) });
const focusIn = (where: Locator) => where.evaluate((element) => element.contains(document.activeElement));
const clickRec = (where: Locator) => button(where, "Take rec").click();

const browserHash = async (page: Page) => {
  const bundle = await build({
    stdin: {
      contents:
        'import {hash} from "@kampus/fabrika-old"; import {Effect} from "effect"; export const digest = value => Effect.runPromise(hash(value));',
      resolveDir: import.meta.dirname,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "askDeskHash",
  });
  // The page's CSP refuses inline script tags; Playwright's evaluate runs over CDP, outside it.
  await page.evaluate(bundle.outputFiles[0]?.text ?? "");
  const seen = await page.evaluate(async (value) => {
    const api = Reflect.get(window, "askDeskHash") as { digest: (v: unknown) => Promise<string> };
    return api.digest(value);
  }, CANONICAL_INPUT);
  check(
    "P3 Chromium matches the independent RFC/Node hash",
    seen === `sha256:${createHash("sha256").update(CANONICAL_TEXT).digest("hex")}`,
    seen,
  );
};

export const askDesk = async (tools: Tools) => {
  const home = await mkdtemp(join(tmpdir(), "ad-"));
  const dir = join(tools.shots, "ask-desk");
  await mkdir(dir, { recursive: true });
  // Exercise remapping and unbinding through the same file a person edits.
  await writeFile(join(home, "keybindings.toml"), 'program.ask.rec = "r"\nprogram.ask.later = []\n');
  await seedAsk(home, 117);
  await seedAsk(home, 118);
  await seedAsk(home, 119, true);
  await seedAsk(home, 120, false, NONE);
  await seedAsk(home, 124);
  await seedFacts(home, 121, [{ type: "started", run: "r-build-121", stage: "build", task: null, log: null }]);
  await seedFacts(home, 122, [{ type: "stopped", why: "read_failed", resume: "review" }]);
  await seedFacts(home, 123, [
    {
      type: "pr",
      url: "https://github.com/fixture/project/pull/1",
      state: "merged",
      head: HEAD,
      checks: [],
    },
  ]);
  const app = await tools.launch(home);
  const captured: string[] = [];
  let failedTicket = 130;
  const shot = async (page: Page, state: string, layout: string, look: string) => {
    const file = `${state}-${layout}-${look}.png`;
    // Round 30, law 4: a press leaves the pointer on what it pressed, and its hover look is not the
    // state being shot. Park the pointer off the ticket tile first.
    await parkPointer(page);
    // Manti fades the buttons' colors, so a shot straight after a state change catches them
    // mid-fade. Wait (at most ~2 s) until the ask box's buttons show equal computed colors on
    // two reads and none has a running finite animation or transition. Only the box's buttons
    // are watched, never the whole document, and infinite animations are ignored.
    const region = box(page);

    if ((await region.count()) > 0) {
      const settled = await region
        .first()
        .evaluate(async (element) => {
          const buttons = () => [...element.querySelectorAll("button")];
          const colors = () =>
            buttons()
              .map((b) => {
                const style = getComputedStyle(b);
                const label = b.querySelector("span") ?? b;
                return [style.backgroundColor, style.color, style.borderColor, getComputedStyle(label).color].join("|");
              })
              .join("/");
          const running = () =>
            buttons().some((b) =>
              b.getAnimations({ subtree: true }).some((a) => a.effect?.getComputedTiming().iterations !== Infinity),
            );
          const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
          const until = performance.now() + 2000;
          let last = "";

          while (performance.now() < until) {
            await frame();
            const now = colors();

            if (now === last && !running()) {
              return true;
            }

            last = now;
          }

          return false;
        })
        .catch(() => false);

      if (!settled) {
        console.log(`note ask desk ${file}: the ask box's buttons were still changing after 2 s`);
      }
    }

    await calmTile(`${state}-${layout}-${look}`, page);
    await page.screenshot({ path: join(dir, file) });
    captured.push(file);
  };

  try {
    const page = await app.firstWindow();
    watched = page;
    await hide(app);
    // The size main.ts asks for.
    await sizeTo(app, page, { width: 1200, height: 760 });
    failShots = soft ? join(tools.shots, "ask-desk-failed") : null;

    if (failShots !== null) {
      await mkdir(failShots, { recursive: true });
    }

    await tools.prompted(page, "t1");
    await browserHash(page);
    await tools.run(page, "t1", "ticket --ticket 117");
    await box(page).waitFor();
    const first = box(page);
    await first.focus();
    check(
      "P14 remapped keycap matches aria-keyshortcuts",
      (await button(first, "Take rec").getAttribute("aria-keyshortcuts")) === "r",
    );
    await page.keyboard.press("y");
    check("P14 the old key is unbound", (await answers(home, 117)).length === 0);
    check("P17 d: the marks show before a pick", (await marksIn(first)) === 2, await marksIn(first));
    await onTheLine("P17 d: the marks sit on the rec line", first);
    check("P23 E: Recommended once before a pick", (await recommendedIn(first)) === 1);
    await page.keyboard.press("n");
    const note = first.getByRole("textbox");
    await note.waitFor();
    check("P24 n focuses the required note", await note.evaluate((e) => e === document.activeElement));
    await page.keyboard.type("yonh");
    check("P14 letter keys type in a note", (await note.inputValue()) === "yonh");
    check("P14 typing never answers", (await answers(home, 117)).length === 0);
    check("P17 d: the marks stay with a note open", (await marksIn(first)) === 2);
    check("P23 E: Recommended once with the note open", (await recommendedIn(first)) === 1);
    await button(first, "Needed me").click();
    check("P17 true mark", (await button(first, "Needed me").getAttribute("aria-pressed")) === "true");
    await button(first, "Needed me").click();
    check("P17 clear mark", (await button(first, "Needed me").getAttribute("aria-pressed")) === "false");
    await button(first, "Needed me").click();
    await note.focus();
    await page.keyboard.press("Escape");
    check("P24 Escape closes the note before leaving the ask", (await note.count()) === 0 && (await first.isVisible()));
    check("P17 d: the marks stay after Escape", (await marksIn(first)) === 2);
    check("P17 d: Escape keeps the mark", (await button(first, "Needed me").getAttribute("aria-pressed")) === "true");
    await button(first, "Every pick").click();
    await first
      .getByRole("button", { name: /approve/i })
      .last()
      .waitFor();
    check("P17 d: the marks stay with every pick open", (await marksIn(first)) === 2);
    check("P23 E: Recommended once with every pick open", (await recommendedIn(first)) === 1);
    await page.keyboard.press("Escape");
    check("P24 every pick closes one level", await first.isVisible());
    // Clear the mark, so this rec answer is the unmarked one.
    await button(first, "Needed me").click();
    await clickRec(first);
    await until(
      "P15 click records rec",
      () => answers(home, 117),
      (a) => a.length === 1,
    );
    check(
      "P17 d: no mark set means no needed key on the answer",
      !Object.hasOwn((await answers(home, 117))[0] ?? {}, "needed"),
      (await answers(home, 117))[0],
    );
    check(
      "P24 answer is politely announced",
      (await page
        .getByRole("status")
        .filter({ hasText: /approved/i })
        .count()) === 1,
    );
    check("P24 the answer keeps focus in its component", await focusIn(page.locator('[data-tile="t1"]')));

    // The mark rides with a picked answer: n, Agent could work it out, a note, Enter.
    await page.keyboard.press("Control+c");
    await tools.prompted(page, "t1");
    await tools.run(page, "t1", "ticket --ticket 124");
    await box(page).waitFor();
    await button(box(page), "Not the rec").click();
    await box(page).getByRole("textbox").fill("The plan misses the empty input");
    await button(box(page), "Agent could work it out").click();
    await box(page).getByRole("textbox").press("Enter");
    const marked = await until(
      "P17 a marked pick saves",
      () => answers(home, 124),
      (a) => a.length === 1,
    );
    check(
      "P17 false survives the window write",
      marked[0]?.needed === false &&
        (marked[0]?.answer as Record<string, unknown> | undefined)?._tag === "against" &&
        (marked[0]?.answer as Record<string, unknown> | undefined)?.note === "The plan misses the empty input",
      marked[0],
    );

    await page.keyboard.press("Control+c");
    await tools.prompted(page, "t1");
    await tools.run(page, "t1", "ticket --ticket 118");
    await box(page).waitFor();
    // Option d: a mark before a pick, then the rec on one key.
    await button(box(page), "Needed me").click();
    await box(page).focus();
    await page.keyboard.down("r");
    await until(
      "P13 first held press answers",
      () => answers(home, 118),
      (a) => a.length === 1,
    );
    await attempt("P13 the next ask shows every pick under a held key", async () => {
      await seedAsk(home, 118, false, DRAFT.rec, "a-approve-118-next");
      await box(page).waitFor();
      await page.keyboard.down("r");
      await page.keyboard.press("o");
      await box(page)
        .getByRole("button", { name: /approve/i })
        .last()
        .waitFor({ timeout: 5000 });
      check("P13 repeated keydown cannot answer the next ask", (await answers(home, 118)).length === 1);
    });
    await page.keyboard.up("r");
    await page.keyboard.press("Escape");
    const click = (await answers(home, 117))[0];
    const key = (await answers(home, 118))[0];
    check(
      "P15 click and key resolve to the same answer",
      JSON.stringify(click?.answer) === '{"_tag":"rec"}' &&
        JSON.stringify(click?.answer) === JSON.stringify(key?.answer),
    );
    check(
      "P17 d: a mark then the rec key records needed: true with the rec",
      key?.needed === true && JSON.stringify(key?.answer) === '{"_tag":"rec"}',
      key,
    );
    check("P15 remapped actual key is recorded", (key?.via as { took?: { key: string } })?.took?.key === "r");

    await page.keyboard.press("Control+c");
    await tools.prompted(page, "t1");
    await tools.run(page, "t1", "ticket --ticket 119");
    await box(page).waitFor();
    check(
      "P8 blind ask has no Take rec button, including hidden DOM",
      (await box(page)
        .getByRole("button", { name: /take rec/i, includeHidden: true })
        .count()) === 0,
    );
    check(
      "P8 blind rec does not leak through DOM or accessible text",
      !(await box(page).ariaSnapshot()).includes(DRAFT.rec.why) &&
        !(await box(page).innerHTML()).includes(DRAFT.rec.why),
    );
    check("P23 E: a blind ask never says Recommended", (await recommendedIn(box(page))) === 0);
    check("P17 d: a blind ask offers the marks before a pick", (await marksIn(box(page))) === 2);
    await onTheLine("P17 d: a blind ask's marks sit on the bar's line", box(page));
    await tools.prefixed(page, "|");
    await tools.prompted(page, "t2");
    await tools.run(page, "t2", "tracker | ticket");
    // The tracker and old asks menu read the same sealed ask, never redraw the blind draw.
    await tools.prefixed(page, "a");
    const menu = page.locator("#pop-asks");
    await menu.waitFor();
    await menu.getByText(DRAFT.what, { exact: true }).first().waitFor();
    check(
      "P10 old asks menu uses the shared answer controls",
      (await menu.getByRole("button", { name: /every pick/i }).count()) > 0,
    );
    const views = menu.getByRole("region", { name: /^ask: / });
    const said: number[] = [];

    for (let i = 0; i < (await views.count()); i++) {
      said.push(await recommendedIn(views.nth(i)));
    }

    check(
      "P23 E: each ask in the menu says Recommended once at most",
      said.every((n) => n <= 1),
      said,
    );
    const inMenu: number[] = [];

    for (let i = 0; i < (await views.count()); i++) {
      inMenu.push(await marksIn(views.nth(i)));
    }

    check(
      "P17 d: each ask in the menu offers both marks before a pick",
      inMenu.length > 0 && inMenu.every((n) => n === 2),
      inMenu,
    );
    const selected = menu.getByRole("row", { selected: true });
    check("P24 selection has a supported row role", (await selected.count()) === 1);
    const before = await selected.textContent();
    await page.keyboard.press("ArrowDown");
    check(
      "P24 an arrow changes the selected row",
      (await menu.getByRole("row", { selected: true }).textContent()) !== before,
    );
    await page.keyboard.press("Escape");

    // Round 7, fix 7: the remap above proves the keys are configurable; that case ends here. The
    // shots show the decided keys (docs/direction/ask-desk.md, A3: `y` takes the rec), so the file
    // goes back to empty, the defaults, and the host's watch hands the window the default table.
    await writeFile(join(home, "keybindings.toml"), "");
    await until(
      "P14 7: the shots use the default keymap: Later is on h again",
      () => button(box(page), "Later").getAttribute("aria-keyshortcuts"),
      (keys) => keys === "h",
    );

    // P23/P24 captures: real ticket and tracker, both themes, all five required layouts.
    // No new inbox, new glance or content-opening screenshots are required by this PR.
    await tools.focusOn(page, "t1");
    await tools.prefixed(page, "-");
    // `tracker | ticket` took t2 and t3, so the two splits are t4 (under t1) and t5 (under t2).
    await tools.prompted(page, "t4");
    await tools.focusOn(page, "t2");
    await tools.prefixed(page, "-");
    await tools.prompted(page, "t5");
    await tools.focusOn(page, "t1");
    const layouts = ["one", "side", "stacked", "2x2", "small"] as const;

    for (const layout of layouts) {
      // Fold existing tiles to create each shape; running work stays alive.
      const visible =
        layout === "one"
          ? ["t1"]
          : layout === "side"
            ? ["t1", "t2"]
            : layout === "stacked"
              ? ["t1", "t4"]
              : ["t1", "t4", "t2", "t5"];
      // Unfold at one known size, the big one, so a strip's tile gets its room.
      await sizeTo(app, page, { width: 1440, height: 1000 });
      // Open every strip first: a column whose tiles all folded is one strip named by the
      // column, not by a tile, so a tile's own strip may not exist.
      const strips = page.locator("[data-strip]").filter({ visible: true });

      // A strip may still be sliding into place, so press it in the page, not by its position.
      for (let i = 0; i < 8 && (await strips.count()) > 0; i++) {
        await strips.first().evaluate((element) => (element as HTMLElement).click());
        await page.waitForTimeout(300);
      }

      for (const id of ["t1", "t2", "t3", "t4", "t5"]) {
        await page.locator(`[data-tile="${id}"]`).waitFor();
      }

      for (const id of ["t2", "t3", "t4", "t5"]) {
        if (visible.includes(id)) {
          continue;
        }

        await tools.focusOn(page, id);
        await tools.prefixed(page, "f");
      }

      await tools.focusOn(page, "t1");
      const size = layout === "small" ? { width: 1024, height: 700 } : { width: 1440, height: 1000 };

      for (const look of ["dark", "light"] as const) {
        await sizeTo(app, page, size);
        await tools.lookIs(app, page, look);
        await shot(page, "blind", layout, look);
        await inspectLine(`blind-${layout}-${look}`, box(page));

        if (layout !== "small") {
          await blindLine(`blind-${layout}-${look}`, box(page));
        }

        // Round 30, laws 2 and 3 on the blind ask, whose hint wraps the piece at side and 2x2:
        // Needed me, then Agent could work it out, then clear, so the ask is left unmarked.
        const blindUnmarked = await markPlace(box(page));

        for (const name of ["Needed me", "Agent could work it out"]) {
          await button(box(page), name).click();
          await marksHold(`blind, ${name}, ${layout}-${look}`, box(page), blindUnmarked, true);
        }

        await button(box(page), "Agent could work it out").click();
        await marksHold(`blind, clear, ${layout}-${look}`, box(page), blindUnmarked, false);
        await inspectBar(page, box(page));
        await inspectCard(page, box(page));
        // Today's asks menu, drawn with the shared ask view.
        await attempt("P10 the asks menu opens", async () => {
          await tools.prefixed(page, "a");
          await page.locator("#pop-asks").getByText(DRAFT.what, { exact: true }).first().waitFor();
          await finishAnimations(page.locator("#pop-asks"));
          await shot(page, "asks-menu", layout, look);
          const menu = page.locator("#pop-asks");
          await menuWidth(`asks-menu-${layout}-${look}`, menu);
          await noCardInMenu(`asks-menu-${layout}-${look}`, menu);
          const views = menu.getByRole("region", { name: /^ask: / });

          for (let i = 0; i < (await views.count()); i++) {
            await inspectLine(`asks-menu-${layout}-${look}, ask ${i + 1}`, views.nth(i));
          }

          await closedRows(`asks-menu-${layout}-${look}`, menu);
          const tight = layout === "side" || layout === "2x2";
          await openRow(`asks-menu-${layout}-${look}`, menu, tight);
          const rowId = () => menu.getByRole("row", { selected: true }).evaluate((row) => row.id);
          const was = await rowId();
          const total = await menu.getByRole("row").count();

          if (layout !== "small") {
            // The blind ask's row, then back to the row that was open, so later shots match.
            const blindOpen = () =>
              menu
                .getByRole("row", { selected: true })
                .evaluate((row) => (row.textContent ?? "").includes("Your pick first"));

            for (let i = 0; i < total && !(await blindOpen()); i++) {
              await page.keyboard.press("ArrowDown");
            }

            if (await blindOpen()) {
              // Round 7c: the blind hint takes its width and the marks follow it or take the
              // next line, the same rule as in the bar; openRow holds the row's own rules.
              await blindLine(
                `asks-menu-${layout}-${look}, blind`,
                menu.getByRole("row", { selected: true }).getByRole("region", { name: /^ask: / }),
              );
              await openRow(`asks-menu-${layout}-${look}, blind`, menu, tight);
            } else {
              check(`P23 E 7, asks-menu-${layout}-${look}: the blind ask has a row`, false);
            }

            for (let i = 0; i < total && (await rowId()) !== was; i++) {
              await page.keyboard.press("ArrowDown");
            }
          }

          // Round 7b, fix 3: a shown-rec ask (seeded above with the rec, picks approve and no)
          // open in the menu, at all five layouts: its own shot, its row and its five buttons.
          const opened = menu.getByRole("row", { selected: true });
          const recOpen = () =>
            opened.evaluate((row) =>
              [...row.querySelectorAll("button")].some(
                (b) => /^Take rec/.test((b.textContent ?? "").trim()) && b.getBoundingClientRect().width > 0,
              ),
            );

          for (let i = 0; i < total && !(await recOpen()); i++) {
            await page.keyboard.press("ArrowDown");
          }

          if (await recOpen()) {
            await menu.evaluate((popover) =>
              Promise.all(popover.getAnimations({ subtree: true }).map((a) => a.finished)),
            );
            await shot(page, "asks-menu-rec", layout, look);
            const when = `asks-menu-rec-${layout}-${look}`;
            await menuWidth(when, menu);
            const names = ["Take rec", "Not the rec", "Every pick", "Open ticket", "Later"];
            const counts = await Promise.all(
              names.map((name) => button(opened, name).filter({ visible: true }).count()),
            );
            check(
              `P23 E 7b, ${when}: the open row shows its five actions`,
              counts.every((n) => n === 1),
              Object.fromEntries(names.map((name, i) => [name, counts[i]])),
            );
            await inspectLine(when, opened.getByRole("region", { name: /^ask: / }));
            await openRow(when, menu, tight);
          } else {
            check(`P23 E 7b, asks-menu-${layout}-${look}: a shown-rec ask has a row`, false);
          }

          for (let i = 0; i < total && (await rowId()) !== was; i++) {
            await page.keyboard.press("ArrowDown");
          }

          await page.keyboard.press("Escape");
        });
        await page.keyboard.press("Control+c");
        await tools.prompted(page, "t1");
        await tools.run(page, "t1", "ticket --ticket 120");
        await box(page).waitFor();
        check(
          "P8 no-rec ask has no Take rec",
          (await box(page)
            .getByRole("button", { name: /take rec/i })
            .count()) === 0,
        );
        check("P23 E: a no-rec ask never says Recommended", (await recommendedIn(box(page))) === 0);
        check("P17 d: a no-rec ask offers the marks", (await marksIn(box(page))) === 2);
        await onTheLine("P17 d: a no-rec ask's marks sit on the bar's line", box(page));
        await shot(page, "no-rec", layout, look);
        await inspectLine(`no-rec-${layout}-${look}`, box(page));

        if (layout === "one" && look === "dark") {
          await attempt("P23 E: the bar is the ask, in shown-one", async () => {
            // A ticket of its own, with a question no other ask has: 118's answered asks
            // rightly keep their rows, which say the same question.
            const what = "Do you approve plan version 3?";
            await seedAsk(home, 125, false, DRAFT.rec, "a-approve-125", what);
            await page.keyboard.press("Control+c");
            await tools.prompted(page, "t1");
            await tools.run(page, "t1", "ticket --ticket 125");
            await box(page, "t1", what).waitFor();
            const tile = await page.locator('[data-tile="t1"]').innerText();
            check(
              "P23 E: in shown-one, the open ask's question is in the ticket tile once",
              tile.split(what).length - 1 === 1,
              tile.split(what).length - 1,
            );
          });
        }

        await page.keyboard.press("Control+c");
        await tools.prompted(page, "t1");
        await tools.run(page, "t1", "ticket --ticket 118");
        await box(page).waitFor();
        await shot(page, "shown", layout, look);
        await takeRecReads(`shown-${layout}-${look}`, box(page));
        // Round 29, law 3 (property 22): #118 holds earlier asks with the open ask's question. The
        // unit law is programs/ticket/src/earlier.ask-desk.test.ts; here the real tile says it too.
        await attempt(`P22 11-09, shown-${layout}-${look}: the open question is in Activity unmarked`, async () => {
          const said = await page.locator('[data-tile="t1"]').evaluate((tile, question) => {
            const rows = [...tile.querySelectorAll('[aria-label="Activity"] .act-r')].map(
              (row) => row.textContent ?? "",
            );
            const mine = rows.filter((row) => row.includes(question));
            const text = (tile as HTMLElement).innerText;
            return {
              rows: mine,
              unmarkedRows: mine.filter((row) => !/earlier/i.test(row)).length,
              unmarkedInTile: text.split("\n").filter((line) => line.includes(question) && !/earlier/i.test(line))
                .length,
            };
          }, DRAFT.what);
          check(
            `P22 11-09, shown-${layout}-${look}: no Activity row reads as the bar's open ask (an answered row with its question names itself earlier)`,
            said.unmarkedRows === 0,
            said,
          );
          check(
            `P22 11-09, shown-${layout}-${look}: the open question appears once in the tile, unmarked`,
            said.unmarkedInTile === 1,
            said,
          );
        });
        const rec = button(box(page), "Take rec");
        check(
          `P14 7, shown-${layout}-${look}: the shot shows the decided rec key, y`,
          (await rec.getAttribute("aria-keyshortcuts")) === "y" &&
            (await rec.locator("kbd").innerText()).trim() === "y",
          {
            keys: await rec.getAttribute("aria-keyshortcuts"),
            chip: await rec
              .locator("kbd")
              .innerText()
              .catch(() => null),
          },
        );
        await inspectLine(`shown-${layout}-${look}`, box(page));

        if (layout === "one") {
          await attempt(`P23 E 7: the focus shot, ${look}`, async () => {
            await box(page).evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            const resting = await barLine(box(page));
            // The keyboard's way back to the bar: every pick opens on o, Escape returns focus.
            await box(page).focus();
            await page.keyboard.press("o");
            await box(page)
              .getByRole("button", { name: /approve/i })
              .last()
              .waitFor({ timeout: 5000 });
            await page.keyboard.press("Escape");
            const focused = await barLine(box(page));
            check(
              `P23 E 7, focus-one-${look}: the bar's focus line is visible and differs from its hairline`,
              focused.focused && focused.visible && focused.color !== null && focused.color !== resting.color,
              { resting, focused },
            );
            await shot(page, "focus", layout, look);
          });
        }

        check("P17 d: the marks show before a pick", (await marksIn(box(page))) === 2);
        await onTheLine("P17 d: the marks sit on the rec line", box(page));
        check("P23 E: Recommended once", (await recommendedIn(box(page))) === 1);
        await inspectBar(page, box(page));
        await button(box(page), "Every pick").click();
        await shot(page, "every-pick", layout, look);
        await takeRecReads(`every-pick-${layout}-${look}`, box(page));
        check("P17 d: the marks stay with every pick open", (await marksIn(box(page))) === 2);
        check("P23 E: Recommended once with every pick open", (await recommendedIn(box(page))) === 1);
        await inspectBar(page, box(page));
        await inFlow(
          "P23 E: every pick opens under the bar in normal flow",
          box(page),
          box(page)
            .getByRole("button", { name: /\bno\b/i })
            .last(),
        );
        await page.keyboard.press("Escape");
        await button(box(page), "Not the rec").click();
        await box(page).getByRole("textbox").waitFor();
        await oneRing(`required-note-${layout}-${look}`, box(page).getByRole("textbox"));
        await shot(page, "required-note", layout, look);
        await takeRecReads(`required-note-${layout}-${look}`, box(page));
        check("P17 d: the marks stay with a note open", (await marksIn(box(page))) === 2);
        check("P23 E: Recommended once with the note open", (await recommendedIn(box(page))) === 1);
        await inspectBar(page, box(page));
        await inFlow("P23 E: the note opens under the bar in normal flow", box(page), box(page).getByRole("textbox"));

        const unmarked = await markPlace(box(page));

        for (const [name, state] of [
          ["Needed me", "needed-true"],
          ["Agent could work it out", "needed-false"],
        ] as const) {
          await button(box(page), name).click();
          await shot(page, state, layout, look);
          await takeRecReads(`${state}-${layout}-${look}`, box(page));
          await marksHold(`${state}-${layout}-${look}`, box(page), unmarked, true);
        }

        await button(box(page), "Agent could work it out").click();
        await marksHold(`needed-clear-${layout}-${look}`, box(page), unmarked, false);
        await box(page).getByRole("textbox").focus();
        await page.keyboard.press("Escape");
        check("P17 d: the marks stay after Escape", (await marksIn(box(page))) === 2);
        await box(page).focus();
        await page.keyboard.press("Space");
        await shot(page, "evidence-open", layout, look);
        await takeRecReads(`evidence-open-${layout}-${look}`, box(page));
        await inspectBar(page, box(page));
        await inspectCard(page, box(page));

        for (const [ticket, state] of [
          [121, "running"],
          [122, "stuck"],
          [123, "done"],
        ] as const) {
          await page.keyboard.press("Control+c");
          await tools.prompted(page, "t1");
          await tools.run(page, "t1", `ticket --ticket ${ticket}`);
          const card = page.locator('[data-tile="t1"]').getByRole("region", { name: "Whose turn" });
          await card.waitFor();
          await shot(page, state, layout, look);
          await inspectLook(page, card, look);

          if (state === "stuck") {
            check(
              "P20 a stop has Open lane and no answer buttons",
              (await card.getByRole("button", { name: /open lane/i }).count()) === 1 &&
                (await card.getByRole("button", { name: /take rec|not the rec|every pick/i }).count()) === 0,
            );
          }
        }

        await seedAsk(home, failedTicket);
        await page.keyboard.press("Control+c");
        await tools.prompted(page, "t1");
        await tools.run(page, "t1", `ticket --ticket ${failedTicket}`);
        await box(page).waitFor();
        await button(box(page), "Not the rec").click();
        const draft = box(page).getByRole("textbox");
        await draft.fill("The plan misses the empty input");
        // Hold a real competing write lock. The host must expose pending, then failure.
        // This changes no app code, response, clock or product export.
        const locked = new DatabaseSync(join((await testProject(home)).home, "ledger.sqlite"));
        locked.exec("BEGIN IMMEDIATE");

        try {
          await draft.press("Enter");
          await attempt("P12 a save shows it is pending", () =>
            page.locator('[data-tile="t1"] [aria-busy="true"]').waitFor({ timeout: 5000 }),
          );
          await inTile(`saving-${layout}-${look}`, box(page), "saving");
          await takeRecReads(`saving-${layout}-${look}`, box(page));
          await shot(page, "saving", layout, look);
          await attempt("P12 a failed real write says so", async () => {
            await box(page).getByRole("alert").waitFor({ timeout: 15000 });
            check(
              "P12 failed real write keeps the note",
              (await draft.inputValue()) === "The plan misses the empty input",
            );
            const alert = await box(page).getByRole("alert").innerText();
            check(
              "P12 a failed save says it in a person's words, never the store's",
              !/database is locked|SQLITE|LedgerUnreachable/i.test(alert),
              alert,
            );
            await inFlow(
              "P23 E: a failed save opens under the bar in normal flow",
              box(page),
              box(page).getByRole("alert"),
            );
            check("P23 E: Recommended once on a failed save", (await recommendedIn(box(page))) === 1);
            await inView(`failed-save-${layout}-${look}`, box(page).getByRole("alert"));
            await inTile(`failed-save-${layout}-${look}`, box(page), "failed");
            await takeRecReads(`failed-save-${layout}-${look}`, box(page));
            await shot(page, "failed-save", layout, look);
          });
        } finally {
          locked.exec("ROLLBACK");
          locked.close();
        }

        check("P12 failed real write records no answer", (await answers(home, failedTicket)).length === 0);
        failedTicket++;
        await page.keyboard.press("Control+c");
        await tools.prompted(page, "t1");
        await tools.run(page, "t1", "ticket --ticket 119");
        await box(page).waitFor();
      }
    }

    for (const [i, choice] of [
      { hidden: false, note: undefined },
      { hidden: false, note: "Keep the empty input test." },
      { hidden: true, note: undefined },
      { hidden: true, note: "Keep the empty input test." },
    ].entries()) {
      await attempt(`P8 optional chose note ${i}`, async () => {
        const ticket = 150 + i;
        await seedAsk(home, ticket, choice.hidden, choice.hidden ? DRAFT.rec : NONE);
        await page.keyboard.press("Control+c");
        await tools.prompted(page, "t1");
        await tools.run(page, "t1", `ticket --ticket ${ticket}`);
        const ask = box(page);
        await ask.waitFor();
        await button(ask, "Every pick").click();
        await ask
          .getByRole("button", { name: /\bapprove\b/i })
          .last()
          .click();
        const note = ask.getByRole("textbox");
        await note.waitFor();
        check("P17 d: the marks stay with a pick's note open", (await marksIn(ask)) === 2);
        check("P23 E: Recommended is never said for a blind or no-rec ask", (await recommendedIn(ask)) === 0);
        check("P8 a pick waits for its optional note", (await answers(home, ticket)).length === 0);
        check(
          "P8 the note is optional",
          await note.evaluate(
            (element) => !element.hasAttribute("required") && element.getAttribute("aria-required") !== "true",
          ),
        );
        check(
          "P24 the optional note takes focus",
          await note.evaluate((element) => element === document.activeElement),
        );

        if (choice.note !== undefined) {
          await note.fill(choice.note);
        }

        if (choice.hidden) {
          check(
            "P8 the blind rec stays hidden while entering a note",
            !(await ask.innerHTML()).includes(DRAFT.rec.why) &&
              !(await ask.ariaSnapshot()).includes(DRAFT.rec.why) &&
              (await ask.getByRole("button", { name: /take rec/i, includeHidden: true }).count()) === 0,
          );
        }

        await note.press("Enter");
        const saved = await until(
          "P8 Enter saves chose with or without a note",
          () => answers(home, ticket),
          (all) => all.length === 1,
        );
        const answer = saved[0]?.answer as Record<string, unknown>;
        check(
          "P22 the window records exactly the chose note supplied",
          answer._tag === "chose" &&
            answer.pick === "approve" &&
            answer.note === choice.note &&
            Object.hasOwn(answer, "note") === (choice.note !== undefined),
          answer,
        );
      });
    }

    await writeFile(
      join(dir, "capture-record.json"),
      JSON.stringify(
        {
          version: "today",
          look: "E: one quiet bar under the ticket title (owner, 2026-11-08)",
          madeUp: [
            "repository",
            "plan contents",
            "recommendations",
            "costs",
            "clocks",
            "ids except the historical ticket number and question",
          ],
          screenshots: captured,
          inspection: "pending human inspection",
          voiceOver: "not run",
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close().catch(() => {});
    const pid = await tools.hostPid(home);

    if (pid !== null) {
      await tools.stop(pid);
    }
  }

  if (failed.length > 0) {
    console.log(`ask desk: ${failed.length} failed checks\n${failed.map((f) => `  ${f}`).join("\n")}`);
    process.exitCode = 1;
  }
};

const inspectLook = async (page: Page, where: Locator, look: "dark" | "light") => {
  const style = await where.evaluate((element) => {
    const css = getComputedStyle(element);
    const edges = (node: Element) => {
      const s = getComputedStyle(node);
      return (
        [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some(
          (w) => Number.parseFloat(w) > 0,
        ) || s.boxShadow !== "none"
      );
    };
    return {
      background: css.backgroundColor,
      radius: css.borderRadius,
      edge: edges(element),
      nestedEdges: [...element.querySelectorAll("section, article, fieldset")].some(edges),
      scrolls: document.documentElement.scrollWidth > innerWidth,
    };
  });
  check(
    "P23 one quiet card, 8px corners, no extra edges or page overflow",
    style.radius === "8px" &&
      style.background === (look === "dark" ? "rgb(33, 34, 37)" : "rgb(240, 240, 243)") &&
      !style.edge &&
      !style.nestedEdges &&
      !style.scrolls,
    style,
  );
  const properties = await page.locator('[data-tile="t1"] .props').evaluateAll((nodes) =>
    nodes.map((node) => {
      const css = getComputedStyle(node.parentElement ?? node);
      return {
        edge: [css.borderTopWidth, css.borderRightWidth, css.borderBottomWidth, css.borderLeftWidth].some(
          (w) => Number.parseFloat(w) > 0,
        ),
      };
    }),
  );
  check(
    "P23 properties keep their labels without an edge",
    properties.length > 0 && properties.every((p) => !p.edge),
    properties,
  );
};

/** How many times an ask's DOM text says Recommended, hidden text included (design E, fix 3). */
const recommendedIn = async (where: Locator) =>
  ((await where.evaluate((element) => element.textContent ?? "")).match(/\brecommended\b/gi) ?? []).length;

/** How many mark buttons an ask shows (option d: both, in every state of an open ask). */
const marksIn = (where: Locator) =>
  where.getByRole("button", { name: /^(needed me|agent could work it out)/i }).count();

/**
 * Option d (owner, 2026-11-08): "Did this need you?" sits at the end of the rec line, or of the
 * bar's line where a blind or no-rec ask has no rec, never on a row of its own. The marks group
 * is inside the line element (class `ask-rec`), with nothing after it there, and the line does
 * not overflow its tile sideways. It may wrap in a 2x2 or small tile, so no top is compared.
 */
const onTheLine = async (what: string, where: Locator) => {
  const group = where.getByRole("group", { name: "Did this need you?" });
  const found = await group.count();

  if (found !== 1) {
    check(what, false, { groups: found });
    return;
  }

  const placed = await group.evaluate((element) => {
    const line = element.closest(".ask-rec");

    if (line === null) {
      return { inLine: false };
    }

    const range = document.createRange();
    range.setStartAfter(element);
    range.setEnd(line, line.childNodes.length);
    const tile = line.closest("[data-tile]")?.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    return {
      inLine: true,
      after: range.toString().trim(),
      overflow: line.scrollWidth > line.clientWidth + 1,
      outside: tile === undefined ? false : box.right > tile.right + 1 || box.left < tile.left - 1,
    };
  });
  check(what, placed.inLine && placed.after === "" && !placed.overflow && !placed.outside, placed);
};

/**
 * Design E's lines, measured (lead, 2026-11-08, round 6d). One read of the ask's geometry:
 * - the action row fits, or wraps with at least two buttons on every line; it may drop its key
 *   chips first, but no button is left alone on a line;
 * - the action row starts on a line under the question, at the content's left edge, on every
 *   layout, wide tiles too, never pushed to the right;
 * - "Did this need you?" and its two picks: any of them that starts a line starts at that edge;
 * - Evidence sits after the reason's last line, or starts a line at that edge, never beside an
 *   earlier line of a wrapped reason.
 * An edge is what a person sees: a button with a border, fill or shadow by its box, a button with
 * none (tertiary) by its text. The content's left edge is where the question's text starts, or in
 * the menu, which draws no question, the rec line's.
 */
const inspectLine = async (when: string, where: Locator) => {
  const read = await where.evaluate((root) => {
    const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
    const textRects = (element: Element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
      }

      return rects;
    };
    const textLeft = (element: Element | null) => {
      const rects = element === null ? [] : textRects(element);
      return rects.length === 0 ? null : Math.min(...rects.map((r) => r.left));
    };
    const boxed = (element: Element) => {
      const s = getComputedStyle(element);
      const border = [
        [s.borderLeftWidth, s.borderLeftColor],
        [s.borderTopWidth, s.borderTopColor],
      ].some(([w, c]) => (Number.parseFloat(w ?? "") || 0) > 0 && !clear(c ?? ""));
      return border || !clear(s.backgroundColor) || s.boxShadow !== "none";
    };
    const edgeOf = (element: Element) => (boxed(element) ? element.getBoundingClientRect().left : textLeft(element));
    const shown = (element: Element) => element.getBoundingClientRect().width > 0;
    /** Rects in reading order, grouped into lines: a new line starts below the last one. */
    const linesOf = (rects: readonly DOMRect[]) => {
      const lines: DOMRect[][] = [];

      for (const r of rects) {
        const last = lines.at(-1);
        const bottom = last === undefined ? -Infinity : Math.max(...last.map((x) => x.bottom));

        if (last === undefined || r.top >= bottom - 1) {
          lines.push([r]);
        } else {
          last.push(r);
        }
      }

      return lines;
    };
    const question = root.querySelector(".ask-question");
    const left = textLeft(question) ?? textLeft(root.querySelector(".ask-recwords"));

    const buttons = [...root.querySelectorAll(".ask-toolbar button")].filter(shown);
    const rowLines = linesOf(buttons.map((b) => b.getBoundingClientRect())).map((l) => l.length);
    const first = buttons[0];
    const toolbar = {
      lines: rowLines,
      left: first === undefined ? null : edgeOf(first),
      top: first === undefined ? null : first.getBoundingClientRect().top,
      questionBottom: question === null ? null : question.getBoundingClientRect().bottom,
    };

    const marks = root.querySelector(".ask-marks");
    const items = [...(marks === null ? [] : [...marks.children].filter(shown))].map((element) => ({
      name: (element.textContent ?? "").trim(),
      top: element.getBoundingClientRect().top,
      edge: element.tagName === "BUTTON" ? edgeOf(element) : textLeft(element),
    }));
    const words = root.querySelector(".ask-recwords");
    const wordRects = words === null ? [] : textRects(words);
    // An item starts a line when nothing before it reaches down to its top.
    const marked = items.map((item, i) => {
      const before = [
        ...wordRects.map((r) => r.bottom),
        ...items.slice(0, i).map((x, j) => {
          const element = marks?.children[j];
          return element === undefined ? x.top : element.getBoundingClientRect().bottom;
        }),
      ];
      return { ...item, starts: before.length === 0 || item.top >= Math.max(...before) - 1 };
    });

    const why = root.querySelector(".ask-why");
    const reason = why?.querySelector("p") ?? null;
    const evidence = why?.querySelector("button") ?? null;
    const reasonLines = linesOf(reason === null ? [] : textRects(reason));
    const at = evidence?.getBoundingClientRect();
    const overlaps = (line: DOMRect[]) =>
      at !== undefined &&
      at.top < Math.max(...line.map((r) => r.bottom)) - 1 &&
      at.bottom > Math.min(...line.map((r) => r.top)) + 1;
    const lastLine = reasonLines.at(-1);
    return {
      left,
      toolbar,
      marks: marked.filter((m) => m.starts).map(({ name, edge }) => ({ name, edge })),
      evidence:
        at === undefined
          ? null
          : {
              besideEarlier: reasonLines.slice(0, -1).some(overlaps),
              onLast: lastLine !== undefined && overlaps(lastLine),
              afterLast: lastLine === undefined ? true : at.left >= Math.max(...lastLine.map((r) => r.right)) - 1,
              edge: evidence === null ? null : edgeOf(evidence),
            },
    };
  });
  const at = (edge: number | null) => edge !== null && read.left !== null && Math.abs(edge - read.left) <= 1;
  const { toolbar, evidence } = read;
  check(
    `P23 E 6d, ${when}: no action button alone on a line`,
    toolbar.lines.length > 0 && (toolbar.lines.length === 1 || toolbar.lines.every((n) => n >= 2)),
    toolbar.lines,
  );
  check(
    `P23 E 6d, ${when}: the action row starts at the content's left edge, under the question`,
    at(toolbar.left) &&
      (toolbar.questionBottom === null || (toolbar.top !== null && toolbar.top >= toolbar.questionBottom - 1)),
    { ...toolbar, left: read.left },
  );
  check(
    `P23 E 6d, ${when}: "Did this need you?" and its picks start a line at the content's left edge`,
    read.marks.every((m) => at(m.edge)),
    { left: read.left, starts: read.marks },
  );
  check(
    `P23 E 6d, ${when}: Evidence sits after the reason's last line, or starts a line at the edge`,
    evidence !== null && !evidence.besideEarlier && (evidence.onLast ? evidence.afterLast : at(evidence.edge)),
    { left: read.left, evidence },
  );
};

/**
 * Fix 5 (lead, 2026-11-08, round 6d): an ask in the asks menu is no card in the popover. Nothing
 * from the popover down to the ask's words has a fill of its own: buttons, key chips and fields
 * keep theirs, and the selected row keeps its highlight.
 */
const noCardInMenu = async (when: string, menu: Locator) => {
  const fills = await menu.evaluate((popover) => {
    const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
    let own = getComputedStyle(popover).backgroundColor;

    for (let node = popover.parentElement; clear(own) && node !== null; node = node.parentElement) {
      own = getComputedStyle(node).backgroundColor;
    }

    const out: string[] = [];

    for (const element of popover.querySelectorAll("*")) {
      if (element.closest("button, kbd, input, textarea, select, [aria-selected='true']") !== null) {
        continue;
      }

      const bg = getComputedStyle(element).backgroundColor;

      if (!clear(bg) && bg !== own) {
        out.push(`${element.tagName}.${element.className} ${bg}`);
      }
    }

    return out;
  });
  check(`P23 E 6d, ${when}: no filled card inside the asks menu`, fills.length === 0, fills);
};

/**
 * Round 7, fix 1 (lead, 2026-11-08): the focused note field draws one ring, 2px, and no second
 * edge inside or outside it. Every edge the field and its tight wrappers draw (a border, an
 * outline, a box-shadow) is a band at a distance from the textarea's own box; an outline covers
 * what it lies on, and touching bands of one color read as one ring. What is left must be one
 * band, 1.5 to 2.5px thick. A wrapper is tight when each side is within 8px of the textarea's.
 */
const oneRing = async (when: string, field: Locator) => {
  const read = await field.evaluate((textarea) => {
    const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
    const px = (w: string) => Number.parseFloat(w) || 0;
    const at = textarea.getBoundingClientRect();
    type Band = { from: string; color: string; inner: number; outer: number; outline: boolean };
    const bands: Band[] = [];
    const stop = textarea.closest("form, .ask-view");

    for (let node: Element | null = textarea; node !== null && node !== stop; node = node.parentElement) {
      const r = node.getBoundingClientRect();
      const sides = [at.top - r.top, r.right - at.right, r.bottom - at.bottom, at.left - r.left];

      if (sides.some((d) => d < -1 || d > 8)) {
        continue;
      }

      const d = Math.min(...sides);
      const s = getComputedStyle(node);
      const name = `${node.tagName}.${node.className}`;
      const bw = px(s.borderTopWidth);

      if (bw > 0 && s.borderTopStyle !== "none" && !clear(s.borderTopColor)) {
        bands.push({
          from: `${name} border`,
          color: s.borderTopColor,
          inner: d - bw,
          outer: d,
          outline: false,
        });
      }

      const ow = px(s.outlineWidth);

      if (ow > 0 && s.outlineStyle !== "none" && !clear(s.outlineColor)) {
        const off = px(s.outlineOffset);
        bands.push({
          from: `${name} outline`,
          color: s.outlineColor,
          inner: d + off,
          outer: d + off + ow,
          outline: true,
        });
      }

      if (s.boxShadow !== "none") {
        for (const layer of s.boxShadow.split(/,(?![^(]*\))/)) {
          const color = /rgba?\([^)]*\)/.exec(layer)?.[0] ?? "";
          const lengths = (layer.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g) ?? []).map(px);
          const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
          const size = Math.max(Math.abs(x), Math.abs(y)) + blur + spread;

          if (clear(color) || size <= 0) {
            continue;
          }

          bands.push(
            layer.includes("inset")
              ? {
                  from: `${name} inset shadow`,
                  color,
                  inner: d - bw - size,
                  outer: d - bw,
                  outline: false,
                }
              : { from: `${name} shadow`, color, inner: d, outer: d + size, outline: false },
          );
        }
      }
    }

    const seen = bands.filter(
      (b) => b.outline || !bands.some((o) => o.outline && o.inner <= b.inner + 0.01 && o.outer >= b.outer - 0.01),
    );
    seen.sort((a, b) => a.inner - b.inner);
    const rings: Band[] = [];

    for (const b of seen) {
      const last = rings.at(-1);

      if (last !== undefined && last.color === b.color && b.inner <= last.outer + 0.01) {
        rings[rings.length - 1] = {
          ...last,
          from: `${last.from} + ${b.from}`,
          outer: Math.max(last.outer, b.outer),
        };
      } else {
        rings.push(b);
      }
    }

    return {
      focused: textarea === document.activeElement,
      rings: rings.map((r) => ({ from: r.from, color: r.color, thick: r.outer - r.inner })),
    };
  });
  const [ring] = read.rings;
  check(
    `P23 E 7, ${when}: the focused note draws one 2px ring, no second edge`,
    read.focused && read.rings.length === 1 && ring !== undefined && ring.thick >= 1.5 && ring.thick <= 2.5,
    read,
  );
};

/**
 * Round 29, law 1 (WCAG 1.4.3, color-principles): in every ask-box state, Take rec's label reads
 * at least 4.5:1 on its own background while enabled, in both looks. Read from the page as drawn: the label's
 * computed color and the button's computed backgrounds, each drawn over what lies behind and
 * faded by every opacity from the button up (a disabled Manti button is drawn at opacity .5).
 * The unit law is packages/fabrika-design/src/take-rec.ask-desk.test.ts.
 */
const takeRecReads = async (when: string, where: Locator) => {
  const rec = button(where, "Take rec");
  // Manti transitions the button's colors, so a read straight after a state change sees mid-fade
  // pale colors. Wait until the computed colors are equal on two reads in a row and no animation
  // or transition on the button is still running, then read.
  const settle = async () => {
    await rec.evaluate(async (element) => {
      const colors = () => {
        const style = getComputedStyle(element);
        const label = element.querySelector("span") ?? element;
        return [style.backgroundColor, style.color, getComputedStyle(label).color].join("|");
      };
      let last = "";

      for (let i = 0; i < 120; i++) {
        await Promise.all(element.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
        await new Promise((done) => requestAnimationFrame(() => done(null)));
        const now = colors();

        if (now === last && element.getAnimations({ subtree: true }).length === 0) {
          return;
        }

        last = now;
      }

      throw new Error("Take rec's colors never settled");
    });
  };
  const read = async () => {
    await settle();
    return await rec.evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      if (ctx === null) {
        throw new Error("no canvas");
      }

      // Any CSS color (oklab, color-mix, light-dark results) to rgba, as the page draws it.
      const rgba = (css: string): [number, number, number, number] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return [r ?? 0, g ?? 0, b ?? 0, (a ?? 0) / 255];
      };
      const over = (top: number[], alpha: number, under: number[]) =>
        [0, 1, 2].map((i) => (top[i] ?? 0) * alpha + (under[i] ?? 0) * (1 - alpha));
      const chain: Element[] = [];

      for (let e: Element | null = element; e !== null; e = e.parentElement) {
        chain.unshift(e);
      }

      let backdrop = [255, 255, 255];
      let faded = 1;

      for (const e of chain) {
        const style = getComputedStyle(e);
        faded *= Number(style.opacity);
        const bg = rgba(style.backgroundColor);
        backdrop = over(bg, bg[3] * faded, backdrop);
      }

      // The label: the button's first own text, not its key chip.
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let label: Element = element;

      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if ((n.textContent ?? "").trim() !== "" && n.parentElement !== null) {
          label = n.parentElement;
          break;
        }
      }

      const ink = rgba(getComputedStyle(label).color);
      const text = over(ink, ink[3] * faded, backdrop);
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const lum = (c: number[]) => 0.2126 * lin(c[0] ?? 0) + 0.7152 * lin(c[1] ?? 0) + 0.0722 * lin(c[2] ?? 0);
      const [hi, lo] = [lum(text), lum(backdrop)].sort((a, b) => b - a);
      return {
        ratio: ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05),
        text: text.map(Math.round),
        background: backdrop.map(Math.round),
        opacity: faded,
        disabled: (element as HTMLButtonElement).disabled,
      };
    });
  };
  const page = where.page();
  const rest = await read();

  // WCAG 1.4.3 exempts inactive user interface components
  // (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html, "Incidental"), so 4.5:1
  // binds only while Take rec is enabled. A disabled one (busy: saving) is recorded, never failed.
  if (rest.disabled) {
    console.log(
      `note ask desk P23 11-09, ${when}: Take rec is disabled, exempt from 4.5:1, reads ${rest.ratio.toFixed(2)}:1 ${JSON.stringify(rest)}`,
    );
    return;
  }

  check(`P23 11-09, ${when}: Take rec's label reads at least 4.5:1 on its background`, rest.ratio >= 4.5, rest);
  // The hovered and the pressed state, from the page's own computed style (Manti's :hover and
  // :active), each read once settled. Pressing focuses the button, so the focus the shot had is
  // put back; the mouse goes off the button before it lifts, so no click fires.
  await rec.evaluate(() => {
    for (const e of document.querySelectorAll("[data-take-rec-was]")) {
      e.removeAttribute("data-take-rec-was");
    }

    document.activeElement?.setAttribute("data-take-rec-was", "");
  });
  await rec.hover();
  const hovered = await read();
  check(
    `P23 11-09, ${when}, hovered: Take rec's label reads at least 4.5:1 on its background`,
    hovered.ratio >= 4.5,
    hovered,
  );
  await page.mouse.down();
  const pressed = await read();
  check(
    `P23 11-09, ${when}, pressed: Take rec's label reads at least 4.5:1 on its background`,
    pressed.ratio >= 4.5,
    pressed,
  );
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await rec.evaluate(() => {
    const was = document.querySelector<HTMLElement>("[data-take-rec-was]");
    was?.removeAttribute("data-take-rec-was");

    if (was !== null) {
      was.focus();
    } else {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  });
  // Manti keeps one module-wide focus-visible flag (@manti-ui/react src/internal/focusVisible.ts):
  // a document pointerdown sets it to "pointer", a keydown without Meta, Alt or Ctrl sets it to
  // "keyboard", and a field's outer ring shows only while it is keyboard. The press above left it
  // on "pointer", so the next note opened by the keyboard path would read no ring. A keyboard
  // user never sends that pointerdown, so put the page back as they had it with one key that
  // changes nothing.
  await page.keyboard.press("Shift");
};

/**
 * Round 29, law 2, at every layout: in the saving and failed-save states, the "Your turn" line and
 * the save status line (Saving your answer..., or Not saved. with Try again) each lie fully inside
 * the ticket tile's visible scroll area. The area is the nearest scrolling ancestor's client box,
 * cut to the window.
 */
const inTile = async (when: string, where: Locator, status: "saving" | "failed") => {
  const read = () =>
    where.evaluate((root, which) => {
      const turn = root.querySelector(".ask-turn");
      const line = root.querySelector(which === "saving" ? ".ask-quiet" : ".ask-fail");
      const retry = which === "failed" ? root.querySelector(".ask-fail button") : null;
      const scrollerOf = (element: Element) => {
        let at = element.parentElement;

        while (at !== null && !/(auto|scroll|overlay)/.test(getComputedStyle(at).overflowY)) {
          at = at.parentElement;
        }

        return at;
      };
      const area = (element: Element) => {
        const scroller = scrollerOf(element);

        if (scroller === null) {
          return { top: 0, bottom: innerHeight, name: null };
        }

        const r = scroller.getBoundingClientRect();
        const top = r.top + scroller.clientTop;
        return {
          top: Math.max(top, 0),
          bottom: Math.min(top + scroller.clientHeight, innerHeight),
          name: `${scroller.tagName}.${scroller.className}`,
        };
      };
      const measure = (name: string, element: Element | null) => {
        if (element === null) {
          return { name, found: false, inside: false };
        }

        const at = element.getBoundingClientRect();
        const port = area(element);
        return {
          name,
          found: true,
          box: { top: at.top, bottom: at.bottom },
          port,
          inside: at.height > 0 && at.top >= port.top - 1 && at.bottom <= port.bottom + 1,
        };
      };
      // Round 30, law 1: in failed-save, every button the bar draws (Try again, Send no and Cancel
      // included) lies inside the same area. A button drawn with no box (the folded evidence) is not.
      const buttons =
        which === "failed"
          ? [...root.querySelectorAll('[data-scope="button"]')]
              .filter((b) => b.getClientRects().length > 0)
              .map((b) => measure(`button ${(b.textContent ?? "").trim()}`, b))
          : [];
      return {
        lines: [
          measure("Your turn line", turn),
          measure(which === "saving" ? "Saving your answer line" : "Not saved line", line),
          ...(retry === null ? [] : [measure("Try again", retry)]),
        ],
        buttons,
      };
    }, status);
  await until(
    `P23 11-09, ${when}: the Your turn line and the save status lie inside the tile's scroll area`,
    read,
    (seen) => seen.lines.every((part) => part.inside),
  );

  if (status === "failed") {
    await until(
      `P23 11-10 law 1, ${when}: every button in the bar lies inside the tile's scroll area, with the Your turn and Not saved lines`,
      read,
      (seen) =>
        seen.lines.every((part) => part.inside) && seen.buttons.length > 0 && seen.buttons.every((b) => b.inside),
    );
  }
};

/**
 * Round 30, law 4: before a shot, the pointer rests off the ticket tile, on the first window corner
 * that is in neither the tile nor the asks menu. The menu is left alone: a pointer over a row is
 * not the state being shot either.
 */
const parkPointer = async (page: Page) => {
  const spot = await page.evaluate(() => {
    const corners = [
      [2, 2],
      [innerWidth - 3, 2],
      [2, innerHeight - 3],
      [innerWidth - 3, innerHeight - 3],
    ] as const;
    return (
      corners.find(([x, y]) => {
        const at = document.elementFromPoint(x, y);
        return at !== null && at.closest('[data-tile="t1"], #pop-asks') === null;
      }) ?? null
    );
  });
  check("P23 11-10 law 4: a window corner lies off the ticket tile, for the pointer", spot !== null);

  if (spot !== null) {
    await page.mouse.move(spot[0], spot[1]);
  }
};

/**
 * Round 30, law 4, at each shot: nothing inside the ticket tile matches :hover or :active, and
 * every mark with aria-pressed="false" paints the bar's background under it. What paints is the
 * first background, going up from the element, that is not fully clear.
 */
const calmTile = async (when: string, page: Page) => {
  const tile = page.locator('[data-tile="t1"]');

  if ((await tile.count()) === 0) {
    return;
  }

  await until(
    `P23 11-10 law 4, ${when}: nothing in the ticket tile is hovered or active, and an unpressed mark has the bar's background`,
    () =>
      tile.evaluate((root) => {
        const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
        const paint = (element: Element | null) => {
          for (let at = element; at !== null; at = at.parentElement) {
            const color = getComputedStyle(at).backgroundColor;

            if (!clear(color)) {
              return color;
            }
          }

          return null;
        };
        const marks = [
          ...root.querySelectorAll('[role="group"][aria-label="Did this need you?"] [aria-pressed="false"]'),
        ].map((mark) => {
          const bar = mark.closest('section[aria-label^="ask: "]');
          return {
            mark: (mark.textContent ?? "").trim(),
            own: paint(mark),
            bar: paint(bar),
          };
        });
        return {
          hovered: [...root.querySelectorAll(":hover")].map((e) => `${e.tagName}.${e.className}`),
          active: [...root.querySelectorAll(":active")].map((e) => `${e.tagName}.${e.className}`),
          marks,
        };
      }),
    (seen) => seen.hovered.length === 0 && seen.active.length === 0 && seen.marks.every((m) => m.own === m.bar),
  );
};

/**
 * Round 30, laws 2 and 3: where the "Did this need you?" piece sits, read from the real window.
 * - top: the top of its "Did this need you?" words; lefts: each mark's left edge;
 * - shares: the words share a line with the rec words' (or blind hint's) last line;
 * - pressed: a pressed mark's painted box (its border box grown by its box-shadow spread) against
 *   the nearest line box above it and the next row's box under it. A line or row is any text line or
 *   button, field or pick in the bar outside the marks pair, whose middle is above the mark's top or
 *   under its bottom. `--s-1` is read from computed style, never written as a number here.
 */
const markPlace = (where: Locator) =>
  where.evaluate((root) => {
    const group = root.querySelector('[role="group"][aria-label="Did this need you?"]');
    const words = group?.querySelector('[aria-hidden="true"]') ?? null;
    const marks = group === null ? [] : [...group.querySelectorAll("[aria-pressed]")];
    const lines = (element: Element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].filter((r) => r.width > 0);
    };
    const recLast = lines(root.querySelector(".ask-recwords") ?? root).at(-1) ?? null;
    const wordsFirst = words === null ? null : (lines(words)[0] ?? null);
    const probe = document.createElement("div");
    probe.style.blockSize = "var(--s-1)";
    root.append(probe);
    const s1 = Number.parseFloat(getComputedStyle(probe).blockSize);
    probe.remove();
    const pressedMark = marks.find((m) => m.getAttribute("aria-pressed") === "true") ?? null;
    let pressed = null;

    if (pressedMark !== null) {
      const at = pressedMark.getBoundingClientRect();
      // box-shadow reads as "color x y blur spread" per shadow, the color dropped; inset paints inside.
      const shadows = getComputedStyle(pressedMark).boxShadow;
      let up = 0;
      let down = 0;

      if (shadows !== "none") {
        for (const one of shadows.split(/,(?![^(]*\))/)) {
          if (/\binset\b/.test(one)) {
            continue;
          }

          const [, y = 0, , spread = 0] = (one.replaceAll(/[a-z-]+\([^)]*\)/gi, "").match(/-?[\d.]+px/g) ?? []).map(
            (n) => Number.parseFloat(n),
          );
          up = Math.max(up, spread - y);
          down = Math.max(down, spread + y);
        }
      }

      const painted = { top: at.top - up, bottom: at.bottom + down };
      const pair = pressedMark.closest(".ask-mark-pair") ?? pressedMark;
      const boxes: DOMRect[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "" || pair.contains(node)) {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        boxes.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
      }

      for (const element of root.querySelectorAll('[data-scope="button"], textarea, input')) {
        if (!pair.contains(element) && element.getClientRects().length > 0) {
          boxes.push(element.getBoundingClientRect());
        }
      }

      const middle = (r: DOMRect) => (r.top + r.bottom) / 2;
      const above = boxes.filter((r) => middle(r) < at.top).map((r) => r.bottom);
      const below = boxes.filter((r) => middle(r) > at.bottom).map((r) => r.top);
      pressed = {
        mark: (pressedMark.textContent ?? "").trim(),
        painted,
        lineAbove: above.length === 0 ? null : Math.max(...above),
        rowBelow: below.length === 0 ? null : Math.min(...below),
      };
    }

    return {
      s1,
      top: wordsFirst?.top ?? null,
      lefts: marks.map((m) => m.getBoundingClientRect().left),
      shares:
        recLast !== null && wordsFirst !== null && wordsFirst.top < recLast.bottom && recLast.top < wordsFirst.bottom,
      pressed,
    };
  });

/** Round 30, laws 2 and 3 after a press or a clear, against the piece's unmarked place. */
const marksHold = async (
  when: string,
  where: Locator,
  unmarked: Awaited<ReturnType<typeof markPlace>>,
  press: boolean,
) => {
  const near = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) <= 1;
  await until(
    `P17 11-10 law 2, ${when}: a press or a clear never moves the marks piece`,
    () => markPlace(where),
    (now) =>
      near(now.top, unmarked.top) &&
      now.lefts.length === unmarked.lefts.length &&
      now.lefts.length > 0 &&
      now.lefts.every((left, i) => near(left, unmarked.lefts[i] ?? null)) &&
      (!unmarked.shares || now.shares),
  );

  if (press) {
    await until(
      `P17 11-10 law 3, ${when}: a pressed mark's fill keeps --s-1 from the line above and the row below`,
      () => markPlace(where),
      (now) =>
        now.pressed !== null &&
        Number.isFinite(now.s1) &&
        now.s1 > 0 &&
        (now.pressed.lineAbove === null || now.pressed.painted.top - now.pressed.lineAbove >= now.s1 - 0.5) &&
        (now.pressed.rowBelow === null || now.pressed.rowBelow - now.pressed.painted.bottom >= now.s1 - 0.5),
    );
  }
};

/**
 * Round 7, fix 3: after a failed save, its line is in view. The alert's box sits inside the
 * nearest scroller's visible area (its client rect), and inside the window, at every layout.
 */
const inView = async (when: string, alert: Locator) => {
  await until(
    `P12 7, ${when}: the failure line is scrolled into view`,
    () =>
      alert.evaluate((element) => {
        const at = element.getBoundingClientRect();
        let scroller: Element | null = element.parentElement;

        while (scroller !== null && !/(auto|scroll|overlay)/.test(getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }

        const port =
          scroller === null
            ? { top: 0, bottom: innerHeight }
            : (() => {
                const r = scroller.getBoundingClientRect();
                const top = r.top + scroller.clientTop;
                return { top, bottom: top + scroller.clientHeight };
              })();
        const top = Math.max(port.top, 0);
        const bottom = Math.min(port.bottom, innerHeight);
        return {
          scroller: scroller === null ? null : `${scroller.tagName}.${scroller.className}`,
          alert: { top: at.top, bottom: at.bottom },
          port: { top, bottom },
          inside: at.height > 0 && at.top >= top - 1 && at.bottom <= bottom + 1,
        };
      }),
    (seen) => seen.inside,
  );
};

/**
 * Round 7, fix 2: a blind ask says "Your pick first: the rec shows once you answer". Evidence sits
 * on the hint's line, or starts on the next: its box top no lower than 1em under the line.
 * Round 7c (lead, 2026-11-08), in the ticket bar and the menu alike, at one, side, stacked and 2x2:
 * - the hint takes its full width, never a narrow column: its first line reaches at least the
 *   smaller of its own one-line width and the line's content width, less one word (a wrap moves at
 *   most a word) and 1em;
 * - the "Did this need you?" group follows on the hint's last line where it fits (text tops within
 *   4px), else takes the next line as one unit, starting at the hint's left edge;
 * - sharing a line, the gap from the hint's last word to the group is at most 2em.
 */
const blindLine = async (when: string, where: Locator) => {
  const read = await where.evaluate((root) => {
    const textRects = (element: Element | null) => {
      if (element === null) {
        return [];
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
      }

      return rects;
    };
    const wordWidths = (element: Element | null) => {
      if (element === null) {
        return [];
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const widths: number[] = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        for (const match of (node.textContent ?? "").matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          widths.push(range.getBoundingClientRect().width);
        }
      }

      return widths;
    };
    const lines = (rects: readonly DOMRect[]) => {
      const out: { top: number; bottom: number; left: number; right: number }[] = [];

      for (const r of [...rects].sort((a, b) => a.top - b.top)) {
        const line = out.find((l) => r.top < l.bottom - 1 && r.bottom > l.top + 1);

        if (line === undefined) {
          out.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
        } else {
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
          line.left = Math.min(line.left, r.left);
          line.right = Math.max(line.right, r.right);
        }
      }

      return out;
    };
    const em = Number.parseFloat(getComputedStyle(root).fontSize) || 16;
    const words = root.querySelector(".ask-recwords");
    const rec = root.querySelector(".ask-rec");
    const hint = textRects(words);
    const said = textRects(root.querySelector(".ask-marks > span[aria-hidden]"));
    const marks = [...root.querySelectorAll(".ask-marks button")]
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width > 0);
    const evidence = root.querySelector(".ask-why button")?.getBoundingClientRect();
    const hintLines = lines(hint);
    const lastHint = hint.at(-1);
    const firstMark = said[0];
    const recBox = rec?.getBoundingClientRect();
    const cs = rec === null ? null : getComputedStyle(rec);
    const content =
      recBox === undefined || cs === null
        ? 0
        : recBox.width -
          (Number.parseFloat(cs.paddingLeft) || 0) -
          (Number.parseFloat(cs.paddingRight) || 0) -
          (Number.parseFloat(cs.borderLeftWidth) || 0) -
          (Number.parseFloat(cs.borderRightWidth) || 0);
    const oneLine = hint.reduce((n, r) => n + r.width, 0);
    const longest = Math.max(0, ...wordWidths(words));
    const first = hintLines[0];
    const reach = first === undefined ? 0 : first.right - first.left;
    const shared = lastHint !== undefined && firstMark !== undefined && Math.abs(lastHint.top - firstMark.top) <= 4;
    const group = [...said, ...marks];
    const edge = hint.length === 0 ? null : Math.min(...hint.map((r) => r.left));
    const groupLeft = group.length === 0 ? null : Math.min(...group.map((r) => r.left));
    const groupTop = group.length === 0 ? null : Math.min(...group.map((r) => r.top));
    const under = lastHint?.bottom ?? null;
    const lineBottom = Math.max(lastHint?.bottom ?? 0, ...said.map((r) => r.bottom), ...marks.map((r) => r.bottom));
    return {
      hint: (words?.textContent ?? "").trim(),
      em,
      width: { reach, oneLine, content, longest, lines: hintLines.length },
      shared,
      next: {
        lines: lines(group).length,
        edge,
        left: groupLeft,
        top: groupTop,
        under,
        ok:
          group.length > 0 &&
          lines(group).length === 1 &&
          edge !== null &&
          groupLeft !== null &&
          Math.abs(groupLeft - edge) <= 1 &&
          under !== null &&
          groupTop !== null &&
          groupTop >= under - 1 &&
          groupTop <= under + em,
      },
      gap: shared && lastHint !== undefined && firstMark !== undefined ? firstMark.left - lastHint.right : null,
      lineBottom,
      evidence: evidence === undefined ? null : { top: evidence.top, bottom: evidence.bottom },
    };
  });
  check(`P23 E 7, ${when}: the blind ask says "Your pick first"`, read.hint.startsWith("Your pick first"), read);
  check(
    `P23 E 7c, ${when}: the blind hint takes its full width, not a narrow column`,
    read.width.content > 0 &&
      read.width.reach >= Math.min(read.width.oneLine, read.width.content) - read.width.longest - read.em,
    read,
  );
  check(
    `P23 E 7c, ${when}: "Did this need you?" follows the hint's last word, or takes the next line as one unit at the hint's left edge`,
    read.shared || read.next.ok,
    read,
  );
  check(
    `P23 E 7c, ${when}: sharing a line, the hint's last word and "Did this need you?" are at most 2em apart`,
    !read.shared || (read.gap !== null && read.gap >= 0 && read.gap <= 2 * read.em),
    read,
  );
  check(
    `P23 E 7, ${when}: Evidence sits on that line or the next`,
    read.evidence !== null && read.evidence.top <= read.lineBottom + read.em,
    read,
  );
};

/**
 * Round 7, fix 4: a closed row of the asks menu reads as two tight lines. The ticket title's text
 * starts right under the question's: the gap between the question's last text line and the
 * title's first is at most 0.5em of the row's font size. At line-height 1.5 that is the leading
 * between two lines of one paragraph, so anything more is a blank band a person sees.
 */
const closedRows = async (when: string, menu: Locator) => {
  const rows = await menu.evaluate((popover) => {
    const textRects = (element: Element | null) => {
      if (element === null) {
        return [];
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
      }

      return rects;
    };
    return [...popover.querySelectorAll('[role="row"][aria-selected="false"]')].map((row) => {
      const title = row.querySelector(".asks-title");
      const sub = title?.nextElementSibling ?? null;
      const above = textRects(title);
      const below = textRects(sub);
      const em = Number.parseFloat(getComputedStyle(row).fontSize) || 16;
      const bottom = above.length === 0 ? null : Math.max(...above.map((r) => r.bottom));
      const top = below.length === 0 ? null : Math.min(...below.map((r) => r.top));
      return {
        row: row.id,
        gap: bottom === null || top === null ? null : top - bottom,
        limit: em * 0.5,
      };
    });
  });
  const measured = rows.filter((r) => r.gap !== null);
  check(
    `P23 E 7, ${when}: each closed row's title sits right under its question`,
    measured.length > 0 && measured.every((r) => (r.gap ?? 0) <= r.limit),
    rows,
  );
};

/**
 * Round 7, fix 5: the open row of the asks menu. Its actions (Take rec, Not the rec, Every pick,
 * Open ticket, Later) share one row; a wrap is allowed only where the next button could not fit at
 * the end of the line before, and no button is left alone on a line (6d). The hint and the marks
 * share a line where they fit, and Evidence is on that line or the next. In side and 2x2 (`tight`),
 * the ask part of the row is at most 3 lines.
 * Round 7b (lead, 2026-11-08): the menu stays narrow, `min(400px, 100% - 16px)`. Where the hint
 * and the marks do not fit one line, the marks group ("Did this need you?" and its two picks)
 * takes the next line as one unit, starting at the hint's left edge. So in side and 2x2 the row
 * may take 4 lines.
 */
const openRow = async (when: string, menu: Locator, tight: boolean) => {
  const read = await menu.evaluate((popover) => {
    const row = popover.querySelector('[role="row"][aria-selected="true"]');

    if (row === null) {
      return null;
    }

    const textRects = (element: Element | null) => {
      if (element === null) {
        return [];
      }

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim() === "") {
          continue;
        }

        if ((node.parentElement?.closest("[hidden]") ?? null) !== null) {
          continue;
        }

        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
      }

      return rects;
    };
    const lines = (rects: readonly DOMRect[]) => {
      const out: { top: number; bottom: number; items: DOMRect[] }[] = [];

      for (const r of [...rects].sort((a, b) => a.top - b.top)) {
        const line = out.find((l) => r.top < l.bottom - 1 && r.bottom > l.top + 1);

        if (line === undefined) {
          out.push({ top: r.top, bottom: r.bottom, items: [r] });
        } else {
          line.items.push(r);
          line.top = Math.min(line.top, r.top);
          line.bottom = Math.max(line.bottom, r.bottom);
        }
      }

      return out;
    };
    const cell = row.querySelector('[role="gridcell"]') ?? row;
    const box = cell.getBoundingClientRect();
    const cs = getComputedStyle(cell);
    const right = box.right - (Number.parseFloat(cs.paddingRight) || 0);
    const buttons = [...row.querySelectorAll(".ask-toolbar button, .asks-acts button")]
      .map((b) => ({ name: (b.textContent ?? "").trim(), r: b.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0);
    const acts = lines(buttons.map((b) => b.r));
    const gap = 4;
    const needless = acts.slice(1).some((line, i) => {
      const before = acts[i];
      const first = [...line.items].sort((a, b) => a.left - b.left)[0];

      if (before === undefined || first === undefined) {
        return false;
      }

      const end = Math.max(...before.items.map((r) => r.right));
      return end + gap + first.width <= right + 1;
    });
    const words = row.querySelector(".ask-recwords");
    const hint = textRects(words);
    const label = textRects(row.querySelector(".ask-marks > span[aria-hidden]"));
    const marks = [...row.querySelectorAll(".ask-marks button")].map((b) => b.getBoundingClientRect());
    const lastHint = hint.at(-1);
    const need =
      (lastHint?.width ?? 0) +
      label.reduce((n, r) => n + r.width, 0) +
      marks.reduce((n, r) => n + r.width, 0) +
      8 * (1 + marks.length);
    const line = row.querySelector(".ask-rec");
    const room = line === null ? 0 : line.getBoundingClientRect().width;
    const shared = lastHint !== undefined && label[0] !== undefined && Math.abs(lastHint.top - label[0].top) <= 4;
    const lineBottom = Math.max(lastHint?.bottom ?? 0, ...marks.map((r) => r.bottom), ...label.map((r) => r.bottom));
    const evidence = row.querySelector(".ask-why button")?.getBoundingClientRect();
    const em = Number.parseFloat(getComputedStyle(row).fontSize) || 16;
    const group = [...label, ...marks];
    const unit =
      group.length === 0
        ? null
        : {
            lines: lines(group).length,
            left: Math.min(...group.map((r) => r.left)),
            top: Math.min(...group.map((r) => r.top)),
            edge: hint.length === 0 ? null : Math.min(...hint.map((r) => r.left)),
            under: lastHint?.bottom ?? null,
          };
    const view = row.querySelector(".ask-view");
    const all = [
      ...textRects(view),
      ...textRects(row.querySelector(".asks-acts")),
      ...buttons.map((b) => b.r),
      ...marks,
    ];
    return {
      acts: acts.map((l) => l.items.length),
      names: buttons.map((b) => b.name.replace(/\s+/g, " ")),
      needless,
      shared,
      fits: need <= room,
      need,
      room,
      evidence: evidence === undefined ? null : { top: evidence.top, ok: evidence.top <= lineBottom + em, lineBottom },
      unit:
        unit === null
          ? null
          : {
              ...unit,
              ok:
                unit.lines === 1 &&
                unit.edge !== null &&
                Math.abs(unit.left - unit.edge) <= 1 &&
                unit.under !== null &&
                unit.top >= unit.under - 1 &&
                unit.top <= unit.under + em,
            },
      lines: lines(all).length,
    };
  });

  if (read === null) {
    check(`P23 E 7, ${when}: the menu has an open row`, false);
    return;
  }

  check(
    `P23 E 7, ${when}: the open row's actions share one row (a wrap only when needed, none alone)`,
    read.acts.length > 0 && !read.needless && (read.acts.length === 1 || read.acts.every((n) => n >= 2)),
    read,
  );
  check(`P23 E 7, ${when}: the open row's hint and marks share a line where they fit`, read.shared || !read.fits, read);
  check(
    `P23 E 7b, ${when}: the open row's marks share the hint's line, or take the next line as one unit at its left edge`,
    read.unit === null || read.shared || read.unit.ok,
    read,
  );
  check(`P23 E 7, ${when}: the open row's Evidence is on that line or the next`, read.evidence?.ok === true, read);

  if (tight) {
    check(`P23 E 7b, ${when}: the open row's ask is at most 4 lines`, read.lines <= 4, read);
  }
};

/**
 * Round 7b, fix 2 (lead, 2026-11-08): the asks menu stays narrow, `min(400px, 100% - 16px)`. Its
 * panel is at most 400px wide and at most the window's width less 16px, at every layout.
 */
const menuWidth = async (when: string, menu: Locator) => {
  const read = await menu.evaluate((panel) => ({
    width: panel.getBoundingClientRect().width,
    window: innerWidth,
  }));
  check(
    `P23 E 7b, ${when}: the asks menu is at most 400px wide, and 16px under the window's width`,
    read.width > 0 && read.width <= 400.5 && read.width <= read.window - 16 + 0.5,
    read,
  );
};

/**
 * The bar's line under it, as a person sees it: the ::after hairline (design E), or an outline,
 * shadow or border the bar draws itself. `focused` says the bar holds keyboard focus.
 */
const barLine = (where: Locator) =>
  where.evaluate((element) => {
    const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
    const px = (w: string) => Number.parseFloat(w) || 0;
    const after = getComputedStyle(element, "::after");
    const own = getComputedStyle(element);
    const drawn =
      after.content !== "none" && px(after.height) > 0 && !clear(after.backgroundColor)
        ? { color: after.backgroundColor, size: px(after.height) }
        : px(own.outlineWidth) > 0 && own.outlineStyle !== "none" && !clear(own.outlineColor)
          ? { color: own.outlineColor, size: px(own.outlineWidth) }
          : own.boxShadow !== "none"
            ? { color: /rgba?\([^)]*\)/.exec(own.boxShadow)?.[0] ?? null, size: 1 }
            : px(own.borderBottomWidth) > 0 && !clear(own.borderBottomColor)
              ? { color: own.borderBottomColor, size: px(own.borderBottomWidth) }
              : { color: null, size: 0 };
    return {
      focused: element === document.activeElement && element.matches(":focus-visible"),
      visible: drawn.color !== null && drawn.size > 0,
      ...drawn,
    };
  });

/** What opens under the bar stays in normal flow: nothing up to the ask is lifted out of it. */
const inFlow = async (what: string, where: Locator, target: Locator) => {
  const lifted = await target.evaluate((element) => {
    const out: string[] = [];
    const root = element.closest('[aria-label^="ask: "]');

    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const position = getComputedStyle(node).position;

      if (position !== "static" && position !== "relative") {
        out.push(`${node.tagName} ${position}`);
      }

      if (node === root) {
        break;
      }
    }

    return out;
  });
  check(what, lifted.length === 0 && (await where.isVisible()), lifted);
};

/**
 * Design E (owner, 2026-11-08): one quiet bar, no box around it, never pinned, and at most a
 * hairline under it (fix 2), focused or not. Its background is the tile's own, so no fill makes it
 * a card.
 */
const inspectBar = async (page: Page, where: Locator) => {
  const read = () =>
    where.evaluate((element) => {
      const css = getComputedStyle(element);
      const px = (w: string) => Number.parseFloat(w) || 0;
      const clear = (c: string) => c === "transparent" || /rgba\(.*,\s*0\)$/.test(c);
      let behind = "rgba(0, 0, 0, 0)";

      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;

        if (!clear(bg)) {
          behind = bg;
          break;
        }
      }

      const pinned: string[] = [];
      const tile = element.closest("[data-tile]");

      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const position = getComputedStyle(node).position;

        if (position === "sticky" || position === "fixed") {
          pinned.push(`${node.tagName} ${position}`);
        }

        if (node === tile) {
          break;
        }
      }

      const edges = (node: Element) => {
        const s = getComputedStyle(node);
        return (
          [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some((w) => px(w) > 0) ||
          s.boxShadow !== "none"
        );
      };
      return {
        sides: [css.borderTopWidth, css.borderRightWidth, css.borderLeftWidth].map(px),
        under: px(css.borderBottomWidth),
        // Every length in the shadow: a 2px inset line under the bar is the thick line fix 2 drops.
        shadow: css.boxShadow === "none" ? [] : (css.boxShadow.match(/-?[\d.]+px/g) ?? []).map(px),
        background: css.backgroundColor,
        fill: !clear(css.backgroundColor) && css.backgroundColor !== behind,
        behind,
        pinned,
        nestedEdges: [...element.querySelectorAll("section, article, fieldset")].some(edges),
        scrolls: document.documentElement.scrollWidth > innerWidth,
      };
    });

  for (const focused of [false, true]) {
    if (focused) {
      await where.focus();
    } else {
      await page.locator('[data-tile="t1"]').evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }

    const bar = await read();
    check(
      `P23 E: no box around the bar${focused ? ", focused" : ""}: no side edges, no fill`,
      bar.sides.every((w) => w === 0) && !bar.fill && !bar.nestedEdges,
      bar,
    );
    check(
      `P23 E: at most a hairline under the bar${focused ? ", focused" : ""}`,
      bar.under <= 1 && bar.shadow.every((l) => Math.abs(l) <= 1),
      bar,
    );
    check("P23 E: the bar scrolls with the ticket, never pinned", bar.pinned.length === 0, bar);
    check("P23 E: no page overflow", !bar.scrolls, bar);
  }
};

const inspectCard = async (page: Page, where: Locator) => {
  const toolbar = where.getByRole("toolbar");
  check("P24 toolbar is keyboard reachable", (await toolbar.count()) === 1);
  await toolbar.focus();
  await page.keyboard.press("ArrowRight");
  check("P24 toolbar arrows keep keyboard focus inside", await focusIn(toolbar));
  const reached = new Set<string>();

  for (let i = 0; i < 12; i++) {
    reached.add(
      await toolbar.evaluate((element) =>
        element.contains(document.activeElement) ? (document.activeElement?.textContent ?? "") : "",
      ),
    );
    await page.keyboard.press("ArrowRight");
  }

  check(
    "P24 every-pick is reachable through toolbar arrows",
    [...reached].some((text) => /every pick/i.test(text)),
    [...reached],
  );
  // Option d: the marks are there before a pick, so Tab reaches them from the first look.
  await where.focus();

  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");

    if (await button(where, "Needed me").evaluate((element) => element === document.activeElement)) {
      break;
    }
  }

  check(
    "P24 a mark is reachable by Tab",
    await button(where, "Needed me").evaluate((element) => element === document.activeElement),
  );
  await page.keyboard.press("Space");
  check("P24 Space sets the mark", (await button(where, "Needed me").getAttribute("aria-pressed")) === "true");
  await page.keyboard.press("Space");
  check("P24 Space clears the mark", (await button(where, "Needed me").getAttribute("aria-pressed")) === "false");
  check("P17 d: the marks stay after a press", (await marksIn(where)) === 2);
};
