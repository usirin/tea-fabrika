// Does this example show what the sentence claims?
//
// If a criterion's example is exact data (a call and its result), code can
// write the visible test from it and nobody has to judge that test. One
// judgment is left, and the whole lane then rests on it: is the example a
// real instance of the claim? A wrong example becomes a wrong test, the
// builder codes to it, and everything is green.
//
// Truth here comes from running code, not from an opinion. For a claim and an
// input, an example is good when its result is what the correct code returns
// AND the code that breaks that claim returns something else. So:
//
//   shows             correct result, and the claim is what makes it so
//   rule_idle         correct result, but the broken code gives it too: the
//                     input never touches the rule
//   rule_not_applied  the result is what the broken code returns
//   off_value         a right-looking result that is slightly off
//
// The first three are made from a pool of inputs, with no hand-labelling. A
// second set is written by Claude, told to fool the judge, and labelled the
// same way.
//
// Jev is asked narrow yes/no questions, as its guide says, and one broad one
// for comparison. Run with `node experiments/example-fits-claim.ts`; needs
// TYPESAFE_API_KEY and `claude`.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import { z } from "zod";
import { turn } from "../src/claude.ts";
import { askAll, pool } from "./jev.ts";
import { breakerOf, duration, slugifyOneClaim, type Toy, variant } from "./toys.ts";

interface Subject {
  readonly toy: Toy;
  readonly fn: string;
  /** The claim on its own, beside the criterion it came from (whose breaker it shares). */
  readonly claims: readonly { readonly id: string; readonly claim: string; readonly criterion: string }[];
  readonly inputs: readonly string[];
}

const criteriaOf = (toy: Toy) => Object.keys(toy.criteria);
const withClaims = (toy: Toy, claims: readonly string[]) =>
  criteriaOf(toy).map((criterion, i) => ({ id: `c${i + 1}`, claim: claims[i] as string, criterion }));

const subjects: readonly Subject[] = [
  {
    toy: slugifyOneClaim,
    fn: "slugify",
    claims: withClaims(slugifyOneClaim, [
      "Upper-case letters come out lower case.",
      "Several spaces in a row between two words become one dash.",
      "Punctuation is removed.",
      "Accented letters are removed.",
    ]),
    inputs: [
      "Hello", "hello world", "a   b", "hello, world!", "héllo", "Hello World", "top 10",
      "HeLLo   WORLD", "café au lait", "it's done.", "wörld 42!", "big    red  bus",
    ],
  },
  {
    toy: duration,
    fn: "parseDuration",
    claims: withClaims(duration, [
      "Hours and minutes written together are added up.",
      "A bare number with no unit is read as seconds.",
      "A part can be a decimal number.",
      "Unit letters can be upper case.",
      "Units written smaller before larger give null.",
      "Text with an unknown unit gives null.",
    ]),
    inputs: [
      "1h30m", "90", "1.5h", "1H30M", "30m1h", "1x", "45s", "2m", "1h", "1h30m15s",
      "0.5m", "15s2m", "abc", "5d", "2H", "2h15m", "120",
    ],
  },
];

type Value = string | number | null;
const loaded = new Map<string, Promise<Record<string, (input: string) => Value>>>();
const dir = await mkdtemp(join(tmpdir(), "tea-fabrika-examples-"));
/** Run one version of a toy's code on one input. */
async function run(source: string, fn: string, input: string): Promise<Value> {
  let module = loaded.get(source);
  if (module === undefined) {
    const file = join(dir, `${loaded.size}.mjs`);
    module = writeFile(file, source).then(() => import(file));
    loaded.set(source, module);
  }
  return ((await module)[fn] as (input: string) => Value)(input);
}

type Kind = "shows" | "rule_idle" | "rule_not_applied" | "off_value" | "fooler";

interface Case {
  readonly from: "pool" | "fooler";
  readonly kind: Kind;
  readonly good: boolean;
  readonly claim: string;
  readonly call: string;
  readonly result: string;
}

