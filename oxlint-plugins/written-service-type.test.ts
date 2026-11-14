// Ticket 908, law 5 of docs/plan/effect-rules-small.md. `fabrika/written-service-type` fires exactly
// when a service's type holds `ReturnType`, `Effect.Success` or a `typeof` query (decision 0095).
// Each generated file runs in process through oxlint's RuleTester; one oxlint run over the first
// file that fires then proves the repo's own .oxlintrc.json turns the rule on for next/ product
// code and leaves tests out.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { writtenServiceType } from "./written-service-type.ts";

// RuleTester runs each case at once, so a failure throws into fast-check, which shrinks it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so the rule reads each path as oxlint gives it there.
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });

const CODE = "fabrika(written-service-type)";

/** Every report names the rule's file, so a fire is known to be this rule's whatever its words are. */
const OURS = /written-service-type\.ts/;

/** What one drawn service is built from. `n` keeps its names apart from its neighbors'. */
interface Drawn {
  readonly n: number;
  readonly name: string;
  /** How the file writes `Effect.Success`, and whether that is Effect's own. */
  readonly success: string;
  readonly effects: boolean;
  /** Whether the file declares its own `ReturnType`, so the name is not the built-in. */
  readonly own: boolean;
}

/** A service's type: the lines it needs around the service, its text, and whether it must fire. */
interface Form {
  readonly imports?: ReadonlyArray<string>;
  readonly above?: ReadonlyArray<string>;
  readonly below?: ReadonlyArray<string>;
  readonly type: string;
  readonly fires: boolean;
}

/** A way to write a service: its lines, which of them holds the type, and whether the rule reads it. */
interface Spelling {
  readonly imports?: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<string>;
  readonly at: number;
  readonly read: boolean;
}

// How a file reaches `Effect.Success` (case 1), and two look-alikes that are not it.
const successes: ReadonlyArray<(n: number) => { imports: ReadonlyArray<string>; text: string; effects: boolean }> = [
  () => ({ imports: [], text: "Effect.Success", effects: true }),
  (n) => ({ imports: [`import { Effect as Fx${n} } from "effect";`], text: `Fx${n}.Success`, effects: true }),
  (n) => ({ imports: [`import * as Fx${n} from "effect/Effect";`], text: `Fx${n}.Success`, effects: true }),
  (n) => ({
    imports: [`import type * as Barrel${n} from "effect";`],
    text: `Barrel${n}.Effect.Success`,
    effects: true,
  }),
  (n) => ({ imports: [`import type { Success as Ok${n} } from "effect/Effect";`], text: `Ok${n}`, effects: true }),
  (n) => ({ imports: [`import { Effect as Mine${n} } from "./mine.ts";`], text: `Mine${n}.Success`, effects: false }),
  (n) => ({ imports: [`import { Exit as Exit${n} } from "effect";`], text: `Exit${n}.Success`, effects: false }),
];

