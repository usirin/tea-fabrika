// `fabrika/no-of` against generated modules, in process through oxlint's RuleTester (0029). Each
// module is 1 to 6 pieces, one per line; the oracle is the plan's case table: the lines that fire,
// each with its message. The valid case is the same module with every firing line taken out.
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { it } from "vitest";
import { noOf } from "./no-of.ts";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: import.meta.dirname });
const RUNS = { seed: 119120, numRuns: 100 };

/** Which diagnostic a line gets: a declared name, or a named import of `of`. */
type Message = "name" | "import";
const MESSAGES: Record<Message, RegExp> = { name: /no bare `of` and no `xOf` names/, import: /imported by name/ };

/** `of` exactly, an `xOf` name, a plain name, or one of the fixed near names (L6). */
type Class = "of" | "xOf" | "plain" | "near";
type Name = { readonly cls: Class; readonly base: string; readonly tail: string };

/**
 * The name piece `i` declares. The index keeps names unique per module, and the `P` before it keeps a
 * plain name off every reserved word and off the helpers' names (`h3`, `H3`, `S3`, `M3`, `m3`).
 */
const spell = ({ cls, base, tail }: Name, i: number): string => {
  switch (cls) {
    case "of":
      return "of";
    case "xOf":
      return `${base}${i}${tail}`;
    case "plain":
      return `${base}P${i}`;
    case "near":
      return base;
  }
};

const NEAR = ["offer", "thereof", "Of", "OF", "ofs"] as const;

const name = (classes: readonly ("of" | "xOf" | "plain")[]): fc.Arbitrary<Name> =>
  fc.record({
    cls: fc.constantFrom(...classes),
    base: fc.stringMatching(/^[a-z][A-Za-z0-9]{0,5}$/),
    tail: fc.constantFrom("Of", "0Of", "URLOf"),
  });

/** One top-level line: its text, and what fires on it for `of` and for an `xOf` name. A plain name passes. */
type Shape = {
  readonly text: (n: string, i: number, from: string) => string;
  readonly of: readonly Message[];
  readonly xOf: readonly Message[];
  readonly once?: true;
};

const banned = (text: Shape["text"]): Shape => ({ text, of: ["name"], xOf: ["name"] });

/** L1: a module's top-level exported `of`; the same shape with an `xOf` name fires. */
const ALLOWED: readonly Shape[] = [
  { text: (n, i) => `export const ${n} = ${i};`, of: [], xOf: ["name"] },
  { text: (n, i) => `export let ${n} = ${i};`, of: [], xOf: ["name"] },
  { text: (n, i) => `export function ${n}() { return ${i}; }`, of: [], xOf: ["name"] },
  { text: (n, i) => `export declare function ${n}(h${i}: string): string;`, of: [], xOf: ["name"] },
  {
    text: (n, i) =>
      `export function ${n}(h${i}: string): string; export function ${n}(h${i}: unknown) { return h${i}; }`,
    of: [],
    xOf: ["name", "name"],
  },
  { text: (n, i) => `export const { a: ${n} } = { a: ${i} };`, of: [], xOf: ["name"] },
  { text: (n, i) => `const ${n} = ${i}; export { ${n} };`, of: [], xOf: ["name"] },
];

