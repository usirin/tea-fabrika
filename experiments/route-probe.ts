// Does Jev, as the review router, tell an extra change that serves the ticket
// from one that does not? Twelve reasons a builder might give for touching a
// file the criteria do not name, labelled by hand, each asked 3 times through
// the real `jevRouter` (floor 0.8, unsure below it).
//
// Run with `node experiments/route-probe.ts`; needs TYPESAFE_API_KEY.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { liveJev } from "../src/local.ts";
import { jevRouter } from "../src/route.ts";
import { type Routed, Router } from "../src/services.ts";
import { pool } from "./jev.ts";

const REPEATS = 3;
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");

const goals = {
  slugify: "slugify turns a title into a URL slug",
  duration: 'parseDuration turns text like "1h30m" into a number of seconds',
};

const cases: readonly { readonly goal: keyof typeof goals; readonly why: string; readonly serves: boolean }[] = [
  { goal: "slugify", why: "Added a small helper that strips accents, which slugify calls to drop non-ASCII letters", serves: true },
  { goal: "slugify", why: "Exported slugify from index.js so the URL builder can import it", serves: true },
  { goal: "slugify", why: "Added a JSDoc comment to slugify.d.ts so the new return value is typed", serves: true },
  { goal: "duration", why: "Moved the unit table (h, m, s to seconds) into units.js, which parseDuration reads", serves: true },
  { goal: "duration", why: "Updated the README example to show parseDuration('1h30m') returning 5400", serves: true },
  { goal: "duration", why: "Added the regex that splits '1h30m' into its parts to patterns.js", serves: true },
  { goal: "slugify", why: "Fixed a typo in the CONTRIBUTING guide that I noticed while reading", serves: false },
  { goal: "slugify", why: "Bumped the eslint version in package.json because it was out of date", serves: false },
  { goal: "slugify", why: "Renamed variables in date.js to be more readable", serves: false },
  { goal: "duration", why: "Reformatted every file in the repo with prettier", serves: false },
  { goal: "duration", why: "Added a formatBytes helper in bytes.js that we will probably need later", serves: false },
  { goal: "duration", why: "Removed an unused import from the logger", serves: false },
];

const router = jevRouter.pipe(Layer.provide(liveJev(key, JEV_ENDPOINT)));
const route = (why: string, goal: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Router).route({ text: why, goal });
    }).pipe(Effect.provide(router)),
  );

const jobs = cases.flatMap((c) => Array.from({ length: REPEATS }, () => c));
const answers = await pool(jobs, 6, async (c) => ({ ...c, ...(await route(c.why, goals[c.goal])) as Routed }));

const right = (a: (typeof answers)[number]) => (a.serves ? a.relation === "related" : a.relation === "unrelated");
const lets = answers.filter((a) => !a.serves && a.relation === "related").length;
console.log(`answers: ${answers.length}`);
console.log(`right: ${answers.filter(right).length}`);
console.log(`unsure: ${answers.filter((a) => a.relation === "unsure").length}`);
console.log(`wrong and lets work through (an unrelated change called related): ${lets}`);
console.log(`wrong and sends good work back (a related change called unrelated): ${answers.filter((a) => a.serves && a.relation === "unrelated").length}`);
for (const c of cases) {
  const mine = answers.filter((a) => a.why === c.why);
  console.log(`${c.serves ? "serves   " : "unrelated"}  ${mine.map((a) => `${a.relation}(${a.confidence.toFixed(2)})`).join(" ")}  ${c.why}`);
}
await writeFile(join(import.meta.dirname, "results", "route-probe.json"), JSON.stringify(answers, null, 2));