const forms: ReadonlyArray<(d: Drawn) => Form> = [
  // Case 1: one of the three forms, as the whole type or anywhere inside it.
  ({ n }) => ({ type: `ReturnType<typeof make${n}>`, fires: true }),
  ({ n }) => ({ type: `typeof impl${n}`, fires: true }),
  ({ n }) => ({ type: `Readonly<typeof impl${n}>`, fires: true }),
  ({ n }) => ({ type: `{ readonly a: ReturnType<typeof make${n}>["a"] }`, fires: true }),
  ({ n }) => ({ type: `{ readonly a: typeof impl${n}.a }`, fires: true }),
  ({ n }) => ({ type: `{ readonly a: (typeof impl${n})["Type"] }`, fires: true }),
  ({ n }) => ({
    type: `{ readonly run: (n: number) => Promise<ReadonlyArray<ReturnType<typeof make${n}>>> }`,
    fires: true,
  }),
  // A spread of an implementation.
  ({ n }) => ({ type: `typeof impl${n} & { readonly extra: number }`, fires: true }),
  ({ n }) => ({ type: `{ readonly extra: number } & Omit<typeof impl${n}, "extra">`, fires: true }),
  // `Effect.Success` alone, over a type from another file: it fires only when it is Effect's.
  ({ n, success, effects }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`],
    type: `${success}<Made${n}>`,
    fires: effects,
  }),
  ({ n, success, effects }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`],
    type: `{ readonly a: () => ${success}<Made${n}>["a"] }`,
    fires: effects,
  }),
  ({ n, success }) => ({ type: `${success}<ReturnType<typeof make${n}>>`, fires: true }),
  // `ReturnType` alone: it fires unless the file declares its own type of that name.
  ({ n, own }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`],
    type: `ReturnType<Made${n}>`,
    fires: !own,
  }),
  // Case 4: an alias or an interface declared in this file is read through, above or below.
  ({ n }) => ({ above: [`type Shape${n} = ReturnType<typeof make${n}>;`], type: `Shape${n}`, fires: true }),
  ({ n }) => ({ below: [`type Shape${n} = typeof impl${n};`], type: `Shape${n}`, fires: true }),
  ({ n }) => ({
    above: [`type First${n} = Second${n};`, `type Second${n} = typeof impl${n};`],
    type: `First${n}`,
    fires: true,
  }),
  ({ n }) => ({
    above: [`type Part${n} = ReturnType<typeof make${n}>["a"];`],
    type: `{ readonly a: Part${n} }`,
    fires: true,
  }),
  ({ n }) => ({
    above: [`interface Shape${n} { readonly a: typeof impl${n}.a }`],
    type: `Shape${n}`,
    fires: true,
  }),
  ({ n, success, effects }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`],
    above: [`export type Shape${n} = ${success}<Made${n}>;`],
    type: `Shape${n}`,
    fires: effects,
  }),
  // Case 4: an interface's `extends` list is read as the body is.
  ({ n }) => ({
    above: [`interface Shape${n} extends ReturnType<typeof make${n}> {}`],
    type: `Shape${n}`,
    fires: true,
  }),
  ({ n, success, effects }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`],
    above: [`interface Shape${n} extends ${success}<Made${n}> { readonly extra: number }`],
    type: `Shape${n}`,
    fires: effects,
  }),
  ({ n }) => ({
    above: [`type Base${n} = ReturnType<typeof make${n}>;`, `interface Shape${n} extends Written${n}, Base${n} {}`],
    below: [`interface Written${n} { readonly size: number }`],
    type: `{ readonly a: Shape${n} }`,
    fires: true,
  }),
  ({ n }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`],
    above: [`interface Shape${n} extends Made${n}<typeof Row${n}.Type> {}`],
    type: `Shape${n}`,
    fires: true,
  }),
  ({ n }) => ({
    above: [`interface Base${n} { readonly size: number }`, `interface Shape${n} extends Base${n} {}`],
    type: `Shape${n}`,
    fires: false,
  }),
  ({ n }) => ({
    imports: [`import type { Made${n} } from "./made.ts";`, `import type * as Shapes${n} from "./shape.ts";`],
    above: [`interface Shape${n} extends Made${n}, Shapes${n}.Inferred<number> { readonly size: number }`],
    type: `Shape${n}`,
    fires: false,
  }),
  // Case 6: `typeof X.Type` fires as the whole type or as a spread, in the type or behind an alias.
  ({ n }) => ({ type: `typeof Row${n}.Type`, fires: true }),
  ({ n }) => ({ type: `Readonly<typeof Row${n}.Type>`, fires: true }),
  ({ n }) => ({ type: `typeof Row${n}.Type & { readonly extra: number }`, fires: true }),
  ({ n }) => ({ above: [`type Shape${n} = typeof Row${n}.Type;`], type: `Shape${n}`, fires: true }),
  // Case 6: inside a member's signature it passes.
  ({ n }) => ({ type: `{ readonly decode: (raw: string) => typeof Row${n}.Type }`, fires: false }),
  ({ n }) => ({
    type: `{ readonly rows: Effect.Effect<ReadonlyArray<typeof Row${n}.Type>, Failure${n}> }`,
    fires: false,
  }),
  ({ n }) => ({
    above: [`type Value${n} = typeof Row${n}.Type;`],
    type: `{ readonly row: Value${n} } & { readonly put: (row: Value${n}) => void }`,
    fires: false,
  }),
  ({ n }) => ({
    above: [`interface Shape${n} { readonly row: typeof Row${n}.Type }`],
    type: `Shape${n}`,
    fires: false,
  }),
  // Case 2: a written object type, an interface name and a type alias name.
  () => ({ type: "{}", fires: false }),
  ({ n }) => ({
    type: `{ readonly get: (id: string) => Effect.Effect<number, Failure${n}>; readonly size: number }`,
    fires: false,
  }),
  ({ n }) => ({
    above: [`interface Shape${n} { readonly get: (id: string) => Effect.Effect<number> }`],
    type: `Shape${n}`,
    fires: false,
  }),
  ({ n }) => ({
    below: [`export type Shape${n} = { readonly get: (id: string) => Effect.Effect<number> };`],
    type: `Shape${n}`,
    fires: false,
  }),
  // A type that names itself is read once.
  ({ n }) => ({
    above: [`type Tree${n} = { readonly kids: ReadonlyArray<Tree${n}> };`],
    type: `Tree${n}`,
    fires: false,
  }),
  // Case 5: a name from another file passes, whatever it holds there.
  ({ n }) => ({ imports: [`import type { Shape${n} } from "./shape.ts";`], type: `Shape${n}`, fires: false }),
  ({ n }) => ({
    imports: [`import type * as Shapes${n} from "./shape.ts";`],
    type: `Shapes${n}.Inferred`,
    fires: false,
  }),
];

