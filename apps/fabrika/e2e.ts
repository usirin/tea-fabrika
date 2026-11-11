import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Ledger, type Shell, streams, writerText } from "@kampus/fabrika-old";
import { layerSqliteSync } from "@kampus/fabrika-old/sqlite";
import { kindOf, nameOf } from "@kampus/pipeline/tickets/ticket";
import { SEVEN, SEVEN_TITLE } from "@tea-fabrika/tracker/seven";
import { Effect } from "effect";
import type { ElectronApplication, Locator, Page } from "playwright";
import { askDesk } from "./e2e/ask-desk.ts";
import { PROTOCOL } from "./src/link.ts";
import * as TestWindow from "./test-window.ts";

// The app, driven end to end through Playwright's Electron support: the whole flow in the one
// tiled window, one screenshot per step. Not part of `pnpm test`: it opens a real window. The
// window rules it checks are macOS's, so it runs on a Mac: CI runs it on a macOS runner, the
// check workflow's `e2e` job, on every pull request and every push to main.
//
//   pnpm --filter @kampus/fabrika-app-old e2e
//   SHOTS=<folder> pnpm --filter @kampus/fabrika-app-old e2e     screenshots there, not in a temp folder
//
// First, with no screenshot: every key the menu holds goes by a focused tsh tile untouched, while
// typing, Ctrl-C and Ctrl-D stay with tsh. Then:
//
//   1 desk           the window opens on one tile, t1, at tsh's prompt
//   2 split          Ctrl-B |, then Ctrl-B -: three tiles, each with its own tsh
//   3 counter        `counter` in t3: counter covers t3, at 1 after a click; t1 and t2 as they were
//   4 close-asked    Ctrl-B x on t3, with nothing running: "close t3? (y/n)"; n keeps it, y closes it
//   5 attached       `tracker &` in t2 opens no tile; `attach %1` brings it in, covering t2
//   5b link          a ticket filed with URLs in its body; a click on one hands it to the browser,
//                    and the window stays on the desk
//   6 zoomed         Ctrl-B z: t2 fills the window
//   7 closing        `sleep --ms 600000 &` in t1, Ctrl-B x, y: t1 shows "closing", as sleep runs on
//   8 stop-asked     Ctrl-B x on the closing t1: "stop t1 now? (y/n)"; y and t1 goes
//
// Then, with no screenshot: focus moves with Ctrl-B h and l and with a click; what opens over the
// desk (the asks list, the palette) takes focus and every key it reads, so no arrow reaches the tile
// under it, and Escape or a press outside gives focus back, one open at a time; info mode (Ctrl-B i)
// is said on and off in the window's status region and by its item's aria-pressed, explains what
// keyboard focus is on when it comes on and what focus moves to, and Escape leaves it, and with the
// bars hidden it is still seen, and still heard going off, and at 1024 by 700 an explanation is not
// cut off; Ctrl-C
// over counter is back to t3's tsh; Ctrl-B twice sends one Ctrl-B on; a line typed in one tile is
// in another's Up; the page has the bridge's three names and no Node; a message on the wrong port
// is refused; window.open hands http and https to the browser and refuses file:, javascript: and
// the app's own; the page cannot navigate away; and a second copy quits and leaves the first.
//
// No run opens a real browser: every launch swaps main's `shell.openExternal` for a list first,
// and reads the swap back before anything is clicked.
//
// Every launch goes through test-window.ts, so no window is in a person's way: each ends at
// opacity 0 in the work area's corner, and none takes OS focus (`done`, after each launch).
//
// Then the window's own close button, as macOS has it:
//
//   9 reopened       the window closed, the app runs on with no window; the dock icon (`activate`)
//                    brings a new window on the same desk, with counter and the tracker still up
//
// Then y on t2, covered by the tracker: the tracker gets the end of its inputs, ends, and t2 goes.
// The app quits with counter up in a tile. The host it started runs on, apart from the app, as
// the tmux server outlives its client: its pid (in `<home>/host/pid`) is alive, and counter with
// it. The app is started again on the same home, and attaches to that host:
//
//   10 restored      the same desk, with counter still up in its tile, at 1: nothing restarted
//
// Ctrl-B | splits there, through the host. Done ends counter; closing the last tile closes the
// window, not the app; the dock icon then opens one fresh tile. Then the app quits.
//
// Then a host of another version, on a home of its own: a small Node server on that home's
// socket that says hello with version 0. The app does not attach, and says so:
//
//   11 mismatch      "Not attached to the host", with both versions; that host still runs
//
// Then a host that only talks about asks, on a home of its own: with the list open, one ask leaves
// as another arrives, and the page says the new one is seen, with the count the same.
//
// Then the link to the host drops while the app runs, on a home of its own, with seq's 60 lines
// in t1 and counter in t2. Main's dialogs, dock bounce and focus are swapped for a list first,
// and read back empty after each drop:
//
//   socket cut       main's socket to the host is cut, the host alive: the top bar says host
//                    down, then the desk is back on the same host, t1 drawn once
//   host killed      SIGKILL, as a crash: the app starts a new host, and the kept desk comes
//                    back with fresh screens
//   12 reconnecting  no host to be had (the home's host folder is a file): the desk stays,
//                    dimmed and out of reach; the top bar says host down, its lines reconnecting
//   13 stopped       main's clock moved five minutes on: it stops, and the top bar offers try
//                    again, which takes no focus. The folder back, a click on it starts a host,
//                    and the desk is back
//
// Then the tiles' look, on a home of its own (`tilesLook`): one tile, a pipe side by side, a pipe
// stacked, a 2x2 in each state, and a small window, each in `tiles/` as `<state>-<layout>-<look>`.
// `pnpm --filter @kampus/fabrika-app-old e2e -- --tiles` runs that stage alone.
//
// Then a border dragged between two tiles, on a home of its own (`borderDrag`): the tiles resize
// while the pointer moves, and keep the sizes once it is let go. `-- --drag` runs it alone.
// The ARIA stage (`ariaStage`) is not in the whole run: `-- --aria` runs it alone, on a home of its
// own. It reads the accessibility tree of each key state at the five layouts and compares it with
// `aria/`, and it only advises: a diff is printed, never failed on.
// `-- --focus` takes the design foundations' 60 images: six states, five layouts, both looks.
// Run each build with its own SHOTS folder to keep the 120 before and after images apart.
// `-- --tracker-focus` checks T245's input outlines and whole row rings from computed styles.
// The default run also checks T259: changing the look while typing into the right tile leaves
// the left prompt empty. Its window is 1200 by 600, within the CI screen's 1440 by 674.
//
// Last, as no person ever does (there is no stop command), the run stops the host it started by
// its pid, and the fake one too, and checks with pgrep that nothing of either home is left.
//
// The terminals draw on canvases; the page keeps each screen as text too, for a screen reader,
// and that is what this reads. Playwright's API is promises, and this script stays in it.

const here = import.meta.dirname;

const shots = process.env.SHOTS ?? (await mkdtemp(join(tmpdir(), "fabrika-e2e-")));
await mkdir(shots, { recursive: true });
const home = await mkdtemp(join(tmpdir(), "fabrika-home-"));

const saved: string[] = [];

const shot = async (page: Page, name: string) => {
  const file = join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  saved.push(file);
};

const check = (what: string, ok: boolean, seen?: unknown) => {
  if (!ok) {
    throw new Error(`${what}: no${seen === undefined ? "" : `, saw ${JSON.stringify(seen)}`}`);
  }

  console.log(`ok  ${what}`);
};

/** Wait until `ok` holds, and answer what it saw. */
const until = async <T>(what: string, look: () => Promise<T>, ok: (seen: T) => boolean) => {
  let seen = await look();

  for (let i = 0; i < 200 && !ok(seen); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    seen = await look();
  }

  if (!ok(seen)) {
    throw new Error(`waited for ${what}; saw ${JSON.stringify(seen)}`);
  }

  return seen;
};

const tile = (page: Page, id: string) => page.locator(`[data-tile="${id}"]`);

/**
 * A tile's screen, as text: its rows, with no trailing spaces. Empty while it is not drawn, as the
 * first tile is not until the host is up: `until` is what waits, and a look here never ends it.
 */
const screen = async (page: Page, id: string) => {
  const text = tile(page, id).locator(".screen-text");
  return (await text.count()) === 0 ? "" : ((await text.textContent({ timeout: 2000 })) ?? "");
};

const lastRow = (text: string) => text.split("\n").at(-1) ?? "";

/**
 * The prompt's line as typed, with soft wraps undone: from the last row that starts with the prompt
 * to the end of the screen, joined. Every row but the last must be as wide as the first, since a
 * soft wrap fills its row; a shorter one is a hard break, and the line is then not one line.
 */
const promptLine = (text: string): string | null => {
  const rows = text.split("\n");
  const start = rows.findLastIndex((row) => row.startsWith("tsh$"));

  if (start < 0) {
    return null;
  }

  const line = rows.slice(start);
  const width = line[0]?.length ?? 0;
  const full = line.slice(0, -1).every((row) => row.length === width);
  return full && (line.at(-1)?.length ?? 0) <= width ? line.join("") : null;
};

/** The tiles drawn now, in reading order. */
const tiles = (page: Page) =>
  page.locator("[data-tile]").evaluateAll((all) => all.map((t) => t.getAttribute("data-tile")));

const focused = (page: Page) =>
  page.locator('[data-tile][aria-current="true"]').getAttribute("data-tile", { timeout: 2000 });

const shows = (page: Page, id: string, what: string, ok: (text: string) => boolean) =>
  until(`${id}: ${what}`, () => screen(page, id), ok);

const prompted = (page: Page, id: string) => shows(page, id, "the prompt", (t) => lastRow(t) === "tsh$");

/** Type at the focused prompt, with at most three attempts and an exact echo check. */
const typeLine = async (page: Page, id: string, line: string) => {
  const expected = `tsh$ ${line}`;
  const seen: string[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await page.keyboard.press("Control+e");
      await page.keyboard.press("Control+u");
      await prompted(page, id);
    }

    await page.keyboard.type(line);
    let row = lastRow(await screen(page, id));

    for (let i = 0; i < 200 && row !== expected; i += 1) {
      await page.waitForTimeout(50);
      row = lastRow(await screen(page, id));
    }

    if (row === expected) {
      return;
    }

    seen.push(row);
    console.warn(`${id}: typing attempt ${attempt + 1} for ${JSON.stringify(line)}; saw ${JSON.stringify(row)}`);
  }

  throw new Error(`${id}: could not type ${JSON.stringify(line)} after 3 attempts; saw ${JSON.stringify(seen)}`);
};

/** Type a line at the focused tile's prompt, wait to see it echoed, and press Enter. */
const run = async (page: Page, id: string, line: string) => {
  await typeLine(page, id, line);
  await page.keyboard.press("Enter");
};

/** Ctrl-B, then `key`, as tmux's prefix. */
const prefixed = async (page: Page, key: string) => {
  await page.keyboard.press("Control+b");
  await page.keyboard.press(key);
};

const focusIs = (page: Page, id: string) =>
  until(
    `focus on ${id}`,
    () => focused(page),
    (f) => f === id,
  );

const tilesAre = (page: Page, ids: readonly string[]) =>
  until(
    `the tiles ${ids.join(" ")}`,
    () => tiles(page),
    (t) => t.join() === ids.join(),
  );

/** The question a tile asks now, or "" for none. */
const asked = (page: Page) =>
  page
    .getByRole("alertdialog")
    .textContent({ timeout: 2000 })
    .then((t) => t ?? "");

const askedIs = (page: Page, question: string) =>
  until(
    `the question ${question}`,
    () => asked(page),
    (q) => q === question,
  );

const noQuestion = (page: Page) =>
  until(
    "no question",
    () => page.getByRole("alertdialog").count(),
    (n) => n === 0,
  );

/** The word in a tile's state slot, or "" for none. */
const stateIn = async (page: Page, id: string) => {
  const state = tile(page, id).locator(".titlebar .state");
  return (await state.count()) === 0 ? "" : ((await state.textContent({ timeout: 2000 })) ?? "");
};

/** 1 when a tile's title bar says it is closing, else 0. */
const closingIn = async (page: Page, id: string) => ((await stateIn(page, id)) === "closing" ? 1 : 0);

const countIn = (page: Page, id: string) => tile(page, id).getByLabel("count", { exact: true });

const windowCount = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

/** What the page can reach: the bridge's three names, and no Node. */
const reachOf = (page: Page) =>
  page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    bridge: Object.keys(window.fabrika).sort(),
    opened: window.open("https://example.com") === null,
  }));

/**
 * Main's `shell.openExternal`, swapped for a list, so the run never opens a real browser. Read
 * back: a swap that did not take stops the run before anything is clicked.
 */
const noBrowser = async (app: ElectronApplication) => {
  const swapped = await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { opened });
    const list = async (url: string) => {
      opened.push(url);
    };
    shell.openExternal = list;
    return shell.openExternal === list;
  });

  if (!swapped) {
    throw new Error("shell.openExternal was not swapped: this run would open a real browser");
  }
};

/** What main has asked the browser to open, in order. */
const openedOutside = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);

/** The dock icon, clicked: Electron's `activate`, and the window it brings. */
const activate = async (app: ElectronApplication) => {
  const next = app.waitForEvent("window");
  await app.evaluate(({ app }) => {
    app.emit("activate");
  });
  return await next;
};

/** The popover that holds the page's focus: its id, or `null`. */
const overHolds = (page: Page) => page.evaluate(() => document.activeElement?.closest("[data-over]")?.id ?? null);

const gone = (page: Page, id: string) =>
  until(
    `#${id} to close`,
    () => page.locator(`#${id}`).count(),
    (n) => n === 0,
  );

/**
 * What opens over the desk (docs/direction/popovers.md), from t3 at an empty prompt, with t1's
 * line in the shared history: focus moves in; no key it takes reaches t3 under it, even with
 * focus knocked out of it; Escape and a press outside close it, focus back in t3; one at a time.
 */
const popovers = async (page: Page) => {
  await prefixed(page, "a");
  await page.locator("#pop-asks").waitFor();
  check("Ctrl-B a opens the asks list, focus in it", (await overHolds(page)) === "pop-asks");
  const empty = (await page.locator("#pop-asks").textContent()) ?? "";
  check("with nothing waiting, it says so in one calm line", empty.includes("Nothing waits on you"));

  for (const key of ["ArrowUp", "ArrowDown", "Enter", "j", "x"]) {
    await page.keyboard.press(key);
  }

  // Focus knocked out of the list, onto the page itself: the next key still never reaches t3.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowUp");
  // `until`: this key is held, and acts only once the host's answer to `a` is in (desk/hold.ts).
  await until(
    "focus back in the list",
    () => overHolds(page),
    (held) => held === "pop-asks",
  );
  check("a key with focus outside it moves focus back in", true);
  await page.waitForTimeout(200);
  const under = await screen(page, "t3");
  check("no arrow, Enter or letter reached t3 under the list", lastRow(under) === "tsh$", under);
  await page.keyboard.press("Escape");
  await gone(page, "pop-asks");
  check("Escape closes it, and focus is back in t3", (await focusedIn(page)) === "t3");

  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Commands" });
  await palette.waitFor();
  check("Cmd-K opens the palette, focus in its text box", (await overHolds(page)) === "pop-palette");
  await page.keyboard.type("zo");
  await page.keyboard.press("ArrowDown");
  const typed = await palette.getByRole("combobox").inputValue();
  check("what is typed goes to its text box, not to t3", typed === "zo", typed);
  await page.keyboard.press("Escape");
  await gone(page, "pop-palette");
  check("Escape closes the palette, and focus is back in t3", (await focusedIn(page)) === "t3");

  await prefixed(page, "a");
  await page.locator("#pop-asks").waitFor();
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  check("one at a time: the palette takes the asks list's place", (await page.locator("#pop-asks").count()) === 0);
  await page.keyboard.press("Escape");
  await gone(page, "pop-palette");

  await prefixed(page, "a");
  await page.locator("#pop-asks").waitFor();
  await tile(page, "t3").click();
  await gone(page, "pop-asks");
  check("a press outside closes the list, and focus is in t3", (await focusedIn(page)) === "t3");
  const still = await screen(page, "t3");
  check("t3's prompt is still empty", lastRow(still) === "tsh$", still);

  // And with nothing open, Up does reach t3: the keys above were held back, not lost on the way.
  await page.keyboard.press("ArrowUp");
  await shows(page, "t3", "t1's line, from the history", (t) => lastRow(t) === "tsh$ seq --to 3 | double");
  await page.keyboard.press("Control+c");
  await prompted(page, "t3");
};

