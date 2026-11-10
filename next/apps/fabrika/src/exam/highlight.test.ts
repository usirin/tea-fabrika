// P8, next/. Port source: programs/markdown/src/highlight.test.ts at 2c29c13f433c.
// Mapping: loadColors -> one in-flight load, no Promise identity; colorsNow -> before/failure plain;
// language aliases, span flags/colors, comments and exact characters -> the code contracts below.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { expect, it } from "@effect/vitest";
import { Arbitrary, Effect, FileSystem, Schema } from "effect";

const options = { arbitrary: { seed: 119120, runs: 300, size: 4096, concurrency: 1 }, timeout: 60_000 };
const text = Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(4096));

const CodeCases = Arbitrary.all({
  lines: Arbitrary.array(Arbitrary.schema(text), { minLength: 0, maxLength: 8 }),
  suffix: Arbitrary.schema(Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(96))),
});

const Span = Schema.Struct({
  text: Schema.String,
  color: Schema.NullOr(Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6,8}$/i))),
  italic: Schema.Boolean,
  bold: Schema.Boolean,
});

const Lines = Schema.Array(Schema.Array(Span));
type Lines = typeof Lines.Type;

const exact = (lines: Lines | null, text: string) => {
  expect(Schema.is(Schema.NullOr(Lines))(lines)).toBe(true);

  if (lines !== null) {
    Schema.decodeUnknownSync(Lines)(lines);
    expect(lines.map((line) => line.map((s) => s.text).join("")).join("\n")).toBe(text);
  }
};

type Highlighter = {
  readonly color: (text: string, lang: string | null) => Lines | null;
  readonly wants: (lang: string | null) => boolean;
  readonly loading: (
    code: string,
    lang: string,
  ) => Effect.Effect<{
    readonly loads: number;
    readonly before: Lines | null;
    readonly after: Lines | null;
  }>;
  readonly failedLoad: (
    code: string,
    lang: string,
  ) => Effect.Effect<{ readonly loads: number; readonly output: Lines | null }>;
};

const loadedOnce = (a: { readonly loads: number; readonly before: Lines | null; readonly after: Lines | null }) => {
  expect(a.loads).toBe(1);
  expect(a.before).toBeNull();
  expect(a.after).not.toBeNull();
};

const failedPlain = (a: { readonly loads: number; readonly output: Lines | null }) => {
  expect(a.loads).toBe(1);
  expect(a.output).toBeNull();
};

const unknownPlain = (call: () => Lines | null) => expect(call()).toBeNull();

const binding = (): Highlighter => {
  throw new Error("P22 started: bind real highlighter and its load/failure driver; import failure must fail");
};

const paths = [
  "root.ts",
  "markdown.ts",
  "drawn.tsx",
  "highlighter.ts",
  "highlight.ts",
  "highlight.tsx",
  "window.tsx",
  "draw.tsx",
].flatMap((file) => [`../../../../programs/notes/src/${file}`, `../../../../programs/notes/${file}`]);

const presence = (files: ReadonlySet<string>, load: () => Highlighter): Highlighter | null => {
  if (!paths.some((p) => files.has(p))) {
    return null;
  }

  const h = load();

  for (const name of ["color", "wants", "loading", "failedLoad"] as const) {
    if (typeof h[name] !== "function") {
      throw new Error(`missing highlighter export: ${name}`);
    }
  }

  return h;
};

const present = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const found = new Set<string>();

  for (const p of paths) {
    if (yield* fs.exists(new URL(p, import.meta.url).pathname)) {
      found.add(p);
    }
  }

  return presence(found, binding);
}).pipe(Effect.provide(NodeFileSystem.layer));

const target = Effect.fnUntraced(function* (ctx: { skip: (reason?: string) => never }) {
  const h = yield* present;

  if (h === null) {
    ctx.skip("not built: P22 highlighter");
  }

  return h;
});

