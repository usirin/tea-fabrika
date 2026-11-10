import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeKeys, defaults, type Keys } from "./keymap.ts";
import { keyName, keyOwner, matchPress, type Press } from "./keys.ts";

// Who a key belongs to before the desk or a tile hears it. On a Mac, Command is the system's and
// the menu's: a terminal never reads it. Everywhere, Ctrl is the shell's. The Command keys that
// are the app's or nobody's come from the keys file's table (keymap.ts), the defaults unless said.

/** The keybindings file's table; a refusal fails the test. */
const table = (text: string): Keys => {
  const answer = decodeKeys(text, true);

  if (Result.isFailure(answer)) {
    throw new Error(`refused: ${answer.failure.why}`);
  }

  return answer.success;
};

const press = (key: string, mods: Partial<Omit<Press, "key">> = {}): Press => ({
  key,
  ctrl: false,
  alt: false,
  meta: false,
  ...mods,
});

const cmd = (key: string, mods: Partial<Omit<Press, "key" | "meta">> = {}) => press(key, { ...mods, meta: true });

describe("keyOwner, on a Mac", () => {
  it.each([
    ["Cmd-Q, quit", cmd("q")],
    ["Cmd-H, hide", cmd("h")],
    ["Cmd-M, minimize", cmd("m")],
    ["Cmd-comma, settings", cmd(",")],
    ["Cmd-backtick, the next window", cmd("`")],
    ["Cmd-C, copy", cmd("c")],
    ["Cmd-V, paste", cmd("v")],
    ["Cmd-A, select all", cmd("a")],
    ["Cmd-R, reload", cmd("r")],
    // With Shift, the event's key is the capital.
    ["Cmd-Shift-Z, redo", cmd("Z")],
    ["Cmd-Shift-R, force reload", cmd("R")],
    ["Cmd-Alt-H, hide others", cmd("˙", { alt: true })],
    ["Ctrl-Cmd-F, full screen", cmd("f", { ctrl: true })],
    ["Cmd-Left", cmd("ArrowLeft")],
    ["Cmd alone", cmd("Meta")],
  ])("%s is the system's", (_, key) => {
    expect(keyOwner(key, true, defaults)).toBe("system");
  });

  it("Cmd-K, the palette, stays in the app", () => {
    expect(keyOwner(cmd("k"), true, defaults)).toBe("app");
  });

  it.each([["Cmd-W", cmd("w")]])("%s does nothing, by the owner's choice for now", (_, key) => {
    expect(keyOwner(key, true, defaults)).toBe("nobody");
  });

  it.each([
    ["Cmd-Alt-W", cmd("∑", { alt: true })],
    ["Ctrl-Cmd-W", cmd("w", { ctrl: true })],
  ])("%s is another key, and the system's", (_, key) => {
    expect(keyOwner(key, true, defaults)).toBe("system");
  });

  it.each([
    ["a letter", press("q")],
    ["a capital", press("Q")],
    ["Enter", press("Enter")],
    ["Ctrl-C", press("c", { ctrl: true })],
    ["Ctrl-D", press("d", { ctrl: true })],
    ["Ctrl-Q", press("q", { ctrl: true })],
    ["Ctrl-W", press("w", { ctrl: true })],
    ["Ctrl-B, the prefix", press("b", { ctrl: true })],
    ["Ctrl-H, the previous workspace after the prefix", press("h", { ctrl: true })],
    ["the prefix's own keys", press("|")],
    ["Alt-B, readline's back a word", press("∫", { alt: true })],
    ["Shift alone", press("Shift")],
  ])("%s stays in the app", (_, key) => {
    expect(keyOwner(key, true, defaults)).toBe("app");
  });
});

