// T877, next/: L1-L8 exercise the public service. Layout hints use fast-check;
// values come from Effect Schema. The model never reads the adapter's edit index.
import { describe, expect, it } from "@effect/vitest";
import { ByteSize, Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import * as Codec from "./Codec.ts";
import * as Declarations from "./Declarations.ts";
import * as Files from "./Files.ts";
import * as Setting from "./Setting.ts";
import { Toml, TomlError } from "./Toml.ts";
import * as TomlParser from "./TomlParser.ts";

const check = { arbitrary: { seed: 119120, runs: 100 }, timeout: 30000 };
const strict = { onExcessProperty: "error" } as const;
const Integer = Schema.Int.check(Schema.isBetween({ minimum: -1000000, maximum: 1000000 }));
// TOML cannot encode lone surrogate code points.
const Text = Schema.String.check(Schema.isPattern(/^[^\uD800-\uDFFF]*$/u), Schema.isMaxLength(32));

const Scalar = Schema.Union([
  Schema.Int,
  Schema.Boolean,
  Text,
  Schema.Literals([0.5, -2.75, 1e-12, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]),
]);

const RecordValue = Schema.Struct({ "a.b": Scalar, "": Scalar, 雪: Scalar });

const Value = Schema.Union([
  Scalar,
  Schema.Array(Scalar).check(Schema.isMaxLength(4)),
  RecordValue,
  Schema.Array(RecordValue).check(Schema.isMaxLength(3)),
  Schema.Struct({ child: RecordValue }),
  Schema.Struct({}),
]);

const Input = {
  seed: Schema.Int,
  initial: Integer,
  values: Schema.Array(Value).check(Schema.isBetweenLength(1, 8)),
};

type Path = ReadonlyArray<string>;
type Tree = Readonly<Record<string, unknown>>;
type Hint = { readonly pick: number; readonly key: number; readonly deep: boolean };

const segments = ["leaf", "a.b", "", "雪", 'a"b', "a'b", "a\\b", "a\nb", "__proto__", "constructor", "toString"];

const layouts = fc.record({
  style: fc.constantFrom("explicit", "implicit", "dotted", "inline"),
  quote: fc.constantFrom("bare", "basic", "literal"),
  eol: fc.constantFrom("\n", "\r\n"),
  mixed: fc.boolean(),
  final: fc.boolean(),
  space: fc.constantFrom(" = ", "  =\t", "="),
  hints: fc.array(fc.record({ pick: fc.nat(), key: fc.nat(), deep: fc.boolean() }), {
    minLength: 1,
    maxLength: 40,
  }),
});

const layout = (seed: number) => fc.sample(layouts, { seed, numRuns: 1 })[0]!;
type Layout = ReturnType<typeof layout>;
const pick = <A>(xs: ReadonlyArray<A>, hint: number): A => xs[hint % xs.length]!;
const same = (a: Path, b: Path) => a.length === b.length && a.every((s, i) => s === b[i]);
const record = (v: unknown): v is Tree => typeof v === "object" && v !== null && !Array.isArray(v);

const frozen = (value: unknown): unknown =>
  Array.isArray(value)
    ? Object.freeze(value.map(frozen))
    : record(value)
      ? Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, frozen(v)])))
      : value;

const throwingRecord = (cause: Error) =>
  Object.defineProperty({}, "member", {
    enumerable: true,
    get: () => {
      throw cause;
    },
  });

const get = (v: unknown, path: Path): unknown =>
  path.reduce<unknown>((parent, key) => (record(parent) && Object.hasOwn(parent, key) ? parent[key] : undefined), v);

const put = (tree: Tree, path: Path, value: unknown): Tree => {
  const [key, ...rest] = path;

  if (key === undefined) {
    return tree;
  }

  const parent = get(tree, [key]);
  return Object.fromEntries([
    ...Object.entries(tree).filter(([name]) => name !== key),
    [key, rest.length === 0 ? value : put(record(parent) ? parent : {}, rest, value)],
  ]);
};

