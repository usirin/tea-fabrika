import { randomUUID } from "node:crypto";
import { run } from "@demlik/tea/effect";
import { fileStore } from "@demlik/tea/node";
import { Effect } from "effect";
import { type Factory, type FactoryMsg, factory, parseFactory } from "./factory.ts";
import { factoryInterpret } from "./handlers.ts";
import type { Lane } from "./lane.ts";
import { type Review, whereOf } from "./review.ts";
import { knobsOf, Settings } from "./settings.ts";
import type { Ship } from "./ship.ts";
import type { Triage } from "./triage.ts";

// What the hosts share: running the factory on one ticket and printing every
// step. Each host (src/demo.ts, src/real.ts) only says where the ticket, the
// repo and the agents are, as Layers.

export function describeTriage(state: Triage): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "fetching":
      return `reading ticket ${state.id} from the tracker`;
    case "enriching":
      return "reading the code and rewriting the issue";
    case "sorting":
      return "sorting";
    case "triaged":
      return `triaged: ${state.type}, ${state.priority}, nothing left open`;
    case "parked":
      return state.why.kind === "needs_decision"
        ? [
            "waiting for the owner: the issue rests on a call nobody has made",
            `${"".padEnd(21)} ${state.why.question}`,
            `${"".padEnd(21)} decide with ANSWER='{"park":"needs_decision","answer":{"kind":"decide","ruling":"<the call>"}}'`,
            `${"".padEnd(21)} or drop with ANSWER='{"park":"needs_decision","answer":{"kind":"drop"}}'`,
          ].join("\n")
        : `parked for a person: ${JSON.stringify(state.why.kind === "enricher_failed" ? state.why : { ...state.why, issue: undefined })}`;
    case "dropped":
      return `dropped by a person: ${state.why.kind}`;
    case "killed":
      return `killed: ${state.clause}`;
  }
}

function describeReview(state: Review): string {
  switch (state.phase) {
    case "scoping":
      return `asking whether the extra changes serve the ticket`;
    case "reading":
      return state.input.open.length === 0
        ? "the reviewer is reading the diff, and Jev is looking for files it left out"
        : `the reviewer is reading the diff, and rechecking ${state.input.open.map((f) => f.id).join(", ")}; Jev is looking for files it left out`;
    case "matching":
      return `asking whether findings ${state.found.map((f) => f.id).join(", ")} were already decided`;
    case "sorting":
      return `asking whether findings ${state.found.map((f) => f.id).join(", ")} are this ticket's`;
    case "parked":
      return `parked for a person: ${state.why.kind}`;
    default:
      return state.phase;
  }
}

export function describeLane(state: Lane): string {
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
    case "checking_fresh":
      return "the tests passed; running them again on a fresh copy of the change";
    case "diagnosing":
      return `the tests failed${state.failure.step === "fresh" ? " on a fresh copy" : ""}; reading whose failure it is`;
    case "reviewing":
      return `reviewing: ${describeReview(state.review)}`;
    case "finishing":
      return "passed; reading the owner's comments before calling it done";
    case "done":
      return [
        `done in ${state.attempt} attempt(s), ${state.builds} build(s)`,
        ...state.deviations.map((d) => `extra change ${d.file} (${d.why})`),
        ...state.notes.map((f) => `filed ${whereOf(f)}: ${f.problem}`),
        ...state.matched.map((m) => `${m.finding.id} taken as ${m.to} again: ${m.finding.problem}`),
        ...state.comments.map((c) => `comment ${c.id} settled by the ${c.state.kind === "settled" ? c.state.by : "?"}: ${c.text}`),
      ].join("; ");
    case "parked":
      return `parked for a person: ${JSON.stringify(state.why)}`;
    case "dropped":
      return `dropped by a person: ${state.why.kind}`;
  }
}

export function describeShip(state: Ship): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "sealing":
      return "sealing the change as one commit";
    case "parked":
      return state.why.kind === "approve"
        ? `waiting for a person to approve ${state.why.head}:\n${state.input.record.map((line) => `${"".padEnd(21)} ${line}`).join("\n")}\n${state.why.stat}\n${"".padEnd(21)} approve with ANSWER='{"park":"approve","answer":{"kind":"approve","head":"${state.why.head}"}}'`
        : `parked for a person: ${JSON.stringify(state.why)}`;
    case "landing":
      return `landing ${state.head}`;
    case "catching_up":
      return "the base moved: merging the change with it";
    case "retesting":
      return `running the tests on the merge ${state.head}`;
    case "landed":
      return `landed: the base is at ${state.sha}`;
    case "dropped":
      return `dropped by a person: ${state.why.kind}`;
  }
}

/** One line per step: ship once it has started, the lane before that, triage before that. */
export const describe = (state: Factory): string =>
  state.ship.phase !== "idle"
    ? `ship    ${describeShip(state.ship)}`
    : state.lane.phase === "idle"
      ? `triage  ${describeTriage(state.triage)}`
      : `lane    ${describeLane(state.lane)}`;

