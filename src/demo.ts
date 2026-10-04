import { run } from "@demlik/tea/effect";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { claudeBuilder, claudeEnricher } from "./claude.ts";
import { type Factory, factory } from "./factory.ts";
import { factoryInterpret } from "./handlers.ts";
import type { Lane } from "./lane.ts";
import { checkoutToy, liveJev, localWorkspace } from "./local.ts";
import {
  scriptedEnricher,
  scriptedFileBuilder,
  scriptedJev,
} from "./scripted.ts";
import type { Triage } from "./triage.ts";

// File one raw issue on a toy repo and print every step, triage through lane.
//   TOY=slugify|duration   which toy under fixtures/ (default slugify)
//   AGENT=claude           real agents; otherwise a scripted rewrite and slugify's two scripted tries
//   MODEL=...              the model the agents are asked for
//   TYPESAFE_API_KEY=...   real Jev; otherwise it sorts "bug, p1, agent" and says "met" to everything

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

function describeTriage(state: Triage): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "enriching":
      return "reading the code and rewriting the issue";
    case "sorting":
      return "sorting";
    case "triaged":
      return `triaged: ${state.type}, ${state.priority}, for ${state.audience === "agent" ? "an agent" : "a person"}`;
    case "parked":
      return `parked for a person: ${JSON.stringify(state.why)}`;
    case "killed":
      return `killed: ${state.clause}`;
  }
}

function describeLane(state: Lane): string {
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

/** One line per step: the lane once it has started, triage before that. */
const describe = (state: Factory): string =>
  state.lane.phase === "idle"
    ? `triage  ${describeTriage(state.triage)}`
    : `lane    ${describeLane(state.lane)}`;

/** The names of the tests that failed, out of `node --test`'s report. */
const failedTests = (output: string): string[] =>
  [...output.matchAll(/^not ok \d+ - (.+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

const key = process.env.TYPESAFE_API_KEY || undefined;
const useClaude = process.env.AGENT === "claude";
const name = process.env.TOY || "slugify";
if (!useClaude && name !== "slugify") {
  throw new Error(`only slugify has a scripted builder; run ${name} with AGENT=claude`);
}

const toy = await checkoutToy(name);
const claude = process.env.MODEL ? { model: process.env.MODEL } : {};
const layers = Layer.mergeAll(
  useClaude ? claudeEnricher(toy.dir, claude) : scriptedEnricher([toy.issue]).layer,
  useClaude
    ? claudeBuilder(toy.dir, claude)
    : scriptedFileBuilder(toy.dir, slugifyTries.map((text) => ({ "slugify.js": text }))).layer,
  localWorkspace(toy.dir, {
    test: ["node", "--test"],
    protect: toy.hidden === undefined ? ["*.test.js"] : [],
    ...(toy.hidden === undefined ? {} : { hidden: toy.hidden }),
  }),
  key === undefined
    ? scriptedJev(
        Object.fromEntries(toy.issue.criteria.map((c) => [c.text, [["met", 0.95] as const]])),
        [
          {
            type: ["bug", 0.95],
            priority: ["p1", 0.9],
            audience: ["agent", 0.95],
            value: ["keep", 0.95],
          },
        ],
      )
    : liveJev(key, JEV_ENDPOINT),
);

console.log(`filed:   "${toy.raw.title}" by a ${toy.raw.filedBy === "human" ? "person" : "agent"}`);
console.log(`         ${toy.raw.body}`);
console.log(`repo:    ${toy.dir}`);
console.log(`tests:   ${toy.hidden === undefined ? "in the repo, the builder can read them" : "hidden from the builder"}`);
console.log(`agents:  ${useClaude ? "Claude Code" : "scripted (AGENT=claude for real ones)"}`);
console.log(`jev:     ${key === undefined ? "scripted (set TYPESAFE_API_KEY for the real one)" : "real"}\n`);

const indent = "".padEnd(21);
let diff = "";
const final = await Effect.runPromise(
  Effect.gen(function* () {
    const handle = yield* run(factory, { interpret: factoryInterpret, ctx: undefined });
    const runtime = yield* handle.ready;
    runtime.observe((msg, state) => {
      console.log(`${msg.type.padEnd(18)} -> ${describe(state)}`);
      if (msg.type === "enrich_ok") {
        const { issue } = msg.value;
        console.log(`${indent} title: ${issue.title}`);
        for (const criterion of issue.criteria) {
          console.log(`${indent} [${criterion.id}] ${criterion.text}`);
        }
      }
      if (msg.type === "resilient_run_ok" && "type" in msg.value.answers) {
        const sorted = Object.entries(msg.value.answers).map(
          ([question, answer]) => `${question}: ${answer.choice} (${answer.confidence})`,
        );
        console.log(`${indent} ${sorted.join("  ")}`);
      }
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
    yield* runtime.dispatch({ type: "file", raw: toy.raw });
    yield* runtime.idle();
    return runtime.getState();
  }).pipe(Effect.scoped, Effect.provide(layers)),
);

console.log(`\ntriage:  ${describeTriage(final.triage)}`);
console.log(`lane:    ${describeLane(final.lane)}`);
if (diff !== "") console.log(`\nthe diff the judge read:\n${diff}`);
if (useClaude) {
  const { triage, lane } = final;
  if (triage.phase !== "idle" && triage.session !== null) {
    console.log(`talk to the enricher: cd ${toy.dir} && claude --resume ${triage.session}`);
  }
  if (lane.phase !== "idle" && lane.session !== null) {
    console.log(`talk to the builder:  cd ${toy.dir} && claude --resume ${lane.session}`);
  }
}