/** Every text a locator finds now, none when it finds nothing: a look that never waits. */
const textsOf = (at: Locator) => at.evaluateAll((all) => all.map((el) => el.textContent ?? ""));

/**
 * The window's own status region for its mode: not a tile's closing note, and not the top bar's
 * host item, which are status regions too. Waits until there is one, and it says `want`.
 */
const modeSaid = (page: Page, want: string) =>
  until(
    `one status region for the mode, saying "${want}"`,
    () => textsOf(page.locator('[role="status"]:not([data-tile] *):not(.topbar *)')),
    (said) => said.length === 1 && said[0] === want,
  );

const bottomLine = (page: Page) => page.locator("footer.bottomline");

/** Waits until the bottom line's INFO words hold `want`. */
const explained = (page: Page, want: string) =>
  until(
    `the bottom line to explain ${want}`,
    () => textsOf(bottomLine(page).locator(".info")),
    (said) => said.some((text) => text.includes(want)),
  );

/** The bottom line's info item, by its name, which stays `info` whether the mode is on or off. */
const infoItem = (page: Page) => bottomLine(page).getByRole("button", { name: /info$/ });

/** Click t3, and wait until focus is back in it. */
const backInT3 = async (page: Page) => {
  await tile(page, "t3").click();
  await until(
    "focus back in t3",
    () => focusedIn(page),
    (at) => at === "t3",
  );
};

/**
 * Info mode, from t3 at an empty prompt (docs/direction/modes.md, M3 and M4): Ctrl-B i says it is
 * on in the window's status region, and its item says it is pressed, under the same name; keyboard
 * focus moving, with no pointer, is explained on the bottom line; while something is explained, the
 * bottom line's right side keeps its items; Escape leaves it and says so. Turned on while
 * focus is on one of the frame's parts, it explains that part at once. With the bars hidden, Ctrl-B
 * i keeps the bottom line up, and Ctrl-B i again still says it is off: the region is drawn whatever
 * the bars, never inside the bottom line.
 */
const infoMode = async (page: Page) => {
  check(
    "its item is not pressed while info mode is off",
    (await infoItem(page).getAttribute("aria-pressed")) === "false",
  );
  await prefixed(page, "i");
  await modeSaid(page, "Info mode on. Escape leaves.");
  await explained(page, "point at anything");
  check("the hint promises no Tab", !(await textsOf(bottomLine(page).locator(".info"))).some((t) => t.includes("tab")));
  check("Ctrl-B i turns info mode on, and the status region says so", true);
  check(
    "its item keeps its name and says it is pressed",
    (await infoItem(page).getAttribute("aria-pressed")) === "true",
  );
  const right = await textsOf(bottomLine(page).locator(".right"));
  await bottomLine(page).getByRole("button", { name: /keys$/ }).focus();
  await explained(page, "keys: press C-b");
  check(
    "while something is explained, the right side keeps its items",
    (await textsOf(bottomLine(page).locator(".right"))).join() === right.join(),
    right,
  );
  await page.keyboard.press("Shift+Tab");
  await explained(page, (await infoItem(page).getAttribute("data-info")) ?? "info:");
  check("keyboard focus moving, by Tab too, is explained on the bottom line", true);
  await modeSaid(page, "Info mode on. Escape leaves.");
  check("the status region says nothing of each part explained", true);
  await page.keyboard.press("Escape");
  await modeSaid(page, "Info mode off.");
  check(
    "Escape leaves info mode, and the status region says so",
    (await bottomLine(page).locator(".info").count()) === 0,
  );
  await backInT3(page);

  const keys = bottomLine(page).getByRole("button", { name: /keys$/ });
  const keysWords = (await keys.getAttribute("data-info")) ?? "keys:";
  await keys.focus();
  // Every text the bottom line's INFO words take on the way, the ones replaced in place too. Focus
  // going back to the item explains it on its own (focusin), so only this tells "at once" from
  // "point at anything" first (desk.tsx, focusWords).
  const shown = await page.evaluateHandle(() => {
    const seen: string[] = [];
    const holdsInfo = (n: Node) => n instanceof Element && (n.matches(".info") || n.querySelector(".info") !== null);
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const at = r.target instanceof Element ? r.target : r.target.parentElement;
        const inside = at?.closest(".info") != null;

        if (inside && r.oldValue !== null) {
          seen.push(r.oldValue);
        }

        for (const n of [...r.addedNodes, ...r.removedNodes]) {
          if (inside || holdsInfo(n)) {
            seen.push(n.textContent ?? "");
          }
        }
      }

      const now = document.querySelector("footer.bottomline .info");

      if (now !== null) {
        seen.push(now.textContent ?? "");
      }
    });
    watch.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      characterDataOldValue: true,
    });
    return { seen, stop: () => watch.disconnect() };
  });
  await prefixed(page, "i");
  await modeSaid(page, "Info mode on. Escape leaves.");
  await explained(page, keysWords);
  const passed = await shown.evaluate((s) => {
    s.stop();
    return s.seen;
  });
  await shown.dispose();
  check(
    "turned on with focus on the keys item, info mode explains it at once, never the hint first",
    passed.length > 0 && !passed.some((text) => text.includes("point at anything")),
    passed,
  );
  // Ctrl-B swaps the right side's items for `esc cancels`, so focus falls to the page; the key
  // done, it goes back to the item it was on (desk.tsx, focusBack).
  await until(
    "focus back on the keys item",
    () => page.evaluate(() => document.activeElement?.getAttribute("data-info") ?? null),
    (at) => at === keysWords,
  );
  check("the key done, focus is back on the keys item it fell from", true);
  await page.keyboard.press("Escape");
  await modeSaid(page, "Info mode off.");
  await backInT3(page);

  await prefixed(page, "B");
  await until(
    "both bars hidden",
    () => bottomLine(page).count(),
    (n) => n === 0,
  );
  await prefixed(page, "i");
  await modeSaid(page, "Info mode on. Escape leaves.");
  await explained(page, "point at anything");
  check("with the bars hidden, info mode keeps the bottom line up", true);
  check(
    "the status region is not inside the bottom line",
    (await bottomLine(page).locator('[role="status"]').count()) === 0,
  );
  await prefixed(page, "i");
  await modeSaid(page, "Info mode off.");
  await until(
    "the bottom line to go with the bars hidden",
    () => bottomLine(page).count(),
    (n) => n === 0,
  );
  check("with the bars hidden, Ctrl-B i twice still says info mode is off", true);
  await prefixed(page, "B");
  await bottomLine(page).waitFor();
  check("Ctrl-B B shows both bars again, focus still in t3", (await focusedIn(page)) === "t3");
  await prompted(page, "t3");
};

/**
 * Info mode in a small window, 1024 by 700. The host item's words are among the longest a part has,
 * and always on screen: explained, they wrap onto a second line and are not cut off. The right side
 * never shrinks and keeps its items. While the mode is on, the bottom line keeps one height, so the
 * desk is the same height for a short explanation and a long one, and no terminal refits as the
 * pointer or focus moves. The way out goes first on the right, so the info item is where it was
 * before the mode came on, and a second click there turns it off. The bottom line's items show
 * their whole focus ring inside the window, the mode off and on, and with the mode on the bottom
 * line starts on a whole pixel, so the tiles above it end on one. No width or height is guessed:
 * each box is checked against the one it sits in, or against itself at another moment.
 *
 * Playwright sizes the page, not the window: macOS keeps a window inside the screen, and a CI
 * runner's screen is too short for 700. It goes through the DevTools protocol, not
 * `page.setViewportSize`, which also sets the pixel ratio to 1 and cannot be undone; scale 0 keeps
 * the screen's own. The page goes back to the window's size after.
 */
const infoModeSmall = async (page: Page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 700,
    deviceScaleFactor: 0,
    mobile: false,
  });
  await until(
    "the window at 1024 by 700",
    () => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
    (size) => size === "1024x700",
  );
  /** Where the info item is now, in the window. */
  const itemAt = async () => {
    const box = await infoItem(page).boundingBox();
    return box === null ? null : { x: box.x, y: box.y };
  };
  /** How tall the desk's workspace is now: it gives the bottom line whatever room it takes. */
  const deskHeight = () => page.locator(".workspace").evaluate((el) => el.getBoundingClientRect().height);
  const keys = bottomLine(page).getByRole("button", { name: /keys$/ });
  /**
   * The focus ring of what has focus: its box grown by its outline's width and offset, whether
   * that box is inside the window, and whether a ring is drawn at all.
   */
  const ring = () =>
    page.evaluate(() => {
      const el = document.activeElement;

      if (el === null) {
        return { drawn: false, inside: false, box: null, focused: null };
      }

      const style = getComputedStyle(el);
      const out = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
      const r = el.getBoundingClientRect();
      const box = {
        left: r.left - out,
        top: r.top - out,
        right: r.right + out,
        bottom: r.bottom + out,
      };
      return {
        drawn: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0,
        inside: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        box,
        focused: el.getAttribute("data-info"),
      };
    });
  /**
   * Tab to the keys item and Shift+Tab back to the info item, by the keyboard, so each draws its
   * focus ring (`:focus-visible`): the whole ring is inside the window (WCAG 2.4.7, 2.4.11).
   */
  const ringsInside = async (when: string) => {
    const infoWords = await infoItem(page).getAttribute("data-info");
    const keysWords = await keys.getAttribute("data-info");
    await infoItem(page).focus();
    const walk: ReadonlyArray<readonly [string, string | null, string]> = [
      ["Tab", keysWords, "keys"],
      ["Shift+Tab", infoWords, "info"],
    ];

    for (const [press, words, name] of walk) {
      await page.keyboard.press(press);
      const seen = await until(`focus on the ${name} item`, ring, (r) => r.focused === words);
      check(
        `at 1024 by 700, ${when}, the ${name} item's focus ring is whole inside the window`,
        seen.drawn && seen.inside,
        seen,
      );
    }
  };
  /**
   * Where the bottom line starts and the desk ends, in px. On a fraction of a pixel, the tiles
   * above end there too: a tile's 1px edge smears over two rows at half strength, and its
   * terminal, which covers whole cells, paints over the upper row, so a focused tile's bottom edge
   * goes faint but for a short bright stub past the last column (round 3's shots 3b and 6a).
   */
  const lineEdges = () =>
    page.evaluate(() => {
      const line = document.querySelector("footer.bottomline")?.getBoundingClientRect();
      const desk = document.querySelector(".workspace")?.getBoundingClientRect();
      return { line: line?.top ?? null, height: line?.height ?? null, desk: desk?.bottom ?? null };
    });
  await ringsInside("info mode off");
  await backInT3(page);
  const off = await itemAt();
  await prefixed(page, "i");
  await modeSaid(page, "Info mode on. Escape leaves.");
  await explained(page, "point at anything");
  const on = await itemAt();
  const hint = await deskHeight();
  const edges = await lineEdges();
  check(
    "at 1024 by 700 with info mode on, the bottom line and the desk's end fall on whole pixels",
    [edges.line, edges.height, edges.desk].every((v) => v !== null && Number.isInteger(v)),
    edges,
  );
  await ringsInside("info mode on");
  await backInT3(page);
  check(
    "at 1024 by 700, the info item is where it was before the mode came on",
    off !== null && on !== null && off.x === on.x && off.y === on.y,
    { off, on },
  );
  await keys.focus();
  await explained(page, (await keys.getAttribute("data-info")) ?? "keys:");
  const short = await deskHeight();
  const host = page.locator(HOST);
  const words = (await host.getAttribute("data-info")) ?? "host:";
  await host.focus();
  await explained(page, words);
  const long = await deskHeight();
  check(
    "at 1024 by 700, the desk keeps its height from the hint to a short explanation to a long one",
    hint === short && short === long,
    { hint, short, long },
  );
  const explaining = await itemAt();
  check(
    "and the info item stays put while a long explanation wraps",
    off !== null && explaining !== null && off.x === explaining.x && off.y === explaining.y,
    { off, explaining },
  );
  const seen = await bottomLine(page).evaluate((line, said) => {
    /** Every rect of `el` lies inside `box`. */
    const inside = (el: Element, box: DOMRect) =>
      [...el.getClientRects()].every(
        (r) => r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom,
      );
    const view = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const left = line.querySelector(".left");
    const info = line.querySelector(".info");
    const out = [...line.querySelectorAll(".right *")].find(
      (el) => el.children.length === 0 && el.textContent === "esc leaves",
    );

    if (left === null || info === null || out === undefined) {
      return {
        found: false,
        full: false,
        wraps: false,
        wide: false,
        tall: false,
        infoIn: false,
        lineIn: false,
        outIn: false,
      };
    }

    return {
      found: true,
      full: (info.textContent ?? "").includes(said),
      wraps: info.getClientRects().length > 1,
      wide: left.scrollWidth <= left.clientWidth,
      tall: left.scrollHeight <= left.clientHeight,
      infoIn: inside(info, left.getBoundingClientRect()),
      lineIn: inside(line, view),
      outIn: inside(out, line.getBoundingClientRect()),
    };
  }, words);
  check(
    "at 1024 by 700, the host item is explained in full: it wraps, and the left side is not cut off",
    seen.found && seen.full && seen.wraps && seen.wide && seen.tall && seen.infoIn,
    seen,
  );
  check(
    "at 1024 by 700, the way out is there in full, inside the bottom line, inside the window",
    seen.lineIn && seen.outIn,
    seen,
  );
  await page.keyboard.press("Escape");
  await modeSaid(page, "Info mode off.");
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await cdp.detach();
  await backInT3(page);
  await prompted(page, "t3");
};

/**
 * Press a chord, and wait until it has ended as `want` says: "free" if the page let the key go by
 * untouched, which is what lets Electron offer it to the menu, or "taken" if something on the page
 * called `preventDefault`. A key the page's own listener swallows never reaches the spy, so it
 * never ends "free". What this cannot see is the menu itself: a key sent over the DevTools protocol
 * has no native event, and Electron offers only a native one to the menu.
 */
const pressEnds = async (page: Page, chord: string, want: "free" | "taken") => {
  await page.evaluate(() => delete document.documentElement.dataset.keyEnd);
  await page.keyboard.press(chord);
  await until(
    `${chord} to end ${want}`,
    () => page.evaluate(() => document.documentElement.dataset.keyEnd),
    (end) => end === want,
  );
};

/**
 * Cmd-W, on a Mac: canceled, so Electron does not offer it to the menu's Close
 * Window, and nothing closes. `onKey` swallows them before the spy, so a key that ended "free" is
 * the failure here. The window count cannot fail on its own: a key sent this way never reaches
 * the menu, whatever the page does. Cancelling is what this proves.
 */
