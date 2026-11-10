import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Ghostty, GhosttyTerminal } from "ghostty-web";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A remade terminal shows only what its own tile drew (tracker ticket 144). Every tile's terminal
// lives in one Ghostty, and ghostty-web 0.4's wasm does not clear memory it hands out again: a
// terminal made after another was freed starts with the freed one's rows. A look change frees
// each tile's terminal and makes a new one, so a tile showed another tile's `tsh$ tracker` line
// and broken symbols, on the screenshots of the stacked layout in dark after a switch. Closing a
// tile and opening another does the same, and shows it here without a look change.
//
// The wasm is the real one; ghostty-web's Terminal is faked as 0.4.0 runs it: open() makes the
// wasm terminal, `wasmTerm`, write() writes into it, dispose() frees it.

let ghostty: Ghostty;
let fresh: () => Ghostty;

beforeAll(async () => {
  const wasm = readFileSync(createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"));
  const real = await vi.importActual<typeof import("ghostty-web")>("ghostty-web");
  const compiled = await WebAssembly.compile(wasm);
  fresh = () => new real.Ghostty(new WebAssembly.Instance(compiled, { env: { log: () => {} } }));
});

const element = (): Record<string, unknown> => {
  const el: Record<string, unknown> = {
    className: "",
    textContent: "",
    parentElement: null,
    setAttribute: () => {},
    append: (...kids: Record<string, unknown>[]) => {
      for (const kid of kids) {
        kid["parentElement"] = el;
      }
    },
    remove: () => {},
    focus: () => {},
    blur: () => {},
  };
  return el;
};

/** Each tile's wasm terminal now, in the order they were made. */
const made: GhosttyTerminal[] = [];

/** A slot on the desk, and the size a tile in it fits to. */
type Slot = Record<string, unknown> & { cells: { cols: number; rows: number } };
const slot = (cols: number, rows: number): Slot => Object.assign(element(), { cells: { cols, rows } });

class FakeTerminal {
  cols = 80;
  rows = 24;
  wasmTerm: GhosttyTerminal | undefined;
  at: { parentElement: { parentElement: Slot } } | undefined;
  readonly buffer = { active: { length: 0, cursorY: 0, getLine: () => undefined } };
  constructor(private readonly options: { ghostty: Ghostty }) {}

  loadAddon(fit: FakeFit) {
    fit.term = this;
  }

  /** As 0.4.0's open(): the wasm terminal is made at the size the terminal has, 80 by 24. */
  open(screen: { parentElement: { parentElement: Slot } }) {
    this.at = screen;
    this.wasmTerm = this.options.ghostty.createTerminal(this.cols, this.rows, {
      scrollbackLimit: 1000,
    });
    made.push(this.wasmTerm);
    this.render();
  }

  /** As 0.4.0's renderer, each frame: the screen read out of the wasm. */
  render() {
    this.wasmTerm?.update();
    this.wasmTerm?.getViewport();
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.wasmTerm?.resize(cols, rows);
    this.render();
  }

  write(bytes: string) {
    this.wasmTerm?.write(bytes);
    this.render();
  }

  dispose() {
    if (this.wasmTerm === undefined) {
      return;
    }

    made.splice(made.indexOf(this.wasmTerm), 1);
    this.wasmTerm.free();
  }

  focus() {}
  onData() {}
  onResize() {}
}

/** As FitAddon: fits its terminal to the slot the tile is in. */
class FakeFit {
  term: FakeTerminal | undefined;

  fit() {
    const cells = this.term?.at?.parentElement.parentElement.cells;

    if (cells !== undefined) {
      this.term?.resize(cells.cols, cells.rows);
    }
  }

  observeResize() {}
}

vi.mock("ghostty-web", async (actual) => ({
  ...(await actual<typeof import("ghostty-web")>()),
  Terminal: FakeTerminal,
  FitAddon: FakeFit,
}));

vi.mock("ghostty-web/ghostty-vt.wasm", () => ({ default: new Uint8Array() }));

const changes: (() => void)[] = [];
const heard = new Map<string, (raw: unknown) => void>();

beforeEach(() => {
  ghostty = fresh();
  vi.stubGlobal("document", { createElement: element, activeElement: null, body: {} });
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => fn());
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: false,
      addEventListener: (_: string, fn: () => void) => changes.push(fn),
      removeEventListener: (_: string, fn: () => void) => changes.splice(changes.indexOf(fn), 1),
    }),
    fabrika: {
      send: () => {},
      forget: () => {},
      onMessage: (port: string, fn: (raw: unknown) => void) => heard.set(port, fn),
    },
  });
});

afterEach(() => {
  changes.length = 0;
  heard.clear();
  made.length = 0;
  vi.unstubAllGlobals();
});

const rows = (t: GhosttyTerminal) =>
  Array.from({ length: t.rows }, (_, y) =>
    (t.getLine(y) ?? [])
      .map((cell) => (cell.codepoint === 0 ? " " : String.fromCodePoint(cell.codepoint)))
      .join("")
      .trimEnd(),
  );

const draw = (tile: string, data: string) => heard.get(`tile:${tile}`)?.({ type: "write", data });

/** open()'s focus timeout runs before the page goes. */
const settled = () => new Promise((done) => setTimeout(done, 0));

describe("a terminal made again", () => {
  it("starts blank when a tile opens after another closed", async () => {
    const { terminalFor } = await import("./terminal.ts");
    const closing = terminalFor(ghostty, "t1" as never);
    closing.attach(slot(40, 6) as never);
    draw("t1", "tsh$ tracker\r\n");
    closing.dispose();
    terminalFor(ghostty, "t2" as never).attach(slot(40, 6) as never);
    expect(made.map(rows)).toEqual([["", "", "", "", "", ""]]);
  });

  it("shows only what its own tile drew, after a look change", async () => {
    const { terminalFor } = await import("./terminal.ts");
    // The screenshots' steps: a terminal ran `tracker` and closed while another sat open, and
    // the look changed to light and back to dark. This fake's memory is not the app's, so it
    // passed before the fix too: it guards that the reset leaves what a tile shows as it was.
    terminalFor(ghostty, "t3" as never).attach(slot(60, 10) as never);
    draw("t3", "tsh$ jobs\r\n[1] running   tracker\r\ntsh$ ");
    const ran = terminalFor(ghostty, "t2" as never);
    ran.attach(slot(60, 10) as never);

    for (let line = 0; line < 30; line += 1) {
      draw("t2", `⚙ 漢字 ✓ row ${line}\r\n`);
    }

    draw("t2", "              tsh$ tracker");
    ran.dispose();
    const before = made.map(rows);

    for (const look of ["light", "dark"]) {
      for (const change of [...changes]) {
        change();
      }

      await settled();
      expect(made.map(rows), look).toEqual(before);
    }
  });
});