const drop = (tree: Tree, path: Path): Tree => {
  const [key, ...rest] = path;
  const parent = key === undefined ? undefined : get(tree, [key]);
  return rest.length === 0
    ? Object.fromEntries(Object.entries(tree).filter(([name]) => name !== key))
    : key !== undefined && record(parent)
      ? put(tree, [key], drop(parent, rest))
      : tree;
};

const leaves = (tree: Tree, path: Path = []): Array<Path> =>
  Object.entries(tree).flatMap(([key, value]) => {
    const at = [...path, key];
    return record(value) && Object.keys(value).length > 0 ? leaves(value, at) : [at];
  });

const parents = (tree: Tree, path: Path = []): Array<Path> => [
  path,
  ...Object.entries(tree).flatMap(([key, value]) => (record(value) ? parents(value, [...path, key]) : [])),
];

const keyText = (key: string, quote: Layout["quote"]): string => {
  if (quote === "bare" && /^[a-zA-Z0-9_-]+$/.test(key)) {
    return key;
  }

  return quote === "literal" && !/[\r\n']/.test(key) ? `'${key}'` : JSON.stringify(key);
};

// A small independent fixture writer, never the serializer being tested.
const literal = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(literal).join(", ")}]`;
  }

  if (record(value)) {
    return `{ ${Object.entries(value)
      .map(([key, child]) => `${JSON.stringify(key)} = ${literal(child)}`)
      .join(", ")} }`;
  }

  // JSON erases negative zero; keep the generated value in the TOML fixture.
  return Object.is(value, -0) ? "-0.0" : JSON.stringify(value);
};

const fixture = (l: Layout, n: number) => {
  const key = (s: string) => keyText(s, l.quote);
  const values = Object.fromEntries(segments.map((s) => [s, n]));
  const members = segments.map((s) => `${key(s)}${l.space}${n}`);
  const lines = ["# note-0-雪", `untouched  = 'text # = [ ]' # note-1-雪`, `"box.a.b"${l.space}${n} # note-2-雪`];
  let box: Tree = values;

  if (l.style === "explicit") {
    lines.push("# note-3-雪", `[${key("box")}]`, ...members);
  } else if (l.style === "implicit") {
    lines.push("# note-3-雪", `[${key("box")}.${key("child")}]`, ...members);
    box = { child: values };
  } else if (l.style === "inline") {
    lines.push(`box${l.space}{ ${members.join(", ")} } # note-3-雪`);
  } else {
    lines.push(...members.map((m) => `${key("box")}.${m}`), "# note-3-雪");
  }

  const text = lines
    .map((line, i) => line + (i === lines.length - 1 && !l.final ? "" : l.mixed && i % 2 ? "\n" : l.eol))
    .join("");
  return { text, value: { untouched: "text # = [ ]", "box.a.b": n, box } };
};

const comments = ["# note-0-雪", "# note-1-雪", "# note-2-雪", "# note-3-雪"];

const retained = (text: string, pieces: ReadonlyArray<string>) => {
  let cursor = -1;

  for (const piece of pieces) {
    const at = text.indexOf(piece);
    expect(at, piece).toBeGreaterThan(cursor);
    expect(text.indexOf(piece, at + piece.length), piece).toBe(-1);
    cursor = at;
  }
};

const document = Effect.fnUntraced(function* (toml: Toml["Service"], text: string, value: Tree) {
  const parsed = yield* toml.parse(text);
  expect(parsed.value).toEqual(value);
  retained(text, comments);
  return parsed;
});

const refusal = Effect.fnUntraced(function* (operation: Effect.Effect<string, TomlError>, tag: string, line?: number) {
  const exit = yield* Effect.exit(operation);
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isSuccess(exit)) {
    return yield* Effect.die(new Error("A refused edit returned text"));
  }

  const reason = exit.cause.reasons.find((r) => r._tag === "Fail");
  expect(reason?._tag).toBe("Fail");

  if (reason?._tag !== "Fail") {
    return yield* Effect.die(new Error("A refused edit was a defect"));
  }

  const error = reason.error;
  expect(error).toBeInstanceOf(TomlError);
  expect(error.reason._tag).toBe(tag);
  expect(error.reason.cause).toBeDefined();
  expect(error.cause).toBeDefined();

  if (line !== undefined) {
    expect(error.line).toBe(line);
  }

  return error;
});

