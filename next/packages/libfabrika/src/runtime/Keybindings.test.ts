// P14, next/ (Tier 1, ticket 286): configurable keys (docs/direction/keybindings-are-configurable.md;
// the plan's "Layout and key tables"). Written before `runtime/Keybindings.ts`; the module loads by
// `import()` in each test.
//
// The shape these laws hold the module to, from the plan's words (the build may add more):
// - A row set is `Record<command, ReadonlyArray<chord text>>`. A chord is `ctrl+`, `alt+`, `meta+`
//   modifiers (and `shift+` for a named key) and a key: one typed character exactly as typed (`+`,
//   `A`), or a lowercase name (`enter`, `tab`, `escape`, `space`, `arrowup`...). Several chords
//   separated by a space are a sequence: the first arms a prefix, the next completes it.
// - `parseKeys(text, commands)`: an Effect `Result` of the rows, or `{line, reason}` with `reason` one of
//   `syntax`, `unknown_command`, `unknown_key`, `clash` (one chord for two commands). Its text is
//   the person's `keybindings.toml`: a `[keys]` table of `"command" = ["chord", ...]` (a string
//   alone is one chord, `[]` unbinds).
// - `buildTable(defaults, rows)`: the file's rows over the defaults; a command the file does not
//   name keeps its defaults, an empty row unbinds.
// - `matchKey(table, armed, event)`: `{armed, out}` with `out` of `_tag` `command` (and `command`),
//   `prefix` or `none`. An event is `{key, shift, ctrl, alt, meta, composing, editable}`.
// - `hintFor(table, command)`: the first chord's text, or null: the same table the match reads.
// - `reload(last, defaults, commands, source)`: `source` is `{_tag: "text", text}` or `{_tag:
//   "failed", reason}`; answers `{table, armed, error}`. A bad or failed source keeps `last` and
//   gives `error`; a good one gives the new table, no error, and `armed` null (an edit clears a prefix).
import { describe, expect, it } from "@effect/vitest";
import { Result } from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const LOAD = "./Keybindings.ts";
const opts = { seed: SEED, numRuns: 300 };

const COMMANDS = ["counter.inc", "counter.dec", "counter.reset", "tile.next", "tile.close"] as const;

type Rows = Readonly<Record<string, ReadonlyArray<string>>>;
type Problem = { readonly line: number; readonly reason: string };
type Table = { readonly rows: Rows };
type Armed = object;

type Event = {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  composing: boolean;
  editable: boolean;
};

type Out = { readonly _tag: string; readonly command?: string };

interface KeysApi {
  readonly parseKeys: (text: string, commands: ReadonlyArray<string>) => Result.Result<Rows, Problem>;
  readonly buildTable: (defaults: Rows, rows: Rows) => Table;
  readonly matchKey: (t: Table, armed: Armed | null, e: Event) => { readonly armed: Armed | null; readonly out: Out };
  readonly hintFor: (t: Table, command: string) => string | null;
  readonly reload: (
    last: Table,
    defaults: Rows,
    commands: ReadonlyArray<string>,
    source: { _tag: string; text?: string; reason?: string },
  ) => { readonly table: Table; readonly armed: Armed | null; readonly error: Problem | null };
}

const api = async (): Promise<KeysApi> => (await import(LOAD)) as KeysApi;

// Chords the table may hold: typed characters, named keys with modifiers. None is browser-reserved.
// The defaults hold `+`, `-` and `0`; a file that wants one of them says so on that command.
const typed = fc.constantFrom("=", "a", "b", "A", "x", "[", "]", ".", ",", "/");

const named = fc.constantFrom("enter", "tab", "escape", "space", "arrowup", "arrowdown", "backspace");

const mods = fc.subarray(["ctrl", "alt"] as const).map((m) => m.join("+"));

const chord = fc.oneof(
  typed,
  fc.tuple(mods, typed).map(([m, k]) => (m === "" ? k : `${m}+${k}`)),
  fc.tuple(fc.boolean(), named).map(([s, k]) => (s ? `shift+${k}` : k)),
);