const lineRule = (output: Lines | null, code: string) => {
  expect(output).not.toBeNull();
  exact(output, code);

  for (const [i, line] of code.split("\n").entries()) {
    if (line.length >= 1000) {
      expect(output?.[i]).toEqual([{ text: line, color: null, italic: false, bold: false }]);
    } else if (line.startsWith("const n = 1;") || (line.length === 999 && line.startsWith("//"))) {
      expect(output?.[i]?.some((s) => s.color !== null)).toBe(true);
    }
  }
};

const LongCases = Arbitrary.schema(
  Schema.Struct({
    length: Schema.Int.check(Schema.isBetween({ minimum: 1000, maximum: 4096 })),
    piece: Schema.Literals(["x", "界", "é", "א"]),
    suffix: Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(96)),
  }),
);

const mixedLines = (c: { length: number; piece: string; suffix: string }) => [
  `const n = 1; // ${c.suffix.replaceAll(/\r|\n/g, " ")}`,
  `//${c.piece.repeat(997)}`, // 999: still colored
  `//${c.piece.repeat(998)}`, // exactly 1,000: one plain span
  "const n = 1;",
  `//${c.piece.repeat(999)}`, // 1,001: one plain span
  c.piece.repeat(c.length),
  "const n = 1; // after the long lines",
];

it.effect.prop(
  "not built: P22 / colored tokens retain text, line breaks, colors and flags",
  { c: CodeCases },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const h = yield* target(ctx),
        code = c.lines.join("\n");

      for (const lang of ["ts", "typescript", "TS", "html", "javascript", "js"]) {
        exact(h.color(code, lang), code);
      }

      const typed = `const n = 1;\n// ${c.suffix}`;
      const aliases = ["ts", "typescript", "TS"].map((lang) => h.color(typed, lang));
      expect(aliases[0]).not.toBeNull();
      expect(aliases[1]).toEqual(aliases[0]);
      expect(aliases[2]).toEqual(aliases[0]);

      for (const output of aliases) {
        exact(output, typed);
        expect(output?.flat().some((s) => s.color !== null)).toBe(true);
      }
    }),
  options,
);

it.effect.prop(
  "not built: P22 / plain and unknown languages never throw or lose text",
  { lines: Arbitrary.array(Arbitrary.schema(text), { minLength: 0, maxLength: 8 }) },
  ({ lines }, ctx) =>
    Effect.gen(function* () {
      const h = yield* target(ctx),
        code = lines.join("\n");

      for (const lang of [
        null,
        "",
        "text",
        "TXT",
        "plain",
        "plaintext",
        "constructor",
        "__proto__",
        `unknown-${code.slice(0, 96)}`,
      ]) {
        expect(h.color(code, lang)).toBeNull();
      }

      expect([null, "", "text", "TXT", "plain", "plaintext", "ts", "nope"].map(h.wants)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
        true,
        true,
      ]);
    }),
  options,
);

it.effect.prop(
  "not built: P22 / one load in flight and plain text before load or after failure",
  { c: CodeCases },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const h = yield* target(ctx),
        code = `${c.lines.join("\n")}\n${c.suffix}`,
        loaded = yield* h.loading(code, "ts"),
        failed = yield* h.failedLoad(code, "ts");
      loadedOnce(loaded);
      exact(loaded.after, code);
      failedPlain(failed);
    }),
  options,
);

it.effect.prop(
  "not built: P22 / every line of 1000 or more is one plain span among shorter colored lines",
  { c: LongCases },
  ({ c }, ctx) =>
    Effect.gen(function* () {
      const h = yield* target(ctx);
      expect(h.wants("ts")).toBe(true);
      const lines = mixedLines(c);

      for (const line of lines) {
        lineRule(h.color(line, "ts"), line);
      }

      const colored999 = h.color(lines[1]!, "ts");
      expect(colored999?.flat().some((s) => s.color !== null)).toBe(true);
      lineRule(h.color(lines.join("\n"), "ts"), lines.join("\n"));
    }),
  options,
);

