import { run } from "@demlik/tea/effect";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { claudeBuilder } from "./claude.ts";
import { interpret } from "./handlers.ts";
import { type Lane, lane } from "./lane.ts";
import { checkoutToy, liveJev, localWorkspace } from "./local.ts";
import { scriptedFileBuilder, scriptedJev } from "./scripted.ts";

// Run one lane on a toy repo and print every step.
//   TOY=slugify|duration   which toy under fixtures/ (default slugify)
//   BUILDER=claude         a real agent; otherwise slugify's two scripted tries
//   MODEL=...              the model the agent is asked for
//   TYPESAFE_API_KEY=...   the real Jev judge; otherwise it says "met" to everything

// The scripted builder's two attempts at slugify. The first forgets the dashes.
const slugifyTries = [
  `export function slugify(title) {
  return title.toLowerCase();
}
`,
  `export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/ +/g, "-");
}
`,
];

/** One line per step: what the lane is doing now, and why. */
function describe(state: Lane): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "building":
      return state.feedback === null
        ? `building (attempt ${state.attempt})`
        : `building (attempt ${state.attempt}), sent back: ${state.feedback.split("\n")[0]}`;
    case "checking":
      return "running the tests";
    case "judging": {
      const asked = Object.entries(state.judge.calls).map(([id, call]) =>
        call.phase === "succeeded"
          ? `${id}: ${call.result.answers.verdict.choice} (${call.result.answers.verdict.confidence})`
          : `${id}: ${call.phase}`,
      );
      return `judging  ${asked.join("  ")}`;
    }
    case "done":
      return `done in ${state.attempt} attempt(s)`;
    case "parked":
      return `parked for a person: ${JSON.stringify(state.why)}`;
  }
}

/** The names of the tests that failed, out of `node --test`'s report. */
const failedTests = (output: string): string[] =>
  [...output.matchAll(/^not ok \d+ - (.+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

const key = process.env.TYPESAFE_API_KEY || undefined;
const useClaude = process.env.BUILDER === "claude";
const name = process.env.TOY || "slugify";
if (!useClaude && name !== "slugify") {
  throw new Error(`only slugify has a scripted builder; run ${name} with BUILDER=claude`);
}

const toy = await checkoutToy(name);
const builder = useClaude
  ? claudeBuilder(toy.dir, process.env.MODEL ? { model: process.env.MODEL } : {})
  : scriptedFileBuilder(toy.dir, slugifyTries.map((text) => ({ "slugify.js": text }))).layer;
const layers = Layer.mergeAll(
  builder,
  localWorkspace(toy.dir, {
    test: ["node", "--test"],
    protect: toy.hidden === undefined ? ["*.test.js"] : [],
    ...(toy.hidden === undefined ? {} : { hidden: toy.hidden }),
  }),
  key === undefined
    ? scriptedJev(
        Object.fromEntries(toy.issue.criteria.map((c) => [c.text, [["met", 0.95] as const]])),
      )
    : liveJev(key, JEV_ENDPOINT),
);

console.log(`issue:   ${toy.issue.title}`);
console.log(`repo:    ${toy.dir}`);
console.log(`tests:   ${toy.hidden === undefined ? "in the repo, the builder can read them" : "hidden from the builder"}`);
console.log(`builder: ${useClaude ? "Claude Code" : "scripted (BUILDER=claude for a real agent)"}`);
console.log(`judge:   ${key === undefined ? "scripted (set TYPESAFE_API_KEY for real Jev)" : "Jev"}\n`);

const indent = "".padEnd(21);
let diff = "";
const final = await Effect.runPromise(
  Effect.gen(function* () {
    const handle = yield* run(lane, { interpret, ctx: undefined });
    const runtime = yield* handle.ready;
    runtime.observe((msg, state) => {
      console.log(`${msg.type.padEnd(18)} -> ${describe(state)}`);
      if (msg.type === "build_ok") {
        console.log(`${indent} builder: ${msg.value.summary}`);
      }
      if (msg.type === "check_ok") {
        diff = msg.value.diff;
        for (const failed of failedTests(msg.value.output)) {
          console.log(`${indent} failed: ${failed}`);
        }
      }
    });
    yield* runtime.dispatch({ type: "start", issue: toy.issue });
    yield* runtime.idle();
    return runtime.getState();
  }).pipe(Effect.scoped, Effect.provide(layers)),
);

console.log(`\nfinal:  ${describe(final)}`);
console.log(`\nthe diff the judge read:\n${diff}`);
if (useClaude && final.phase !== "idle" && final.session !== null) {
  console.log(`talk to the builder:  cd ${toy.dir} && claude --resume ${final.session}`);
}