const sequence = fc.oneof(
  chord,
  fc.tuple(chord, chord).map(([a, b]) => `${a} ${b}`),
);

/** Rows with no clash: no chord text is two commands', and none is the start of another's sequence. */
const rowsArb: fc.Arbitrary<Rows> = fc
  .array(fc.tuple(fc.constantFrom(...COMMANDS), fc.array(sequence, { maxLength: 3 })), { maxLength: 5 })
  .map((entries) => {
    const rows: Record<string, ReadonlyArray<string>> = {};
    const accepted: Array<string> = [];

    for (const [command, keys] of entries) {
      if (command in rows) {
        continue;
      }

      const mine: Array<string> = [];

      for (const k of keys) {
        if (accepted.some((a) => a === k || a.startsWith(`${k} `) || k.startsWith(`${a} `))) {
          continue;
        }

        accepted.push(k);
        mine.push(k);
      }

      rows[command] = mine;
    }

    return rows;
  });

const defaultsArb: fc.Arbitrary<Rows> = fc.constant({
  "counter.inc": ["+"],
  "counter.dec": ["-"],
  "counter.reset": ["0"],
});

const toml = (rows: Rows): string =>
  `[keys]\n${Object.entries(rows)
    .map(([c, k]) => `"${c}" = ${JSON.stringify(k)}`)
    .join("\n")}\n`;

const eventFor = (text: string): Event => {
  const parts = text.split("+");
  const key = text.endsWith("+") ? "+" : (parts.at(-1) ?? "");
  const lead = text.endsWith("+") ? parts.slice(0, -2) : parts.slice(0, -1);
  return {
    key,
    shift: lead.includes("shift"),
    ctrl: lead.includes("ctrl"),
    alt: lead.includes("alt"),
    meta: false,
    composing: false,
    editable: false,
  };
};

const plainEvent = (key: string): Event => ({
  key,
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
  composing: false,
  editable: false,
});

const press = (a: KeysApi, t: Table, text: string): Out => {
  let armed: Armed | null = null;
  let out: Out = { _tag: "none" };

  for (const c of text.split(" ")) {
    ({ armed, out } = a.matchKey(t, armed, eventFor(c)));
  }

  return out;
};

type Law = (a: KeysApi, rows: Rows, defaults: Rows) => void;