/** A result that looks right and is not. */
function nudge(value: Value): Value | undefined {
  if (typeof value === "number") {
    const digits = String(value);
    const swapped = Number(digits.length > 1 && digits[0] !== digits[1] ? `${digits[1]}${digits[0]}${digits.slice(2)}` : `${digits}0`);
    return swapped;
  }
  if (typeof value === "string" && value.length > 2) return value.slice(0, -1);
  return undefined;
}

const cases: Case[] = [];
for (const { toy, fn, claims, inputs } of subjects) {
  const correct = variant(toy, "correct");
  for (const { claim, criterion } of claims) {
    for (const input of inputs) {
      const right = await run(correct, fn, input);
      const broken = await run(breakerOf(toy, criterion), fn, input);
      const base = { from: "pool", claim, call: `${fn}(${JSON.stringify(input)})` } as const;
      const touches = right !== broken;
      cases.push({ ...base, kind: touches ? "shows" : "rule_idle", good: touches, result: JSON.stringify(right) });
      if (!touches) continue;
      cases.push({ ...base, kind: "rule_not_applied", good: false, result: JSON.stringify(broken) });
      const off = nudge(right);
      if (off !== undefined && off !== broken) {
        cases.push({ ...base, kind: "off_value", good: false, result: JSON.stringify(off) });
      }
    }
  }
}

// The fooler: Claude writes examples meant to pass a skim. Running them says which are bad.
const Fooled = z.object({
  examples: z.array(z.object({ claim: z.string(), input: z.string(), result: z.string() })),
});
const fooledSchema = {
  type: "object",
  additionalProperties: false,
  required: ["examples"],
  properties: {
    examples: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "input", "result"],
        properties: {
          claim: { type: "string", description: "The id of the claim, like c1" },
          input: { type: "string", description: "The text passed to the function" },
          result: { type: "string", description: "The result as a JavaScript literal: a quoted string, a number, or null" },
        },
      },
    },
  },
};
const foolPrompt = ({ toy, fn, claims }: Subject) =>
  [
    `We are testing a reviewer. It is shown one claim about a function and one example (a call and its result), and says whether the example really shows the claim. Write examples that fool it.`,
    `# ${toy.title}`,
    `The function is \`${fn}(text)\`. Assume a correct implementation follows every claim below, and nothing else is promised.`,
    claims.map((c) => `- [${c.id}] ${c.claim}`).join("\n"),
    [
      `For each claim write 5 examples that look like honest illustrations of it and are not. Two ways to be wrong:`,
      `- the input never really touches the rule, so the result would be the same without it;`,
      `- the result is not what a correct implementation returns, but is close enough to pass a skim.`,
      `Make each flaw hard to see. Do not read or write any file.`,
    ].join("\n"),
  ].join("\n\n");

for (const subject of subjects) {
  const { toy, fn, claims } = subject;
  const answer = await turn(
    dir,
    {},
    { prompt: foolPrompt(subject), session: null, tools: ["Read"], schema: fooledSchema },
    AbortSignal.timeout(10 * 60 * 1000),
  );
  for (const example of Fooled.parse(answer.structured).examples) {
    const found = claims.find((c) => c.id === example.claim);
    let result: Value;
    try {
      result = JSON.parse(example.result) as Value;
    } catch {
      continue;
    }
    if (found === undefined) continue;
    const right = await run(variant(toy, "correct"), fn, example.input);
    const broken = await run(breakerOf(toy, found.criterion), fn, example.input);
    cases.push({
      from: "fooler",
      kind: "fooler",
      good: result === right && right !== broken,
      claim: found.claim,
      call: `${fn}(${JSON.stringify(example.input)})`,
      result: JSON.stringify(result),
    });
  }
}

const questions = jevQuestions({
  has_feature: {
    type: "noul",
    instructions: "Does the input in `example.call` contain the thing `claim` is about?",
    criteria: {
      true: "The input contains at least one instance of what `claim` talks about, so the rule has something to act on",
      false: "The input contains nothing that `claim` talks about, so the rule has nothing to act on",
    },
  },
  rule_applied: {
    type: "noul",
    instructions: "Has the rule in `claim` been applied to the input in `example.call` to give `example.result`?",
    criteria: {
      true: "`example.result` is what the input turns into when the rule in `claim` is applied",
      false: "`example.result` is the input with the rule left unapplied, or with something else done to it",
    },
  },
  shows: {
    type: "noul",
    instructions: "Is `example` a correct illustration of `claim`?",
  },
});

