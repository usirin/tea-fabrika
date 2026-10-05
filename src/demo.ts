import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "@demlik/tea/effect";
import { fileStore } from "@demlik/tea/node";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { claudeBuilder, claudeEnricher } from "./claude.ts";
import { type Factory, type FactoryMsg, factory, parseFactory } from "./factory.ts";
import { factoryInterpret } from "./handlers.ts";
import type { Lane } from "./lane.ts";
import { checkoutToy, liveJev, localWorkspace, openToy } from "./local.ts";
import { jevRouter } from "./route.ts";
import {
  scriptedEnricher,
  scriptedFileBuilder,
  scriptedJev,
  scriptedRouter,
} from "./scripted.ts";
import type { Triage } from "./triage.ts";

// File one raw issue on a toy repo and print every step, triage through lane.
//   TOY=slugify|duration   which toy under fixtures/ (default slugify)
//   AGENT=claude           real agents; otherwise a scripted rewrite and slugify's two scripted tries
//   MODEL=...              the model the agents are asked for
//   TYPESAFE_API_KEY=...   real Jev for the sort; otherwise it sorts "bug, p1, agent"
//   RUN=<folder>           keep the run's state there: stop it at any point (Ctrl-C), run the
//                          same command again, and it carries on from where it stopped
//   ANSWER='<json>'        with RUN, answer the park the run stopped at, e.g.
//                          '{"park":"sort_unsure","answer":{"kind":"sort","type":"feature","priority":"p2","audience":"agent"}}'

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
      return `parked for a person: ${JSON.stringify(state.why.kind === "enricher_failed" ? state.why : { ...state.why, issue: undefined })}`;
    case "dropped":
      return `dropped by a person: ${state.why.kind}`;
    case "killed":
      return `killed: ${state.clause}`;
  }
}

function describeLane(state: Lane): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "preparing":
      return "writing the issue's tests and running them on the untouched code";
    case "building":
      return state.feedback === null
        ? `building (attempt ${state.attempt})`
        : `building (attempt ${state.attempt}), sent back: ${state.feedback.split("\n")[0]}`;
    case "checking":
      return "running the tests";
    case "reviewing":
      return `asking whether the extra changes serve the ticket: ${Object.entries(state.routed)
        .map(([file, relation]) => `${file} ${relation ?? "..."}`)
        .join(", ")}`;
    case "done":
      return state.deviations.length === 0
        ? `done in ${state.attempt} attempt(s)`
        : `done in ${state.attempt} attempt(s), with extra changes: ${state.deviations.map((d) => `${d.file} (${d.why})`).join("; ")}`;
    case "parked":
      return `parked for a person: ${JSON.stringify(state.why)}`;
    case "dropped":
      return `dropped by a person: ${state.why.kind}`;
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

// A run kept in RUN remembers which toy it checked out, and where.
const runDir = process.env.RUN || undefined;
// Trusted as typed: it is the person running the demo, and an answer that fits no park changes nothing.
const answer = process.env.ANSWER
  ? (JSON.parse(process.env.ANSWER) as Extract<FactoryMsg, { type: "answer" }>["answer"])
  : undefined;
if (answer !== undefined && runDir === undefined) throw new Error("ANSWER needs RUN: there is no stopped run to answer");
const kept =
  runDir === undefined
    ? null
    : await readFile(join(runDir, "run.json"), "utf8").then(
        (text) => JSON.parse(text) as { readonly toy: string; readonly dir: string },
        () => null,
      );
const toy = kept === null ? await checkoutToy(name) : await openToy(kept.toy, kept.dir);
if (runDir !== undefined && kept === null) {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify({ toy: name, dir: toy.dir }));
}
const store =
  runDir === undefined ? undefined : fileStore(join(runDir, "state.json"), parseFactory, { fenced: true });
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
    ? scriptedJev([
        {
          type: ["bug", 0.95],
          priority: ["p1", 0.9],
          audience: ["agent", 0.95],
          value: ["keep", 0.95],
        },
      ])
    : liveJev(key, JEV_ENDPOINT),
  // The router: Jev when there is a key; otherwise every extra change is unsure, so a person sees it.
  key === undefined ? scriptedRouter().layer : jevRouter.pipe(Layer.provide(liveJev(key, JEV_ENDPOINT))),
);