const spellings: ReadonlyArray<(d: Drawn, type: string) => Spelling> = [
  // Case 3: the class form, through each import of `Context`.
  ({ name }, type) => ({
    lines: [`export class ${name} extends Context.Service<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: true,
  }),
  ({ name }, type) => ({
    lines: [`export class ${name} extends Context.Service<`, `  ${name},`, `  ${type}`, `>()("unit/${name}") {}`],
    at: 2,
    read: true,
  }),
  ({ n, name }, type) => ({
    imports: [`import { Context as Renamed${n} } from "effect";`],
    lines: [`export class ${name} extends Renamed${n}.Service<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: true,
  }),
  ({ n, name }, type) => ({
    imports: [`import * as Module${n} from "effect/Context";`],
    lines: [`class ${name} extends Module${n}.Service<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: true,
  }),
  ({ n, name }, type) => ({
    imports: [`import * as Whole${n} from "effect";`],
    lines: [`export class ${name} extends Whole${n}.Context.Service<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: true,
  }),
  ({ n, name }, type) => ({
    imports: [`import { Service as Named${n} } from "effect/Context";`],
    lines: [`export class ${name} extends Named${n}<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: true,
  }),
  ({ name }, type) => ({
    lines: [`export class ${name} extends Context["Service"]<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: true,
  }),
  // The direct form, with one type argument or two, and through an optional member.
  ({ name }, type) => ({
    lines: [`export const ${name} = Context.Service<${type}>("unit/${name}");`],
    at: 0,
    read: true,
  }),
  ({ name }, type) => ({
    lines: [`export const ${name} = Context.Service<"${name}", ${type}>("unit/${name}");`],
    at: 0,
    read: true,
  }),
  ({ name }, type) => ({
    lines: [`export const ${name} = () =>`, `  Context?.Service<${type}>("unit/${name}");`],
    at: 1,
    read: true,
  }),
  // Case 7: a Reference is not read.
  ({ name }, type) => ({
    lines: [`export const ${name} = Context.Reference<${type}>("unit/${name}", { defaultValue: () => undefined });`],
    at: 0,
    read: false,
  }),
  // Not Effect's `Context.Service`: a shadowed `Context`, another module's, and a use in a type.
  ({ name }, type) => ({
    lines: [`export const ${name} = (Context: { readonly Service: never }) => Context.Service<${type}>("unit");`],
    at: 0,
    read: false,
  }),
  ({ n, name }, type) => ({
    imports: [`import { Context as Other${n} } from "./context.ts";`],
    lines: [`export class ${name} extends Other${n}.Service<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: false,
  }),
  ({ n, name }, type) => ({
    imports: [`import { Service as Other${n} } from "./context.ts";`],
    lines: [`export class ${name} extends Other${n}<${name}, ${type}>()("unit/${name}") {}`],
    at: 0,
    read: false,
  }),
  ({ name }, type) => ({
    lines: [`export type ${name} = Context.Service<"${name}", ${type}>;`],
    at: 0,
    read: false,
  }),
];

/** A file of the drawn services, one after another, and the lines the rule must fire on. */
const file = (
  drawn: ReadonlyArray<{
    readonly name: string;
    readonly success: number;
    readonly form: number;
    readonly spelling: number;
  }>,
  own: boolean,
) => {
  const imports = ['import { Context, Effect } from "effect";'];
  const body: string[] = own ? ["type ReturnType<T> = { readonly made: T };"] : [];
  const fires: number[] = [];

  drawn.forEach((pick, n) => {
    const success = successes[pick.success % successes.length]!(n);
    const d: Drawn = { n, name: `${pick.name}${n}`, success: success.text, effects: success.effects, own };
    const form = forms[pick.form % forms.length]!(d);
    const spelling = spellings[pick.spelling % spellings.length]!(d, form.type);
    imports.push(...success.imports, ...(form.imports ?? []), ...(spelling.imports ?? []));
    body.push(...(form.above ?? []));

    if (form.fires && spelling.read) {
      fires.push(body.length + spelling.at);
    }

    body.push(...spelling.lines, ...(form.below ?? []));
  });

  // Each import is written once: two services may ask for the same line.
  const head = [...new Set(imports)];
  return { text: `${[...head, ...body].join("\n")}\n`, fires: fires.map((at) => head.length + at + 1) };
};

const Name = fc.stringMatching(/^[a-z]{2,6}$/).map((w) => `${w[0]!.toUpperCase()}${w.slice(1)}Svc`);

const services = fc.array(fc.record({ name: Name, success: fc.nat(), form: fc.nat(), spelling: fc.nat() }), {
  minLength: 1,
  maxLength: 6,
});

const product = "next/packages/libfabrika/src/unit/Unit.ts";

it("fires exactly on a read service whose type holds ReturnType, Effect.Success or a typeof query", async () => {
  // The generated files with a fire: the first is for the oxlint run below.
  const fired: Array<ReturnType<typeof file>> = [];
  fc.assert(
    fc.property(services, fc.boolean(), (drawn, own) => {
      const made = file(drawn, own);

      if (made.fires.length > 0) {
        fired.push(made);
      }

      tester.run("written-service-type", writtenServiceType, {
        valid: made.fires.length === 0 ? [{ code: made.text, filename: product }] : [],
        invalid:
          made.fires.length === 0
            ? []
            : [{ code: made.text, filename: product, errors: made.fires.map((line) => ({ line, message: OURS })) }],
      });
    }),
    { seed: 119120, numRuns: 100 },
  );

  // Case 8, and the config's wiring: the same file fires in next/ product code and nowhere else.
  expect(fired).not.toHaveLength(0);
  const planted = fired[0]!;
  const off = [
    "next/packages/libfabrika/src/unit/Unit.test.ts",
    "next/apps/fabrika/src/unit/Unit.test.tsx",
    "next/packages/libfabrika/src/unit/UnitTest.ts",
    "next/packages/libfabrika/src/unit/Unit.test-support.ts",
    "packages/fabrika/src/unit/Unit.ts",
  ];
  const tsx = "next/apps/fabrika/src/unit/Unit.tsx";
  const linted = await plant(Object.fromEntries([product, tsx, ...off].map((path) => [path, planted.text])));
  expect(linted(CODE, product)).toEqual(planted.fires);
  // The same text as a `.tsx` product file fires, so the `.test.tsx` path below is quiet by the config.
  expect(linted(CODE, tsx)).toEqual(planted.fires);

  for (const path of off) {
    expect(linted(CODE, path), path).toEqual([]);
  }
});