const laws: Readonly<Record<string, Law>> = {
  "a table written as TOML reads back to the same rows": (a, rows) => {
    const back = a.parseKeys(toml(rows), COMMANDS);
    expect(Result.isSuccess(back)).toBe(true);

    if (Result.isSuccess(back)) {
      expect(back.success).toEqual(rows);
    }
  },
  "matching, hints and unbinding read one table": (a, rows, defaults) => {
    const t = a.buildTable(defaults, rows);

    for (const command of COMMANDS) {
      const keys = rows[command] ?? defaults[command] ?? [];
      expect(a.hintFor(t, command)).toBe(keys[0] ?? null);

      for (const k of keys) {
        expect(press(a, t, k), `${command} on ${k}`).toEqual({ _tag: "command", command });
      }
    }

    for (const [command, keys] of Object.entries(defaults)) {
      if (rows[command]?.length === 0) {
        for (const k of keys) {
          const owner = Object.entries(rows).find(([, r]) => r.includes(k));

          if (owner === undefined) {
            expect(press(a, t, k)._tag, `${command} unbound`).toBe("none");
          }
        }
      }
    }
  },
  "a bad file keeps the last good table and names its line; a failed read keeps it too": (a, rows, defaults) => {
    const good = a.buildTable(defaults, rows);
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["unknown_command", `# one\n[keys]\n"no.such.command" = ["a"]\n`],
      ["unknown_key", `[keys]\n"counter.inc" = ["hyper+q"]\n`],
      ["clash", `[keys]\n"counter.inc" = ["q"]\n"counter.dec" = ["q"]\n`],
      ["syntax", `[keys]\n"counter.inc" ~ nope\n`],
    ];

    for (const [reason, text] of cases) {
      const out = a.reload(good, defaults, COMMANDS, { _tag: "text", text });
      expect(out.table).toBe(good);
      expect(out.error?.reason).toBe(reason);
      expect(out.error?.line).toBeGreaterThanOrEqual(1);
      expect(out.armed).toBeNull();
    }

    const failed = a.reload(good, defaults, COMMANDS, { _tag: "failed", reason: "EACCES" });
    expect(failed.table).toBe(good);
    expect(failed.error).not.toBeNull();
    const edited = a.reload(good, defaults, COMMANDS, { _tag: "text", text: toml(rows) });
    expect(edited.error).toBeNull();
    expect(edited.table).toEqual(a.buildTable(defaults, rows));
  },
  "a valid edit changes the next key and clears an armed prefix": (a, rows, defaults) => {
    const before = a.buildTable(defaults, { "counter.inc": ["g i"] });
    const first = a.matchKey(before, null, plainEvent("g"));
    expect(first.out._tag).toBe("prefix");
    const out = a.reload(before, defaults, COMMANDS, { _tag: "text", text: toml(rows) });
    expect(out.armed).toBeNull();
    const after = a.matchKey(out.table, out.armed, plainEvent("i"));
    expect(after.out.command === "counter.inc").toBe(false);
  },
  "editable text, composing input, reserved browser chords and an unbound key are never taken": (a, rows, defaults) => {
    const t = a.buildTable(defaults, {
      ...rows,
      "counter.inc": ["+"],
      "tile.close": ["ctrl+w", "ctrl+t"],
    });

    for (const base of [plainEvent("+"), { ...plainEvent("+"), shift: true }]) {
      expect(a.matchKey(t, null, { ...base, editable: true }).out._tag).toBe("none");
      expect(a.matchKey(t, null, { ...base, composing: true }).out._tag).toBe("none");
    }

    for (const reserved of ["w", "t", "l", "r", "n"]) {
      for (const m of [{ ctrl: true }, { meta: true }]) {
        expect(a.matchKey(t, null, { ...plainEvent(reserved), ...m }).out._tag).toBe("none");
      }
    }

    expect(a.matchKey(t, null, plainEvent("F9")).out._tag).toBe("none");
  },
  "Shift and the typed character count: a typed plus matches +, shift+tab is not tab": (a, _rows, defaults) => {
    const t = a.buildTable(defaults, { "tile.next": ["tab"], "tile.close": ["shift+tab"] });
    expect(a.matchKey(t, null, { ...plainEvent("+"), shift: true }).out).toEqual({
      _tag: "command",
      command: "counter.inc",
    });
    expect(a.matchKey(t, null, plainEvent("Tab")).out).toEqual({
      _tag: "command",
      command: "tile.next",
    });
    expect(a.matchKey(t, null, { ...plainEvent("Tab"), shift: true }).out).toEqual({
      _tag: "command",
      command: "tile.close",
    });
    expect(a.matchKey(t, null, plainEvent("A")).out._tag === "command" ? 1 : 0).toBe(0);
  },
  "a prefix arms on its first chord, completes on its second, and clears on a miss": (a, _rows, defaults) => {
    const t = a.buildTable(defaults, { "tile.next": ["g n"], "tile.close": ["g x"] });
    const one = a.matchKey(t, null, plainEvent("g"));
    expect(one.out._tag).toBe("prefix");
    expect(a.matchKey(t, one.armed, plainEvent("n")).out).toEqual({
      _tag: "command",
      command: "tile.next",
    });
    expect(a.matchKey(t, one.armed, plainEvent("x")).out).toEqual({
      _tag: "command",
      command: "tile.close",
    });
    const miss = a.matchKey(t, one.armed, plainEvent("q"));
    expect(miss.out._tag).toBe("none");
    expect(miss.armed).toBeNull();
    expect(a.matchKey(t, miss.armed, plainEvent("n")).out._tag).toBe("none");
  },
};