/** L2: every other declared `of` or `xOf` name fires, old positions and newly visited ones. */
const BANNED: readonly Shape[] = [
  banned((n, i) => `const ${n} = ${i};`),
  banned((n, i) => `function ${n}() { return ${i}; }`),
  banned((n, i) => `export function h${i}() { const ${n} = ${i}; return ${n}; }`),
  banned((n, i) => `{ const ${n} = ${i}; void ${n}; }`),
  banned((n, i) => `export namespace S${i} { export const ${n} = ${i}; }`),
  banned((n, i) => `declare module "m${i}" { export function ${n}(): void; }`),
  { ...banned((n) => `export default function ${n}() {}`), once: true },
  banned((n, i) => `const ${n} = ${i}; export { ${n} as m${i} };`),
  // A type-only export is never read as `M.of`, so the local it names stays a bare `of`.
  banned((n, i) => `const ${n} = ${i}; export type { ${n} };`),
  banned((n, i) => `const ${n} = ${i}; export { type ${n} };`),
  banned((n, i) => `let ${n} = ${i}; export type { ${n} };`),
  banned((n, i) => `const { a: ${n} } = { a: ${i} }; export type { ${n} };`),
  banned((n, i) => `function ${n}() { return ${i}; } export type { ${n} };`),
  banned((n, i) => `declare function ${n}(h${i}: string): string; export { type ${n} };`),
  // Beside a top-level `const of; export { of }`, which passes: the flag it sets covers that one
  // binding, never a nested `of`. An `xOf` name fires at both.
  ...[
    (n: string, i: number) => `export function h${i}() { const ${n} = ${i}; return ${n}; }`,
    (n: string, i: number) => `{ const ${n} = ${i}; void ${n}; }`,
    (n: string, i: number) => `namespace S${i} { const ${n} = ${i}; void ${n}; }`,
    (n: string, i: number) => `declare module "m${i}" { function ${n}(): void; }`,
  ].map((nested): Shape => ({
    text: (n, i) => `const ${n} = ${i}; export { ${n} }; ${nested(n, i)}`,
    of: ["name"],
    xOf: ["name", "name"],
  })),
  // Neither sets the flag: `export { of } from` names another module's `of`, and `export { a as of }`
  // exports `a`, so the local `of` stays a bare `of`.
  banned((n, i, from) => `const ${n} = ${i}; export { ${n} } from "${from}";`),
  {
    text: (n, i) => `const ${n} = ${i}; declare const h${i}: number; export { h${i} as ${n} };`,
    of: ["name"],
    xOf: ["name", "name"],
  },
  banned((n) => `export type ${n} = number;`),
  banned((n, i) => `export interface ${n} { readonly h${i}: string }`),
  banned((n) => `export class ${n} {}`),
  banned((n) => `export enum ${n} { A }`),
  banned((n, i) => `export const h${i} = (${n}: number) => ${n};`),
  banned((n, i) => `export function h${i}(${n}: number) { return ${n}; }`),
  banned((n, i) => `export const h${i} = (${n} = 1) => ${n};`),
  banned((n, i) => `export const h${i} = (...${n}: number[]) => ${n};`),
  banned((n, i) => `export const h${i} = ({ a: ${n} }: { a: number }) => ${n};`),
  banned((n, i) => `export const h${i} = ([${n}]: number[]) => ${n};`),
  banned((n, i) => `export class H${i} { constructor(readonly ${n}: number) {} }`),
  banned((n, i) => `export type H${i} = { m${i}(${n}: number): void };`),
  banned((n, i) => `export const h${i} = { ${n}: ${i} };`),
  banned((n, i) => `export const h${i} = { "${n}": ${i} };`),
  banned((n, i) => `export const h${i} = { ${n}() { return ${i}; } };`),
  banned((n, i) => `export class H${i} { ${n} = ${i}; }`),
  banned((n, i) => `export class H${i} { ${n}() { return ${i}; } }`),
  banned((n, i) => `export class H${i} { static ${n}() { return ${i}; } }`),
  banned((n, i) => `export class H${i} { get ${n}() { return ${i}; } }`),
  banned((n, i) => `export type H${i} = { ${n}: string };`),
  banned((n, i) => `export type H${i} = { ${n}(): void };`),
  // Newly visited: catch, type parameter, enum member, namespace, import-equals, accessor, abstract.
  banned((n) => `try { void 0; } catch (${n}) { void ${n}; }`),
  banned((n, i) => `export type H${i}<${n}> = ${n}[];`),
  banned((n, i) => `export enum H${i} { ${n} }`),
  banned((n, i) => `export namespace ${n} { export const h${i} = ${i}; }`),
  banned((n, i) => `import ${n} = require("./m${i}.ts");`),
  banned((n, i) => `export class H${i} { accessor ${n} = ${i}; }`),
  banned((n, i) => `export abstract class H${i} { abstract ${n}(): void; }`),
  banned((n, i) => `export abstract class H${i} { abstract ${n}: number; }`),
  banned((n, i) => `export abstract class H${i} { abstract accessor ${n}: number; }`),
];

