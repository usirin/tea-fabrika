import { randomUUID } from "node:crypto";
import { run } from "@demlik/tea/effect";
import { fileStore } from "@demlik/tea/node";
import { Effect } from "effect";
import { enrichmentText } from "./enrichment.ts";
import { factsBrief } from "./facts.ts";
import { type Factory, type FactoryMsg, factory, parseFactory } from "./factory.ts";
import { factoryInterpret, interpret, shipInterpret, triageInterpret } from "./handlers.ts";
import type { Criterion, Issue } from "./issue.ts";
import { type Build, buildProblems, type Lane } from "./lane.ts";
import { type Review, whereOf } from "./review.ts";
import { knobsOf, Settings } from "./settings.ts";
import type { Ship } from "./ship.ts";
import { type Enrichment, rewriteOf, type Triage } from "./triage.ts";
import { snippetsOf, vetProblems } from "./vetting.ts";

// What the hosts share: running the factory on one ticket and printing every
// step. Each host (src/demo.ts, src/real.ts) only says where the ticket, the
// repo and the agents are, as Layers.

/** Where the enrichment child is. */
function describeEnrichment(e: Enrichment): string {
  switch (e.phase) {
    case "writing":
      return `the enricher is writing draft ${e.tries} of at most ${e.limit}${e.tries > 1 ? ", from vetting's problems" : ""}`;
    case "checking":
      return `vetting draft ${e.tries}: its files at HEAD, and its examples run on today's code in a fresh copy`;
    default:
      return e.phase;
  }
}

/** How a person answers a park, printed under it. */
const answerHint = (park: string, answers: readonly string[]) =>
  answers.map((a, i) => `${indent} ${i === 0 ? "answer" : "    or"} with ANSWER='{"park":"${park}","answer":${a}}'`);

/** What triage is waiting on a person for, with how to answer it. */
function describeTriagePark(why: Extract<Triage, { phase: "parked" }>["why"]): string {
  switch (why.kind) {
    case "needs_decision":
      return [
        "waiting for the owner: the issue rests on a call nobody has made",
        `${indent} ${why.question}`,
        ...answerHint("needs_decision", ['{"kind":"decide","ruling":"<the call>"}', '{"kind":"drop"}']),
      ].join("\n");
    case "enrichment_unvetted":
      return [
        `the enricher's last draft still fails vetting, and its ${why.enrichment.phase === "out_of_tries" ? why.enrichment.limit : ""} tries are spent:`,
        ...why.problems.map((p) => `${indent} - ${p}`),
        ...answerHint("enrichment_unvetted", ['{"kind":"retry","tries":2}', '{"kind":"accept"}', '{"kind":"drop"}']),
      ].join("\n");
    case "vetting_failed":
      return ["the draft could not be vetted: the fresh copy, its install or the test run failed", ...answerHint("vetting_failed", ['{"kind":"retry"}', '{"kind":"accept"}', '{"kind":"drop"}'])].join("\n");
    case "enricher_failed":
      return ["the enricher's turn failed", ...answerHint("enricher_failed", ['{"kind":"retry"}', '{"kind":"drop"}'])].join("\n");
    default:
      return `parked for a person: ${JSON.stringify({ ...why, issue: undefined })}`;
  }
}

export function describeTriage(state: Triage): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "fetching":
      return `reading ticket ${state.id} from the tracker`;
    case "gathering":
      return `asking the code about ${[...state.mentions.names, ...state.mentions.paths].length} name(s) and path(s) the report mentions`;
    case "enriching":
      return describeEnrichment(state.enrichment);
    case "sorting":
      return "sorting";
    case "triaged":
      return `triaged: ${state.type}, ${state.priority}, nothing left open`;
    case "parked":
      return "raw" in state ? describeTriagePark(state.why) : `parked for a person: ${state.why.kind}`;
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