// Read both the model and the reparsed document before selecting a move.
const selected = (model: Tree, parsed: Tree, hint: Hint): Path => {
  const paths = leaves(model).filter((path) => get(parsed, path) !== undefined);
  return pick(paths, hint.pick);
};

const absent = (model: Tree, parsed: Tree, hint: Hint): Path => {
  const parent = pick(
    parents(model).filter((p) => record(get(parsed, p))),
    hint.pick,
  );
  let key = pick(segments, hint.key);

  while (get(model, [...parent, key]) !== undefined) {
    key += "x";
  }

  return hint.deep ? [...parent, key, pick(segments, hint.pick), "value"] : [...parent, key];
};

describe("T877 public TOML edits, next/", () => {
  it.effect.prop(
    "L1 set changes only the selected segmented path across state-selected edits",
    Input,
    ({ seed, initial, values }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const start = fixture(l, initial);
        let text = start.text;
        let model: Tree = start.value;

        for (const [i, hint] of l.hints.entries()) {
          const parsed = yield* document(toml, text, model);
          const path = selected(model, parsed.value, hint);
          const value = frozen(values[i % values.length]!);
          const before = text;
          const next = yield* toml.set(text, Object.freeze([...path]), value);
          model = put(model, path, value);
          yield* document(toml, next, model);
          // Reusing an earlier input must still read its original values.
          expect((yield* toml.parse(before)).value).toEqual(parsed.value);
          text = next;
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L2 replacement preserves every byte outside the independently marked value range",
    Input,
    ({ seed, initial, values }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        // Each slot records source pieces when the fixture is written, before the edit.
        const slots = [
          { prefix: `"a.b"${l.space}`, token: String(initial), suffix: " # keep-0-雪" },
          { prefix: `second${l.space}`, token: `'''line # [ =\n雪'''`, suffix: " # keep-1-雪" },
          { prefix: `third${l.space}`, token: `[${initial}, { k = "# inside string" }]`, suffix: " # keep-2-雪" },
          { prefix: `fourth${l.space}`, token: `{ "" = ${initial}, peer = true }`, suffix: " # keep-3-雪" },
        ];
        const paths = [["a.b"], ["second"], ["third"], ["fourth"]];
        const endings = slots.map((_, i) => (l.mixed && i % 2 ? "\n" : l.eol));
        const prefix = `# first-雪${l.eol}date = 1979-05-27T07:32:00Z${l.eol}large = 9_223_372_036_854_775_807${l.eol}`;
        const suffix = `${l.eol}# last-雪${l.final ? l.eol : ""}`;
        const write = () => prefix + slots.map((s, i) => s.prefix + s.token + s.suffix + endings[i]).join("") + suffix;
        let text = write();
        let model = (yield* toml.parse(text)).value;

        for (const [i, hint] of l.hints.entries()) {
          const slot = hint.pick % slots.length;
          const current = slots[slot]!;
          const at =
            prefix.length +
            slots
              .slice(0, slot)
              .reduce((n, s, j) => n + s.prefix.length + s.token.length + s.suffix.length + endings[j]!.length, 0) +
            current.prefix.length;
          const head = text.slice(0, at);
          const tail = text.slice(at + current.token.length);
          const value = frozen(values[i % values.length]!);
          const edited = yield* toml.set(text, paths[slot]!, value);
          expect(edited.startsWith(head)).toBe(true);
          expect(edited.endsWith(tail)).toBe(true);
          current.token = edited.slice(head.length, edited.length - tail.length);
          expect(edited).toBe(write());
          model = put(model, paths[slot]!, value);
          expect((yield* toml.parse(edited)).value).toEqual(model);
          text = edited;
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L2 container comments survive replacement and removal once, in source order",
    { seed: Schema.Int, value: Value },
    ({ seed, value }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const before = `# before-雪${l.eol}`;
        const pair = `target${l.space}[${l.eol}  1, # inner-0-雪${l.eol}  "# text", # inner-1-雪${l.eol}] # attached-雪`;
        const after = `${l.eol}${l.eol}[next]${l.eol}peer  = 'unchanged # text'${l.final ? l.eol : ""}`;
        const source = before + pair + after;

        for (const operation of [toml.set(source, ["target"], value), toml.remove(source, ["target"])]) {
          const edited = yield* operation;
          retained(edited, ["# before-雪", "# inner-0-雪", "# inner-1-雪", "# attached-雪"]);
          expect(edited.startsWith(before)).toBe(true);
          expect(edited.endsWith(after)).toBe(true);
          expect((yield* toml.parse(edited)).value.next).toEqual({ peer: "unchanged # text" });

          // Rehomed comments must be standalone, never embedded in the new value.
          for (const comment of ["# inner-0-雪", "# inner-1-雪"]) {
            expect(edited.split(/\r?\n/).some((line) => line.trim() === comment)).toBe(true);
          }
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  for (const operation of ["set", "remove"] as const) {
    it.effect.prop(
      `L2 ${operation} keeps nested inline member comments in order across state-selected edits`,
      {
        seed: Schema.Int,
        depth: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
        members: Schema.Array(Scalar).check(Schema.isBetweenLength(2, 8)),
        values: Schema.Array(Value).check(Schema.isBetweenLength(1, 8)),
      },
      ({ seed, depth, members, values }) =>
        Effect.gen(function* () {
          const toml = yield* Toml;
          const l = layout(seed);
          const array = (value: unknown, marker: string) => `[${literal(value)}, "# string text", ${marker}${l.eol}]`;
          const keys = members.map((_, i) => segments[i]!);
          let markers = members.map((_, i) => `# member-${i}-雪`);
          let inline = `{ ${members
            .map((value, i) => `${keyText(keys[i]!, l.quote)}${l.space}${array(value, markers[i]!)}`)
            .join(", ")} }`;
          let model: Tree = Object.fromEntries(members.map((value, i) => [keys[i]!, [value, "# string text"]]));
          let paths: Array<Path> = keys.map((key) => [key]);
          const siblings: Array<string> = [];

          for (let level = 0; level < depth; level++) {
            const before = `# before-${level}-雪`;
            const after = `# after-${level}-雪`;
            const first = pick(members, level);
            const last = pick(members, level + 1);
            const head = `before${l.space}${array(first, before)}`;
            const tail = `after${l.space}${array(last, after)}`;
            siblings.push(head, tail);
            inline = `{ ${head}, child${l.space}${inline}, ${tail} }`;
            model = { before: [first, "# string text"], child: model, after: [last, "# string text"] };
            paths = paths.map((path) => ["child", ...path]);
            markers = [before, ...markers, after];
          }

          const prefix = `# first-雪${l.eol}`;
          const suffix = ` # attached-雪${l.eol}${l.eol}[next]${l.eol}peer = 'unchanged # text'${l.final ? l.eol : ""}`;
          const source = `${prefix}box${l.space}${inline}${suffix}`;
          let text = source;
          model = { box: model, next: { peer: "unchanged # text" } };
          paths = paths.map((path) => ["box", ...path]);
          const original = model;
          const comments = ["# first-雪", ...markers, "# attached-雪"];

          // Select only members still present in both the model and the reparsed document.
          for (let i = 0; paths.length > 0; i++) {
            const parsed = yield* toml.parse(text);
            expect(parsed.value).toEqual(model);
            const hint = l.hints[i % l.hints.length]!;
            const choices = paths.filter(
              (path) => get(model, path) !== undefined && get(parsed.value, path) !== undefined,
            );
            const path = pick(choices, hint.pick);
            const value = frozen(pick(values, hint.key));
            text = yield* operation === "set" ? toml.set(text, path, value) : toml.remove(text, path);
            model = operation === "set" ? put(model, path, value) : drop(model, path);
            expect((yield* toml.parse(text)).value).toEqual(model);
            retained(text, comments);
            expect(text.startsWith(prefix)).toBe(true);
            expect(text.endsWith(suffix)).toBe(true);

            for (const sibling of siblings) {
              expect(text).toContain(sibling);
            }

            expect((yield* toml.parse(source)).value).toEqual(original);
            paths = paths.filter((candidate) => !same(candidate, path));
          }
        }).pipe(Effect.provide(TomlParser.layer)),
      check,
    );
  }

  it.effect.prop(
    "L3 insertion keeps legal root, explicit, implicit, dotted and inline parents",
    Input,
    ({ seed, initial, values }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const start = fixture(l, initial);
        let text = start.text;
        let model: Tree = start.value;

        for (const [i, hint] of l.hints.entries()) {
          const parsed = yield* document(toml, text, model);
          const path = absent(model, parsed.value, hint);
          const value = frozen(values[i % values.length]!);
          const next = yield* toml.set(text, path, value);
          model = put(model, path, value);
          yield* document(toml, next, model);
          // All old lines are kept verbatim except an inline member's punctuation.
          const oldLines = (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).filter(
            (line) => line.trim().length > 0 && !line.includes("{") && !line.includes("}"),
          );
          let end = -1;

          for (const line of oldLines) {
            const at = next.indexOf(line, end + 1);
            expect(at, line).toBeGreaterThan(end);
            end = at;
          }

          expect(next.endsWith("\n")).toBe(text.endsWith("\n"));

          if (path.length === 1 && (l.style === "explicit" || l.style === "implicit")) {
            const inserted = (yield* toml.parse(next)).spans.find((s) => same(s.path, path))!;
            const commentLine = next.slice(0, next.indexOf("# note-3-雪")).split(/\r?\n/).length;
            expect(inserted.line).toBeLessThan(commentLine);
          }

          // Find the changed text independently, including in a document with mixed endings.
          let head = 0;

          while (head < text.length && text[head] === next[head]) {
            head++;
          }

          let tail = 0;

          while (tail < text.length - head && text[text.length - tail - 1] === next[next.length - tail - 1]) {
            tail++;
          }

          const changed = next.slice(head, next.length - tail);
          expect(l.eol === "\r\n" ? changed.replaceAll("\r\n", "").includes("\n") : changed.includes("\r\n")).toBe(
            false,
          );

          text = next;
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L3 empty documents use LF and preserve final-newline presence",
    { seed: Schema.Int, value: Value },
    ({ seed, value }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const path = [pick(segments, Math.abs(seed))];
        const next = yield* toml.set("", path, value);
        expect((yield* toml.parse(next)).value).toEqual(put({}, path, value));
        expect(next.includes("\r")).toBe(false);
        expect(next.endsWith("\n")).toBe(false);
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L4 removal preserves siblings, comments and empty headers and is idempotent",
    { seed: Schema.Int, initial: Integer },
    ({ seed, initial }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const start = fixture(l, initial);
        let text = start.text;
        let model: Tree = start.value;
        const removed: Array<Path> = [];
        const headers = text.split(/\r?\n/).filter((line) => line.startsWith("["));

        // Drain the current leaves, so inline first/middle/last/only positions all occur.
        for (let i = 0; leaves(model).length > 0; i++) {
          const parsed = yield* document(toml, text, model);
          // Empty structural tables stay in the model; they are not assigned leaves.
          const choices = leaves(model).filter(
            (p) => !record(get(model, p)) || (l.style === "inline" && p.length === 1 && p[0] === "box"),
          );

          if (choices.length === 0) {
            break;
          }

          const hint = l.hints[i % l.hints.length]!;
          const path = pick(
            choices.filter((p) => get(parsed.value, p) !== undefined),
            hint.pick,
          );
          const edited = yield* toml.remove(text, path);
          model = drop(model, path);

          // A dotted parent has no header left to declare it after its last key goes.
          const box = get(model, ["box"]);

          if (l.style === "dotted" && record(box) && Object.keys(box).length === 0) {
            model = drop(model, ["box"]);
          }

          yield* document(toml, edited, model);
          removed.push(path);
          expect(yield* toml.remove(edited, pick(removed, hint.key))).toBe(edited);

          for (const header of headers) {
            expect(edited.includes(header)).toBe(true);
          }

          expect(edited.endsWith("\n")).toBe(text.endsWith("\n"));
          text = edited;
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L4 removing an assignment changes no bytes except its key/value text",
    { seed: Schema.Int, initial: Integer },
    ({ seed, initial }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const prefix = `# before${l.eol}[box]${l.eol}`;
        const assigned = `"a.b"${l.space}${initial}`;
        const suffix = ` # keep-attached${l.eol}${l.eol}next = "# unchanged"${l.final ? l.eol : ""}`;
        const edited = yield* toml.remove(prefix + assigned + suffix, ["box", "a.b"]);
        // Only the assignment is removed. Whitespace and its trailing comment survive.
        expect(edited).toBe(prefix + suffix);
        expect((yield* toml.parse(edited)).value).toEqual({ box: { next: "# unchanged" } });
        expect(yield* toml.remove(edited, ["box", "a.b"])).toBe(edited);
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L2 L4 inline removal changes only the member and one adjacent comma",
    { seed: Schema.Int, values: Schema.Array(Scalar).check(Schema.isBetweenLength(1, 8)) },
    ({ seed, values }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        type Piece = { readonly text: string; readonly member?: string; readonly comma?: number };
        let pieces: Array<Piece> = [{ text: `# before${l.eol}box${l.space}{  ` }];
        const initial = Object.fromEntries(values.map((v, i) => [`k${i}`, v]));
        let model: Tree = initial;
        values.forEach((value, i) => {
          pieces.push({ text: `k${i}${l.space}${literal(value)}`, member: `k${i}` });

          if (i < values.length - 1) {
            pieces.push({ text: " " }, { text: ",", comma: i }, { text: "\t " });
          }
        });
        pieces.push({ text: `  } # attached${l.eol}other = 'unchanged # text'${l.final ? l.eol : ""}` });
        const write = (parts: ReadonlyArray<Piece>) => parts.map((part) => part.text).join("");
        let text = write(pieces);

        for (let i = 0; Object.keys(model).length > 0; i++) {
          const parsed = yield* toml.parse(text);
          expect(parsed.value).toEqual({ box: model, other: "unchanged # text" });
          const hint = l.hints[i % l.hints.length]!;
          const key = pick(
            Object.keys(model).filter((key) => get(parsed.value, ["box", key]) !== undefined),
            hint.pick,
          );
          const at = pieces.findIndex((piece) => piece.member === key);
          const left = pieces.findLastIndex((piece, index) => index < at && piece.comma !== undefined);
          const right = pieces.findIndex((piece, index) => index > at && piece.comma !== undefined);
          const candidates = [...new Set([left, right].filter((index) => index >= 0))];
          const choices = (candidates.length === 0 ? [-1] : candidates).map((comma) =>
            pieces.filter((_, index) => index !== at && index !== comma),
          );
          const edited = yield* toml.remove(text, ["box", key]);
          expect(choices.map(write)).toContain(edited);
          pieces = choices.find((choice) => write(choice) === edited)!;
          model = drop(model, [key]);
          expect((yield* toml.parse(edited)).value).toEqual({ box: model, other: "unchanged # text" });
          expect(yield* toml.remove(edited, ["box", key])).toBe(edited);
          text = edited;
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L5 invalid source is refused even for absent removal",
    Input,
    ({ seed, initial, values }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const start = fixture(l, initial);
        let text = start.text;
        let model: Tree = start.value;

        // Three edit requests per hint, within the plan's 40-request bound.
        for (const [i, hint] of l.hints.slice(0, 13).entries()) {
          const current = yield* document(toml, text, model);
          const editedPath = selected(model, current.value, hint);
          const value = frozen(values[i % values.length]!);
          text = yield* toml.set(text, editedPath, value);
          model = put(model, editedPath, value);
          const parsed = yield* document(toml, text, model);
          const path = absent(model, parsed.value, hint);
          const bad = pick(
            [
              `broken = ]${l.eol}${text}`,
              `duplicate = 1${l.eol}duplicate = 2${l.eol}${text}`,
              `[conflict]${l.eol}x = 1${l.eol}[conflict]${l.eol}y = 2${l.eol}${text}`,
              `parent = 1${l.eol}[parent]${l.eol}x = 2${l.eol}${text}`,
            ],
            hint.key,
          );
          yield* refusal(toml.set(bad, path, value), "Syntax");
          yield* refusal(toml.remove(bad, path), "Syntax");
          yield* document(toml, text, model);
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L5 empty paths, scalars, arrays and structural tables refuse traversal",
    { seed: Schema.Int, initial: Integer },
    ({ seed, initial }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const text = `# first${l.eol}scalar = ${initial}${l.eol}array = [${initial}]${l.eol}[[rows]]${l.eol}x = ${initial}${l.eol}[table]${l.eol}x = ${initial}`;
        const parsed = yield* toml.parse(text);
        const hint = l.hints[0]!;
        const parent = pick(["scalar", "array", "rows", "table"], hint.pick);
        const path = parent === "table" ? [parent] : [parent, parent === "rows" ? "0" : pick(segments, hint.key)];
        const line = parsed.spans.find((s) => s.path[0] === parent)!.line;
        const set = yield* refusal(toml.set(text, path, 2), "Conflict", line);
        expect(set.reason).toMatchObject({ path });
        yield* refusal(toml.remove(text, path), "Conflict", line);
        yield* refusal(toml.set(text, [], 2), "Conflict", 1);
        yield* refusal(toml.remove(text, []), "Conflict", 1);
        expect((yield* toml.parse(text)).value).toEqual(parsed.value);
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L5 unsupported values never produce text or silently drop a member",
    Input,
    ({ seed, initial }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const start = fixture(l, initial);
        const parsed = yield* toml.parse(start.text);
        const path = selected(start.value, parsed.value, l.hints[0]!);
        const cycle: Record<string, unknown> = {};
        cycle.self = cycle;
        const sparse: Array<unknown> = Array.from({ length: 2 });
        Reflect.deleteProperty(sparse, 0);
        const bad: ReadonlyArray<unknown> = [
          null,
          undefined,
          () => initial,
          Symbol("made-up"),
          cycle,
          Number.NaN,
          Infinity,
          -Infinity,
          Number.MAX_SAFE_INTEGER + 1,
          1n,
          new Date(0),
          new Map(),
          sparse,
        ];

        for (const value of bad) {
          yield* refusal(toml.set(start.text, path, value), "Value");
          yield* refusal(toml.set(start.text, path, { nested: [value] }), "Value");
        }

        expect((yield* toml.parse(start.text)).value).toEqual(start.value);
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L6 equal sets and absent removes return identical bytes after earlier edits",
    Input,
    ({ seed, initial, values }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const start = fixture(l, initial);
        let text = start.text;
        let model: Tree = start.value;
        const history: Array<{ text: string; value: Tree }> = [];

        // Five edit requests per hint, within the plan's 40-request bound.
        for (const [i, hint] of l.hints.slice(0, 8).entries()) {
          const parsed = yield* document(toml, text, model);
          const path = selected(model, parsed.value, hint);
          expect(yield* toml.set(text, path, get(model, path))).toBe(text);
          expect(yield* toml.remove(text, absent(model, parsed.value, hint))).toBe(text);
          history.push({ text, value: model });
          text = yield* toml.set(text, path, values[i % values.length]!);
          model = put(model, path, values[i % values.length]!);
          yield* document(toml, text, model);
          const earlier = pick(history, hint.key);
          expect((yield* toml.parse(earlier.text)).value).toEqual(earlier.value);
          const other = `other = ${i}`;
          expect(yield* toml.remove(other, ["absent"])).toBe(other);
          expect(yield* toml.set(text, path, get(model, path))).toBe(text);
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L6 semantically equal containers and alternate scalar spellings keep the original text",
    { seed: Schema.Int, initial: Integer },
    ({ seed, initial }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const n = Math.abs(initial);
        const text =
          [
            `number = +${n}`,
            `hex = 0x${n.toString(16)}`,
            `word = '''雪 # text'''`,
            `array = [${n}, # inside-array${l.eol} true]`,
            `table = { b = 2, a = ${n} }`,
          ].join(l.eol) + (l.final ? l.eol : "");
        const parsed = yield* toml.parse(text);

        for (const path of Object.keys(parsed.value).map((key) => [key])) {
          expect(yield* toml.set(text, path, get(parsed.value, path))).toBe(text);
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L7 declaration-encoded writes pass the scoped file schema with exact text quantities",
    {
      seed: Schema.Int,
      ports: Schema.Array(Declarations.port.schema).check(Schema.isBetweenLength(1, 8)),
      quantities: Schema.Array(
        Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 9007199254740993n, maximum: 2n ** 100n })),
      ).check(Schema.isBetweenLength(1, 8)),
    },
    ({ seed, ports, quantities }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const bytes = Setting.make("limits.record", {
          schema: Schema.ByteSize,
          default: ByteSize.bytes(1),
          doc: "Generated exact quantity.",
          scope: ["person"],
          reload: "restart",
          since: "0.0.0",
          format: "text",
        });
        const group = Setting.group({ port: Declarations.port, bytes });
        const file = Files.schema(group, "person");
        let text = `# settings-雪${l.final ? l.eol : ""}`;
        const checkedSet = Effect.fnUntraced(function* <A>(
          source: string,
          declaration: Setting.Setting<A>,
          value: A,
          scope: Setting.File,
        ) {
          const encoded = yield* Schema.encodeEffect(Codec.file(declaration))(value);
          const candidate = yield* toml.set(source, declaration.segments, encoded);
          const parsed = yield* toml.parse(candidate);
          yield* Schema.decodeUnknownEffect(Files.schema(group, scope))(parsed.value, strict);
          return candidate;
        });

        // At most five checked or raw edit requests per hint.
        for (const [i, hint] of l.hints.slice(0, 8).entries()) {
          const port = pick(ports, hint.pick);
          const count = pick(quantities, hint.key);
          text = yield* checkedSet(text, Declarations.port, port, "person");
          text = yield* checkedSet(text, bytes, ByteSize.bytes(count), "person");
          const parsed = yield* toml.parse(text);
          const decoded = yield* Schema.decodeUnknownEffect(file)(parsed.value, strict);
          expect(decoded).toEqual({ instance: { port }, limits: { record: ByteSize.bytes(count) } });
          expect(get(parsed.value, bytes.segments)).toBe(Schema.encodeSync(Codec.file(bytes))(ByteSize.bytes(count)));
          expect(Exit.isFailure(yield* Effect.exit(checkedSet(text, Declarations.port, port, "repo")))).toBe(true);
          const invalid = i % 2 ? 0 : 65536;
          expect(Exit.isFailure(yield* Effect.exit(checkedSet(text, Declarations.port, invalid, "person")))).toBe(true);
          // Raw TOML editing does not know a declaration's range or file scope.
          const raw = yield* toml.set(text, Declarations.port.segments, invalid);
          expect(get((yield* toml.parse(raw)).value, Declarations.port.segments)).toBe(invalid);
          expect(
            Exit.isFailure(
              yield* Effect.exit(Schema.decodeUnknownEffect(file)((yield* toml.parse(raw)).value, strict)),
            ),
          ).toBe(true);
          retained(text, ["# settings-雪"]);
        }
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );

  it.effect.prop(
    "L8 a throwing value encoder retains the exact underlying failure",
    { seed: Schema.Int, value: Scalar },
    ({ seed, value }) =>
      Effect.gen(function* () {
        const toml = yield* Toml;
        const l = layout(seed);
        const cause = new Error("generated encoder failure");
        const failing = throwingRecord(cause);
        const text = `target = ${literal(value)}${l.final ? l.eol : ""}`;
        const error = yield* refusal(toml.set(text, ["target"], failing), "Value");
        expect(error.reason.cause).toBe(cause);
        expect(error.cause).toBe(cause);
        expect((yield* toml.parse(text)).value).toEqual({ target: value });
      }).pipe(Effect.provide(TomlParser.layer)),
    check,
  );
});