describe("today's complete presses", () => {
  const full = (key: string, mods = {}) => ({
    key,
    code: "",
    ctrl: false,
    alt: false,
    meta: false,
    shift: false,
    composing: false,
    altGraph: false,
    ...mods,
  });
  it("K5: Shift distinguishes named keys and modified shortcuts", () => {
    expect(keyName(full("F6"))).toBe("<f6>");
    expect(keyName(full("F6", { shift: true }))).toBe("<s-f6>");
    expect(keyName(full("W", { meta: true, shift: true }))).toBe("<s-m-w>");
    expect(keyOwner(full("W", { meta: true, shift: true }), true, defaults)).toBe("system");
    expect(keyOwner(full("w", { meta: true }), true, defaults)).toBe("nobody");
  });
  it("K6: Option characters match first; Unicode is kept; physical fallback comes last", () => {
    const bar = { _tag: "after_prefix", key: "|" } as const;
    expect(matchPress(full("|", { code: "Digit7", alt: true, shift: true }), [bar], true)).toEqual(bar);

    for (const key of ["İ", "ı", "Ж", "é", "🦊"]) {
      expect(keyName(full(key))).toBe(key);
    }

    expect(keyName(full("İ", { ctrl: true }))).toBe("<c-İ>");
    expect(keyName(full("Ж", { meta: true }))).toBe("<m-Ж>");
    const character = { _tag: "alone", key: "<m-ж>" } as const;
    const position = { _tag: "alone", key: "<m-k>" } as const;
    const russian = full("ж", { code: "KeyK", meta: true });
    expect(matchPress(russian, [position, character], true)).toEqual(character);
    expect(matchPress(russian, [position], true)).toEqual(position);
    expect(matchPress(full("x", { code: "KeyK", meta: true }), [position], true)).toBeNull();
    expect(matchPress(full("ж", { code: "KeyK" }), [bar], true)).toBeNull();
    expect(matchPress(full("|", { altGraph: true, alt: true, ctrl: true }), [bar], true)).toEqual(bar);
  });
  it("K16: system keys win even over an impossible table, and Ctrl-C is never bindable", () => {
    for (const key of ["q", "h", "Tab", " "]) {
      const p = full(key, { meta: true });
      const name = keyName(p) ?? "";
      const impossible = {
        ...defaults,
        prefix: name,
        ignore: [name],
        rows: defaults.rows.map((row) => ({ ...row, keys: [{ _tag: "alone" as const, key: name }] })),
      };
      expect(keyOwner(p, true, impossible)).toBe("system");
    }

    for (const text of ['tezgah.zoom = "ctrl+c"', 'ignore = ["ctrl+c"]', 'prefix = "ctrl+c"']) {
      expect(Result.isFailure(decodeKeys(text, true))).toBe(true);
    }

    expect(keyName(full("c", { ctrl: true }))).toBe("<c-c>");
  });
});

describe("keyOwner, on Windows and Linux", () => {
  it.each([
    ["Ctrl-C", press("c", { ctrl: true })],
    ["Ctrl-D", press("d", { ctrl: true })],
    ["Ctrl-Q", press("q", { ctrl: true })],
    ["Ctrl-W", press("w", { ctrl: true })],
    ["Ctrl-Shift-R", press("R", { ctrl: true })],
    ["a letter", press("q")],
    // The Windows or Super key is not Command: nothing changes for it there.
    ["Super-Q", cmd("q")],
    ["Super-W", cmd("w")],
  ])("%s stays in the app", (_, key) => {
    expect(keyOwner(key, false, defaults)).toBe("app");
  });
});

describe("keyOwner, from the keys file (ticket 174)", () => {
  it("gives the app a Command key you bind, and the system the palette's old one (p5, p6)", () => {
    const keys = table(['palette.open = "cmd+p"', 'tezgah.split = "cmd+d"'].join("\n"));
    expect(keyOwner(cmd("p"), true, keys)).toBe("app");
    expect(keyOwner(cmd("d"), true, keys)).toBe("app");
    expect(keyOwner(cmd("k"), true, keys)).toBe("system");
  });

  it("lets Cmd-W reach the menu once ignore is emptied, and eats a key you add (p6)", () => {
    expect(keyOwner(cmd("w"), true, table("ignore = []"))).toBe("system");
    const eaten = table('ignore = ["cmd+e"]');
    expect(keyOwner(cmd("e"), true, eaten)).toBe("nobody");
    expect(keyOwner(cmd("w"), true, eaten)).toBe("system");
  });

  it("leaves Cmd-Q to the system whatever the file binds (p17)", () => {
    expect(keyOwner(cmd("q"), true, table('palette.open = "cmd+p"'))).toBe("system");
    expect(keyOwner(cmd("q"), true, table("ignore = []"))).toBe("system");
  });

  it("gives the app a Cmd prefix, so the desk can arm on it", () => {
    const keys = table('prefix = "cmd+b"');
    expect(keyOwner(cmd("b"), true, keys)).toBe("app");
    // Ctrl-B is no longer the prefix, and is the tile's, as every Ctrl key is.
    expect(keyOwner(press("b", { ctrl: true }), true, keys)).toBe("app");
  });

  it("never gives the app one of the Mac's keys, even from a table no file could write", () => {
    const keys: Keys = {
      ...defaults,
      prefix: "<m-h>",
      rows: defaults.rows.map((row) =>
        row.does === "palette.open" ? { ...row, keys: [{ _tag: "alone", key: "<m-q>" }] } : row,
      ),
    };
    expect(keyOwner(cmd("q"), true, keys)).toBe("system");
    expect(keyOwner(cmd("h"), true, keys)).toBe("system");
  });

  it("changes nothing off a Mac, where Ctrl is the shell's", () => {
    const keys = table(['palette.open = "cmd+p"', "ignore = []"].join("\n"));
    expect(keyOwner(cmd("w"), false, keys)).toBe("app");
    expect(keyOwner(press("w", { ctrl: true }), false, keys)).toBe("app");
  });
});
