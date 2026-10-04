// What makes the judge sure a test checks a criterion? One criterion, asked
// several ways: one claim or two, with or without a worked example, one test
// or two. Run with `node experiments/fit-probe.ts`; needs TYPESAFE_API_KEY.
import { questions } from "./fit.ts";
import { ask } from "./jev.ts";
const t = (name: string, input: string, out: string) =>
  `test(${JSON.stringify(name)}, () => {\n  assert.equal(slugify(${JSON.stringify(input)}), ${JSON.stringify(out)});\n});`;
const punct = t("c3: punctuation is removed", "hello,world!", "helloworld");
const accent = t("c3: accented letters are removed", "héllowörld", "hllowrld");
const both = t("c3: punctuation and accents are removed", "héllo, wörld!", "hllo-wrld");
const two = "Punctuation and accented letters are removed from the slug.";
const twoEx = `Punctuation and accented letters are removed from the slug, so "héllo, wörld!" becomes "hllo-wrld".`;
const probes: [string, string, string][] = [
  ["two claims, two tests shown together", two, `${punct}\n\n${accent}`],
  ["two claims, one test covering both", two, both],
  ["two claims + example, test is that example", twoEx, both],
  ["two claims, only the punctuation test", two, punct],
  ["one claim (punctuation), its test", "Punctuation is removed from the slug.", punct],
  ["one claim (accents), its test", "Accented letters are removed from the slug.", accent],
  ["one claim + example (punctuation)", `Punctuation is removed from the slug, so "hello,world!" becomes "helloworld".`, punct],
  ["one claim (several spaces), its test", "Several spaces in a row between two words become one dash.", t("c2", "hello   big world", "hello-big-world")],
  ["one claim + example (several spaces)", `Several spaces in a row between two words become one dash, so "a   b" becomes "a-b".`, t("c2", "a   b", "a-b")],
];
for (const [label, criterion, test] of probes) {
  const answers = await Promise.all([1, 2, 3].map(() => ask(questions, "fit", { issue: "slugify turns a title into a URL slug", criterion, test })));
  console.log(label.padEnd(46), answers.map((a) => `${a.choice} ${a.confidence}`).join("  "));
}
