import { fabrika, fabrikaLight, terminalTheme } from "@kampus/fabrika-design";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A terminal follows the system's look while it is open (tracker ticket 144). The window's
// stylesheet follows it with light-dark(); a terminal draws on a canvas, so it must be told.
//
// ghostty-web is faked here as 0.4.0 behaves: a terminal draws in the theme it was made with, and
// a theme set on its options after open() is not drawn ("theme changes after open() are not yet
// fully supported", its handleOptionChange). So, until a palette call lands upstream, a look change
// means a terminal made again in the new theme, with what it showed written to it again, as
// docs/direction/themes.md (live switching) says. If a pnpm patch to ghostty-web makes a live change
// real, this fake changes with it.

class FakeTerminal {
  static made: FakeTerminal[] = [];
  /** The theme this terminal draws in: the one it was made with. */
  readonly drawn: unknown;
  readonly options: Record<string, unknown>;
  readonly written: string[] = [];
  opened = false;
  disposed = false;
  cols = 80;
  rows = 24;
  readonly buffer = { active: { length: 0, cursorY: 0, getLine: () => undefined } };
  /** Re-focus timeouts still waiting, cleared after each test so none lands in the next. */
  static timers: ReturnType<typeof setTimeout>[] = [];
  /** ghostty-web's hidden textarea, where keys are typed. */
  readonly textarea = {};
  /** The element it was opened in: what its focus() focuses. */
  element: object | undefined;
  /** Who hears its keys and its new sizes. */
  readonly keys: ((data: string) => void)[] = [];
  readonly sizes: ((size: { cols: number; rows: number }) => void)[] = [];

  constructor(options: Record<string, unknown>) {
    this.options = { ...options };
    this.drawn = options["theme"];
    FakeTerminal.made.push(this);
  }

  loadAddon() {}

  /** As 0.4.0's open(): it ends by focusing itself. */
  open(parent: object) {
    this.opened = true;
    this.element = parent;
    this.focus();
  }

  onData(fn: (data: string) => void) {
    this.keys.push(fn);
    return { dispose: () => {} };
  }

  onResize(fn: (size: { cols: number; rows: number }) => void) {
    this.sizes.push(fn);
    return { dispose: () => {} };
  }

  write(data: string, done?: () => void) {
    this.written.push(data);
    done?.();
  }

  reset() {
    this.written.length = 0;
  }

  clear() {}
  refresh() {}
  resize() {}
  scrollToBottom() {}

  /** As 0.4.0's focus(): once open, its element now, and again after a zero timeout. */
  focus() {
    const at = this.element;

    if (!this.opened || at === undefined) {
      return;
    }

    page.activeElement = at;
    FakeTerminal.timers.push(
      setTimeout(() => {
        page.activeElement = at;
      }, 0),
    );
  }

  dispose() {
    this.disposed = true;
  }
}

class FakeFit {
  activate() {}
  fit() {}
  observeResize() {}
  dispose() {}
}

vi.mock("ghostty-web", () => ({ Terminal: FakeTerminal, FitAddon: FakeFit, Ghostty: class {} }));
vi.mock("ghostty-web/ghostty-vt.wasm", () => ({ default: new Uint8Array() }));

/** Just enough of an element for terminal.ts to build and move its own. */
const element = (tag = "div"): Record<string, unknown> => {
  const el: Record<string, unknown> = {
    tag,
    attrs: {} as Record<string, string>,
    className: "",
    textContent: "",
    style: {},
    parentElement: null,
    children: [] as unknown[],
    setAttribute: (name: string, value: string) => {
      (el["attrs"] as Record<string, string>)[name] = value;
    },
    append: (...kids: Record<string, unknown>[]) => {
      for (const kid of kids) {
        kid["parentElement"] = el;
        (el["children"] as unknown[]).push(kid);
      }
    },
    remove: () => {
      el["parentElement"] = null;
    },
    focus: () => {
      page.activeElement = el;
    },
  };
  let text = "";
  Object.defineProperty(el, "textContent", {
    get: () => text,
    set: (value: string) => {
      text = value;
      page.writes.push({ element: el, text: value });
    },
  });
  page.made.push(el);
  return el;
};

/** The page: what it makes, and which element has focus. */
const page: {
  createElement: typeof element;
  activeElement: unknown;
  made: Record<string, unknown>[];
  writes: { element: Record<string, unknown>; text: string }[];
} = {
  createElement: element,
  activeElement: undefined,
  made: [],
  writes: [],
};

type Heard = (e: { matches: boolean }) => void;

/**
 * The system's look, and every query list made on it, as a browser's matchMedia gives them. A list
 * keeps its listeners by event name, as an EventTarget does, and only "change" is fired, so a
 * listener added or removed under another name is never heard or never goes.
 */
