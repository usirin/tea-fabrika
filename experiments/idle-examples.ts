// Does Jev flag triage's own idle examples?
//
// Experiment 18 found one example question Jev answers well: does the input
// touch the rule at all? There the idle examples were made from a pool of
// inputs. Here they are triage's own, from experiment 19's three runs (the
// toy's tests visible, the ticket only, the rules in words).
//
// Each example is labelled by running code. A rule maps by its words to the
// broken versions that break it (a rule may name several things, so several):
//
//   shows   the correct code passes it, and at least one of its rule's broken
//           versions fails it
//   idle    the correct code passes it, and every broken version of its rule
//           passes it too: the input never makes the rule matter
//
// A rule whose words match no broken version is left out and counted.
//
// Run with `node experiments/idle-examples.ts`; needs TYPESAFE_API_KEY.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { jevQuestions } from "@demlik/tea/jev";
import type { DataCriterion } from "./data-triage.ts";
import { agrees, type Example } from "./examples.ts";
import { askAll, pool } from "./jev.ts";
import { duration, slugifyOneClaim, variant } from "./toys.ts";

const slugify = variant(slugifyOneClaim, "correct");
const parse = variant(duration, "correct");
const swap = (source: string, from: string, to: string) => {
  if (!source.includes(from)) throw new Error(`no ${from} to replace`);
  return source.split(from).join(to);
};