/** Where the build loop is. */
function describeBuild(b: Build): string {
  switch (b.phase) {
    case "writing":
      return b.note === null
        ? `building (attempt ${b.tries})`
        : `building (attempt ${b.tries}), sent back: ${b.note.split("\n")[0]}`;
    case "checking":
      return "checking: the tests, the published API, the tests on a fresh copy; a failed run is read for whose it is";
    default:
      return b.phase;
  }
}

export function describeLane(state: Lane): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "preparing":
      return "writing the issue's tests and running them on the untouched code";
    case "building":
      return describeBuild(state.build);
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

/**
 * Where a run stops on its own: `end`, wherever the factory stops; `triage`,
 * once triage is done with the issue, before the lane does any work.
 */
export type Until = "end" | "triage";

/** `UNTIL`, as typed: left out, the run goes to the end. */
export function untilFrom(text: string | undefined): Until {
  if (!text || text === "end") return "end";
  if (text === "triage") return "triage";
  throw new Error(`UNTIL is "${text}": it can be "triage", or left out to run to the end`);
}

/**
 * The same handlers, none of which does its work: each says the run has
 * reached work it must not do, then waits until the run stops. The Cmd stays
 * asked, so the saved state still waits on it, and a later run without
 * `UNTIL` asks it again on resume.
 */
const holdAll = <H extends Record<string, unknown>>(handlers: H, reached: () => void) =>
  Object.fromEntries(
    Object.keys(handlers).map((type) => [type, () => Effect.sync(reached).pipe(Effect.andThen(Effect.never))]),
  ) as { readonly [K in keyof H]: () => Effect.Effect<never> };

/**
 * tea's own sink, except that it says nothing of Cmds a stop leaves in
 * flight: held work is left there on purpose. Anything else is thrown, as tea
 * throws it.
 */
const quietAboutHeld = (error: unknown, context: { readonly phase: string }) => {
  if (context.phase === "discard") return;
  setTimeout(() => {
    throw error;
  }, 0);
};

/** Start the factory, kept in `store` if there is one. `held` is called when `until` stops lane or ship work. */
const start = (store: ReturnType<typeof fileStore<Factory>> | undefined, until: Until, held: () => void) =>
  run(factory, {
    ctx: undefined,
    ...(store === undefined ? {} : { store }),
    // Triage's work runs; stopping at triage, the lane's and ship's is held, so nothing touches the repo.
    ...(until === "triage"
      ? {
          interpret: { ...triageInterpret, ...holdAll(interpret, held), ...holdAll(shipInterpret, held) },
          onError: quietAboutHeld,
        }
      : { interpret: factoryInterpret }),
  });

/** A message as the runtime's observers get it: the factory's own, and every command's result. */
type Observed = Parameters<
  Parameters<Effect.Success<Effect.Success<ReturnType<typeof start>>["ready"]>["observe"]>[0]
>[0];

const indent = "".padEnd(21);

/** A criterion's kind in a few words: how many examples or snippets, its test, or what an unchecked rule is about. */
const kindLine = (c: Criterion): string => {
  switch (c.kind) {
    case "example":
      return `${c.examples.length} example(s)`;
    case "type":
      return `type: ${c.snippets.map((s) => `${s.expect}/${s.today}`).join(" ")}`;
    case "existing_test":
      return `test ${c.test}`;
    case "unchecked":
      return `unchecked ${c.about}`;
  }
};

/** A rewrite, whole: every criterion with what checks it or what it is about, and the call left open. */
function printIssue(issue: Issue): void {
  console.log(`${indent} title: ${issue.title}`);
  const about = (files: readonly string[]) => `${indent}     about: ${files.length === 0 ? "no one file" : files.join(", ")}`;
  for (const criterion of issue.criteria) {
    console.log(`${indent} [${criterion.id}] ${criterion.rule}`);
    switch (criterion.kind) {
      case "example":
        for (const u of criterion.uses) console.log(`${indent}     uses ${u.name} from ${u.file}`);
        for (const e of criterion.examples) console.log(`${indent}     ${e.call} -> ${e.result}`);
        break;
      case "type":
        for (const u of criterion.uses) console.log(`${indent}     uses ${u.name} from ${u.file}`);
        criterion.snippets.forEach((s, i) => {
          console.log(`${indent}     snippet ${i + 1}: ${s.expect}, ${s.today} today`);
          for (const line of s.code.split("\n")) console.log(`${indent}       ${line}`);
        });
        console.log(about(criterion.files));
        break;
      case "existing_test":
        console.log(`${indent}     the test ${criterion.test} passes`);
        console.log(about(criterion.files));
        break;
      case "unchecked":
        console.log(`${indent}     no check (${criterion.about}): ${criterion.why}`);
        console.log(about(criterion.files));
        break;
    }
  }
  console.log(`${indent} open decision: ${issue.openDecision ?? "none"}`);
}