let look: "dark" | "light" = "dark";
const lists: { query: string; heard: Map<string, Heard[]>; list: object }[] = [];

const matches = (query: string) =>
  query.includes("light") ? look === "light" : query.includes("dark") ? look === "dark" : false;

const matchMedia = (query: string) => {
  const heard = new Map<string, Heard[]>();
  const add = (name: string, fn: Heard) => heard.set(name, [...(heard.get(name) ?? []), fn]);
  const remove = (name: string, fn: Heard) =>
    heard.set(
      name,
      (heard.get(name) ?? []).filter((f) => f !== fn),
    );
  const list = {
    media: query,
    get matches() {
      return matches(query);
    },
    onchange: null as Heard | null,
    addEventListener: add,
    removeEventListener: remove,
    addListener: (fn: Heard) => add("change", fn),
    removeListener: (fn: Heard) => remove("change", fn),
  };
  lists.push({ query, heard, list });
  return list;
};

const switchTo = (next: "dark" | "light") => {
  look = next;

  for (const { query, heard, list } of lists) {
    const event = { matches: matches(query), media: query };

    for (const fn of [...(heard.get("change") ?? [])]) {
      fn(event);
    }

    (list as { onchange: Heard | null }).onchange?.(event);
  }
};

/** What the tile's port heard, so a test can send it bytes, and what it was sent. */
let toTile: ((raw: unknown) => void) | undefined;
let sent: { port: string; msg: unknown }[] = [];

beforeEach(() => {
  look = "dark";
  lists.length = 0;
  FakeTerminal.made = [];
  toTile = undefined;
  sent = [];
  page.activeElement = undefined;
  page.made = [];
  page.writes = [];
  vi.stubGlobal("document", page);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
  vi.stubGlobal("window", {
    matchMedia,
    fabrika: {
      send: (port: string, msg: unknown) => {
        sent.push({ port, msg });
      },
      forget: () => {},
      onMessage: (_: string, fn: (raw: unknown) => void) => {
        toTile = fn;
      },
    },
  });
});

afterEach(() => {
  for (const timer of FakeTerminal.timers) {
    clearTimeout(timer);
  }

  FakeTerminal.timers = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** After the timeouts already queued, ghostty-web's re-focus among them. */
const settled = () => new Promise((done) => setTimeout(done, 0));

/** A tile's terminal, open in its slot, that has been sent `writes` (by default, `hello`). */
const openTerminal = async (writes: readonly string[] = ["hello"]) => {
  const { terminalFor } = await import("./terminal.ts");
  const term = terminalFor({} as never, "t1" as never);
  term.attach(element() as never);

  for (const data of writes) {
    toTile?.({ type: "write", data });
  }

  return term;
};

/** What the terminal made in the new look was written: the replay, and nothing else yet. */
const replayed = () => showing()[0]?.written.join("");

/** The terminals open now and not disposed: what the tile shows. */
const showing = () => FakeTerminal.made.filter((t) => t.opened && !t.disposed);

describe("the terminal's spoken status", () => {
  const status = () => {
    const found = page.made.find((e) => (e["attrs"] as Record<string, string>)["role"] === "status");

    if (found === undefined) {
      throw new Error("no job status region");
    }

    return found;
  };
  const writes = () => page.writes.filter((w) => w.element === status()).map((w) => w.text);

  it("announces each complete reply in the log region", async () => {
    await openTerminal([]);
    const log = page.made.find((e) => (e["attrs"] as Record<string, string>)["role"] === "log");

    if (log === undefined) {
      throw new Error("no reply log region");
    }

    expect(log["tag"]).toBe("div");
    toTile?.({ type: "said", text: "scout: The river is Kura.\nThe bridge has 7 arches." });
    expect((log["children"] as Record<string, unknown>[]).map((e) => e["textContent"])).toEqual([
      "scout: The river is Kura.\nThe bridge has 7 arches.",
    ]);
  });

  it("creates a status region and clears it at once when the job ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    await openTerminal([]);
    expect(status()["tag"]).toBe("div");
    toTile?.({ type: "status", text: "reading" });
    expect(status()["textContent"]).toBe("reading");
    toTile?.({ type: "status", text: "finishing" });
    expect(status()["textContent"]).toBe("reading");
    toTile?.({ type: "status", text: null });
    expect(status()["textContent"]).toBe("");
    vi.advanceTimersByTime(3000);
    expect(writes()).toEqual(["reading", ""]);
  });

  it("drops a queued announcement when the terminal is disposed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const terminal = await openTerminal([]);
    toTile?.({ type: "status", text: "reading" });
    toTile?.({ type: "status", text: "waiting" });
    terminal.dispose();
    vi.advanceTimersByTime(3000);
    expect(writes()).toEqual(["reading"]);
  });
});