/** For each toy: the broken versions, and which words in a rule name each. */
const toys = {
  slugify: {
    fn: "slugify",
    broken: {
      no_lower_case: variant(slugifyOneClaim, "no_lower_case"),
      one_dash_per_space: variant(slugifyOneClaim, "one_dash_per_space"),
      spaces_removed: swap(slugify, `.replace(/ +/g, "-")`, `.replace(/ +/g, "")`),
      leaves_punctuation: variant(slugifyOneClaim, "leaves_punctuation"),
      leaves_accents: variant(slugifyOneClaim, "leaves_accents"),
      drops_digits: swap(slugify, "[^a-z0-9 ]", "[^a-z ]"),
      no_trim: swap(slugify, ".trim()", ""),
      unchanged: "export function slugify(title) {\n  return title;\n}\n",
      returns_null: "export function slugify(title) {\n  return null;\n}\n",
      returns_empty: 'export function slugify(title) {\n  return "";\n}\n',
    },
    words: [
      [/lower|upper-case|capital/i, ["no_lower_case"]],
      [/space|dash|hyphen|joined/i, ["spaces_removed", "one_dash_per_space"]],
      [/punctuation|other than|outside a-z|unsafe|url path|percent/i, ["leaves_punctuation"]],
      [/accent|other than|outside a-z/i, ["leaves_accents"]],
      [/digit|0-9/i, ["drops_digits"]],
      [/starts nor ends|leading|trailing/i, ["no_trim"]],
      [/url|unchanged|original text/i, ["unchanged"]],
      [/returns a string/i, ["returns_null"]],
      [/words of the title/i, ["returns_empty"]],
    ],
  },
  "duration-open": {
    fn: "parseDuration",
    broken: {
      single_unit_only: variant(duration, "single_unit_only"),
      h_wrong: swap(parse, "Number(hours) * 3600", "Number(hours) * 60"),
      m_wrong: swap(parse, "Number(minutes) * 60", "Number(minutes) * 1"),
      s_wrong: swap(parse, "+ Number(seconds)", "+ 0"),
      no_bare_number: variant(duration, "no_bare_number"),
      no_decimals: variant(duration, "no_decimals"),
      no_upper_case: variant(duration, "no_upper_case"),
      any_order: variant(duration, "any_order"),
      zero_for_unknown: variant(duration, "zero_for_unknown"),
      empty_zero: swap(parse, 'if (input === "") return null;', 'if (input === "") return 0;'),
      no_spaces: swap(parse, "\\\\s*", ""),
    },
    words: [
      [/combin|together|added|sum|several|followed by minutes|\d+h\d+m/i, ["single_unit_only"]],
      [/\bh\b|hour/i, ["h_wrong"]],
      [/\bm\b|minute/i, ["m_wrong"]],
      // Not the s of "issue's".
      [/(?<!')\bs\b|seconds part/i, ["s_wrong"]],
      [/no unit|bare|plain number/i, ["no_bare_number"]],
      [/decimal/i, ["no_decimals"]],
      [/upper/i, ["no_upper_case"]],
      [/order|largest|smaller unit before|more than once|same unit/i, ["any_order"]],
      [/unknown|other than h|not a duration|no number/i, ["zero_for_unknown"]],
      [/empty/i, ["empty_zero"]],
      [/space/i, ["no_spaces"]],
    ],
  },
} as const satisfies Record<string, { fn: string; broken: Record<string, string>; words: readonly (readonly [RegExp, readonly string[]])[] }>;

type ToyName = keyof typeof toys;

interface Labelled extends Example {
  readonly source: string;
  readonly toy: ToyName;
  readonly rule: string;
  readonly label: "shows" | "idle";
}

const runs = ["data-criteria", "data-criteria-ticket-only", "data-criteria-rules"];
const labelled: Labelled[] = [];
const unmapped: string[] = [];
let wrong = 0;
for (const source of runs) {
  const results = JSON.parse(await readFile(join(import.meta.dirname, "results", `${source}.json`), "utf8")) as {
    toy: ToyName;
    criteria: DataCriterion[];
  }[];
  for (const run of results) {
    const toy = toys[run.toy];
    const correct = run.toy === "slugify" ? slugify : parse;
    for (const criterion of run.criteria) {
      const words: readonly (readonly [RegExp, readonly string[]])[] = toy.words;
      const names = [...new Set(words.flatMap(([pattern, broken]) => (pattern.test(criterion.rule) ? broken : [])))];
      if (names.length === 0) {
        unmapped.push(`${run.toy} | ${criterion.rule}`);
        continue;
      }
      for (const example of criterion.examples) {
        if (!(await agrees(correct, toy.fn, example))) {
          wrong++;
          continue;
        }
        const rejected = await Promise.all(
          names.map(async (name) => !(await agrees(toy.broken[name as keyof typeof toy.broken], toy.fn, example))),
        );
        labelled.push({ ...example, source, toy: run.toy, rule: criterion.rule, label: rejected.some(Boolean) ? "shows" : "idle" });
      }
    }
  }
}

// The question that worked in experiment 18, word for word.
const questions = jevQuestions({
  has_feature: {
    type: "noul",
    instructions: "Does the input in `example.call` contain the thing `claim` is about?",
    criteria: {
      true: "The input contains at least one instance of what `claim` talks about, so the rule has something to act on",
      false: "The input contains nothing that `claim` talks about, so the rule has nothing to act on",
    },
  },
});

const rows = await pool(labelled, 8, async (e) => {
  const answers = (await askAll(questions, { claim: e.rule, example: { call: e.call, result: e.result } })) as {
    has_feature: { noul: number };
  };
  return { ...e, has_feature: answers.has_feature.noul };
});
await writeFile(join(import.meta.dirname, "results", "idle-examples.json"), `${JSON.stringify({ unmapped, wrong, rows }, null, 2)}\n`);

const shows = rows.filter((r) => r.label === "shows");
const idle = rows.filter((r) => r.label === "idle");
console.log(`${rows.length} examples labelled (${wrong} wrong left out; ${unmapped.length} rules matched no broken version)`);
for (const source of runs) {
  const mine = rows.filter((r) => r.source === source);
  console.log(`  ${source}: ${mine.filter((r) => r.label === "idle").length} idle of ${mine.length}`);
}
console.log(`\nflagged (has_feature below the cut)   idle       shows`);
for (const cut of [0.5, 0.7, 0.9]) {
  const flagged = (group: typeof rows) => group.filter((r) => r.has_feature < cut).length;
  console.log(`  below ${cut}                          ${`${flagged(idle)} of ${idle.length}`.padEnd(10)} ${flagged(shows)} of ${shows.length}`);
}
console.log(`\nidle examples:`);
for (const r of idle) console.log(`  ${r.has_feature.toFixed(2)}  ${r.call} -> ${r.result}   [${r.rule}]`);
console.log(`\nunmapped rules:`);
for (const u of unmapped) console.log(`  ${u}`);