const closeKeysDoNothing = async (app: ElectronApplication, page: Page, where: string) => {
  const before = await tiles(page);

  for (const chord of ["Meta+w"]) {
    await page.evaluate(() => delete document.documentElement.dataset.keyEnd);
    await page.keyboard.press(chord);
    await page.waitForTimeout(200);
    const end = await page.evaluate(() => document.documentElement.dataset.keyEnd);
    check(`${chord} is cancelled ${where}`, end !== "free", end);
    check(`${chord} closes no window`, (await windowCount(app)) === 1);
    check(`${chord} closes no tile`, (await tiles(page)).join() === before.join());
  }
};

/** A menu accelerator, as Playwright spells the same chord. */
const chordFor = (accelerator: string) =>
  accelerator
    .split("+")
    .map((part) => {
      if (/^(Command|Cmd|CommandOrControl|CmdOrCtrl)$/.test(part)) {
        return "Meta";
      }

      if (part === "Option") {
        return "Alt";
      }

      if (part === "Plus") {
        return "Shift+=";
      }

      return part.length === 1 ? part.toLowerCase() : part;
    })
    .join("+");

/**
 * Who owns a key, from t1 at an empty prompt: every accelerator in the real menu goes by the tile
 * untouched and types nothing, as does each key the system or the menu may own, with the prefix
 * armed or a popover open too. Typing, Ctrl-C and Ctrl-D stay with tsh, and Cmd-W does nothing.
 */
const systemKeys = async (app: ElectronApplication, page: Page) => {
  await page.evaluate(() => {
    window.addEventListener(
      "keydown",
      (e) => {
        if (["Meta", "Shift", "Alt", "Control"].includes(e.key)) {
          return;
        }

        // Read on the next turn: by then every listener on the page has had the key.
        setTimeout(() => {
          document.documentElement.dataset.keyEnd = e.defaultPrevented ? "taken" : "free";
        });
      },
      { capture: true },
    );
    // Playwright's Meta+v really pastes, from this machine's clipboard. The spy notes where the
    // paste would land, and stops it, so what is on the clipboard never reaches a tile or a log.
    window.addEventListener(
      "paste",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const at = e.target instanceof Element ? e.target : null;
        const over = at?.closest("[data-over]")?.id;
        const tile = at?.closest("[data-tile]")?.getAttribute("data-tile");
        document.documentElement.dataset.pasteIn = over ?? tile ?? "elsewhere";
      },
      { capture: true },
    );
  });
  const accelerators = await app.evaluate(({ Menu }) => {
    const inMenu = (menu: Electron.Menu): string[] =>
      menu.items.flatMap((item) => [
        ...(item.accelerator ? [item.accelerator] : []),
        ...(item.submenu ? inMenu(item.submenu) : []),
      ]);
    const menu = Menu.getApplicationMenu();
    return menu === null ? [] : inMenu(menu);
  });
  const chords = accelerators.map(chordFor).filter((chord) => chord !== "Meta+w");
  check("the menu has Quit on Cmd-Q", chords.includes("Meta+q"), chords);

  for (const chord of [...chords, "Meta+,", "Meta+`", "Meta+t"]) {
    await pressEnds(page, chord, "free");
    const row = lastRow(await screen(page, "t1"));
    check(`${chord} goes by t1 and types nothing`, row === "tsh$", row);
  }

  // While the host has not answered Ctrl-B yet, and then with the prefix armed.
  await page.keyboard.press("Control+b");
  await pressEnds(page, "Meta+q", "free");
  await page.waitForTimeout(200);
  await pressEnds(page, "Meta+q", "free");
  check("Cmd-Q goes by the prefix", true);
  await page.keyboard.press("q");
  await page.waitForTimeout(200);
  await prompted(page, "t1");

  await page.keyboard.press("Meta+k");
  const palette = page.getByRole("dialog", { name: "Commands" });
  await palette.waitFor();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await pressEnds(page, "Meta+q", "free");
  check("Cmd-Q goes by a palette without focus", true);

  // Focus can land in a tile under the palette: a split from another window focuses its new
  // terminal. Focus is put there by hand here. Cmd-V must not paste into a shell nobody sees.
  const intoTile = async () => {
    await page.locator('[data-tile="t1"] .screen').focus();
    check("focus is in t1, under what is open", (await overHolds(page)) === null);
  };
  await intoTile();
  await page.evaluate(() => delete document.documentElement.dataset.pasteIn);
  await pressEnds(page, "Meta+v", "free");
  check("Cmd-V moves focus into the palette", (await overHolds(page)) === "pop-palette");
  await until(
    "the paste to land",
    () => page.evaluate(() => document.documentElement.dataset.pasteIn),
    (pasted) => pasted === "pop-palette",
  );
  check("Cmd-V pastes into the palette", true);
  await intoTile();
  await pressEnds(page, "Meta+q", "free");
  check("Cmd-Q goes by with focus in a tile under the palette", true);
  await page.waitForTimeout(200);
  check("nothing reached t1 under the palette", lastRow(await screen(page, "t1")) === "tsh$");
  await page.keyboard.press("Escape");
  await gone(page, "pop-palette");

  // The asks list gives way to the desk while the prefix is armed. Cmd-V still does not reach t1.
  await prefixed(page, "a");
  await page.locator("#pop-asks").waitFor();
  await page.waitForTimeout(200);
  await intoTile();
  await page.keyboard.press("Control+b");
  await pressEnds(page, "Meta+v", "free");
  check("with the prefix armed, Cmd-V moves focus into the list", (await overHolds(page)) === "pop-asks");
  await page.keyboard.press("q");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await gone(page, "pop-asks");
  await prompted(page, "t1");

  await typeLine(page, "t1", "ab");
  await page.keyboard.press("ArrowLeft");
  await pressEnds(page, "Control+d", "taken");
  await shows(page, "t1", "Ctrl-D deleting a character", (t) => lastRow(t) === "tsh$ a");
  check("Ctrl-D stays with tsh", true);
  await pressEnds(page, "Control+c", "taken");
  await prompted(page, "t1");
  check("Ctrl-C stays with tsh", true);
  await pressEnds(page, "q", "taken");
  await shows(page, "t1", "a plain q", (t) => lastRow(t) === "tsh$ q");
  check("a plain q is typed", true);
  await page.keyboard.press("Control+u");
  await prompted(page, "t1");

  await closeKeysDoNothing(app, page, "over t1's tsh");
  const row = lastRow(await screen(page, "t1"));
  check("Cmd-W types nothing in t1", row === "tsh$", row);
  await page.keyboard.press("Meta+k");
  await palette.waitFor();
  await closeKeysDoNothing(app, page, "over the palette");
  check("the palette is still open", (await palette.count()) === 1);
  await page.keyboard.press("Escape");
  await gone(page, "pop-palette");
  await prompted(page, "t1");
};

const flow = async (app: ElectronApplication) => {
  const page = await app.firstWindow();
  await prompted(page, "t1");
  await systemKeys(app, page);
  check("the desk starts on our own scheme", page.url() === "fabrika://app/desk.html", page.url());
  await run(page, "t1", "seq --to 3 | double");
  const answer = await prompted(page, "t1");
  check("t1's tsh answers", answer.includes("double 2\ndouble 4\ndouble 6\ntsh$"), answer);
  await quietAtRest(page);
  await shot(page, "1-desk");

  await prefixed(page, "|");
  await tilesAre(page, ["t1", "t2"]);
  await focusIs(page, "t2");
  await prompted(page, "t2");
  await prefixed(page, "-");
  await tilesAre(page, ["t1", "t2", "t3"]);
  await focusIs(page, "t3");
  await prompted(page, "t3");
  check("Ctrl-B | then Ctrl-B -: three tiles, each at its own prompt", true);
  await shot(page, "2-split");

  await prefixed(page, "h");
  await focusIs(page, "t1");
  await prefixed(page, "l");
  const right = await until(
    "focus off t1",
    () => focused(page),
    (f) => f !== "t1",
  );
  check("Ctrl-B h and Ctrl-B l move focus", right === "t2" || right === "t3", right);
  await tile(page, "t3").click();
  await focusIs(page, "t3");
  check("a click focuses a tile", true);
  await popovers(page);
  await infoMode(page);
  await infoModeSmall(page);

  await run(page, "t3", "counter");
  await countIn(page, "t3").waitFor();
  check("counter covers t3, at 0", (await countIn(page, "t3").innerText()) === "0");
  await tile(page, "t3").locator("[data-view]").focus();
  await closeKeysDoNothing(app, page, "over a program's view");
  await tile(page, "t3").getByRole("button", { name: "+1" }).click();
  await countIn(page, "t3").filter({ hasText: /^1$/ }).waitFor();
  const t1 = await screen(page, "t1");
  check("t1 is as it was", t1.endsWith("double 6\ntsh$"), t1);
  await shot(page, "3-counter");
  await page.keyboard.press("Control+c");
  await until(
    "counter's view to go",
    () => countIn(page, "t3").count(),
    (n) => n === 0,
  );
  const stopped = await prompted(page, "t3");
  check("Ctrl-C over counter goes to t3's tsh: counter stops, the prompt is back", stopped.includes("^C"), stopped);

  await prefixed(page, "x");
  await askedIs(page, "close t3? (y/n)");
  await shot(page, "4-close-asked");
  await page.keyboard.press("n");
  await noQuestion(page);
  await tilesAre(page, ["t1", "t2", "t3"]);
  check("Ctrl-B x asks on a tile with nothing running too, and n keeps it", true);
  await prefixed(page, "x");
  await askedIs(page, "close t3? (y/n)");
  await page.keyboard.press("y");
  await tilesAre(page, ["t1", "t2"]);
  check("y closes a tile with nothing running at once", true);

  await focusIs(page, "t2");
  await run(page, "t2", "tracker &");
  // The host keeps one job table, numbers never reused: the tracker's is whatever comes next.
  const job = await shows(page, "t2", "the job's number", (t) => /\[\d+\] tracker:/.test(t));
  const n = /\[(\d+)\] tracker:/.exec(job)?.[1] ?? "1";
  await prompted(page, "t2");
  await page.waitForTimeout(300);
  await tilesAre(page, ["t1", "t2"]);
  check(
    "tracker & opens no tile: a job in the background, and t2's prompt is back",
    (await tile(page, "t2").getByLabel("tracker view").count()) === 0,
    job,
  );
  await run(page, "t2", `attach %${n}`);
  await tile(page, "t2").getByLabel("tracker view").waitFor();
  await tilesAre(page, ["t1", "t2"]);
  check(`attach %${n} brings the tracker in, covering t2, as fg does`, true);
  await shot(page, "5-attached");

  const tracker = tile(page, "t2").getByLabel("tracker view");
  await tracker.getByLabel("new ticket title").fill("Links");
  await tracker
    .getByLabel("new ticket body")
    .fill("See https://example.com/a_(b). Or (https://example.org/x), not javascript:alert(1).");
  await tracker.getByRole("button", { name: "File ticket" }).click();
  await tracker.getByRole("button", { name: /Links/ }).click();
  const link = tracker.getByRole("link", { name: "https://example.com/a_(b)", exact: true });
  await link.waitFor();
  const shown = await tracker
    .getByRole("link")
    .evaluateAll((all) => all.map((a) => [a.textContent, a.getAttribute("target"), a.getAttribute("rel")].join(" ")));
  check(
    "a ticket's body links its http and https URLs, GitHub's way: no trailing . ) or ,",
    shown.join() === ["https://example.com/a_(b) _blank noreferrer", "https://example.org/x _blank noreferrer"].join(),
    shown,
  );
  await link.click();
  const clicked = await until(
    "the link to go to the browser",
    () => openedOutside(app),
    (o) => o.length > 0,
  );
  check("a click on a link hands its URL to the browser", clicked.join() === "https://example.com/a_(b)", clicked);
  check(
    "and the window stays on the desk, with no window of its own",
    page.url() === "fabrika://app/desk.html" && (await windowCount(app)) === 1,
    page.url(),
  );
  await shot(page, "5b-link");

  await prefixed(page, "z");
  await tilesAre(page, ["t2"]);
  check("Ctrl-B z zooms t2", true);
  await shot(page, "6-zoomed");
  await prefixed(page, "z");
  await tilesAre(page, ["t1", "t2"]);

  await prefixed(page, "h");
  await focusIs(page, "t1");
  await run(page, "t1", "sleep --ms 600000 &");
  await prompted(page, "t1");
  await until(
    "t1's job on the bottom line",
    () => page.locator(".bottomline .job").innerText(),
    (t) => /^%\d+ sleep --ms 600000 \d+s$/.test(t),
  );
  await prefixed(page, "x");
  await askedIs(page, "close t1? (y/n)");
  await page.keyboard.press("y");
  await until(
    "t1 closing",
    () => closingIn(page, "t1"),
    (n) => n === 1,
  );
  await page.waitForTimeout(300);
  await tilesAre(page, ["t1", "t2"]);
  check(
    "y on a busy tile: it shows closing, and waits, as sleep does not end on its inputs' end",
    (await tile(page, "t2").getByLabel("tracker view").count()) === 1,
  );
  await shot(page, "7-closing");
  await prefixed(page, "x");
  await askedIs(page, "stop t1 now? (y/n)");
  await shot(page, "8-stop-asked");
  await page.keyboard.press("n");
  await noQuestion(page);
  check("Ctrl-B x on a closing tile asks to stop now, and n keeps it closing", true);
  await prefixed(page, "x");
  await askedIs(page, "stop t1 now? (y/n)");
  await page.keyboard.press("y");
  await tilesAre(page, ["t2"]);
  check("y stops t1, and the tracker in t2 runs on", (await tile(page, "t2").getByLabel("tracker view").count()) === 1);

  await prefixed(page, "|");
  const split = await until(
    "a new tile",
    () => tiles(page),
    (t) => t.length === 2,
  );
  const next = split[1] ?? "";
  await prompted(page, next);
  await typeLine(page, next, "ab");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+b");
  // Keep the insertion raw so a retry cannot hide a cursor-routing bug.
  await page.keyboard.type("X");
  await shows(page, next, "aXb", (t) => lastRow(t) === "tsh$ aXb");
  check("Ctrl-B twice sends one Ctrl-B on: the cursor went back one", true);
  await page.keyboard.press("Control+u");
  await page.keyboard.press("ArrowUp");
  await shows(page, next, "the other tile's line", (t) => lastRow(t) === "tsh$ sleep --ms 600000 &");
  check("a line typed in one tile is in another's Up", true);
  await page.keyboard.press("Control+u");

  const iconWidth = await app.evaluate(
    ({ nativeImage }, file) => nativeImage.createFromPath(file).getSize().width,
    join(here, "dist", "icon.png"),
  );
  check("the app's icon loads as a real image, 1024 wide", iconWidth === 1024, iconWidth);

  const brand = await page.locator(".topbar .brand").evaluate((el) => {
    const at = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      off: Math.abs((at.left + at.right) / 2 - innerWidth / 2),
      shown: style.display !== "none",
      drags: style.getPropertyValue("app-region"),
      press: style.pointerEvents,
    };
  });
  check(
    "the bar's mark and name sit on the window's middle, and the window drags through them",
    brand.shown && brand.off < 1 && brand.drags === "drag" && brand.press === "none",
    brand,
  );

  const reach = await reachOf(page);
  check(
    "the page has send, onMessage and forget only, and no Node",
    reach.require === "undefined" &&
      reach.process === "undefined" &&
      reach.bridge.join() === "forget,onMessage,send" &&
      reach.opened,
    reach,
  );
  await page.evaluate(() => {
    window.open("javascript:alert(1)");
    window.open("file:///etc/hosts");
    window.open("fabrika://app/desk.html");
    window.open("x-custom://open");
  });
  await page.waitForTimeout(300);
  const outside = await openedOutside(app);
  check(
    "window.open hands only http and https to the browser: file:, javascript:, the app's own and a custom scheme are refused",
    outside.join() === ["https://example.com/a_(b)", "https://example.com/"].join() && (await windowCount(app)) === 1,
    outside,
  );
  await page.evaluate((next) => {
    window.fabrika.send(`tile:${next}`, { type: "line", value: "say --text no\r" });
    window.fabrika.send(`tile:${next}`, { type: "keys", data: "say --text no\r", to: "tsh:p1" });
    window.fabrika.send("tile:../t1", { type: "keys", data: "say --text no\r" });
    window.fabrika.send("desk", { type: "open", tile: "../../etc" });
    window.fabrika.send("desk", "rm -rf");
  }, next);
  await page.waitForTimeout(300);
  const refused = await screen(page, next);
  check("messages not of the protocol tell tsh nothing", !refused.includes("no"), refused);

  await run(page, next, "counter");
  await countIn(page, next).waitFor();
  await tile(page, next).getByRole("button", { name: "+1" }).click();
  await countIn(page, next).filter({ hasText: /^1$/ }).waitFor();

  // A second copy, on the same home, brings the first forward and quits.
  const second = await TestWindow.secondCopy(home);
  const windows = await windowCount(app);
  check("a second copy quits, and the first keeps its one window", second === "quit" && windows === 1, {
    second,
    windows,
  });

  // Last on this page: Playwright waits on the navigation main refused, so it is not driven after.
  await page.evaluate(() => {
    window.location.href = "https://example.com";
  });
  await page.waitForTimeout(500);
  const url = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL());
  check("the page cannot navigate away", url === "fabrika://app/desk.html", url);
  const after = await openedOutside(app);
  check("and a navigation opens nothing in the browser either", after.length === 2, after);
  return next;
};

