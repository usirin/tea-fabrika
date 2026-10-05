// Can Jev, as the comment reader, tell an owner's comment that changes what
// "done" means from one that changes nothing? Sixteen comments on the duration
// ticket, labelled by hand: the rule each one changes, "adds" for behaviour no
// rule covers, or "none". Some are built to trip it: agreement that names a
// rule, a question about a rule, a change asked for politely. Each is asked 3
// times through the real `jevCommentReader` (a "changes nothing" needs 0.9).
//
// Every answer but "none" sends the comment to a person, so a wrong rule or an
// "unsure" costs a question, never a pass. The dangerous answer is "none" on a
// comment that does change something: it lets the lane finish past it.
//
// Run with `node experiments/comment-probe.ts`; needs TYPESAFE_API_KEY.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { liveJev } from "../src/local.ts";
import { jevCommentReader } from "../src/route.ts";
import { CommentReader } from "../src/services.ts";
import { pool } from "./jev.ts";

const REPEATS = 3;
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");

/** The duration ticket's rules, as the reader sees them: the enricher's from experiment 30. */
const rules = [
  { id: "hours-and-minutes", rule: `A duration written as hours followed by minutes returns its total length in seconds. (parseDuration("1h30m") -> 5400)` },
  { id: "hour-unit", rule: `Each hour written with the unit h counts as 3600 seconds. (parseDuration("2h") -> 7200)` },
  { id: "minute-unit", rule: `Each minute written with the unit m counts as 60 seconds. (parseDuration("45m") -> 2700)` },
  { id: "invalid-is-null", rule: `Text that is not a duration returns null. (parseDuration("soon") -> null)` },
];

type Label = string | "adds" | "none";

const cases: readonly { readonly text: string; readonly label: Label }[] = [
  // Changes nothing.
  { text: "Thanks for picking this up!", label: "none" },
  { text: "Is this going out this week?", label: "none" },
  { text: "Yes, 1h30m giving 5400 is exactly what I need.", label: "none" },
  { text: "Just to confirm: 2h is 7200, right? That's how I read it too.", label: "none" },
  { text: "I'll be away until Monday, no rush.", label: "none" },
  { text: "Linking the old ticket where we first talked about this: #12", label: "none" },
  // Changes a rule.
  { text: "Actually, minutes should come first: write it as 30m1h.", label: "hours-and-minutes" },
  { text: "Sorry, I meant milliseconds, not seconds. 1h30m should be 5400000.", label: "hours-and-minutes" },
  { text: "Could an hour be written as hr instead of h? 2hr should work, and 2h should not.", label: "hour-unit" },
  { text: "Instead of null for bad input, please throw an error so I notice.", label: "invalid-is-null" },
  { text: "Would be nice if \"soon\" gave 0 rather than null, it's easier for my code.", label: "invalid-is-null" },
  // Adds behaviour no rule covers.
  { text: "Can it also take seconds, like 1h30m15s?", label: "adds" },
  { text: "I'd also need days: 2d should be 172800.", label: "adds" },
  { text: "Small thing: 1h30 without the m should be read as 1h30m.", label: "adds" },
  { text: "Please make 1.5h work too, I write it that way a lot.", label: "adds" },
  { text: "Upper case too please, 1H30M comes from our old system.", label: "adds" },
];

const reader = jevCommentReader.pipe(Layer.provide(liveJev(key, JEV_ENDPOINT)));
const ask = (text: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* CommentReader).weigh({ text, rules });
    }).pipe(Effect.provide(reader)),
  );

const said = (r: Awaited<ReturnType<typeof ask>>["reading"]): string =>
  r.kind === "changes" ? r.criterion : r.kind;

const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(jobs, 6, async (c) => {
  const { reading, confidence } = await ask(c.text);
  return { ...c, said: said(reading), confidence };
});

const right = answers.filter((a) => a.said === a.label).length;
const passedWrongly = answers.filter((a) => a.said === "none" && a.label !== "none").length;
const unsure = answers.filter((a) => a.said === "unsure").length;
const otherWrong = answers.filter((a) => a.said !== a.label && a.said !== "none" && a.said !== "unsure").length;
const stoppedNeedlessly = answers.filter((a) => a.label === "none" && a.said !== "none").length;
console.log(`answers: ${answers.length}`);
console.log(`right: ${right}`);
console.log(`"changes nothing" on a comment that changes something (dangerous: no person sees it): ${passedWrongly}`);
console.log(`a harmless comment sent to a person (costs a question): ${stoppedNeedlessly}`);
console.log(`unsure (goes to a person): ${unsure}`);
console.log(`the wrong rule or kind, but still to a person: ${otherWrong}`);
for (const c of cases) {
  const mine = answers.filter((a) => a.text === c.text);
  console.log(`${c.label.padEnd(18)} ${mine.map((a) => `${a.said}(${a.confidence.toFixed(2)})`).join(" ")}  ${c.text}`);
}
await writeFile(join(import.meta.dirname, "results", "comment-probe.json"), JSON.stringify(answers, null, 2));
