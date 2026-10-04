import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { run } from "@demlik/tea/effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { claudeBuilder } from "./claude.ts";
import { interpret } from "./handlers.ts";
import type { Issue } from "./issue.ts";
import { type Lane, lane } from "./lane.ts";
import { checkoutToy, liveJev, localWorkspace } from "./local.ts";
import { scriptedFileBuilder, scriptedJev } from "./scripted.ts";

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  body: "Make slugify(title) in slugify.js return a URL slug.",
  criteria: [
    { id: "lower", text: "The slug is lower case" },
    { id: "dashes", text: "Spaces become single dashes" },
    { id: "ascii", text: "Characters outside a-z and 0-9 are dropped" },
  ],
};

// The builder's two attempts. The first forgets the dashes, so the tests send it back.
const firstTry = `export function slugify(title) {
  return title.toLowerCase();
}
`;
const secondTry = `export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/ +/g, "-");
}
`;

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

const key = process.env.TYPESAFE_API_KEY || undefined;
const useClaude = process.env.BUILDER === "claude";
const dir = await checkoutToy("slugify");
const builder = useClaude
  ? claudeBuilder(dir, process.env.MODEL ? { model: process.env.MODEL } : {})
  : scriptedFileBuilder(dir, [
      { "slugify.js": firstTry },
      { "slugify.js": secondTry },
    ]).layer;
const layers = Layer.mergeAll(
  builder,
  localWorkspace(dir, { test: ["node", "--test"], protect: ["*.test.js"] }),
  key === undefined
    ? scriptedJev(
        Object.fromEntries(issue.criteria.map((c) => [c.text, [["met", 0.95] as const]])),
      )
    : liveJev(key, JEV_ENDPOINT),
);

console.log(`issue:   ${issue.title}`);
console.log(`repo:    ${dir}`);
console.log(`builder: ${useClaude ? "Claude Code" : "scripted (BUILDER=claude for a real agent)"}`);
console.log(`judge:   ${key === undefined ? "scripted (set TYPESAFE_API_KEY for real Jev)" : "Jev"}\n`);

const final = await Effect.runPromise(
  Effect.gen(function* () {
    const handle = yield* run(lane, { interpret, ctx: undefined });
    const runtime = yield* handle.ready;
    runtime.observe((msg, state) => {
      console.log(`${msg.type.padEnd(18)} -> ${describe(state)}`);
      if (msg.type === "build_ok") console.log(`${"".padEnd(21)} builder: ${msg.value.summary}`);
    });
    yield* runtime.dispatch({ type: "start", issue });
    yield* runtime.idle();
    return runtime.getState();
  }).pipe(Effect.scoped, Effect.provide(layers)),
);

console.log(`\nfinal:  ${describe(final)}`);
console.log(`\nslugify.js as the builder left it:\n${await readFile(join(dir, "slugify.js"), "utf8")}`);
if (useClaude && final.phase !== "idle" && final.session !== null) {
  console.log(`talk to the builder:  cd ${dir} && claude --resume ${final.session}`);
}