/** One line, cut to fit a terminal row. */
const short = (text: string, max = 160) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Print what one step brought: the facts, each draft and its vetting, the sort, the builder's answer, the review and the test results. */
function printStep(msg: Observed): void {
  if (msg.type === "gather_facts_ok") {
    for (const line of factsBrief(msg.value).split("\n")) console.log(`${indent} ${short(line, 200)}`);
  }
  if (msg.type === "gather_facts_err") console.log(`${indent} facts: could not gather them; the enricher reads the code itself`);
  if (msg.type === "enrich_write_ok") {
    const { draft } = msg.value;
    const examples = draft.criteria.flatMap((c) => (c.kind === "example" ? c.examples : []));
    const unchecked = draft.criteria.filter((c) => c.kind === "unchecked").length;
    console.log(`${indent} draft: ${draft.title}`);
    console.log(
      `${indent} ${draft.criteria.length} criteria, ${draft.criteria.length - unchecked} checked: ${examples.length} example(s); ${draft.criteria
        .map((c) => `${c.id} (${kindLine(c)})`)
        .join(", ")}`,
    );
  }
  if (msg.type === "enrich_check_ok") {
    const vetted = msg.value;
    for (const m of vetted.missing) console.log(`${indent} vet: missing file ${m.file} (criterion ${m.criterion})`);
    for (const e of vetted.examples) {
      // The call as written: its spaces may be what the example is about.
      const call = e.call.length > 90 ? `${e.call.slice(0, 89)}…` : e.call;
      console.log(`${indent} vet: ${e.verdict.padEnd(13)} ${e.criterion}: ${call.replace(/\n/g, " ")}`);
      if (e.detail !== "" && e.verdict !== "holds_already") console.log(`${indent}      ${short(e.detail)}`);
    }
    for (const s of vetted.snippets) {
      const said = snippetsOf(msg.cmd.draft).find((d) => d.criterion === s.criterion && d.snippet === s.snippet);
      const meant = said === undefined ? "" : ` (${said.expect}, meant to ${said.today === "holds" ? "hold" : "fail"} today)`;
      console.log(`${indent} vet: ${s.verdict.padEnd(13)} ${s.criterion}: snippet ${s.snippet}${meant}`);
      if (s.detail !== "") console.log(`${indent}      ${short(s.detail)}`);
    }
    for (const t of vetted.tests) {
      console.log(`${indent} vet: ${t.verdict.padEnd(13)} ${t.criterion}: ${t.test}`);
      if (t.verdict === "cannot_run") console.log(`${indent}      ${short(t.detail)}`);
    }
    const problems = vetProblems(msg.cmd.draft, vetted);
    console.log(`${indent} vet: ${problems.length === 0 ? "passes" : `${problems.length} problem(s), back to the enricher unless its tries are spent`}`);
    for (const p of problems) console.log(`${indent}      - ${short(p, 300)}`);
  }
  if (msg.type === "enrich_check_err") console.log(`${indent} vet: could not run`);
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
  if (msg.type === "build_write_ok") {
    const answer = msg.value.draft;
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
  if (msg.type === "build_check_ok") {
    const verdict = msg.value;
    if (verdict.kind === "touched") console.log(`${indent} changed locked files: ${verdict.files.join(", ")}`);
    if (verdict.kind === "failed") {
      for (const failed of failedTests(verdict.output)) console.log(`${indent} failed${verdict.step === "fresh" ? " on a fresh copy" : ""}: ${failed}`);
      console.log(`${indent} whose failure: ${verdict.cause}`);
    }
    if (verdict.kind !== "touched") {
      const { api } = verdict;
      if (api.kind === "skipped") console.log(`${indent} published API: not compared, ${api.why}`);
      else {
        for (const c of api.changes) console.log(`${indent} published API: ${c.kind} ${c.name} (${c.subpaths.join(", ")})`);
        if (api.changes.length === 0) console.log(`${indent} published API: ${api.package} unchanged`);
      }
    }
    const problems = buildProblems(msg.cmd.draft, verdict, msg.cmd.brief);
    console.log(`${indent} checks: ${problems.length === 0 ? "pass" : `${problems.length} problem(s)`}`);
  }
  if (msg.type === "build_check_err") console.log(`${indent} checks: could not run`);
}

/**
 * File ticket `issue` and drive the factory until it stops, printing every
 * step. With `state`, the run is kept in that file: a run found there is
 * resumed instead, and `answer` answers the park it stopped at. `until`
 * `triage` stops where the lane would start work, or wherever the run stops
 * before that. Hands back where it stopped, the builder's last diff, and the
 * enricher's rewrite, if there is one.
 */
export const drive = (options: {
  readonly issue: string;
  readonly state?: string;
  readonly answer?: Answer;
  readonly until?: Until;
}) =>
  Effect.gen(function* () {
    // A step waits for its own Cmds, so held work never lets the run go quiet,
    // and the step that asked for it never ends: the run stops when it is reached.
    let reached = () => {};
    const held = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const handle = yield* start(
      options.state === undefined ? undefined : fileStore(options.state, parseFactory, { fenced: true }),
      options.until ?? "end",
      () => reached(),
    );
    const runtime = yield* handle.ready;
    let diff = "";
    let rewrite: Issue | null = null;
    let enriching = runtime.getState().triage.phase === "enriching";
    runtime.observe((msg, state) => {
      console.log(`${msg.type.padEnd(18)} -> ${describe(state)}`);
      printStep(msg);
      if (msg.type === "build_check_ok" && msg.value.kind !== "touched") diff = msg.value.diff;
      if (msg.type === "enrich_write_ok") rewrite = msg.value.draft;
      // The draft-and-vet loop is over, one way or another: the rewrite it ended with, whole.
      const final = rewriteOf(state.triage);
      if (enriching && state.triage.phase !== "enriching" && final !== null) {
        console.log(`${indent} the enrichment, as triage keeps it:`);
        printIssue(final);
      }
      enriching = state.triage.phase === "enriching";
    });
    const work = Effect.gen(function* () {
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
    });
    yield* Effect.raceFirst(work, Effect.promise(() => held));
    const final = runtime.getState();
    return { final, diff, rewrite: rewriteOf(final.triage) ?? rewrite };
  });

/**
 * Print where a run stopped at triage, and the whole rewrite as it is kept in
 * `ours`, beside fabrika's own in `theirs` when there is one to compare.
 */
export function printTriageEnd(
  final: Factory,
  rewrite: Issue | null,
  files: { readonly ours: string | null; readonly theirs: string | null },
): void {
  console.log(`\ntriage:  ${describeTriage(final.triage)}`);
  console.log(
    final.lane.phase === "idle"
      ? "lane:    not started"
      : "lane:    held: UNTIL=triage stops before the lane does any work; run again without UNTIL to build",
  );
  if (rewrite === null) {
    console.log("\nno rewrite to show: the enricher has not written one this run holds");
    return;
  }
  console.log(`\nour enrichment:\n\n${enrichmentText(rewrite)}\n`);
  if (files.ours !== null) console.log(`ours:    ${files.ours}`);
  if (files.theirs !== null) console.log(`fabrika: ${files.theirs}`);
}

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