/** The red close button, then the dock icon: the app runs on with no window, and the desk comes back. */
const reopen = async (app: ElectronApplication, left: string) => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await until(
    "no window",
    () => windowCount(app),
    (n) => n === 0,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const alive = await app.evaluate(({ app }) => app.isReady());
  check("the close button closes the window only: the app runs on, with no window", alive);

  const page = await activate(app);
  await tilesAre(page, ["t2", left]);
  await countIn(page, left).filter({ hasText: /^1$/ }).waitFor();
  await tile(page, "t2").getByLabel("tracker view").waitFor();
  check("the dock icon brings a window on the same desk: counter at 1 and the tracker run on", true);
  await shot(page, "9-reopened");

  await tile(page, "t2").click();
  await focusIs(page, "t2");
  await prefixed(page, "x");
  await askedIs(page, "close t2? (y/n)");
  await page.keyboard.press("y");
  await tilesAre(page, [left]);
  check("y on t2: the tracker gets the end of its inputs, ends, and t2 goes", true);
};

/** Started again on the same home: it attaches to the host that ran on, and the desk is as it was. */
const again = async (app: ElectronApplication, left: string) => {
  const page = await app.firstWindow();
  await tilesAre(page, [left]);
  await countIn(page, left).filter({ hasText: /^1$/ }).waitFor();
  const before = await screen(page, left);
  check(
    "started again: the same desk, with counter still up at 1, and no earlier job to attach",
    !before.includes("earlier tsh"),
    before,
  );
  await focusIs(page, left);
  await shot(page, "10-restored");

  await tile(page, left).getByRole("button", { name: "done" }).click();
  const back = await shows(page, left, "counter's count", (t) => t.includes("tsh$ counter\n1\n"));
  check("done: counter ends, the tsh that ran it all along prints 1", true, back);
  await prompted(page, left);

  await prefixed(page, "|");
  const split = await until(
    "a new tile",
    () => tiles(page),
    (t) => t.length === 2,
  );
  await prompted(page, split[1] ?? "");
  check("Ctrl-B | splits, through the host", split[0] === left, split);
  await prefixed(page, "x");
  await askedIs(page, `close ${split[1]}? (y/n)`);
  await page.keyboard.press("y");
  await tilesAre(page, [left]);
  await focusIs(page, left);

  const gone = page.waitForEvent("close");
  await prefixed(page, "x");
  await askedIs(page, `close ${left}? (y/n)`);
  // The window closes on the key going down, so the key's release may find no page, and press
  // throws. That is this step working. If the window stays, `gone` still fails the run.
  await page.keyboard.press("y").catch(() => {});
  await gone;
  await until(
    "no window",
    () => windowCount(app),
    (n) => n === 0,
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  check("closing the last tile closes the window, and the app runs on", await app.evaluate(({ app }) => app.isReady()));
  const fresh = await activate(app);
  await tilesAre(fresh, ["t1"]);
  const first = await prompted(fresh, "t1");
  check("the next window opens on one fresh tile with a fresh tsh", !first.includes("earlier tsh"), first);
};

if (process.platform !== "darwin") {
  throw new Error("this run checks macOS's window rules: run it on a Mac");
}

const launch = async (on: string) => {
  const win = await TestWindow.launch({ home: on });
  await noBrowser(win.app).catch(async (e: unknown) => {
    await win.close().catch(() => {});
    throw e;
  });
  return win;
};

/** The ask desk takes the bare app and closes it itself, so it gets the test window's `app`. */
const askDeskLaunch = async (on: string) => (await launch(on)).app;

/** What `done` saw put a window in the person's way. The run fails on it last, after its hosts stop. */
const inWay: unknown[] = [];

/**
 * The window scenario, after each launch: every window the app has ends at opacity 0, in the work
 * area's bottom-right corner, or at its top-left on a side where it is larger. Then `close`, which
 * fails if any window took OS focus or was seen above opacity 0. Neither throws here, so the
 * cleanup after it still runs; each failure goes in `inWay`.
 */
const done = async (win: TestWindow.TestWindow) => {
  const windows = await win.app
    .evaluate(({ BrowserWindow, screen }) => {
      const area = screen.getPrimaryDisplay().workArea;
      return BrowserWindow.getAllWindows().map((w) => ({ opacity: w.getOpacity(), bounds: w.getBounds(), area }));
    })
    .catch((e: unknown) => {
      inWay.push({ home: win.home, read: String(e) });
      return [];
    });
  const out = windows.filter(
    ({ opacity, bounds: b, area: a }) =>
      opacity !== 0 ||
      b.x !== Math.max(a.x, a.x + a.width - b.width) ||
      b.y !== Math.max(a.y, a.y + a.height - b.height),
  );

  if (out.length > 0) {
    inWay.push({ home: win.home, windows: out });
  }

  await win.close().catch((e: unknown) => {
    inWay.push({ home: win.home, close: String(e) });
  });
};

/** Is there a process with this pid? Signal 0 asks, and sends nothing. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The pid the host wrote in its home, or none. */
const hostPid = async (on: string) => {
  const text = await readFile(join(on, "host", "pid"), "utf8").catch(() => "");
  const pid = Number.parseInt(text, 10);
  return Number.isInteger(pid) ? pid : null;
};

/**
 * The jobs in the host's one table, as kept in `<home>/storage/jobs` (host/run.ts), read from the
 * files and never opened: an open takes the table over from the host that runs on it
 * (@kampus/fabrika-old's host-jobs.ts), so its next write would fail. The table is the run `tsh`'s
 * machine `jobs`, under `table`, in two slots, the newer one whole (program/storage.ts). A file
 * that does not read fails the run, so a change to that layout is seen here.
 */
const keptJobs = async (on: string): Promise<readonly Shell.Job[]> => {
  const slots = await Promise.all(
    ["a", "b"].map((slot) =>
      readFile(join(on, "storage", "jobs", encodeURIComponent(`run/tsh/machine/jobs/table/${slot}`)), "utf8").then(
        (text): { opened: number; count: number; body: string } => JSON.parse(text),
        () => null,
      ),
    ),
  );
  const newest = slots
    .flatMap((slot) => (slot === null ? [] : [slot]))
    .sort((x, y) => y.opened - x.opened || y.count - x.count)[0];

  if (newest === undefined) {
    throw new Error(`no job table kept in ${on}`);
  }

  const table: Shell.Jobs = JSON.parse(newest.body);
  return table.jobs;
};

/** The pids whose command line names `what`, as pgrep finds them. */
const pgrep = (what: string) =>
  promisify(execFile)("pgrep", ["-f", what]).then(
    (r) => r.stdout.split("\n").filter((l) => l !== ""),
    (): string[] => [],
  );

/** Stop a process by its pid, as the test's own clean-up, and wait for it to be gone. */
const stop = async (pid: number) => {
  if (alive(pid)) {
    process.kill(pid, "SIGTERM");
  }

  await until(
    `pid ${pid} to stop`,
    async () => alive(pid),
    (up) => !up,
  );
};

/**
 * A host of another version: a Node server on the home's socket, in a 0700 folder as the host
 * keeps it, that says hello with version 0 to whoever connects.
 */
const oldHost = async (on: string) => {
  const dir = join(on, "host");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const sock = join(dir, "sock");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require("node:net").createServer((c) => c.write('{"type":"hello","version":0}\\n')).listen(process.argv[1])`,
      sock,
    ],
    { stdio: "ignore" },
  );
  await until(
    "the old host's socket",
    () =>
      stat(sock).then(
        (s) => s.isSocket(),
        () => false,
      ),
    (up) => up,
  );
  return child;
};

/** The app on a home whose host speaks version 0: it does not attach, says so, and stops nothing. */
const mismatch = async () => {
  const other = await mkdtemp(join(tmpdir(), "fabrika-old-"));
  const old = await oldHost(other);

  try {
    const win = await launch(other);
    const { app } = win;

    try {
      const page = await app.firstWindow();
      const said = await until(
        "the app to say it did not attach",
        () =>
          page
            .getByRole("alert")
            .textContent({ timeout: 2000 })
            .then(
              (t) => t ?? "",
              () => "",
            ),
        (t) => t.includes("Not attached"),
      );
      check(
        "a host of another version: the app does not attach, and says both versions",
        said.includes("version 0") && said.includes(`speaks ${PROTOCOL}`) && (await tiles(page)).length === 0,
        said,
      );
      await shot(page, "11-mismatch");
    } finally {
      await done(win);
    }

    check("the host of another version still runs: the app did not stop it", old.pid !== undefined && alive(old.pid));
  } finally {
    if (old.pid !== undefined) {
      await stop(old.pid);
    }
  }

  check("the old host stopped by its pid: pgrep finds nothing on its home", (await pgrep(other)).length === 0);
};

/**
 * A host that only talks about asks: a Node server on the home's socket, in this script, so a run
 * can hand the page one ask leaving as another arrives, in one line. A real host's read of the
 * ledger can do that, but nothing can make it do so on cue.
 */
const askingHost = async (on: string) => {
  const dir = join(on, "host");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const heard: { readonly type: string; readonly m?: { readonly type: string } }[] = [];
  const links: Socket[] = [];
  const server = createServer((link) => {
    links.push(link);
    let held = "";
    link.on("error", () => {});
    link.on("data", (chunk) => {
      const lines = `${held}${chunk}`.split("\n");
      held = lines.pop() ?? "";

      for (const line of lines) {
        const m = JSON.parse(line);

        if (m.type === "hello") {
          link.write(`${JSON.stringify({ type: "hello", version: PROTOCOL })}\n`);
        } else {
          heard.push(m);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(join(dir, "sock"), resolve));
  return {
    heard,
    toPage: (m: unknown) => {
      for (const link of links) {
        link.write(`${JSON.stringify({ type: "to", port: "desk", m })}\n`);
      }
    },
    stop: () => {
      for (const link of links) {
        link.destroy();
      }

      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

/**
 * The asks list stays open while one ask leaves as another arrives. The count holds, but the new
 * ask is seen, so the page says so, or the dot in the top bar stays on with the ask in plain view.
 */
const asksSwap = async () => {
  const other = await mkdtemp(join(tmpdir(), "fabrika-asks-"));
  const host = await askingHost(other);
  const asks = (key: string, what: string, seen: boolean) => ({
    type: "asks",
    now: {
      asks: [{ key, ticket: 7, title: "Swap", what, kind: "ask", at: 1, seen }],
      later: [],
      reach: "ok",
      why: null,
    },
  });
  const seen = async () => host.heard.filter((m) => m.type === "on" && m.m?.type === "seen").length;
  const win = await launch(other);
  const { app } = win;

  try {
    const page = await app.firstWindow();
    await until(
      "the page to load",
      async () => host.heard.some((m) => m.type === "page"),
      (up) => up,
    );
    host.toPage(asks("7/a-1", "first ask", false));
    host.toPage({ type: "show", what: "asks" });
    const list = page.locator("#pop-asks");
    await list.getByText("First ask").waitFor();
    await until("the first seen", seen, (n) => n === 1);
    check("opening the asks list says its asks are seen", true);

    host.toPage(asks("7/a-2", "second ask", false));
    await list.getByText("Second ask").waitFor();
    await until("a seen for the ask that took its place", seen, (n) => n === 2);
    check("one ask leaving as another arrives, the count the same, says seen again", true);

    // The host's answer to a seen: the same keys, now marked. Saying seen again would never end.
    host.toPage(asks("7/a-2", "second ask", true));
    await page.waitForTimeout(300);
    check("the same asks marked seen say nothing more", (await seen()) === 2, await seen());
  } finally {
    await done(win);
    await host.stop();
  }
};

/** Is `pid` a host of this build: its command line names this folder. Asked before any signal. */
const ours = (pid: number) =>
  promisify(execFile)("ps", ["-o", "command=", "-p", String(pid)]).then(
    (r) => r.stdout.includes(here),
    () => false,
  );

/** Kill a host this run started, as a crash does: SIGKILL, so it cleans nothing up. */
const crash = async (pid: number) => {
  check(`pid ${pid} is a host of this build, started by this run`, await ours(pid), pid);
  process.kill(pid, "SIGKILL");
  await until(
    `pid ${pid} to be gone`,
    async () => alive(pid),
    (up) => !up,
  );
};

/**
 * Cut main's socket to the host, as a link that breaks: the host runs on. It is main's one Unix
 * socket that is no stdio. Answers how many were cut.
 */
const cutLink = (app: ElectronApplication) =>
  app.evaluate(() => {
    interface Handle {
      readonly constructor: { readonly name: string };
      readonly _handle?: { readonly constructor: { readonly name: string }; readonly fd?: number };
      readonly destroy?: () => void;
    }
    const all = Reflect.get(process, "_getActiveHandles") as () => Handle[];
    const links = all
      .call(process)
      .filter(
        (h) => h.constructor.name === "Socket" && h._handle?.constructor.name === "Pipe" && (h._handle.fd ?? -1) > 2,
      );

    for (const link of links) {
      link.destroy?.();
    }

    return links.length;
  });

/**
 * Main's ways to interrupt a person, swapped for a list: a dialog, a bounce of the dock icon, the
 * app or its window brought forward. Read back, as the browser's swap is.
 */
const noInterrupts = (app: ElectronApplication) =>
  app.evaluate(({ app, dialog, BrowserWindow }) => {
    const asked: string[] = [];
    Object.assign(globalThis, { asked });
    const noted = (what: string) => () => {
      asked.push(what);
    };
    const box = noted("dialog");
    Object.assign(dialog, { showMessageBox: box, showMessageBoxSync: box, showErrorBox: box });

    if (app.dock !== undefined) {
      Object.assign(app.dock, { bounce: noted("bounce") });
    }

    Object.assign(app, { focus: noted("app focus") });

    for (const w of BrowserWindow.getAllWindows()) {
      Object.assign(w, {
        focus: noted("focus"),
        show: noted("show"),
        moveTop: noted("moveTop"),
        flashFrame: noted("flashFrame"),
      });
    }

    const now: unknown = dialog.showMessageBox;
    return now === box;
  });

/** What main was asked that would interrupt a person, in order. */
const interruptions = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { asked?: string[] }).asked ?? []);

/** Where the window says the link: the host's word in the top bar, a status. */
const LINK = '[role="status"][aria-label="the link to the host"]';
/**
 * What the host's item is named while the host is up. It shows an icon and no word, so the run
 * reads the item's name (its `aria-label`), which is its word when it has one.
 */
const UP = "host up";
/** The host's item: the first button of the link, before any Try again. */
const HOST = `${LINK} button`;

/**
 * From now on, note each change in what the window says of the link: a word may be up for a
 * moment only.
 */
const watchNotes = (page: Page) =>
  page.evaluate(
    ({ host, up }) => {
      const said: string[] = [up];
      Object.assign(globalThis, { said });
      new MutationObserver(() => {
        const name = document.querySelector(host)?.getAttribute("aria-label") ?? "";

        if (said.at(-1) !== name) {
          said.push(name);
        }
      }).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-label"],
      });
    },
    { host: HOST, up: UP },
  );

/** The words the window said of the link since `watchNotes`, in order, with no host up. */
const notesSaid = (page: Page) =>
  page.evaluate((up) => ((globalThis as { said?: string[] }).said ?? []).filter((t) => t !== up), UP);

/** What the window says of the link now, by the host item's name, or "" for none drawn. */
const noteNow = (page: Page) =>
  page
    .locator(HOST)
    .first()
    .getAttribute("aria-label", { timeout: 500 })
    .then(
      (t) => t ?? "",
      () => "",
    );

/**
 * A part that works says nothing: on a fresh home with nothing asking and no agent attached, the
 * top bar's right end is the host's quiet icon alone, with no word and no `·`. C-b A and C-b S
 * still open their lines, which say no agent is attached and that the ledger is this home's own.
 */
const quietAtRest = async (page: Page) => {
  const said = await until(
    "the top bar's right end quiet, the host up",
    async () =>
      [
        (await page.locator(".topbar .right").textContent()) ?? "",
        await noteNow(page),
        await page.locator(".topbar .right svg").count(),
      ] as const,
    ([text, name, icons]) => text.trim() === "" && name === UP && icons === 1,
  );
  check("at rest the top bar says nothing but the host's icon", true, said);
  const lines = async (key: string, label: string) => {
    await prefixed(page, key);
    const text = (await page.getByRole("dialog", { name: label }).textContent({ timeout: 2000 })) ?? "";
    await prefixed(page, key);
    await until(
      `${label} closed`,
      () => page.getByRole("dialog").count(),
      (n) => n === 0,
    );
    return text;
  };
  const agents = await lines("A", "The agents");
  check(
    "C-b A at zero opens lines: none attached, and how",
    agents.includes("No agent is attached") && agents.includes("fabrika mcp"),
    agents,
  );
  const sync = await lines("S", "The sync");
  check("C-b S on an own ledger opens lines: nothing to sync", sync.includes("Nothing to sync"), sync);
};

/** The host's few lines, opened from its word in the top bar, then closed again. */
const hostLines = async (page: Page) => {
  const host = page.locator(LINK).getByRole("button", { name: /^host / });
  await host.click();
  const lines = (await page.getByRole("dialog", { name: "The host" }).textContent({ timeout: 2000 })) ?? "";
  await host.click();
  return lines;
};

/** The tile that holds the page's focus, or none. */
const focusedIn = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest("[data-tile]")?.getAttribute("data-tile") ?? null);

/** The desk is back: the host's item is its quiet up icon with no word, and nothing is dimmed. */
const deskBack = (page: Page) =>
  until(
    "the desk back, the host up",
    async () =>
      [
        await noteNow(page),
        await page.locator(`${HOST} svg`).count(),
        (await page.locator(HOST).first().textContent()) ?? "",
        await page.locator(".desk.lost").count(),
      ] as const,
    ([name, icons, word, lost]) => name === UP && icons === 1 && word === "" && lost === 0,
  );

/**
 * The link to the host drops while the app runs, on a home of its own: the socket cut with the
 * host alive, the host killed, and no host to be had at all until a person presses Try again.
 */
const reconnect = async () => {
  const own = await mkdtemp(join(tmpdir(), "fabrika-link-"));
  const started = new Set<number>();
  const win = await launch(own);
  const { app } = win;

  try {
    const page = await app.firstWindow();
    await prompted(page, "t1");
    // Longer than the tile, so the screen has scrollback a second copy would show in.
    await run(page, "t1", "seq --to 60");
    const long = await shows(page, "t1", "seq's last line", (t) => t.endsWith("\n60\ntsh$"));
    await prefixed(page, "|");
    await tilesAre(page, ["t1", "t2"]);
    await prompted(page, "t2");
    await run(page, "t2", "counter");
    await countIn(page, "t2").waitFor();
    await tile(page, "t2").getByRole("button", { name: "+1" }).click();
    await countIn(page, "t2").filter({ hasText: /^1$/ }).waitFor();
    const host = await hostPid(own);
    check("a host started on this stage's own home", host !== null && (await ours(host)), host);

    if (host === null) {
      return;
    }

    started.add(host);
    await watchNotes(page);
    check("main's dialogs, dock bounce and focus are swapped for a list", await noInterrupts(app));

    check("main has one socket to the host, and it is cut", (await cutLink(app)) === 1);
    const said = await until(
      "the window to say it reconnects",
      () => notesSaid(page),
      (n) => n.length > 0,
    );
    await deskBack(page);
    check(
      "the socket cut: the top bar says calmly the host is down, and the desk comes back",
      said[0] === "host down",
      said,
    );
    check("on the same host: it was alive all along", (await hostPid(own)) === host);
    await countIn(page, "t2").filter({ hasText: /^1$/ }).waitFor();
    check(
      "counter in t2 is still at 1, and focus is back on it",
      (await focusedIn(page)) === "t2",
      await focusedIn(page),
    );
    await tile(page, "t2").getByRole("button", { name: "+1" }).click();
    await countIn(page, "t2").filter({ hasText: /^2$/ }).waitFor();
    // Counter answered on its new port, sent after t1's: t1's screen came again before it.
    const again = await screen(page, "t1");
    check("t1's screen is drawn once, scrollback and all, as it was", again === long, again);
    await tile(page, "t1").click();
    await focusIs(page, "t1");
    await run(page, "t1", "seq --to 2");
    await shows(page, "t1", "seq's 2", (t) => t.endsWith("\n1\n2\ntsh$"));
    check("the view and the terminal reach the host again", true);

    await crash(host);
    const next = await until(
      "a new host",
      () => hostPid(own),
      (p) => p !== null && p !== host,
    );

    if (next === null) {
      return;
    }

    started.add(next);
    await deskBack(page);
    await tilesAre(page, ["t1", "t2"]);
    // The old host's screen is still on the page until the new one's comes, in its place.
    await shows(page, "t1", "only a fresh prompt", (t) => t === "tsh$");
    check(
      "the host killed: the app starts one, and the kept desk comes back with fresh screens",
      await ours(next),
      next,
    );
    const kept = await shows(page, "t2", "the earlier job", (t) => t.includes("tsh: 1 job from"));
    check("t2's counter is a job of the earlier tsh, not running", true, kept);
    check("no dialog, no dock bounce, no focus taken", (await interruptions(app)).length === 0);

    // No host to be had: the home's host folder is a file, so no socket can be reached there.
    const folder = join(own, "host");
    await rename(folder, join(own, "host-killed"));
    await writeFile(folder, "");
    await crash(next);
    await until(
      "the window to say it reconnects",
      () => noteNow(page),
      (t) => t === "host down",
    );
    await page.waitForTimeout(1500);
    const dimmed = {
      lost: await page.locator(".desk.lost").count(),
      inert: await page.locator(".workspace[inert]").count(),
      status: await page.getByRole("status", { name: "the link to the host" }).count(),
      focused: await page.evaluate(() => document.activeElement?.closest("[data-tile]") !== null),
    };
    check(
      "no host: the desk stays, dimmed and out of reach, the top bar says host down, and focus is nowhere in it",
      dimmed.lost === 1 && dimmed.inert === 1 && dimmed.status === 1 && !dimmed.focused,
      dimmed,
    );
    const reaching = await hostLines(page);
    check("the host's lines say it is reconnecting", reaching.startsWith("Reconnecting to the host"), reaching);
    await shot(page, "12-reconnecting");

    // Five minutes on, by main's clock: the next try that fails is the last.
    await app.evaluate(() => {
      const real = Date.now;
      Object.assign(globalThis, { realNow: real });
      Date.now = () => real() + 6 * 60_000;
    });
    const button = page.locator(".topbar").getByRole("button", { name: "try again", exact: true });
    await until(
      "the app to stop trying",
      () => button.count(),
      (n) => n === 1,
    );
    const stopped = await hostLines(page);
    check(
      "five minutes on, it stops and offers try again in the top bar, which takes no focus",
      (await button.count()) === 1 &&
        !(await button.evaluate((b) => b === document.activeElement)) &&
        stopped.startsWith("Could not reconnect to the host") &&
        stopped.includes("five minutes"),
      stopped,
    );
    check("no dialog, no dock bounce, no focus taken", (await interruptions(app)).length === 0);
    await shot(page, "13-stopped");

    await app.evaluate(() => {
      Date.now = (globalThis as { realNow?: () => number }).realNow ?? Date.now;
    });
    await rm(folder);
    await button.click();
    const last = await until(
      "a host started by Try again",
      () => hostPid(own),
      (p) => p !== null && p !== next,
    );

    if (last !== null) {
      started.add(last);
    }

    await deskBack(page);
    await tilesAre(page, ["t1", "t2"]);
    await shows(page, "t1", "only a fresh prompt", (t) => t === "tsh$");
    check("the folder back, Try again starts a host, and the desk is back", last !== null && (await ours(last)), last);
    const still = await shows(page, "t2", "the earlier job", (t) => t.includes("tsh: 1 job from"));
    check("on the restored desk, only t2 is told of its counter: t1 never ran it", true, still);
  } finally {
    await done(win);

    for (const pid of started) {
      if (alive(pid) && (await ours(pid))) {
        await stop(pid);
      }
    }
  }
};

/**
 * The system's look, as a person sets it: Electron's nativeTheme, for the window's frame, and the
 * page's own, which Playwright holds and so sets apart.
 */
const lookIs = async (app: ElectronApplication, page: Page, look: "dark" | "light") => {
  await app.evaluate(({ nativeTheme }, to) => {
    nativeTheme.themeSource = to;
  }, look);
  await page.emulateMedia({ colorScheme: look });
  await until(
    `the ${look} look`,
    () => page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches),
    (light) => light === (look === "light"),
  );
  // Media change handlers remake terminals and restore focus on a timer (terminal.ts). Let
  // that frame and its timers finish before a capture moves focus to a different control.
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => setTimeout(done, 0));
      }),
  );
};

/** The tile a title bar's slot, name and state belong to, as the page draws them. */
const titleOf = (page: Page, id: string) =>
  tile(page, id)
    .locator(".titlebar")
    .evaluate((bar) => ({
      pipe: bar.parentElement?.getAttribute("data-pipe") ?? null,
      slot: bar.querySelector(".slot")?.textContent ?? "",
      name: bar.querySelector(".name")?.textContent ?? "",
    }));

/** A click on a tile's title bar: it focuses the tile and presses nothing in its body. */
const focusOn = async (page: Page, id: string) => {
  await tile(page, id).locator(".titlebar").click();
  await focusIs(page, id);
};

/** L3, today's version: real keys overlap a look change, with no timer drain or typing retry. */
const lookFocus = async () => {
  const own = await mkdtemp(join(tmpdir(), "fabrika-look-"));
  const win = await launch(own);
  const { app } = win;

  try {
    // No wider than CI's 1024-wide work area. At 1200, macOS moved the window 1px off the corner in
    // 1 of 2 runs of the same commit; every window inside the area landed on it. `promptLine`
    // joins a wrapped burst, so the narrower tiles change nothing the law reads.
    await win.size(1024, 600);
    const page = await app.firstWindow();
    await prompted(page, "t1");
    await lookIs(app, page, "dark");
    await prefixed(page, "|");
    await tilesAre(page, ["t1", "t2"]);
    await prompted(page, "t2");
    await focusOn(page, "t2");
    const burst = "focusstaysright".repeat(4);

    for (const look of ["light", "dark"] as const) {
      await prompted(page, "t1");
      await prompted(page, "t2");
      await app.evaluate(({ nativeTheme }, to) => {
        nativeTheme.themeSource = to;
      }, look);
      // lookIs waits for the bug to pass. Start real key events alongside the media change
      // instead; the short burst spans its focus timers and is never retried.
      await Promise.all([page.emulateMedia({ colorScheme: look }), page.keyboard.type(burst, { delay: 1 })]);
      const rows = await until(
        `L3: the burst echoed after switching to ${look}`,
        async () => {
          const [t1, t2] = [await screen(page, "t1"), await screen(page, "t2")];
          // The last rows ride along: a failure shows what was joined, so a wrap never reads as a
          // lost key.
          const tail = { t1: t1.split("\n").slice(-3), t2: t2.split("\n").slice(-3) };
          return { left: promptLine(t1), right: promptLine(t2), tail };
        },
        (seen) => seen.left !== "tsh$" || seen.right === `tsh$ ${burst}`,
      );
      check(`L3: the left prompt stays empty in ${look}`, rows.left === "tsh$", rows);
      check(`L3: the right prompt receives the whole burst in ${look}`, rows.right === `tsh$ ${burst}`, rows);
      check("L3: the desk still picks the right tile", (await focused(page)) === "t2");
      await page.keyboard.press("Control+u");
      await prompted(page, "t2");
    }
  } finally {
    await done(win);
    const pid = await hostPid(own);

    if (pid !== null) {
      await stop(pid);
    }
  }
};

/**
 * The stage's one ticket, picked in a tracker: the pick goes down the pipe, and the tracker shows
 * the ticket, not the repository's pull requests, which change from run to run.
 */
const pickIn = (tracker: Locator) => tracker.getByRole("button", { name: /Tiles, the look/ }).click();

/**
 * The tile guidelines' look (docs/direction/tile-guidelines.md), on a home of its own: one tile,
 * a pipe side by side, a pipe stacked with a strip lying under it, a 2x2 in every state, and a
 * 2x2 in a 1024 by 700 window with a pipe folded. Each picture is `<state>-<layout>-<look>.png`,
 * in `tiles/` under the screenshots' folder; the look is the system's, as nativeTheme sets it.
 *
 *   SHOTS=docs pnpm --filter @kampus/fabrika-app-old e2e -- --tiles    only this, into docs/tiles
 */
const tilesLook = async () => {
  const own = await mkdtemp(join(tmpdir(), "fabrika-tiles-"));
  const out = join(shots, "tiles");
  await mkdir(out, { recursive: true });
  const win = await launch(own);
  const { app } = win;

  try {
    const page = await app.firstWindow();
    await prompted(page, "t1");
    await lookIs(app, page, "dark");
    /** One picture, with the pointer off every tile unless `hovered` says it is on one. */
    const snap = async (name: string, hovered = false) => {
      if (!hovered) {
        await page.mouse.move(1, 1);
      }

      await page.waitForTimeout(250);
      const file = join(out, `${name}.png`);
      await page.screenshot({ path: file });
      saved.push(file);
    };
    /** The picture in the dark look, then in the light, and back to dark. */
    const both = async (name: string) => {
      await snap(`${name}-dark`);
      await lookIs(app, page, "light");
      await snap(`${name}-light`);
      await lookIs(app, page, "dark");
    };

    const plain = await titleOf(page, "t1");
    check(
      "a plain tile: no pipe, a dot in its slot, and its name, tsh",
      plain.pipe === null && plain.slot === "•" && plain.name === "tsh",
      plain,
    );
    await both("plain-focused-one");

    // A pipe of two, side by side: the tracker in t1, where it was typed, the ticket beside it.
    await run(page, "t1", "tracker | ticket");
    await tilesAre(page, ["t1", "t2"]);
    const tracker = tile(page, "t1").getByLabel("tracker view");
    await tracker.waitFor();
    await tracker.getByLabel("new ticket title").fill("Tiles, the look");
    await tracker.getByRole("button", { name: "File ticket" }).click();
    await pickIn(tracker);
    await tile(page, "t2").getByText("Tiles, the look").first().waitFor();
    await focusOn(page, "t1");
    const piped = [await titleOf(page, "t1"), await titleOf(page, "t2")];
    check(
      "a pipe of two: both tiles sky, with the letter A",
      piped.every((t) => t.pipe === "sky" && t.slot === "A"),
      piped,
    );
    await both("pipe-focused-side");

    // A 2x2: a tsh under each window of the pipe.
    await prefixed(page, "-");
    await tilesAre(page, ["t1", "t3", "t2"]);
    await prompted(page, "t3");
    await focusOn(page, "t2");
    await prefixed(page, "-");
    await tilesAre(page, ["t1", "t3", "t2", "t4"]);
    await prompted(page, "t4");
    await snap("plain-focused-2x2-dark");
    await focusOn(page, "t1");
    await snap("pipe-focused-2x2-dark");
    await lookIs(app, page, "light");
    await snap("pipe-focused-2x2-light");
    await lookIs(app, page, "dark");

    await prefixed(page, "z");
    await tilesAre(page, ["t1"]);
    check("a zoomed tile says so in its state slot", (await stateIn(page, "t1")) === "zoomed");
    await snap("zoomed-2x2-dark");
    await prefixed(page, "z");
    await tilesAre(page, ["t1", "t3", "t2", "t4"]);

    // Two strips lying: t3, plain, under t1; the ticket, in the pipe, over t4. The pointer on
    // the plain one, the keyboard's ring on the pipe's.
    await focusOn(page, "t3");
    await prefixed(page, "f");
    await focusOn(page, "t2");
    await prefixed(page, "f");
    await tilesAre(page, ["t1", "t4"]);
    await page.locator('[data-strip="t2"]').focus();
    await page.locator('[data-strip="t3"]').hover();
    await snap("strips-2x2-dark", true);
    await page.locator('[data-strip="t3"]').click();
    await page.locator('[data-strip="t2"]').click();
    await tilesAre(page, ["t1", "t3", "t2", "t4"]);

    await focusOn(page, "t1");
    await prefixed(page, "B");
    await snap("bars-hidden-2x2-dark");
    await prefixed(page, "B");
    await page.emulateMedia({ forcedColors: "active" });
    await snap("forced-colors-2x2-dark");
    await page.emulateMedia({ forcedColors: "none", contrast: "more" });
    await snap("more-contrast-2x2-dark");
    await page.emulateMedia({ contrast: "no-preference" });

    // Closing: a job that does not end on its inputs' end, then the close question beside it.
    await focusOn(page, "t3");
    await run(page, "t3", "sleep --ms 600000 &");
    await prompted(page, "t3");
    await prefixed(page, "x");
    await askedIs(page, "close t3? (y/n)");
    await page.keyboard.press("y");
    await until(
      "t3 closing",
      () => closingIn(page, "t3"),
      (n) => n === 1,
    );
    await snap("closing-2x2-dark");
    await focusOn(page, "t4");
    await prefixed(page, "x");
    await askedIs(page, "close t4? (y/n)");
    check("the close question is in the tile's state slot too", (await stateIn(page, "t4")) === "close t4? (y/n)");
    await snap("asking-2x2-dark");
    await page.keyboard.press("n");
    await noQuestion(page);

    // Stacked, in a workspace of its own: a pipe of three turned into a column, its last
    // window folded into a strip lying under the other two.
    await prefixed(page, "N");
    await tilesAre(page, ["t5"]);
    await prompted(page, "t5");
    await run(page, "t5", "tracker | ticket | trace");
    await tilesAre(page, ["t5", "t6", "t7"]);
    await pickIn(tile(page, "t5").getByLabel("tracker view"));
    await tile(page, "t6").getByText("Tiles, the look").first().waitFor();
    await prefixed(page, " ");
    await focusOn(page, "t7");
    await prefixed(page, "f");
    await tilesAre(page, ["t5", "t6"]);
    await focusOn(page, "t5");
    await both("pipe-focused-stacked");

    // The small window: a 2x2 with a pipe of three in one quarter, too narrow for three
    // windows, so two open folded; and four narrow tiles in another, one named `ticket #1`.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1024,
      height: 700,
      deviceScaleFactor: 0,
      mobile: false,
    });
    await until(
      "the window at 1024 by 700",
      () => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
      (size) => size === "1024x700",
    );
    await prefixed(page, "N");
    await tilesAre(page, ["t8"]);
    await prompted(page, "t8");
    await prefixed(page, "|");
    await prompted(page, "t9");
    await prefixed(page, "-");
    await prompted(page, "t10");
    await focusOn(page, "t8");
    await prefixed(page, "-");
    await prompted(page, "t11");
    // The ticket first, while its prompt is wide enough for the line; then its tile split
    // twice, to an eighth of the window.
    await focusOn(page, "t9");
    await run(page, "t9", "ticket --ticket 1");
    await tile(page, "t9").getByText("Tiles, the look").first().waitFor();

    for (const id of ["t12", "t13"]) {
      await focusOn(page, "t9");
      await prefixed(page, "|");
      await prompted(page, id);
    }

    await focusOn(page, "t8");
    await run(page, "t8", "tracker | ticket | trace");
    await pickIn(tile(page, "t8").getByLabel("tracker view"));
    const folds = await page.locator("[data-strip]").count();
    check("a pipe of three in a quarter of 1024 by 700: two windows open folded", folds === 2, folds);
    await both("pipe-folded-small");
  } finally {
    await done(win);
    const pid = await hostPid(own);

    if (pid !== null) {
      await stop(pid);
    }
  }
};