/** L3: a named import of `of` fires; a local binding named `of` or `xOf` fires; a borrowed `xOf` passes. */
const IMPORTS: readonly Shape[] = [
  { text: (n, _i, from) => `import { ${n} } from "${from}";`, of: ["import"], xOf: [] },
  { text: (n, i, from) => `import { ${n} as m${i} } from "${from}";`, of: ["import"], xOf: [] },
  { text: (n, _i, from) => `import { type ${n} } from "${from}";`, of: ["import"], xOf: [] },
  { text: (n, _i, from) => `import type { ${n} } from "${from}";`, of: ["import"], xOf: [] },
  banned((n, i, from) => `import { h${i} as ${n} } from "${from}";`),
  banned((n, _i, from) => `import ${n} from "${from}";`),
  banned((n, _i, from) => `import * as ${n} from "${from}";`),
  // The import fires; the export of what it bound is a borrowed name and passes.
  { text: (n, _i, from) => `import { ${n} } from "${from}"; export { ${n} };`, of: ["import"], xOf: [] },
];

/** L4: re-exports and uses pass; a name chosen here (`as N`, `* as N`) with an `xOf` name fires. */
const EXPORTS: readonly Shape[] = [
  { text: (n, _i, from) => `export { ${n} } from "${from}";`, of: [], xOf: [] },
  { text: (n, i) => `declare const h${i}: number; export { h${i} as ${n} };`, of: [], xOf: ["name"] },
  { text: (n, i, from) => `export { h${i} as ${n} } from "${from}";`, of: [], xOf: ["name"] },
  { text: (n, _i, from) => `export * as ${n} from "${from}";`, of: [], xOf: ["name"] },
  { text: (n, i, from) => `import * as M${i} from "${from}"; export const h${i} = M${i}.${n}(1);`, of: [], xOf: [] },
  { text: (n, i) => `export const h${i} = Uint8Array.${n}(1);`, of: [], xOf: [] },
  { text: (n, i) => `export const h${i} = CheckedWriter.${n}({ a: ${i} });`, of: [], xOf: [] },
  { text: (n, i) => `declare const z${i}: number[]; export const h${i} = z${i}.${n}(1);`, of: [], xOf: [] },
];

const hits = (shape: Shape, n: Name): readonly Message[] =>
  n.cls === "of" ? shape.of : n.cls === "xOf" ? shape.xOf : [];

type Piece = { readonly shape: Shape; readonly name: Name; readonly from: string };

const from = fc.constantFrom("./m.ts", "effect/Chunk", "@kampus/x");

const piece = (shapes: readonly Shape[], n: fc.Arbitrary<Name>): fc.Arbitrary<Piece> =>
  fc.record({ shape: fc.constantFrom(...shapes), name: n, from });

/** Other pieces beside the one under test: never `of`, never a second default export. */
const filler = piece(
  [...ALLOWED, ...BANNED, ...IMPORTS, ...EXPORTS].filter((s) => s.once === undefined),
  name(["xOf", "plain"]),
);

/** The piece under test at a drawn position among 0 to 5 others. */
const place = (main: Piece, others: readonly Piece[], at: number): readonly Piece[] => {
  const k = at % (others.length + 1);
  return [...others.slice(0, k), main, ...others.slice(k)];
};

/** One line of a case, and what fires on it. */
type Line = { readonly text: string; readonly fires: readonly Message[] };

/** RuleTester: the module fires exactly these lines with these messages, and the rest of it fires nothing. */
const check = (lines: readonly Line[]) => {
  const code = lines.map((l) => l.text).join("\n");
  const errors = lines.flatMap((l, i) => l.fires.map((m) => ({ line: i + 1, message: MESSAGES[m] })));
  const valid = lines
    .filter((l) => l.fires.length === 0)
    .map((l) => l.text)
    .join("\n");
  tester.run("no-of", noOf, {
    valid: [{ code: valid, filename: "case.ts" }],
    invalid: errors.length === 0 ? [] : [{ code, filename: "case.ts", errors }],
  });
};

const render = (pieces: readonly Piece[]): readonly Line[] =>
  pieces.map((p, i) => ({ text: p.shape.text(spell(p.name, i), i, p.from), fires: hits(p.shape, p.name) }));

const all = name(["of", "xOf", "plain"]);

/**
 * Each run draws a name, a source, 0 to 5 other pieces and a position, then checks every shape in
 * `shapes` there. Drawing one shape per run left a 1 in 90 chance per run of `of` in a given shape,
 * and the seed never drew `export namespace S { export const of }`, so the "any depth" plant lived.
 */
