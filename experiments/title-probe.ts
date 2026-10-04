// Does the ticket title change how sure the judge is? Same criterion and test,
// shown under a title that states the goal, one that states the bug, and none.
// Run with `node experiments/title-probe.ts`; needs TYPESAFE_API_KEY.
import { questions } from "./fit.ts";
import { ask } from "./jev.ts";
const criterion = `Upper-case letters come back in lower case, so "Hello" becomes "hello".`;
const body = `() => {\n  assert.equal(slugify("Hello"), "hello");\n});`;
const kebab = `test("lower-case: upper-case letters come back in lower case", ${body}`;
const short = `test("c2: upper-case letters come back in lower case", ${body}`;
const bug = "slugify returns the title unchanged instead of a URL-safe slug";
const goal = "slugify turns a title into a URL slug";
const probes: [string, object][] = [
  ["bug title, kebab id", { issue: bug, criterion, test: kebab }],
  ["goal title, kebab id", { issue: goal, criterion, test: kebab }],
  ["no title, kebab id", { criterion, test: kebab }],
  ["bug title, c2 id", { issue: bug, criterion, test: short }],
  ["goal title, c2 id", { issue: goal, criterion, test: short }],
  ["no title, c2 id", { criterion, test: short }],
];
for (const [label, state] of probes) {
  const answers = await Promise.all([1, 2, 3, 4].map(() => ask(questions, "fit", state)));
  console.log(label.padEnd(24), answers.map((a) => `${a.choice} ${a.confidence}`).join("  "));
}