// Today's configurable keys. --keys runs only this stage. No screenshots are fabricated.
const keysLook = async () => {
  const out = join(shots, "keybindings");
  await mkdir(out, { recursive: true });

  for (const layout of ["one", "side", "stacked", "2x2", "small"] as const) {
    const own = await mkdtemp(join(tmpdir(), "fk-"));
    const file = join(own, "keybindings.toml");
    await writeFile(file, "tezgah.fold = []\n");
    const win = await launch(own);
    const { app } = win;

    try {
      const page = await app.firstWindow();
      await prompted(page, "t1");

      if (layout === "side" || layout === "2x2" || layout === "small") {
        await prefixed(page, "|");
        await prompted(page, "t2");
      }

      if (layout === "stacked") {
        await prefixed(page, "-");
        await prompted(page, "t2");
      }

      if (layout === "2x2" || layout === "small") {
        await prefixed(page, "-");
        await prompted(page, "t3");
        await focusOn(page, "t1");
        await prefixed(page, "-");
        await prompted(page, "t4");
      }

      if (layout === "small") {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: 1024,
          height: 700,
          deviceScaleFactor: 0,
          mobile: false,
        });
      }

      await focusOn(page, "t1");
      await app.evaluate(() => {
        // A dynamic import has no loader inside Playwright's evaluate: take the built-in as it is.
        const { EventEmitter } = process.getBuiltinModule("node:events");
        const emit = EventEmitter.prototype.emit;
        const sends: unknown[] = [];
        EventEmitter.prototype.emit = function (event: string | symbol, ...args: unknown[]) {
          const message = args[0];
          const data = typeof message === "object" && message !== null ? Reflect.get(message, "data") : null;

          if (
            event === "message" &&
            typeof data === "object" &&
            data !== null &&
            Reflect.get(data, "type") === "keys"
          ) {
            sends.push(data);
          }

          return Reflect.apply(emit, this, [event, ...args]);
        };
        Object.assign(globalThis, { keysTestBytes: sends });
      });
      await run(page, "t1", "counter");
      await until(
        "the terminal-byte observer hears real typing",
        () => app.evaluate(() => Reflect.get(globalThis, "keysTestBytes").length),
        (count) => count > 0,
      );
      const beforeTiles = await tiles(page);
      await page.evaluate(() => {
        window.addEventListener(
          "keydown",
          (event) => {
            if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) {
              return;
            }

            setTimeout(() => {
              document.documentElement.dataset.keyEnd = event.defaultPrevented ? "taken" : "free";
            });
          },
          { capture: true },
        );
      });
      const editor = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      const search = editor.getByRole("textbox", { name: /search/i });
      const choose = async (word: string) => {
        await search.fill(word);
        await editor
          .getByRole("option", { name: new RegExp(word, "i") })
          .first()
          .click();
      };
      const snap = async (state: string) => {
        for (const look of ["dark", "light"] as const) {
          await lookIs(app, page, look);
          check(`${state} fits ${layout}`, await editor.evaluate((el) => el.scrollWidth <= el.clientWidth));
          await page.mouse.move(1, 1);
          const path = join(out, `${state}-${layout}-${look}.png`);
          await page.screenshot({ path });
          saved.push(path);
        }
      };
      const close = async () => {
        await editor.getByRole("button", { name: /close keyboard shortcuts/i }).click();
        await editor.waitFor({ state: "hidden" });
      };
      const open = async () => {
        await prefixed(page, "?");
        await editor.waitFor();
      };
      // WCAG 2.4.3: the button pressed goes away, and focus goes to Change, never the page.
      const onChange = (what: string) =>
        until(
          what,
          () =>
            editor
              .getByRole("button", { name: "Change", exact: true })
              .evaluate((el) => el === document.activeElement)
              .catch(() => false),
          (focused) => focused,
        );
      await open();
      check("keys opens in the palette layer with no new tile", (await tiles(page)).join() === beforeTiles.join());
      check(
        "list shows unbound commands and source",
        (await editor.innerText()).match(/fold.*(?:unbound|no key)/is) !== null &&
          (await editor.innerText()).includes("default"),
      );
      check(
        "F6's fallback target, the desk, has a name",
        // The dialog hides the desk from the tree while it is open, so read the desk's own attributes.
        (await page.locator('.desk[role="group"][aria-label="the desk"]').count()) === 1,
      );
      check(
        "actions are outside listbox options",
        (await editor.getByRole("option").getByRole("button").count()) === 0,
      );
      await snap("list");
      await search.fill("ctrl+b z");
      check("K1: key search finds Zoom", (await editor.getByRole("option", { name: /zoom/i }).count()) === 1);
      await snap("search-key");
      await search.fill("no such shortcut");
      check("empty search is explained", /no .*found|no results/i.test(await editor.innerText()));
      await snap("search-key-empty");

      await choose("zoom");
      await editor.getByRole("button", { name: "Change", exact: true }).click();
      const bytesBefore = await app.evaluate(() => Reflect.get(globalThis, "keysTestBytes").length);
      await page.keyboard.press("Meta+k");
      check(
        "K3: recorded Cmd-K opens no command palette",
        (await page.getByRole("dialog", { name: "Commands", exact: true }).count()) === 0,
      );
      check(
        "recording reaches no terminal",
        (await app.evaluate(() => Reflect.get(globalThis, "keysTestBytes").length)) === bytesBefore,
      );
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await onChange("after Cancel focus is on Change");
      await editor.getByRole("button", { name: "Change", exact: true }).click();
      await page.keyboard.press("Control+b");
      check(
        "K4: recording shows the prefix and Cancel",
        /prefix|⌃B|C-b/i.test(await editor.innerText()) &&
          (await editor.getByRole("button", { name: "Cancel", exact: true }).isVisible()),
      );
      await snap("recording");
      check(
        "a recorded prefix sends no terminal bytes",
        (await app.evaluate(() => Reflect.get(globalThis, "keysTestBytes").length)) === bytesBefore,
      );
      await pressEnds(page, "Meta+q", "free");
      check("K16: system quit bypasses recording", await editor.isVisible());
      await page.keyboard.press("Control+c");
      await prompted(page, "t1");
      check(
        "Ctrl-C reaches the tile program and leaves the recorder armed",
        await editor.getByRole("button", { name: "Cancel", exact: true }).isVisible(),
      );
      const beforeCandidate = await app.evaluate(() => Reflect.get(globalThis, "keysTestBytes").length);
      await page.keyboard.press("m");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await until(
        "Zoom saved",
        () => readFile(file, "utf8"),
        (text) => text.includes("<prefix>m"),
      );
      check(
        "the recorded character sends no terminal bytes",
        (await app.evaluate(() => Reflect.get(globalThis, "keysTestBytes").length)) === beforeCandidate,
      );
      // The file is written before the editor hears the applied table back: wait for that.
      await until(
        "K18: saved editor has the new binding",
        () => editor.innerText(),
        (text) => /(?:C-b|⌃B)\s*then\s*M/i.test(text) && !/Saving/i.test(text),
      );
      await onChange("after Save focus is on Change");
      await snap("saved");
      await close();
      await page.keyboard.press("Control+b");
      await until(
        "prefix hints follow the saved key",
        () => page.locator(".bottomline").innerText(),
        (text) => /m.*zoom/i.test(text),
      );
      await page.keyboard.press("q");
      await open();
      await choose("zoom");
      await editor.getByRole("button", { name: "Change", exact: true }).click();
      await page.keyboard.press("Control+b");
      await page.keyboard.press("x");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await until(
        "K8: clash names loser and offers Undo",
        async () =>
          /close/i.test(await editor.innerText()) &&
          (await editor.getByRole("button", { name: "Undo", exact: true }).isVisible()),
        (ok) => ok,
      );
      await snap("clash");
      await editor.getByRole("button", { name: "Undo", exact: true }).click();
      await until(
        "Undo restored Zoom",
        () => readFile(file, "utf8"),
        (text) => text.includes("<prefix>m") && !text.includes("<prefix>x"),
      );
      await onChange("after Undo focus is on Change");
      await editor.getByRole("button", { name: "Unbind", exact: true }).click();
      await until(
        "Zoom unbound",
        () => editor.innerText(),
        (text) => /unbound|no key/i.test(text),
      );
      await snap("unbound");
      await close();
      await page.keyboard.press("Meta+k");
      const palette = page.getByRole("dialog", { name: "Commands", exact: true });
      // The palette's text box is a combobox (window/pop.tsx), not a plain textbox.
      await palette.getByRole("combobox").fill("zoom");
      check(
        "K17: unbinding keeps the palette command",
        (await palette.getByRole("option", { name: /zoom/i }).count()) === 1,
      );
      await page.keyboard.press("Escape");
      await run(page, "t1", "zoom");
      await prompted(page, "t1");
      // A lone tile does not zoom, as tmux's resize-pane -Z: only a layout of two or more says so.
      await until(
        "K17: tsh still executes unbound Zoom",
        () => stateIn(page, "t1"),
        (state) => state === (layout === "one" ? "" : "zoomed"),
      );
      await until(
        "focus follows the zoom into t1's terminal",
        () =>
          tile(page, "t1")
            .locator(".screen")
            .evaluate((el) => el.contains(document.activeElement)),
        (inside) => inside,
      );
      await run(page, "t1", "zoom");
      await prompted(page, "t1");

      await open();
      await choose("prefix");
      await editor.getByRole("button", { name: "Change", exact: true }).click();
      await page.keyboard.press("Control+a");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await until(
        "changed prefix",
        () => readFile(file, "utf8"),
        (text) => text.includes('prefix = "ctrl+a"'),
      );
      await snap("prefix");
      const good = await readFile(file, "utf8");
      await writeFile(file, `${good}\ntezgah.zom = "<prefix>u"\n`);
      await until(
        "file error line",
        () => editor.innerText(),
        (text) => /line \d+/i.test(text) && text.includes("tezgah.zom"),
      );
      await snap("file-error");
      await close();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("?");
      await editor.waitFor();
      check("bad file keeps last good prefix", await editor.isVisible());
      await writeFile(file, good);
      await until(
        "file error clears",
        () => editor.innerText(),
        (text) => !text.includes("tezgah.zom"),
      );
      await choose("zoom");
      await rename(file, join(own, "keys-backup.toml"));
      await mkdir(file);
      await editor.getByRole("button", { name: "Change", exact: true }).click();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("u");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await until(
        "save error",
        () => editor.innerText(),
        // The watcher may say the file cannot be read first: wait for the save's own answer.
        (text) => /Save failed/.test(text),
      );
      check("K11: failed save shows no success", !/saved successfully|Keys saved\./i.test(await editor.innerText()));
      check("a failed save shows no path from this machine", !(await editor.innerText()).includes(own));
      await snap("save-error");
      await rm(file, { recursive: true });
      await rename(join(own, "keys-backup.toml"), file);
      await search.fill("");
      // Open "Not ours", so the shot shows the system's keys and their reasons.
      await editor.locator("details.keys-system > summary").click();
      check(
        "Not ours lists the system's keys",
        await editor.locator("details.keys-system").evaluate((el) => (el as HTMLDetailsElement).open),
      );
      // Read once "Not ours" is open: a closed details element hides its text.
      check("reserved keys have plain reasons", /macOS owns|Quit the app/.test(await editor.innerText()));
      await snap("not-ours");
      // A new table puts an armed prefix down (desk/desk.ts, `swapped`), and the host hears a
      // save some time after it is written. So the file is written with the editor still open,
      // and no prefix is pressed before the editor shows the new table: the host steps the desk
      // first and sends the page its table after (host/serve.ts, `swap`).
      await writeFile(file, `${good}\npalette.open = "<prefix>p"\n`);
      await search.fill("palette.open");
      await until(
        "prefix palette binding applied",
        () => editor.innerText(),
        (text) => /(?:⌃A|C-a|ctrl\+a)\s*then\s*p/i.test(text),
      );
      await close();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("?");
      await editor.waitFor();
      await close();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("p");
      await page.getByRole("dialog", { name: "Commands", exact: true }).waitFor();
      check("K17: a prefix sequence opens the command palette", true);
      await page.keyboard.press("Escape");

      // K20: tsh starts a real editor run. Closing must end it, not merely hide its view.
      await prompted(page, "t1");
      await run(page, "t1", "keys");
      await editor.waitFor();
      const first = await until(
        "the keys job",
        // A slot read mid-write does not parse yet: read again.
        () => keptJobs(own).catch((): readonly Shell.Job[] => []),
        (jobs) => jobs.some((job) => job.text === "keys"),
      );
      const runId = first.find((job) => job.text === "keys")?.stages[0].run;
      await choose("zoom");
      await editor.getByRole("button", { name: "Change", exact: true }).click();
      await close();
      await until(
        "closed editor run ends",
        // A slot read mid-write does not parse yet: read again.
        () => keptJobs(own).catch((): readonly Shell.Job[] => []),
        (jobs) => jobs.every((job) => job.text !== "keys"),
      );
      await until(
        "K20: closing restores terminal focus",
        () =>
          tile(page, "t1")
            .locator(".screen")
            .evaluate((el) => el.contains(document.activeElement)),
        (inside) => inside,
      );
      await run(page, "t1", "keys");
      await editor.waitFor();
      const second = await until(
        "new keys job",
        // A slot read mid-write does not parse yet: read again.
        () => keptJobs(own).catch((): readonly Shell.Job[] => []),
        (jobs) => jobs.some((job) => job.text === "keys"),
      );
      check(
        "reopening creates a new run with no recorder",
        second.find((job) => job.text === "keys")?.stages[0].run !== runId &&
          (await editor.getByRole("button", { name: "Cancel", exact: true }).count()) === 0,
      );
      await close();
      // The keys run's end moves focus back to the tile it covered: wait for it, so it cannot
      // pull focus back from where F6 put it.
      await until(
        "the reopened keys run ends",
        () => keptJobs(own).catch((): readonly Shell.Job[] => []),
        (jobs) => jobs.every((job) => job.text !== "keys"),
      );
      await prompted(page, "t1");
      // K15 and K16: focus leaves a terminal using data-backed F6, and Ctrl-C still cancels its program.
      // From inside the terminal, F6 moves to the next region: the bar, as a browser's F6 does.
      await tile(page, "t1").locator(".screen").focus();
      await page.keyboard.press("F6");
      await until(
        "F6 provides a keyboard route out of the terminal, to a bar",
        () => page.evaluate(() => document.activeElement?.closest(".bottomline, .topbar") instanceof HTMLElement),
        (there) => there,
      );
      await page.keyboard.press("Shift+F6");
      await until(
        "Shift+F6 goes back into the terminal",
        () =>
          tile(page, "t1")
            .locator(".screen")
            .evaluate((el) => el.contains(document.activeElement)),
        (inside) => inside,
      );
      // F6 leaves what is open over the desk too: the palette closes as focus moves on. The
      // file now opens it on the prefix, then p.
      await page.keyboard.press("Control+a");
      await page.keyboard.press("p");
      const commands = page.getByRole("dialog", { name: "Commands", exact: true });
      await commands.waitFor();
      await page.keyboard.press("F6");
      await commands.waitFor({ state: "hidden" });
      check("F6 closes the palette as it moves focus", true);
      await focusOn(page, "t1");
      await tile(page, "t1").locator(".screen").focus();
      await run(page, "t1", "counter");
      // Ctrl-C before counter is up reaches only tsh's line: wait for counter first.
      await countIn(page, "t1").waitFor();
      await page.keyboard.press("Control+c");
      await prompted(page, "t1");
      await page.keyboard.type("recorder-is-closed");
      await shows(page, "t1", "ordinary typing after close", (text) => text.includes("recorder-is-closed"));
      await page.keyboard.press("Control+c");
    } finally {
      await done(win);
      const pid = await hostPid(own);

      if (pid !== null) {
        await stop(pid);
      }

      await rm(own, { recursive: true, force: true });
    }
  }
};

