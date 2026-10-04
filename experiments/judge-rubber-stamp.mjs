// Does the judge rubber-stamp once it is shown passing tests? It gets a diff
// that only lower-cases, and one passing test about lower case. A criterion no
// test covers and the diff does not do should NOT come back "met".
// Run with `node experiments/judge-rubber-stamp.mjs`; needs TYPESAFE_API_KEY.
import { questions } from "../src/judge.ts";

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");

const diff = `--- a/slugify.js
+++ b/slugify.js
@@ -1,3 +1,3 @@
 export function slugify(title) {
-  return title;
+  return title.toLowerCase();
 }`;
const passingTests = ["the slug is lower case"];
const cases = [
  ["covered by a test and done", "The slug is lower case"],
  ["not done, no test covers it", "Spaces become single dashes"],
  ["not done, no test covers it", "Punctuation is removed from the slug"],
];

const askOnce = async (criterion) => {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      questions,
      state: { issue: "slugify turns a title into a URL slug", criterion, diff, passingTests },
    }),
  });
  const a = (await res.json()).answers?.verdict;
  return a ? `${a.choice} ${a.confidence}` : `HTTP ${res.status}`;
};

for (const [what, criterion] of cases) {
  const runs = await Promise.all([1, 2, 3, 4].map(() => askOnce(criterion)));
  console.log(`${criterion}  (${what})\n    ${runs.join(" | ")}`);
}