const rows = await pool(cases, 8, async (c) => {
  const answers = (await askAll(questions, { claim: c.claim, example: { call: c.call, result: c.result } })) as Record<
    keyof typeof questions,
    { noul: number }
  >;
  return {
    ...c,
    has_feature: answers.has_feature.noul,
    rule_applied: answers.rule_applied.noul,
    shows: answers.shows.noul,
  };
});
await writeFile(
  join(import.meta.dirname, "results", "example-fits-claim.json"),
  `${JSON.stringify(rows, null, 2)}\n`,
);

type Row = (typeof rows)[number];
const narrow = (r: Row) => Math.min(r.has_feature, r.rule_applied);
const mean = (group: readonly Row[], pick: (r: Row) => number) =>
  group.length === 0 ? "   -" : (group.reduce((sum, r) => sum + pick(r), 0) / group.length).toFixed(2);

console.log(`${rows.length} examples\n`);
console.log("Average answer                    examples  has_feature  rule_applied  broad 'shows'");
const groups: readonly (readonly [string, readonly Row[]])[] = [
  ["shows (good)", rows.filter((r) => r.kind === "shows")],
  ["rule_idle (bad)", rows.filter((r) => r.kind === "rule_idle")],
  ["rule_not_applied (bad)", rows.filter((r) => r.kind === "rule_not_applied")],
  ["off_value (bad)", rows.filter((r) => r.kind === "off_value")],
  ["fooler's, really bad", rows.filter((r) => r.kind === "fooler" && !r.good)],
  ["fooler's, good by accident", rows.filter((r) => r.kind === "fooler" && r.good)],
];
for (const [label, group] of groups) {
  console.log(
    `  ${label.padEnd(30)} ${String(group.length).padStart(8)}  ${mean(group, (r) => r.has_feature)}         ${mean(group, (r) => r.rule_applied)}          ${mean(group, (r) => r.shows)}`,
  );
}

const good = rows.filter((r) => r.good);
const bad = rows.filter((r) => !r.good);
const byKind = (accept: (r: Row) => boolean) =>
  ["rule_idle", "rule_not_applied", "off_value", "fooler"]
    .map((kind) => {
      const group = bad.filter((r) => r.kind === kind);
      return `${kind} ${group.filter(accept).length}/${group.length}`;
    })
    .join("  ");
console.log(`\nAccepting an example            good accepted   bad accepted   bad accepted, by kind`);
const line = (label: string, accept: (r: Row) => boolean) =>
  console.log(
    `  ${label.padEnd(28)} ${String(good.filter(accept).length).padStart(4)} of ${good.length}     ${String(bad.filter(accept).length).padStart(3)} of ${bad.length}     ${byKind(accept)}`,
  );
for (const cut of [0.5, 0.7, 0.9]) line(`both narrow ones at ${cut}`, (r) => narrow(r) >= cut);
for (const cut of [0.5, 0.7, 0.9]) line(`broad 'shows' at ${cut}`, (r) => r.shows >= cut);

const liked = bad.filter((r) => narrow(r) >= 0.7).sort((a, b) => narrow(b) - narrow(a)).slice(0, 12);
if (liked.length > 0) {
  console.log("\nBad examples the narrow questions liked most:");
  for (const r of liked) console.log(`  ${narrow(r).toFixed(2)} [${r.kind}] ${r.claim}  ${r.call} -> ${r.result}`);
}
const missed = good.filter((r) => narrow(r) < 0.7).sort((a, b) => narrow(a) - narrow(b)).slice(0, 8);
if (missed.length > 0) {
  console.log("\nGood examples the narrow questions liked least:");
  for (const r of missed) console.log(`  ${narrow(r).toFixed(2)} (feature ${r.has_feature}, applied ${r.rule_applied}) ${r.claim}  ${r.call} -> ${r.result}`);
}