it.effect("format: not built: P22 / source comment's color and flags", (ctx) =>
  Effect.gen(function* () {
    const h = yield* target(ctx);
    expect(h.color("// a comment", "ts")).toEqual([
      [{ text: "// a comment", color: "#9198a1", italic: false, bold: false }],
    ]);
  }),
);

it.prop(
  "checker clean control: spans preserve every code character",
  { c: CodeCases },
  ({ c }) => {
    const code = `${c.lines.join("\n")}\n${c.suffix}`;
    exact(
      code.split("\n").map((line) => [{ text: line, color: null, italic: false, bold: false }]),
      code,
    );
    loadedOnce({ loads: 1, before: null, after: [] });
    failedPlain({ loads: 1, output: null });
    unknownPlain(() => null);
  },
  options,
);

it.prop(
  "checker plants: HTML tokens, lost newline, bad flags and long-line coloring fail",
  { c: CodeCases },
  ({ c }) => {
    const code = `${c.lines.join("\n")}\n${c.suffix}\n`;
    expect(() => loadedOnce({ loads: 2, before: null, after: [] })).toThrow();
    expect(() => failedPlain({ loads: 1, output: [] })).toThrow();
    expect(() =>
      unknownPlain(() => {
        throw new Error("unknown language");
      }),
    ).toThrow();
    expect(() => exact([[{ text: `<b>${code}</b>`, color: null, italic: false, bold: false }]], code)).toThrow();
    expect(() => exact([[{ text: code.slice(0, -1), color: null, italic: false, bold: false }]], code)).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Lines)([[{ text: code, color: "red", italic: "true", bold: false }]]),
    ).toThrow();
  },
  options,
);

it.prop(
  "checker controls/plants: 1000 boundary, split long lines and whole-block fallback fail",
  { c: LongCases },
  ({ c }) => {
    const lines = mixedLines(c),
      code = lines.join("\n");
    const clean = lines.map((line) => [
      { text: line, color: line.length >= 1000 ? null : "#ffffff", italic: false, bold: false },
    ]);
    lineRule(clean, code);
    expect(() => lineRule(null, code)).toThrow();

    for (const [i, line] of lines.entries()) {
      if (line.length < 1000) {
        continue;
      }

      const colored = structuredClone(clean);
      colored[i] = [{ text: line, color: "#ffffff", italic: false, bold: false }];
      expect(() => lineRule(colored, code)).toThrow();
      const split = structuredClone(clean);
      split[i] = [
        { text: line.slice(0, 1), color: null, italic: false, bold: false },
        { text: line.slice(1), color: null, italic: false, bold: false },
      ];
      expect(() => lineRule(split, code)).toThrow();
    }

    expect(() =>
      lineRule(
        lines.map((line) => [{ text: line, color: null, italic: false, bold: false }]),
        code,
      ),
    ).toThrow();
  },
  options,
);

it.prop(
  "presence checker: absent is pending; partial, failed-import and missing exports fail",
  { message: Arbitrary.schema(text) },
  ({ message }) => {
    const failed = () => {
      throw new Error(`import failed: ${message}`);
    };
    expect(presence(new Set(), failed)).toBeNull();

    for (const file of [
      "root.ts",
      "markdown.ts",
      "drawn.tsx",
      "highlighter.ts",
      "highlight.ts",
      "highlight.tsx",
      "window.tsx",
      "draw.tsx",
    ]) {
      for (const p of [`../../../../programs/notes/src/${file}`, `../../../../programs/notes/${file}`]) {
        expect(() => presence(new Set([p]), failed)).toThrow("import failed");
      }
    }

    const clean: Highlighter = {
      color: () => null,
      wants: () => false,
      loading: () => Effect.succeed({ loads: 1, before: null, after: [] }),
      failedLoad: () => Effect.succeed({ loads: 1, output: null }),
    };
    expect(() => presence(new Set(paths), () => ({ ...clean, wants: undefined! }))).toThrow(
      "missing highlighter export",
    );
    expect(presence(new Set(paths), () => clean)).toBe(clean);
  },
  options,
);