/** The tests that failed, out of a TAP report: `node --test`'s, or vitest's `tap-flat`. */
const failedTests = (output: string): string[] =>
  [...output.matchAll(/^not ok \d+ - (.+)$/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

/** A person's answer to the park a stopped run is waiting at. */
export type Answer = Extract<FactoryMsg, { type: "answer" }>["answer"];

/** `ANSWER`, as typed. Trusted: it is the person running the host, and an answer that fits no park changes nothing. */
export const answerFrom = (text: string | undefined): Answer | undefined =>
  text ? (JSON.parse(text) as Answer) : undefined;

/** Start the factory, kept in `store` if there is one. */
const start = (store: ReturnType<typeof fileStore<Factory>> | undefined) =>
  run(factory, { interpret: factoryInterpret, ctx: undefined, ...(store === undefined ? {} : { store }) });

/** A message as the runtime's observers get it: the factory's own, and every command's result. */
type Observed = Parameters<
  Parameters<Effect.Success<Effect.Success<ReturnType<typeof start>>["ready"]>["observe"]>[0]
>[0];

const indent = "".padEnd(21);

/** Print what one step brought: the rewrite, the sort, the builder's answer, the review and the test results. */
function printStep(msg: Observed): void {
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
    console.log(`${indent} open decision: ${issue.openDecision ?? "none"}`);
  }
  if (msg.type === "sort_run_ok") {
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
    switch (answer.kind) {
      case "done":
        console.log(`${indent} builder: ${answer.summary}`);
        for (const d of answer.deviations) console.log(`${indent} also changed ${d.file}: ${d.why}`);
        break;
      case "blocked":
        console.log(`${indent} builder: blocked: ${answer.why}`);
        break;
      case "contradiction":
        console.log(`${indent} builder: contradiction in ${answer.criterion}, ${answer.call}: ${answer.why}`);
        break;
      case "dispute":
        console.log(`${indent} builder: disputes ${answer.finding}: ${answer.why}`);
        break;
    }
  }
  if (msg.type === "inspect_ok") {
    for (const f of msg.value.findings) console.log(`${indent} reviewer: ${f.file}:${f.line} \`${f.quote.trim()}\`: ${f.problem}`);
    for (const r of msg.value.rechecks) console.log(`${indent} reviewer: ${r.id} ${r.fixed ? "fixed" : "not fixed"}`);
    if (msg.value.findings.length === 0) console.log(`${indent} reviewer: no findings`);
  }
  if (msg.type === "find_missing_ok") {
    const found = msg.value;
    if (found.kind === "too_many") {
      console.log(`${indent} missing files: skipped, ${found.candidates} candidates is over the cap of ${found.cap}`);
    } else {
      for (const f of found.flagged) console.log(`${indent} missing files: ${f.file} (${f.yes.toFixed(2)})`);
      if (found.flagged.length === 0) console.log(`${indent} missing files: none of ${found.asked} flagged`);
    }
  }
  if (msg.type === "find_missing_err") console.log(`${indent} missing files: skipped, the reader failed`);
  if (msg.type === "route_ok") {
    console.log(`${indent} router: ${msg.value.key} ${msg.value.relation} (${msg.value.confidence})`);
  }
  if (msg.type === "match_ok") {
    console.log(`${indent} matcher: ${msg.value.key} ${msg.value.to === null ? "new point" : `same as ${msg.value.to}`} (${msg.value.confidence})`);
  }
  if (msg.type === "fetch_comments_ok") {
    for (const c of msg.value.comments) console.log(`${indent} comment ${c.id}: ${c.text}`);
    if (msg.value.comments.length === 0) console.log(`${indent} no comments`);
  }
  if (msg.type === "weigh_ok") {
    const { key, reading, confidence } = msg.value;
    const said = reading.kind === "changes" ? `changes ${reading.criterion}` : reading.kind;
    console.log(`${indent} reader: ${key} ${said} (${confidence})`);
  }
  if (msg.type === "check_ok") {
    for (const failed of failedTests(msg.value.output)) console.log(`${indent} failed: ${failed}`);
  }
}

/**
 * File ticket `issue` and drive the factory until it stops, printing every
 * step. With `state`, the run is kept in that file: a run found there is
 * resumed instead, and `answer` answers the park it stopped at. Hands back
 * where it stopped and the builder's last diff.
 */
export const drive = (options: { readonly issue: string; readonly state?: string; readonly answer?: Answer }) =>
  Effect.gen(function* () {
    const handle = yield* start(
      options.state === undefined ? undefined : fileStore(options.state, parseFactory, { fenced: true }),
    );
    const runtime = yield* handle.ready;
    let diff = "";
    runtime.observe((msg, state) => {
      console.log(`${msg.type.padEnd(18)} -> ${describe(state)}`);
      printStep(msg);
      if (msg.type === "check_ok") diff = msg.value.diff;
    });
    const booted = runtime.getState();
    if (booted.triage.phase === "idle") {
      const knobs = knobsOf(yield* Settings);
      yield* runtime.dispatch({ type: "file", issue: options.issue, builder: randomUUID(), knobs });
    } else {
      // Booted from a stopped run: ask again for whatever it was waiting on.
      console.log(`resumed:           ${describe(booted)}`);
      yield* runtime.dispatch({ type: "resume", at: Date.now() });
      if (options.answer !== undefined) {
        console.log(`answered:          ${JSON.stringify(options.answer)}`);
        yield* runtime.dispatch({ type: "answer", answer: options.answer, at: Date.now() });
      }
    }
    yield* runtime.idle();
    return { final: runtime.getState(), diff };
  });

/** Print where a run stopped, the builder's diff, and how to talk to the Claude agents it ran in `dir`, if any. */
export function printEnd(final: Factory, diff: string, claudeIn: string | null): void {
  console.log(`\ntriage:  ${describeTriage(final.triage)}`);
  console.log(`lane:    ${describeLane(final.lane)}`);
  console.log(`ship:    ${describeShip(final.ship)}`);
  if (diff !== "") console.log(`\nthe builder's diff:\n${diff}`);
  if (claudeIn === null) return;
  const { triage, lane } = final;
  if ("session" in triage && triage.session !== null) {
    console.log(`talk to the enricher: cd ${claudeIn} && claude --resume ${triage.session}`);
  }
  if (lane.phase !== "idle") {
    console.log(`talk to the builder:  cd ${claudeIn} && claude --resume ${lane.session}`);
  }
}