/**
 * A border dragged between two tiles side by side, on a home of its own: the tiles take the new
 * sizes while the pointer moves, as tmux's drag does, and the desk keeps them once it is let go.
 */
const borderDrag = async () => {
  const own = await mkdtemp(join(tmpdir(), "fk-"));
  const win = await launch(own);
  const { app } = win;

  try {
    const page = await app.firstWindow();
    await prompted(page, "t1");
    await prefixed(page, "|");
    await prompted(page, "t2");
    const width = () => page.locator('[data-cell="t1"]').evaluate((el) => el.getBoundingClientRect().width);
    const before = await width();
    const box = await page.locator("hr.border").first().boundingBox();

    if (box === null) {
      throw new Error("no border between t1 and t2");
    }

    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, y, { steps: 5 });
    const during = await width();
    check("a dragged border resizes t1 while it moves", during < before - 100, { before, during });
    await page.mouse.up();
    const kept = await until("the desk keeps the dragged sizes", width, (w) => Math.abs(w - during) < 20);
    check("let go, the desk keeps the dragged sizes", Math.abs(kept - during) < 20, kept);

    // Stacked: t1 split below, and the border between them dragged up, along the other axis.
    await focusOn(page, "t1");
    await prefixed(page, "-");
    await prompted(page, "t3");
    const height = () => page.locator('[data-cell="t1"]').evaluate((el) => el.getBoundingClientRect().height);
    const tall = await height();
    const across = await page.locator('hr.border[aria-orientation="horizontal"]').boundingBox();

    if (across === null) {
      throw new Error("no border between t1 and t3");
    }

    const x = across.x + across.width / 2;
    await page.mouse.move(x, across.y + across.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, across.y - 150, { steps: 5 });
    const short = await height();
    check("a stacked border resizes t1's height while it moves", short < tall - 80, { tall, short });
    await page.mouse.up();
  } finally {
    await done(win);
    const pid = await hostPid(own);

    if (pid !== null) {
      await stop(pid);
    }

    await rm(own, { recursive: true, force: true });
  }
};