if (runDir !== undefined) console.log(`kept in: ${runDir}`);
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
    const handle = yield* run(factory, {
      interpret: factoryInterpret,
      ctx: undefined,
      ...(store === undefined ? {} : { store }),
    });
    const runtime = yield* handle.ready;
    runtime.observe((msg, state) => {
      console.log(`${msg.type.padEnd(18)} -> ${describe(state)}`);
      if (msg.type === "enrich_ok") {
        const { issue } = msg.value;
        console.log(`${indent} title: ${issue.title}`);
        for (const criterion of issue.criteria) {
          console.log(`${indent} [${criterion.id}] ${criterion.rule}`);
          if (criterion.kind === "example") {
            for (const e of criterion.examples) console.log(`${indent}     ${e.call} -> ${e.result}`);
          } else {
            console.log(`${indent}     no example: ${criterion.why}`);
          }
        }
      }
      if (msg.type === "resilient_run_ok" && "type" in msg.value.answers) {
        const sorted = Object.entries(msg.value.answers).map(
          ([question, answer]) => `${question}: ${answer.choice} (${answer.confidence})`,
        );
        console.log(`${indent} ${sorted.join("  ")}`);
      }
      if (msg.type === "prepare_ok") {
        for (const failed of msg.value.failing) console.log(`${indent} fails before any change: ${failed}`);
        for (const passed of msg.value.passing) console.log(`${indent} holds already: ${passed}`);
      }
      if (msg.type === "build_ok") {
        const answer = msg.value;
        console.log(
          `${indent} builder: ${answer.kind === "done" ? answer.summary : answer.kind === "blocked" ? `blocked: ${answer.why}` : `contradiction in ${answer.criterion}, ${answer.call}: ${answer.why}`}`,
        );
        if (answer.kind === "done") {
          for (const d of answer.deviations) console.log(`${indent} also changed ${d.file}: ${d.why}`);
        }
      }
      if (msg.type === "route_ok") {
        console.log(`${indent} router: ${msg.value.file} ${msg.value.relation} (${msg.value.confidence})`);
      }
      if (msg.type === "check_ok") {
        diff = msg.value.diff;
        for (const failed of failedTests(msg.value.output)) {
          console.log(`${indent} failed: ${failed}`);
        }
      }
    });
    const booted = runtime.getState();
    if (booted.triage.phase === "idle") {
      yield* runtime.dispatch({ type: "file", raw: toy.raw, builder: randomUUID() });
    } else {
      // Booted from a stopped run: ask again for whatever it was waiting on.
      console.log(`resumed:           ${describe(booted)}`);
      yield* runtime.dispatch({ type: "resume", at: Date.now() });
      if (answer !== undefined) {
        console.log(`answered:          ${JSON.stringify(answer)}`);
        yield* runtime.dispatch({ type: "answer", answer, at: Date.now() });
      }
    }
    yield* runtime.idle();
    return runtime.getState();
  }).pipe(Effect.scoped, Effect.provide(layers)),
);

console.log(`\ntriage:  ${describeTriage(final.triage)}`);
console.log(`lane:    ${describeLane(final.lane)}`);
if (diff !== "") console.log(`\nthe builder's diff:\n${diff}`);
if (useClaude) {
  const { triage, lane } = final;
  if (triage.phase !== "idle" && triage.session !== null) {
    console.log(`talk to the enricher: cd ${toy.dir} && claude --resume ${triage.session}`);
  }
  if (lane.phase !== "idle") {
    console.log(`talk to the builder:  cd ${toy.dir} && claude --resume ${lane.session}`);
  }
}
