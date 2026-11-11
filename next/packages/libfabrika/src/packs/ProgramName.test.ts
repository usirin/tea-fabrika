// P40 slice 1, next/. A program's identity is `pack/program`: exactly two segments, each in the
// builder's segment alphabet, at most 256 characters in all (0083). Builder contract:
// `packs/ProgramName.ts` exports the `ProgramName` schema, pure and platform-free.
//
// The law walks a name. A decision tape is folded through the current valid name: an even step
// grows or replaces one of its segments, staying valid, and an odd step breaks the current name in
// one way and must be refused. Shrinking a tape recomputes every move from the shortened prefix.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Option, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

type Api = { readonly ProgramName: Schema.Codec<string> };

const load = async () => {
  const file = join(import.meta.dirname, "ProgramName.ts");
  assert(existsSync(file), "P40 not built: packs/ProgramName.ts, the qualified name schema, is absent");
  vi.resetModules();
  return vi.importActual<Api>(pathToFileURL(file).href);
};

const MAX = 256;
const FIRST = "ABCXYZabcxyz_";
const REST = `${FIRST}0123456789-`;
// Text that must never sit inside a segment: separators, path text, quotes, controls and wide text.
const FOREIGN = [" ", ".", ":", '"', "'", "\n", "\\", "@", "#", "%", "?", "雪", "\0", "\t", "+", "~"];

type Name = { readonly pack: string; readonly program: string };
type Step = { readonly name: string; readonly accepted: boolean; readonly move: string };

const pick = <A>(xs: ReadonlyArray<A>, n: number): A => xs[n % xs.length]!;
const text = (name: Name) => `${name.pack}/${name.program}`;

// A fresh valid segment, spelled from the decision.
const segment = (n: number) => {
  let out = pick([...FIRST], n);

  for (let left = Math.floor(n / FIRST.length) % 9; left > 0; left--) {
    n = Math.floor(n / 7) + left;
    out += pick([...REST], n);
  }

  return out;
};

const side = (n: number): keyof Name => (n % 2 === 0 ? "pack" : "program");

// Moves that keep the current name valid, chosen from what its length still allows.
const grow = (name: Name, n: number): { name: Name; move: string } => {
  const room = MAX - text(name).length;
  const key = side(n);

  if (room > 0 && n % 3 !== 0) {
    // Fill to the bound now and then, so the 256th character is reached, not only approached.
    const add = n % 5 === 0 ? room : 1 + (n % Math.min(room, 4));
    const tail = Array.from({ length: add }, (_, i) => pick([...REST], n + i)).join("");
    return { name: { ...name, [key]: name[key] + tail }, move: `grow ${key} by ${add}` };
  }

  const fresh = segment(n);
  const other = key === "pack" ? name.program : name.pack;
  return other.length + 1 + fresh.length <= MAX
    ? { name: { ...name, [key]: fresh }, move: `replace ${key}` }
    : { name: { pack: segment(n), program: segment(n + 1) }, move: "replace both" };
};

// Ways to break the current valid name. Each keeps a valid name inside the text, so a check that
// reads only a prefix, a suffix or one segment lets it pass.
const breaks = (name: Name): ReadonlyArray<(n: number) => string> => {
  const { pack, program } = name;
  const full = text(name);
  return [
    () => program, // the bare name main accepted
    () => pack,
    () => `/${program}`,
    () => `${pack}/`,
    () => `/${full}`,
    () => `${full}/`,
    () => `${pack}//${program}`,
    (n) => `${full}/${segment(n)}`,
    (n) => `${segment(n)}/${full}`,
    () => `./${program}`,
    () => `${pack}/..`,
    () => `../${full}`,
    () => `${pack}/./${program}`,
    () => `${pack}/../${program}`,
    (n) => {
      const key = side(n);
      const at = n % (name[key].length + 1);
      const broken = name[key].slice(0, at) + pick(FOREIGN, n) + name[key].slice(at);
      return key === "pack" ? `${broken}/${program}` : `${pack}/${broken}`;
    },
    (n) =>
      side(n) === "pack" ? `${pick([..."0123456789-"], n)}${full}` : `${pack}/${pick([..."0123456789-"], n)}${program}`,
    (n) => `${full}${pick([..."ab_-1"], n).repeat(MAX + 1 - full.length)}`,
  ];
};

const walk = (tape: ReadonlyArray<number>): ReadonlyArray<Step> => {
  let name: Name = { pack: "fabrika", program: "counter" };
  const steps: Step[] = [{ name: text(name), accepted: true, move: "start" }];

  for (const [i, n] of tape.entries()) {
    if (i % 2 === 0) {
      const next = grow(name, n);
      name = next.name;
      steps.push({ name: text(name), accepted: true, move: next.move });
    } else {
      const options = breaks(name);
      const choice = n % options.length;
      steps.push({ name: options[choice]!(Math.floor(n / options.length)), accepted: false, move: `break ${choice}` });
    }
  }

  return steps;
};

const tape = fc.array(fc.nat(), { minLength: 2, maxLength: 40 });

describe("P40 qualified program names", () => {
  it("L1: a name is accepted exactly when it has one pack and one program segment within the bound", async () => {
    const { ProgramName } = await load();
    const decode = Schema.decodeUnknownOption(ProgramName);
    await fc.assert(
      fc.asyncProperty(tape, async (tape) => {
        const steps = walk(tape);
        // The walk took both kinds of move, so a schema that accepts or refuses everything fails.
        expect(steps.some((s) => s.accepted && s.move !== "start")).toBe(true);
        expect(steps.some((s) => !s.accepted)).toBe(true);

        for (const step of steps) {
          const decoded = decode(step.name);

          if (step.accepted) {
            expect(step.name.length).toBeLessThanOrEqual(MAX);
            expect(decoded, `${step.move}: ${JSON.stringify(step.name)}`).toEqual(Option.some(step.name));
          } else {
            expect(Option.isNone(decoded), `${step.move}: ${JSON.stringify(step.name)}`).toBe(true);
          }
        }
      }),
      { seed: 119120, numRuns: 200 },
    );
  });
  it("L1: values that are not text are refused", async () => {
    const { ProgramName } = await load();
    await fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string()), fc.object()),
        (raw) => {
          expect(Schema.is(ProgramName)(raw)).toBe(false);
        },
      ),
      { seed: 119120, numRuns: 50 },
    );
  });
});