/** The five layouts every look is checked at (AGENTS.md, "Shoot more than one layout"). */
const LAYOUTS = ["one", "side", "stacked", "2x2", "small"] as const;
type Layout = (typeof LAYOUTS)[number];

const addedTile = async (page: Page, before: readonly (string | null)[], total = before.length + 1) => {
  const now = await until(
    "a new tile",
    () => tiles(page),
    (t) => t.length === total && t.some((id) => !before.includes(id)),
  );
  const id = now.find((t) => t !== null && !before.includes(t));

  if (id === undefined || id === null) {
    throw new Error("no new tile");
  }

  return id;
};

const splitTile = async (page: Page, id: string, key: "|" | "-") => {
  await focusOn(page, id);
  const before = await tiles(page);
  await prefixed(page, key);
  const made = await addedTile(page, before);
  await prompted(page, made);
  return made;
};

/** Check both tile count and placement, including before a capture after a state changed. */
const layoutIs = async (page: Page, layout: Layout, ids: readonly string[]) => {
  await tilesAre(page, ids);
  const columns = layout === "side" || layout === "2x2" || layout === "small" ? 2 : 1;
  const rows = layout === "stacked" || layout === "2x2" || layout === "small" ? 2 : 1;
  await until(
    `${layout}: ${columns} columns, ${rows} rows, ${columns * rows} tiles`,
    () =>
      page.locator("[data-tile]").evaluateAll((all) =>
        all.map((el) => {
          const box = el.getBoundingClientRect();
          return { x: box.x, y: box.y };
        }),
      ),
    (boxes) =>
      boxes.length === columns * rows &&
      new Set(boxes.map((b) => b.x)).size === columns &&
      new Set(boxes.map((b) => b.y)).size === rows,
  );
};

/** Start with one tile, or a pipe's two windows, and build the promised layout around them. */
const arrange = async (page: Page, layout: Layout, first: string, second?: string) => {
  let ids = [first];

  if (layout !== "one") {
    const b = second ?? (await splitTile(page, first, layout === "stacked" ? "-" : "|"));

    if (second !== undefined && layout === "stacked") {
      await focusOn(page, first);
      await prefixed(page, " ");
    }

    ids =
      layout === "2x2" || layout === "small"
        ? [first, await splitTile(page, first, "-"), b, await splitTile(page, b, "-")]
        : [first, b];
  }

  await layoutIs(page, layout, ids);
  await focusOn(page, first);
  return ids;
};

/** Five fresh workspaces, shared by the screenshots and ARIA captures. Small comes last. */
const grid = async (page: Page, visit: (layout: Layout, ids: readonly string[]) => Promise<void>) => {
  for (const layout of LAYOUTS) {
    if (layout === "small") {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: 1024,
        height: 700,
        deviceScaleFactor: 0,
        mobile: false,
      });
      await until(
        "the window at 1024 by 700",
        () => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
        (size) => size === "1024x700",
      );
    }

    const before = await tiles(page);
    await prefixed(page, "N");
    const first = await addedTile(page, before, 1);
    await prompted(page, first);
    await visit(layout, await arrange(page, layout, first));
  }
};

/** The key states the ARIA stage reads, in the order it puts each layout through them. */
const STATES = ["plain", "asks-dot", "close-asked", "info", "palette", "strips", "closing", "pipe"] as const;
type State = (typeof STATES)[number];

/** The existing, made-up ticket #7 has a plan waiting on the person. No agent is started. */
const seedAsks = (own: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ledger = yield* Ledger;

      for (const entry of SEVEN) {
        const name = nameOf(entry.ticket);
        const writer = writerText(entry.by);
        yield* ledger.register(name, writer);
        yield* ledger.send(streams(name).inbox, `focus-${entry.pos}`, {
          kind: kindOf(entry.fact.type),
          writer,
          data: entry.fact,
        });
      }
    }).pipe(Effect.provide(layerSqliteSync({ path: join(own, "ledger.sqlite") }))),
  );

const FOCUS = {
  "tile-focused": "apps/fabrika/docs/focus",
  "tracker-ring-input": "programs/tracker/docs/focus",
  "tracker-ring-row": "programs/tracker/docs/focus",
  "tracker-ring-composer": "programs/tracker/docs/focus",
  "asks-dot": "apps/fabrika/docs/focus",
  "map-you": "programs/map/docs/focus",
} as const;

const LOOKS = ["dark", "light"] as const;

/** T245 A and B, today's tracker: actual keyboard focus, with the built app's CSS cascade. */
const trackerFocus = async () => {
  const own = await mkdtemp(join(tmpdir(), "fh-ring-"));
  await seedAsks(own);
  const win = await launch(own);
  const { app } = win;

  try {
    const page = await app.firstWindow();
    await prompted(page, "t1");
    await run(page, "t1", "tracker");
    const tracker = tile(page, "t1").getByLabel("tracker view");
    await tracker.waitFor();
    await tracker.getByLabel("new ticket title").fill("Focus check");
    const failures: string[] = [];
    const record = (law: string, ok: boolean, seen: unknown) => {
      if (ok) {
        check(law, true);
      } else {
        failures.push(`${law}: ${JSON.stringify(seen)}`);
      }
    };
    const ring = async (target: Locator) => {
      await target.press("ArrowRight");
      await until(
        "keyboard focus on the tracker control",
        () =>
          target.evaluate((el) => document.hasFocus() && el === document.activeElement && el.matches(":focus-visible")),
        (on) => on,
      );
      return target.evaluate((el) => {
        const forced = matchMedia("(forced-colors: active)").matches;
        const probe = document.createElement("span");
        probe.style.position = "fixed";
        probe.style.visibility = "hidden";
        probe.style.outline = `2px solid ${forced ? "Highlight" : "var(--focus)"}`;
        el.parentElement?.append(probe);
        const expected = getComputedStyle(probe).outlineColor;
        probe.remove();
        const style = getComputedStyle(el);
        const outline =
          style.outlineStyle === "solid" && style.outlineWidth === "2px" && style.outlineColor === expected;
        const shadow = style.boxShadow.split(/,(?![^()]*\))/).some((layer) => {
          const lengths = layer.match(/-?\d+(?:\.\d+)?px/g)?.map(Number.parseFloat);
          return (
            lengths?.length === 4 &&
            lengths[0] === 0 &&
            lengths[1] === 0 &&
            lengths[2] === 0 &&
            lengths[3] === 2 &&
            layer.includes(expected)
          );
        });
        return {
          forced,
          outline,
          shadow,
          expected,
          width: style.outlineWidth,
          style: style.outlineStyle,
          color: style.outlineColor,
          boxShadow: style.boxShadow,
        };
      });
    };

    for (const look of LOOKS) {
      await lookIs(app, page, look);
      await page.emulateMedia({ forcedColors: "none" });

      for (const name of ["search titles", "new ticket title", "new ticket body"]) {
        const seen = await ring(tracker.getByLabel(name));
        record(`T245 A: ${name}, ${look}, draws a 2px --focus outline`, seen.outline, seen);
      }

      const row = tracker.locator(".tracker-list button").filter({ hasText: SEVEN_TITLE });
      const normal = await ring(row);
      record(`T245 B: the row, ${look}, draws a full --focus ring`, normal.outline || normal.shadow, normal);
      await page.emulateMedia({ forcedColors: "active" });
      const forced = await ring(row);
      record(`T245 B: the row, ${look}, keeps a full ring in forced colors`, forced.forced && forced.outline, forced);
    }

    check("T245 tracker focus laws", failures.length === 0, failures);
  } finally {
    await done(win);
    const pid = await hostPid(own);

    if (pid !== null) {
      await stop(pid);
    }
  }
};