describe("an open terminal follows the system's look", () => {
  it("is made in the system's look", async () => {
    await openTerminal();
    expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrika)]);
  });

  it("draws in fabrika-light once the system turns light, one terminal, still showing its text", async () => {
    await openTerminal();
    switchTo("light");
    expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrikaLight)]);
    expect(replayed()).toBe("hello");
  });

  it("writes again only what came after the last full reset (RIS, ESC c)", async () => {
    await openTerminal(["old", "older\x1bcnew"]);
    switchTo("light");
    expect(replayed()).toBe("\x1bcnew");
    switchTo("dark");
    toTile?.({ type: "write", data: " more" });
    toTile?.({ type: "write", data: "x\x1bcfresh" });
    switchTo("light");
    expect(replayed()).toBe("\x1bcfresh");
  });

  // A tile keeps the newest 1 MiB to write again (experiment 177's spike), dropping whole writes
  // from the oldest.
  it("keeps the newest 1 MiB, dropping the oldest writes past it", async () => {
    const part = (c: string) => c.repeat(400 * 1024);
    await openTerminal([part("a"), part("b")]);
    switchTo("light");
    expect(replayed()).toBe(part("a") + part("b"));
    toTile?.({ type: "write", data: part("c") });
    switchTo("dark");
    expect(replayed()).toBe(part("b") + part("c"));
  });

  it("opens nothing on a look change before it is attached, and opens in the new look", async () => {
    const { terminalFor } = await import("./terminal.ts");
    const term = terminalFor({} as never, "t1" as never);
    switchTo("light");
    expect(FakeTerminal.made.filter((t) => t.opened)).toEqual([]);
    term.attach(element() as never);
    expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrikaLight)]);
  });

  it("sends the remade terminal's keys and its size on the tile's port", async () => {
    await openTerminal();
    const before = sent.length;
    switchTo("light");
    expect(sent.slice(before)).toEqual([{ port: "tile:t1", msg: { type: "size", cols: 80, rows: 24 } }]);
    const now = showing()[0];

    for (const fn of now?.keys ?? []) {
      fn("ls\r");
    }

    for (const fn of now?.sizes ?? []) {
      fn({ cols: 100, rows: 30 });
    }

    expect(sent.slice(-2)).toEqual([
      { port: "tile:t1", msg: { type: "keys", data: "ls\r" } },
      { port: "tile:t1", msg: { type: "size", cols: 100, rows: 30 } },
    ]);
  });

  // ghostty-web 0.4.0's open() focuses the terminal, now and again after a zero timeout. A look
  // change remakes every tile's terminal, so unless focus is put back, the last one remade takes
  // it, and keys go to the wrong tile or leave the input a person is typing in.
  describe("focus stays where it was across a look change", () => {
    it("a focused terminal's remake is focused", async () => {
      const term = await openTerminal();
      term.focus();
      switchTo("light");
      await settled();
      expect(page.activeElement).toBe(showing()[0]?.element);
    });

    it("an input outside any terminal keeps focus", async () => {
      await openTerminal();
      const input = {
        name: "a tracker's input",
        focus: () => {
          page.activeElement = input;
        },
      };
      page.activeElement = input;
      switchTo("light");
      await settled();
      expect(page.activeElement).toBe(input);
    });

    // Between the remake and open()'s timeout, focus is already back: keys typed at once still
    // reach the input, not the remade terminal.
    it("an input outside any terminal has focus back at once, before open()'s timeout", async () => {
      await openTerminal();
      const input = {
        name: "a tracker's input",
        focus: () => {
          page.activeElement = input;
        },
      };
      page.activeElement = input;
      switchTo("light");
      expect(page.activeElement).toBe(input);
    });

    it("an unfocused tile's terminal does not take focus from the focused one", async () => {
      const { terminalFor } = await import("./terminal.ts");
      const first = terminalFor({} as never, "t1" as never);
      first.attach(element() as never);
      terminalFor({} as never, "t2" as never).attach(element() as never);
      first.focus();
      const focused = page.activeElement;
      switchTo("light");
      await settled();
      expect(page.activeElement).toBe(focused);
    });
  });

  it("goes back to fabrika when the system turns dark again", async () => {
    look = "light";
    await openTerminal();
    switchTo("dark");
    expect(showing().map((t) => t.drawn)).toEqual([terminalTheme(fabrika)]);
  });

  it("stops listening once disposed", async () => {
    const term = await openTerminal();
    term.dispose();
    const before = FakeTerminal.made.length;
    switchTo("light");
    expect({ made: FakeTerminal.made.length - before, showing: showing().length }).toEqual({
      made: 0,
      showing: 0,
    });
  });
});
