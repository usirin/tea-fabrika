import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JEV_ENDPOINT } from "@demlik/tea/jev";
import { Effect, Layer } from "effect";
import { claudeBuilder, claudeEnricher, claudeReviewer } from "./claude.ts";
import { answerFrom, drive, printEnd } from "./drive.ts";
import { checkoutToy, fileTracker, liveJev, localRepo, localWorkspace, openToy, seedTicket, TOY_BASE } from "./local.ts";
import { jevCommentReader, jevFailureReader, jevMatcher, jevMissingReader, jevRouter } from "./route.ts";
import { defaultSettings, settingsFile } from "./settings.ts";
import {
  scriptedCommentReader,
  scriptedFailureReader,
  scriptedEnricher,
  scriptedFileBuilder,
  scriptedJev,
  scriptedMatcher,
  scriptedMissingReader,
  scriptedReviewer,
  scriptedRouter,
} from "./scripted.ts";

// File one raw issue on a toy repo and print every step, triage through lane.
//   TOY=slugify|duration   which toy under fixtures/ (default slugify)
//   AGENT=claude           real agents; otherwise a scripted rewrite and slugify's two scripted tries
//   MODEL=...              the model the agents are asked for
//   TYPESAFE_API_KEY=...   real Jev for the sort; otherwise it sorts "bug, p1, agent"
//   CONFIG=<file>          a fabrika.toml with the floors, limits and try limit; otherwise today's
//   RUN=<folder>           keep the run's state there: stop it at any point (Ctrl-C), run the
//                          same command again, and it carries on from where it stopped
//   ANSWER='<json>'        with RUN, answer the park the run stopped at, e.g.
//                          '{"park":"sort_unsure","answer":{"kind":"sort","type":"feature","priority":"p2","audience":"agent"}}'
//   <RUN>/tracker/<id>.json  the ticket, as the folder tracker keeps it; add {"id", "text"} to its
//                          "comments" to comment. The lane reads them before it calls itself done.
// A real ticket on a real repo is src/real.ts.

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

const key = process.env.TYPESAFE_API_KEY || undefined;
const useClaude = process.env.AGENT === "claude";
const name = process.env.TOY || "slugify";
if (!useClaude && name !== "slugify") {
  throw new Error(`only slugify has a scripted builder; run ${name} with AGENT=claude`);
}

// A run kept in RUN remembers which toy it checked out, and where.
const runDir = process.env.RUN || undefined;
const answer = answerFrom(process.env.ANSWER);
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
// Where the ticket lives: a folder tracker, seeded with the toy's ticket. A kept run keeps its own.
const trackerDir = runDir === undefined ? `${toy.dir}-tracker` : join(runDir, "tracker");
await seedTicket(trackerDir, toy.raw);
const claude = process.env.MODEL ? { model: process.env.MODEL } : {};
const testing = {
  test: ["node", "--test"],
  protect: toy.hidden === undefined ? ["*.test.js"] : [],
  ...(toy.hidden === undefined ? {} : { hidden: toy.hidden }),
} as const;
// What every Jev reader is built on: the call, and the floors and limits from CONFIG or today's.
const settings = process.env.CONFIG === undefined ? defaultSettings : settingsFile(process.env.CONFIG);
const jevReading = (key: string) => Layer.mergeAll(liveJev(key, JEV_ENDPOINT), settings);
const workspace = localWorkspace(toy.dir, testing);
const layers = Layer.mergeAll(
  useClaude ? claudeEnricher(toy.dir, claude) : scriptedEnricher([toy.issue]).layer,
  useClaude
    ? claudeBuilder(toy.dir, claude)
    : scriptedFileBuilder(toy.dir, slugifyTries.map((text) => ({ "slugify.js": text }))).layer,
  workspace,
  // The repo the change lands in: the toy's own, whose base is `main`.
  localRepo(toy.dir, { ...testing, base: TOY_BASE }),
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
  // The router: Jev when there is a key; otherwise everything is unsure, so a person sees it.
  key === undefined ? scriptedRouter().layer : jevRouter.pipe(Layer.provide(jevReading(key))),
  // The reviewer: Claude with real agents; otherwise a clean review.
  useClaude ? claudeReviewer(toy.dir, claude) : scriptedReviewer().layer,
  // The matcher: Jev when there is a key; otherwise nothing matches, and every finding is routed.
  key === undefined ? scriptedMatcher().layer : jevMatcher.pipe(Layer.provide(jevReading(key))),
  // The ticket and its comments: a folder of files, so a person can comment by editing one between steps.
  fileTracker(trackerDir),
  // The comment reader: Jev when there is a key; otherwise every comment is unsure, so a person sees it.
  key === undefined ? scriptedCommentReader().layer : jevCommentReader.pipe(Layer.provide(jevReading(key))),
  // The failure reader: Jev when there is a key; otherwise every failure goes back to the builder.
  key === undefined ? scriptedFailureReader().layer : jevFailureReader.pipe(Layer.provide(jevReading(key))),
  // The missing-file reader: Jev over the toy's files when there is a key; otherwise it flags nothing.
  key === undefined
    ? scriptedMissingReader().layer
    : jevMissingReader.pipe(Layer.provide(Layer.mergeAll(jevReading(key), workspace))),
  // The knobs a run copies in when it is filed.
  settings,
);

if (runDir !== undefined) console.log(`kept in: ${runDir}`);
console.log(`filed:   "${toy.raw.title}" by a ${toy.raw.filedBy === "human" ? "person" : "agent"}`);
console.log(`         ${toy.raw.body}`);
console.log(`ticket:  ${join(trackerDir, `${toy.raw.id}.json`)} (add to its "comments" to comment)`);
console.log(`repo:    ${toy.dir}`);
console.log(`tests:   ${toy.hidden === undefined ? "in the repo, the builder can read them" : "hidden from the builder"}`);
console.log(`agents:  ${useClaude ? "Claude Code" : "scripted (AGENT=claude for real ones)"}`);
console.log(`jev:     ${key === undefined ? "scripted (set TYPESAFE_API_KEY for the real one)" : "real"}\n`);

const { final, diff } = await Effect.runPromise(
  drive({
    issue: toy.raw.id,
    ...(runDir === undefined ? {} : { state: join(runDir, "state.json") }),
    ...(answer === undefined ? {} : { answer }),
  }).pipe(Effect.scoped, Effect.provide(layers)),
);
printEnd(final, diff, useClaude ? toy.dir : null);