const everyShape = (shapes: readonly Shape[], n: fc.Arbitrary<Name>) =>
  fc.property(n, from, fc.array(filler, { maxLength: 5 }), fc.nat(), (nm, f, others, at) => {
    for (const shape of shapes) {
      check(render(place({ shape, name: nm, from: f }, others, at)));
    }
  });

it("L1: a module's top-level exported `of` passes in every allowed shape; an `xOf` name there fires", () => {
  fc.assert(everyShape(ALLOWED, all), RUNS);
});

it("L2: every other declared `of` or `xOf` name fires, newly visited positions included", () => {
  fc.assert(everyShape(BANNED, name(["of", "xOf"])), RUNS);
});

it("L3: a named import of `of` fires, renamed or type-only, and so does a local import bound as `of` or `xOf`", () => {
  fc.assert(everyShape(IMPORTS, all), RUNS);
});

it("L4: re-exports and uses pass; `export { a as N }` and `export * as N` with an `xOf` name fire", () => {
  fc.assert(everyShape(EXPORTS, all), RUNS);
});

/** L5's inner pieces: an object key, a parameter, a nested const. */
type Inner = { readonly kind: "key" | "param" | "const"; readonly name: Name };

/** `of` at most once inside, so nothing is declared twice. */
const once = (inner: readonly Inner[]): readonly Inner[] =>
  inner.map((p, i) =>
    p.name.cls === "of" && inner.slice(0, i).some((q) => q.name.cls === "of")
      ? { ...p, name: { ...p.name, cls: "xOf" } }
      : p,
  );

const inside = (outer: "object" | "function", inner: readonly Inner[]): readonly Line[] => {
  const fires = (p: Inner): readonly Message[] => (p.name.cls === "plain" ? [] : ["name"]);
  const line = (p: Inner, i: number, text: (n: string) => string): Line => ({
    text: text(spell(p.name, i)),
    fires: fires(p),
  });

  if (outer === "object") {
    const entry: Record<Inner["kind"], (n: string, i: number) => string> = {
      key: (n, i) => `  ${n}: ${i},`,
      param: (n, i) => `  h${i}(${n}: number) { return ${n}; },`,
      const: (n, i) => `  h${i}: () => { const ${n} = ${i}; return ${n}; },`,
    };
    const body = inner.map((p, i) => line(p, i, (n) => entry[p.kind](n, i)));
    return [{ text: "export const of = {", fires: [] }, ...body, { text: "};", fires: [] }];
  }

  const params = inner.flatMap((p, i) => (p.kind === "param" ? [line(p, i, (n) => `  ${n}: number,`)] : []));
  const body = inner.flatMap((p, i) =>
    p.kind === "key"
      ? [line(p, i, (n) => `  const h${i} = { ${n}: ${i} };`)]
      : p.kind === "const"
        ? [line(p, i, (n) => `  const ${n} = ${i};`)]
        : [],
  );
  return [
    { text: "export function of(", fires: [] },
    ...params,
    { text: ") {", fires: [] },
    ...body,
    { text: "  return 0;", fires: [] },
    { text: "}", fires: [] },
  ];
};

it("L5: inside an allowed `of`, every key, parameter and nested name is still checked", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("object" as const, "function" as const),
      fc.array(fc.record({ kind: fc.constantFrom("key" as const, "param" as const, "const" as const), name: all }), {
        minLength: 1,
        maxLength: 4,
      }),
      (outer, inner) => check(inside(outer, once(inner))),
    ),
    RUNS,
  );
});

it("L6: near names (`offer`, `thereof`, `Of`, `OF`, `ofs`) pass in every shape", () => {
  const shapes = [...ALLOWED, ...BANNED, ...IMPORTS, ...EXPORTS];
  fc.assert(
    fc.property(
      fc
        .uniqueArray(fc.record({ near: fc.constantFrom(...NEAR), shape: fc.constantFrom(...shapes), from }), {
          selector: (p) => p.near,
          minLength: 1,
          maxLength: 5,
        })
        .filter((ps) => ps.filter((p) => p.shape.once !== undefined).length <= 1),
      (pieces) =>
        check(
          render(pieces.map((p) => ({ shape: p.shape, from: p.from, name: { cls: "near", base: p.near, tail: "" } }))),
        ),
    ),
    RUNS,
  );
});
