// Triage that writes each criterion as data: a rule, and examples that are a
// JavaScript call and its exact result. Shared by the experiments on it.
import { turn } from "../src/claude.ts";
import type { Example } from "./examples.ts";

export interface DataCriterion {
  readonly id: string;
  readonly rule: string;
  readonly examples: readonly Example[];
  /** Why the rule cannot be shown by a call and its result, when it cannot. */
  readonly no_example: string | null;
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "goal", "criteria"],
  properties: {
    title: { type: "string" },
    goal: { type: "string", description: "One sentence saying what the code does once this issue is done." },
    criteria: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "rule", "examples", "no_example"],
        properties: {
          id: { type: "string", description: "A short kebab-case name" },
          rule: { type: "string", description: "The rule in one plain sentence, one claim" },
          examples: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["call", "result"],
              properties: {
                call: { type: "string", description: "One JavaScript expression, e.g. formatPrice(3.5)" },
                result: { type: "string", description: 'The exact value as a JavaScript literal, e.g. "3.50"' },
              },
            },
          },
          no_example: {
            type: ["string", "null"],
            description: "null when examples show the rule; otherwise why no call and result can",
          },
        },
      },
    },
  },
};

const EXAMPLES_LINE = `- Give each rule one example, or more only when one cannot show it. Pick an input that the rule decides: a test of "upper case becomes lower case" needs an upper-case letter in it.`;

const DATA_BRIEF = [
  `How your criteria will be used: each criterion is data, a rule and the examples that prove it. An example is one JavaScript call and the exact value it returns, such as call \`formatPrice(3.5)\` and result \`"3.50"\`. Code turns every example into \`assert.deepStrictEqual(<call>, <result>)\` and runs it against the finished code, with no person or model in between. So the call must run exactly as written, and the result must be exactly right.`,
  `- One claim per rule. A sentence that says two things becomes two criteria.`,
  EXAMPLES_LINE,
  `- Say what the finished code does. A rule it has to follow gets a criterion even when the starting code happens to follow it already. Leave out only what the issue does not touch.`,
  `- If a rule cannot be shown by a call and its result (it is about types, timing, files, docs or side effects), leave examples empty and say why in no_example. Do not force it.`,
].join("\n");

function prompt(title: string, body: string, brief?: string): string {
  return [
    `You are triaging one raw issue for the code in the current folder. Turn it into an issue a builder can pick up cold. You write no code, and you cannot run anything.`,
    `# ${title}`,
    body,
    [
      `Rules:`,
      `- Never work from the title alone. Read the code the issue is about first, and check what the issue claims against it.`,
      `- No invention. Write only what you found or what the issue says.`,
      `- The first criterion states the user's job as an outcome someone could observe.`,
      `- Write one criterion for each rule you found, most important first.`,
    ].join("\n"),
    brief === undefined ? DATA_BRIEF : DATA_BRIEF.replace(EXAMPLES_LINE, brief),
  ].join("\n\n");
}

export interface Triaged {
  readonly title: string;
  readonly goal: string;
  readonly criteria: readonly DataCriterion[];
}

/** Triage one raw issue in `dir` into criteria as data. `brief` replaces the line on how many examples to give. */
export async function triage(dir: string, title: string, body: string, brief?: string): Promise<Triaged> {
  const result = await turn(
    dir,
    { timeoutMs: 15 * 60 * 1000 },
    { prompt: prompt(title, body, brief), session: null, tools: ["Read", "Glob", "Grep"], schema },
    AbortSignal.timeout(15 * 60 * 1000),
  );
  return result.structured as Triaged;
}
