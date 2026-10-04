// Can Jev tell a vague acceptance criterion from a clear one before any code
// exists? Run with `node experiments/criterion-clarity.mjs`; needs TYPESAFE_API_KEY.
//
// 2026-10-04, jev-1.13.0, four runs each: answers are steady run to run (about
// +-0.03), but "judgeable" does not separate anything: clear criteria score
// about 0.5 and "The function works well" scores 0.4. "contradicts" gives 0.21
// for the criterion that fights the others, against 0.06 to 0.11 for the rest.
// So the text alone is a weak signal. Judging against a real diff worked better:
// the same bad criterion pulled the judge's confidence down to about 0.7.
const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("set TYPESAFE_API_KEY");
const good = ["The slug is lower case", "Spaces become single dashes"];
// Each case: the criterion under test, and the other criteria of the same issue.
const cases = [
  ["The slug is lower case", [good[1], "Punctuation and accented letters are removed"]],
  ["Spaces become single dashes", [good[0], "Punctuation and accented letters are removed"]],
  ["Characters outside a-z and 0-9 are dropped", good],
  ["Punctuation and accented letters are removed, so the slug only has a-z, 0-9 and dashes", good],
  ["The function works well", good],
];
const questions = {
  judgeable: {
    type: "noul",
    instructions:
      "Could a reviewer decide, from a code diff alone and with no guessing, whether this acceptance criterion is met?",
  },
  contradicts: {
    type: "noul",
    instructions: "Does this criterion contradict any of the other criteria of the same issue?",
  },
};
const askOnce = async ([criterion, otherCriteria]) => {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      questions,
      state: { issue: "slugify turns a title into a URL slug", otherCriteria, criterion },
    }),
  });
  const body = await res.json();
  const a = body.answers;
  return a ? `${a.judgeable.noul.toFixed(2)}/${a.contradicts.noul.toFixed(2)}` : `HTTP ${res.status}`;
};
console.log("judgeable/contradicts, 4 runs each (1 = yes)\n");
for (const c of cases) {
  const runs = await Promise.all([1, 2, 3, 4].map(() => askOnce(c)));
  console.log(`${c[0]}\n    ${runs.join("  ")}`);
}