describe("key tables: one table for binding, unbinding, matching, hints and live changes", () => {
  for (const [name, law] of Object.entries(laws)) {
    it(name, async () => {
      const a = await api();
      fc.assert(
        fc.property(rowsArb, defaultsArb, (rows, defaults) => law(a, rows, defaults)),
        opts,
      );
    });
  }

  it("good thing: generated tables bind, rebind, unbind and use sequences", async () => {
    const a = await api();
    const seen = { empty: 0, many: 0, sequence: 0, rebound: 0 };
    fc.assert(
      fc.property(rowsArb, defaultsArb, (rows, defaults) => {
        const t = a.buildTable(defaults, rows);

        if (Object.values(rows).some((r) => r.length === 0)) {
          seen.empty++;
        }

        if (Object.values(rows).flat().length >= 3) {
          seen.many++;
        }

        if (
          Object.values(rows)
            .flat()
            .some((k) => k.includes(" "))
        ) {
          seen.sequence++;
        }

        if (a.hintFor(t, "counter.inc") !== "+") {
          seen.rebound++;
        }
      }),
      opts,
    );

    for (const [name, n] of Object.entries(seen)) {
      expect(n, name).toBeGreaterThan(0);
    }
  });

  // Plants (keys): hard-code +; steal editable text; drop Shift; install a bad file. Each wraps the
  // real table code with one break, and the law that names it must throw.
  const run = (name: string, a: KeysApi): void =>
    fc.assert(
      fc.property(rowsArb, defaultsArb, (rows, defaults) => laws[name]?.(a, rows, defaults)),
      opts,
    );
  it("plant: a hard-coded + is caught", async () => {
    const real = await api();
    const broken: KeysApi = {
      ...real,
      matchKey: (t, armed, e) =>
        e.key === "+" ? { armed: null, out: { _tag: "command", command: "counter.inc" } } : real.matchKey(t, armed, e),
    };
    expect(() => run("matching, hints and unbinding read one table", broken)).toThrow();
  });
  it("plant: stealing editable text is caught", async () => {
    const real = await api();
    const broken: KeysApi = {
      ...real,
      matchKey: (t, armed, e) => real.matchKey(t, armed, { ...e, editable: false }),
    };
    expect(() =>
      run("editable text, composing input, reserved browser chords and an unbound key are never taken", broken),
    ).toThrow();
  });
  it("plant: dropping Shift is caught", async () => {
    const real = await api();
    const broken: KeysApi = {
      ...real,
      matchKey: (t, armed, e) => real.matchKey(t, armed, { ...e, shift: false }),
    };
    expect(() =>
      run("Shift and the typed character count: a typed plus matches +, shift+tab is not tab", broken),
    ).toThrow();
  });
  it("plant: installing a bad file is caught", async () => {
    const real = await api();
    const broken: KeysApi = {
      ...real,
      reload: (last, d, c, s) => ({
        table: { rows: {} },
        armed: null,
        error: real.reload(last, d, c, s).error,
      }),
    };
    expect(() =>
      run("a bad file keeps the last good table and names its line; a failed read keeps it too", broken),
    ).toThrow();
  });
  it("plant: an edit that leaves the prefix armed is caught", async () => {
    const real = await api();
    const broken: KeysApi = {
      ...real,
      reload: (last, d, c, s) => ({ ...real.reload(last, d, c, s), armed: { chords: ["g"] } }),
    };
    expect(() => run("a valid edit changes the next key and clears an armed prefix", broken)).toThrow();
  });
  it("plant: a hint read from a different table than matching is caught", async () => {
    const real = await api();
    const broken: KeysApi = {
      ...real,
      hintFor: (t, command) => (command === "counter.inc" ? "+" : real.hintFor(t, command)),
    };
    expect(() => run("matching, hints and unbinding read one table", broken)).toThrow();
  });
});
