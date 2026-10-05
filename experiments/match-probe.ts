// Can Jev, as review's matcher, tell a finding that repeats one a person
// already decided from a new point? Twelve new findings, each asked against
// the decided findings of its toy, labelled by hand with the one it repeats or
// none. Five come from the real duration run of experiment 28. Each is asked
// 3 times through the real `jevMatcher` (floor 0.9; below it, no match).
//
// A miss (a repeat not matched) is safe: the finding is routed like a new one.
// A wrong match (a new point, or a different one, called a repeat) is the
// dangerous answer: it lets the finding pass unrouted.
//
// Run with `node experiments/match-probe.ts`; needs TYPESAFE_API_KEY.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { liveJev } from "../src/local.ts";
import { jevMatcher } from "../src/route.ts";
import { Matcher } from "../src/services.ts";
import { defaultSettings } from "../src/settings.ts";
import { pool } from "./jev.ts";

const REPEATS = 3;
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");

/** What a person decided earlier, per toy. The duration ones are experiment 28's, word for word. */
const decided = {
  duration: [
    {
      id: "r2-1",
      text: "The issue doesn't ask for unitless input. Treating a bare number like \"90\" as seconds is an unrequested guess, and it is ambiguous because a caller could mean minutes. That input should be rejected rather than silently given a meaning.",
    },
    {
      id: "r2-2",
      text: "Accepting decimals goes beyond the issue, and it gives fractional, imprecise results. For example, \"1.1h\" returns 3960.0000000000005 and \"0.5s\" returns 0.5, where a caller would expect a whole number of seconds.",
    },
    {
      id: "r2-4",
      text: "The case-insensitive flag, like the `s` unit and the free whitespace, extends the accepted format beyond the \"1h30m\" form the issue asks for. The reporter left these as open questions, but the change decides them anyway.",
    },
  ],
  slugify: [
    { id: "r1-1", text: "Two spaces in a row make two dashes" },
    { id: "r1-2", text: "Accented letters are kept as they are, so the slug is not plain ASCII" },
    { id: "r1-3", text: "An empty title gives an empty slug" },
  ],
};

const cases: readonly { readonly toy: keyof typeof decided; readonly text: string; readonly repeats: string | null }[] = [
  {
    toy: "duration",
    text: "A bare number with no unit, such as \"90\", is accepted and treated as seconds. The issue never asks for this, and the reporter could just as easily mean minutes. This should be an open question for the reporter, not a quiet guess.",
    repeats: "r2-1",
  },
  {
    toy: "duration",
    text: "The change goes beyond the issue. It adds a seconds unit, decimal values, upper-case units and whitespace between parts. The issue lists all of these as open questions for the reporter, but this line settles them all without asking.",
    repeats: "r2-4",
  },
  {
    toy: "duration",
    text: "Because decimals are accepted and then rounded, sub-second amounts are lost without any warning. \"0.4s\" and \"0.0001h\" return 0, which looks like a valid duration, and \"1.5s\" becomes 2.",
    repeats: null,
  },
  {
    toy: "duration",
    text: "Digit runs of any length are accepted, so a very long number such as \"9\".repeat(400) + \"h\" returns Infinity instead of null.",
    repeats: null,
  },
  { toy: "duration", text: "Upper-case units like \"1H\" are accepted though the issue never asked for them.", repeats: "r2-4" },
  { toy: "slugify", text: "Runs of spaces turn into runs of dashes", repeats: "r1-1" },
  { toy: "slugify", text: "Letters like é survive into the slug", repeats: "r1-2" },
  { toy: "slugify", text: "slugify(\"\") returns \"\" rather than a fallback", repeats: "r1-3" },
  { toy: "slugify", text: "Leading and trailing spaces turn into dashes at the ends of the slug", repeats: null },
  { toy: "slugify", text: "Tabs and newlines are not treated as spaces", repeats: null },
  { toy: "slugify", text: "Digits are dropped from the slug", repeats: null },
  { toy: "slugify", text: "The function changes the title object it was given", repeats: null },
];

const matcher = jevMatcher.pipe(Layer.provide(Layer.mergeAll(liveJev(key, JEV_ENDPOINT), defaultSettings)));
const ask = (text: string, candidates: readonly { readonly id: string; readonly text: string }[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Matcher).match({ text, candidates });
    }).pipe(Effect.provide(matcher)),
  );

const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(jobs, 6, async (c) => ({ ...c, ...(await ask(c.text, decided[c.toy])) }));

const right = answers.filter((a) => a.to === a.repeats).length;
const missed = answers.filter((a) => a.repeats !== null && a.to === null).length;
const wrong = answers.filter((a) => a.to !== null && a.to !== a.repeats).length;
console.log(`answers: ${answers.length}`);
console.log(`right: ${right}`);
console.log(`missed a repeat (safe: routed like a new finding): ${missed}`);
console.log(`wrong match (dangerous: passes unrouted): ${wrong}`);
for (const c of cases) {
  const mine = answers.filter((a) => a.text === c.text);
  console.log(
    `${(c.repeats ?? "new").padEnd(5)}  ${mine.map((a) => `${a.to ?? "none"}(${a.confidence.toFixed(2)})`).join(" ")}  ${c.text.slice(0, 80)}`,
  );
}
await writeFile(join(import.meta.dirname, "results", "match-probe.json"), JSON.stringify(answers, null, 2));