/** All 60 planned images per build, under SHOTS with the plan's repo-relative folders. */
const focusShots = async () => {
  const own = await mkdtemp(join(tmpdir(), "fh-focus-"));
  await seedAsks(own);
  const pending = new Set(
    Object.keys(FOCUS).flatMap((state) =>
      LAYOUTS.flatMap((layout) => LOOKS.map((look) => `${state}-${layout}-${look}`)),
    ),
  );
  const planned = pending.size;
  const win = await launch(own);
  const { app } = win;

  try {
    const page = await app.firstWindow();
    await prompted(page, "t1");
    await win.size(1440, 900);
    await until(
      "the window at 1440 by 900",
      () => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
      (size) => size === "1440x900",
    );
    const ringOn = async (target: Locator) => {
      // A key on the target establishes keyboard focus without Tab moving to another control.
      await target.press("ArrowRight");
      await until(
        "the keyboard focus ring",
        () =>
          target.evaluate((el) => ({
            pageFocused: document.hasFocus(),
            focused: el === document.activeElement,
            visible: el.matches(":focus-visible"),
            active: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName,
            activeTile: document.activeElement?.closest("[data-tile]")?.getAttribute("data-tile"),
          })),
        (on) => on.pageFocused && on.focused && on.visible,
      );
    };
    await grid(page, async (layout, ids) => {
      const first = ids[0] ?? "";
      const both = async (state: keyof typeof FOCUS, prepare: () => Promise<unknown>) => {
        const folder = join(shots, FOCUS[state]);
        await mkdir(folder, { recursive: true });

        for (const look of LOOKS) {
          await lookIs(app, page, look);
          await prepare();
          await layoutIs(page, layout, ids);
          await page.mouse.move(1, 1);
          await page.waitForTimeout(250);
          const name = `${state}-${layout}-${look}`;
          const file = join(folder, `${name}.png`);
          await page.screenshot({ path: file });
          check(`one planned image: ${name}`, pending.delete(name));
          saved.push(file);
        }

        await lookIs(app, page, "dark");
      };
      await both("tile-focused", () => focusOn(page, first));
      await both("asks-dot", () => page.locator(".udot").waitFor({ state: "visible" }));
      await run(page, first, "tracker");
      const tracker = tile(page, first).getByLabel("tracker view");
      await tracker.waitFor();
      await both("tracker-ring-input", () => ringOn(tracker.getByLabel("search titles")));
      await both("tracker-ring-row", () =>
        ringOn(tracker.locator(".tracker-list button").filter({ hasText: SEVEN_TITLE })),
      );
      await both("tracker-ring-composer", () => ringOn(tracker.getByLabel("new ticket title")));
      await focusOn(page, first);
      await page.keyboard.press("Control+c");
      await prompted(page, first);
      await until(
        "tracker closed",
        () => tracker.count(),
        (n) => n === 0,
      );
      await run(page, first, "map --ticket 7");
      await both("map-you", () => tile(page, first).locator(".mapbar .dot.you").waitFor({ state: "visible" }));
    });
    check("every planned focus image was taken", pending.size === 0, [...pending]);
    console.log(`focus: ${planned} planned images taken; ${planned * 2} across before and after`);
  } finally {
    await done(win);
    const pid = await hostPid(own);

    if (pid !== null) {
      await stop(pid);
    }
  }
};

/** Where the approved trees are kept: `<state>-<layout>.aria.yml`. */
const ARIA = join(here, "aria");

/**
 * A tree as text with what changes from run to run taken out: the stage's home is `<home>`, a pid
 * is `<pid>`, a clock time or a job's age (`3s`, `1m`) is `<time>`, and a job's run id
 * (`sleep:8c6246d7`) is `sleep:<id>`. Anything else that moves is a real change, or noise
 * the ratings will find.
 */
const scrubbed = (tree: string, own: string, pids: readonly number[]) => {
  let out = tree.replaceAll(own, "<home>").replaceAll(join("/private", own), "<home>");

  for (const pid of pids) {
    out = out.replace(new RegExp(`\\b${String(pid)}\\b`, "g"), "<pid>");
  }

  return out
    .replace(/\bpid( ?)\d+\b/gi, "pid$1<pid>")
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?\b/g, "<time>")
    .replace(/\b\d+(ms|s|m|h|d)\b/g, "<time>")
    .replace(/\b([a-z]+):[0-9a-f]{8}\b/g, "$1:<id>");
};

/** A line diff of two trees, as `-` and `+` lines with a little context: the longest common run. */
const linesDiff = (was: string, now: string) => {
  const a = was.split("\n");
  const b = now.split("\n");
  const lcs = a.map(() => b.map(() => 0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] ?? [];
      row[j] = a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(`  ${a[i] ?? ""}`);
      i += 1;
      j += 1;
    } else if (j < b.length && (i >= a.length || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      out.push(`+ ${b[j] ?? ""}`);
      j += 1;
    } else {
      out.push(`- ${a[i] ?? ""}`);
      i += 1;
    }
  }

  // Context: three lines either side of a change, as a unified diff keeps.
  const near = new Set<number>();
  out.forEach((line, n) => {
    if (!line.startsWith("  ")) {
      for (let k = n - 3; k <= n + 3; k += 1) {
        near.add(k);
      }
    }
  });
  return out.filter((_, n) => near.has(n)).join("\n");
};

/**
 * The ARIA stage (design language call 8, decided 2026-11-07: advising first), on a home of its
 * own: each key state at each of the five layouts, in the dark look only, since the tree is the
 * same in both. Each cell is read twice, a second apart; two reads that differ are a flake. Each
 * is compared as text with `aria/<state>-<layout>.aria.yml`, a diff printed per cell and a total,
 * and the trees it read are written to `aria-received/` under the screenshots' folder. One tile
 * shows a folded neighbor for strips and a zoomed ticket for a pipe. Every planned cell must be
 * recorded. It answers 2 only when it cannot reach a state; tree diffs only advise.
 *
 *   pnpm --filter @kampus/fabrika-app-old e2e -- --aria    only this
 */
const ariaStage = async (): Promise<0 | 2> => {
  const own = await mkdtemp(join(tmpdir(), "fh-aria-"));
  const out = join(shots, "aria-received");
  await mkdir(out, { recursive: true });
  await seedAsks(own);
  const win = await launch(own);
  const { app } = win;
  const tally = { same: 0, diff: 0, fresh: 0, flake: 0 };
  const pending = new Set(STATES.flatMap((state) => LAYOUTS.map((layout) => `${state}-${layout}`)));
  const planned = pending.size;
  let reached: 0 | 2 = 0;

  try {
    const page = await app.firstWindow();
    await prompted(page, "t1");
    await lookIs(app, page, "dark");
    // The window opens at the size it last had, which a person's own use sets: a wider or narrower
    // window lays a view out another way (the ticket's properties beside or under it), so the
    // stage sets its own.
    await win.size(1440, 900);
    await until(
      "the window at 1440 by 900",
      () => page.evaluate(() => [window.innerWidth, window.innerHeight].join("x")),
      (size) => size === "1440x900",
    );
    const read = async () => {
      await page.mouse.move(1, 1);
      const pid = await hostPid(own);
      const tree = await page.locator("body").ariaSnapshot();
      return scrubbed(tree, own, pid === null ? [] : [pid]);
    };
    const cell = async (state: State, layout: Layout, ids: readonly string[]) => {
      const name = `${state}-${layout}`;

      if (state === "strips") {
        await tilesAre(page, ids);
      } else {
        await layoutIs(page, layout, ids);
      }

      await page.waitForTimeout(250);
      const first = await read();
      await page.waitForTimeout(1100);
      const second = await read();

      if (first !== second) {
        tally.flake += 1;
        console.log(`flake  ${name}: two reads differ\n${linesDiff(first, second)}`);
      }

      await writeFile(join(out, `${name}.aria.yml`), `${second}\n`);
      check(`one planned ARIA tree: ${name}`, pending.delete(name));
      const approved = await readFile(join(ARIA, `${name}.aria.yml`), "utf8").catch(() => null);

      if (approved === null) {
        tally.fresh += 1;
        console.log(`new    ${name}: no approved tree yet`);
      } else if (approved === `${second}\n`) {
        tally.same += 1;
        console.log(`same   ${name}`);
      } else {
        tally.diff += 1;
        console.log(`diff   ${name}\n${linesDiff(approved.replace(/\n$/, ""), second)}`);
      }
    };
    await grid(page, async (layout, ids) => {
      const [first = "", ...rest] = ids;
      const last = rest.at(-1) ?? first;

      for (const state of STATES) {
        try {
          if (state === "plain") {
            await cell(state, layout, ids);
          }

          if (state === "asks-dot") {
            await page.locator(".udot").waitFor({ state: "visible" });
            await cell(state, layout, ids);
          }

          if (state === "close-asked") {
            await focusOn(page, first);
            await prefixed(page, "x");
            await askedIs(page, `close ${first}? (y/n)`);
            await cell(state, layout, ids);
            await page.keyboard.press("n");
            await noQuestion(page);
          }

          if (state === "info") {
            await focusOn(page, first);
            await prefixed(page, "i");
            await until(
              "info mode on",
              () => infoItem(page).getAttribute("aria-pressed"),
              (on) => on === "true",
            );
            await cell(state, layout, ids);
            await page.keyboard.press("Escape");
            await until(
              "info mode off",
              () => infoItem(page).getAttribute("aria-pressed"),
              (on) => on === "false",
            );
          }

          if (state === "palette") {
            await focusOn(page, first);
            await page.keyboard.press("Meta+k");
            await page.getByRole("dialog", { name: "Commands" }).waitFor();
            await cell(state, layout, ids);
            await page.keyboard.press("Escape");
            await gone(page, "pop-palette");
          }

          if (state === "strips") {
            const folded = rest.length === 0 ? await splitTile(page, first, "|") : first;
            await focusOn(page, folded);
            await prefixed(page, "f");
            const strip = page.locator(`[data-strip="${folded}"]`);
            await strip.waitFor();
            await cell(state, layout, rest.length === 0 ? ids : rest);
            await strip.click();

            if (rest.length === 0) {
              await tilesAre(page, [first, folded]);
              await focusOn(page, folded);
              await prefixed(page, "x");
              await askedIs(page, `close ${folded}? (y/n)`);
              await page.keyboard.press("y");
            }

            await tilesAre(page, ids);
          }

          if (state === "pipe") {
            // Closing can remove the workspace's last tile. Start the pipe on a fresh one.
            const before = await tiles(page);
            await prefixed(page, "N");
            const source = await addedTile(page, before, 1);
            await prompted(page, source);
            await run(page, source, "tracker | ticket");
            const ticket = await addedTile(page, [source]);
            let pipeIds = [source, ticket];

            if (layout !== "one") {
              pipeIds = await arrange(page, layout, source, ticket);
            }

            const tracker = tile(page, source).getByLabel("tracker view");
            await tracker.waitFor();
            await tracker.locator(".tracker-list button").filter({ hasText: SEVEN_TITLE }).click();
            // The ticket renders backticks as code type, so its heading has no backticks.
            await tile(page, ticket)
              .getByRole("heading", {
                level: 1,
                name: "fabrika post prints the ticket number twice",
                exact: true,
              })
              .waitFor();

            if (layout === "one") {
              await focusOn(page, ticket);
              await prefixed(page, "z");
              pipeIds = [ticket];
            }

            await cell(state, layout, pipeIds);
          }

          if (state === "closing") {
            await focusOn(page, last);
            await run(page, last, "sleep --ms 600000 &");
            await prompted(page, last);
            await prefixed(page, "x");
            await askedIs(page, `close ${last}? (y/n)`);
            await page.keyboard.press("y");
            await until(
              `${last} closing`,
              () => closingIn(page, last),
              (n) => n === 1,
            );
            await cell(state, layout, ids);
            await prefixed(page, "x");
            await askedIs(page, `stop ${last} now? (y/n)`);
            await page.keyboard.press("y");
            await until(
              `${last} stopped`,
              () => tile(page, last).count(),
              (n) => n === 0,
            );
          }
        } catch (e) {
          reached = 2;
          console.log(`cannot reach ${state}-${layout}: ${e instanceof Error ? e.message : String(e)}`);
          throw e;
        }
      }
    });
    check("every planned ARIA tree was recorded", pending.size === 0, [...pending]);
  } catch (e) {
    reached = 2;
    console.log(`the ARIA stage stopped: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await done(win);
    const pid = await hostPid(own);

    if (pid !== null) {
      await stop(pid);
    }
  }

  console.log(
    `aria: ${planned - pending.size}/${planned} planned, ${String(tally.same)} same, ` +
      `${String(tally.diff)} differ, ${String(tally.fresh)} new, ${String(tally.flake)} flaky; trees in ${out}`,
  );
  return reached;
};

const all = async () => {
  const first = await launch(home);
  let left = "";

  try {
    try {
      left = await flow(first.app);
      await reopen(first.app, left);
    } finally {
      // With counter up, at 1: `close` asks Electron's `app.quit()`, as Cmd-Q does.
      await done(first);
    }

    const pid = await hostPid(home);
    check("the app quit, and the host it started runs on", pid !== null && alive(pid), pid);
    const kept = (await keptJobs(home)).map((job) => [job.n, job.text, job.owner]);
    check(
      "the host's one job table keeps one job, the counter of the tile left, and no closed tile's",
      kept.length === 1 && kept[0]?.[1] === "counter" && kept[0]?.[2] === left,
      kept,
    );
    const desk = await readFile(join(home, "desk.json"), "utf8").catch(() => "");
    check("the host kept the desk in the home", desk.includes(`"${left}"`), desk);
    const history = await readFile(join(home, "history"), "utf8").catch(() => "");
    check("the host kept the history in the home", history.endsWith("counter\n"), history);

    const next = await launch(home);

    try {
      await again(next.app, left);
    } finally {
      await done(next);
    }

    check("then the app quits, and the same host runs on", (await hostPid(home)) === pid && pid !== null && alive(pid));

    await mismatch();
    await asksSwap();
    await reconnect();
    await lookFocus();
    await tilesLook();
    await borderDrag();
    await keysLook();
    await trackerFocus();
    await askDesk({
      launch: askDeskLaunch,
      prompted,
      run,
      prefixed,
      focusOn,
      tilesAre,
      lookIs,
      hostPid,
      stop,
      shots,
    });
    // The 60 focus images need a 1440 by 900 window, taller than a CI runner's screen, so they
    // run only with --focus, the way the ARIA trees run only with --aria.
  } finally {
    // No person stops the host: there is no command for it. The run stops its own, by its pid.
    const pid = await hostPid(home);

    if (pid !== null) {
      await stop(pid);
    }
  }
};

// Each capture stage can also run alone. ARIA answers 2 only when it cannot reach a state.
if (process.argv.includes("--ask-desk")) {
  await askDesk({ launch: askDeskLaunch, prompted, run, prefixed, focusOn, tilesAre, lookIs, hostPid, stop, shots });
} else if (process.argv.includes("--keys")) {
  await keysLook();
} else if (process.argv.includes("--drag")) {
  await borderDrag();
} else if (process.argv.includes("--tiles")) {
  await tilesLook();
} else if (process.argv.includes("--aria")) {
  process.exitCode = await ariaStage();
} else if (process.argv.includes("--focus")) {
  await focusShots();
} else if (process.argv.includes("--tracker-focus")) {
  await trackerFocus();
} else {
  await all();
}

check(
  "every launch stayed out of the way: each window ended at opacity 0 in the corner, and none took OS focus",
  inWay.length === 0,
  inWay,
);

const after = await pgrep(here);
check("the host stopped by its pid: pgrep finds nothing of this app left", after.length === 0, after);

const sock = await stat(join(home, "host", "sock")).then(
  () => true,
  () => false,
);

check("the host took its socket away as it stopped", !sock);
console.log(`screenshots:\n${saved.map((s) => `  ${s}`).join("\n")}`);
