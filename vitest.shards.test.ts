import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BaseSequencer, createVitest } from "vitest/node";
import { nextFiles } from "./.github/ci/shard-rows.ts";
import { inLaneStep, vitestLegs } from "./.github/ci/workflow-lint.ts";
import { assign, measured, median, Shards, wall, WORKERS, restLoads } from "./vitest.shards.ts";

/** A file's row, or undefined when the table has none, as `Shards` reads it. */
const rowOf = (path: string): number | undefined => (Object.hasOwn(measured, path) ? measured[path] : undefined);

/** What a file with no row counts as in `assign` by default: the median of every row. */
const noRow = median(Object.values(measured));

/** A row from its samples: the median of three, or the larger of the one or two in hand. */
const row = (samples: readonly number[]): number =>
  samples.length === 3 ? samples.toSorted((a, b) => a - b)[1]! : Math.max(...samples);

it("vector: L5 known next timings are the median of three runs, or the larger of those in hand", () => {
  // Today's CI. The seven heaviest next/ files by row, with their samples in run order A, B, C:
  // attempt 1 of run 43544589151 (push to main), 43551626086 (merge queue group) and 43556494864
  // (push to main). RunnerAdmission has one sample: only run C held it.
  // The complete observations and job IDs are in nextSamples below.
  // L5. Plants, each run once on a copy of the table filled from these samples, and restored: drop
  // the StartChild row (red here and in the all-rows vector); set chaos.laws to 1.0 (red in the
  // all-rows vector).
  for (const [path, samples] of [
    ["next/packages/libfabrika/src/node/Watchers.test.ts", [488.0, 685.9, 492.4]],
    ["next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts", [351.1, 379.3, 412.7]],
    ["next/packages/libfabrika/src/node/StartChild.test.ts", [349.9, 341.0, 598.2]],
    ["next/packages/libfabrika/src/node/RunnerAdmission.test.ts", [258.9]],
    ["next/apps/fabrika/src/start-child.laws.test.ts", [175.9, 108.2, 190.2]],
    ["next/apps/fabrika/src/door.test.ts", [177.7, 117.3, 174.9]],
    ["next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts", [266.1, 169.1, 168.8]],
  ] as const) {
    expect(nextSamples[path], path).toEqual(samples);
    expect.soft(measured[path], path).toBe(row(samples));
  }
});

it("scenario: L6 the five measured heaviest next files occupy the five vitest machines with bounded loads", async () => {
  // Today's CI: the real table, the real file set and the workflow's own count of vitest machines,
  // since the law is about today's split. The names are the five heaviest by the rows of runs
  // 43544589151, 43551626086 and 43556494864. The sixth heaviest shares a machine with the fifth.
  // Keep these names independent of the table so an accidentally tiny row cannot hide the file.
  // Plants, each run once on a copy of the table filled from nextSamples, and restored: set the
  // Watchers row to 1.0, so it lands beside another of the five (red); add a leg "6" to the
  // workflow's next matrix, so the count no longer matches the five names (red).
  const heaviest = [
    "next/packages/libfabrika/src/node/Watchers.test.ts",
    "next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts",
    "next/packages/libfabrika/src/node/StartChild.test.ts",
    "next/packages/libfabrika/src/node/RunnerAdmission.test.ts",
    "next/apps/fabrika/src/start-child.laws.test.ts",
  ];
  const machines = vitestLegs(readFileSync(join(import.meta.dirname, ".github/workflows/check.yaml"), "utf8")).length;
  expect(machines).toBe(heaviest.length);
  const files = (await nextFiles(import.meta.dirname)).map((path) => ({ path, seconds: rowOf(path) }));
  const placed = assign(files, machines);
  expect(new Set(heaviest.map((path) => placed[files.findIndex((file) => file.path === path)]))).toHaveLength(machines);
  const loads = Array.from({ length: machines }, (_, machine) =>
    files.reduce((sum, file, index) => sum + (placed[index] === machine ? (file.seconds ?? noRow) : 0), 0),
  );
  const mean = loads.reduce((sum, load) => sum + load, 0) / machines;
  expect(Math.max(...loads)).toBeLessThanOrEqual(mean + Math.max(...files.map((file) => file.seconds ?? noRow)));
});

// Today's CI, next/. Each file's samples in run order A, B, C, attempt 1 of each:
//   A: run 43544589151, a push to main at 1e712b328.
//   B: run 43551626086, a merge queue group at 1d3061a5c.
//   C: run 43556494864, a push to main at 48460bdaa.
// A sample is the sum of the file's test times as the verbose reporter printed them in that
// run's job log, to one decimal. The job ids are kept because GitHub drops job logs after 90 days.
// Of the 257 files, 225 have three samples, 7 have two and 25 have one: a file a run did not
// hold has no sample from it.
// This fixed snapshot copies the observations, never the measured table's computed weights.
const nextSamples = {
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/brain-life.test.ts": [26.5, 25.5, 44.2],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/build-command.test.ts": [2.2, 1.3, 2.3],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/build.test.ts": [38.9, 41.6, 162.5],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/chaos.laws.test.ts": [69.0, 80.8, 79.9],
  // C job 132330501025.
  "next/apps/fabrika/src/checklist-instance.laws.test.ts": [98.0],
  // A job 132292933169, B job 132315559486, C job 132330500993.
  "next/apps/fabrika/src/checklist-runner.laws.test.ts": [20.7, 18.5, 22.7],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/door-recovery.test.ts": [23.2, 14.8, 20.9],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/door-spans.test.ts": [2.8, 1.6, 10.0],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/door.test.ts": [177.7, 117.3, 174.9],
  // A job 132292933326, B job 132315559534, C job 132330501014.
  "next/apps/fabrika/src/error-cause.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933221, B job 132315559497, C job 132330500983.
  "next/apps/fabrika/src/exam/agent-may.test.ts": [3.3, 2.0, 4.2],
  // A job 132292933192, B job 132315559467, C job 132330501001.
  "next/apps/fabrika/src/exam/agents.test.ts": [14.6, 5.9, 9.6],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts": [10.9, 10.9, 10.9],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/exam/bytes.test.ts": [6.0, 6.4, 7.0],
  // A job 132292933270, B job 132315559508, C job 132330501025.
  "next/apps/fabrika/src/exam/client-manager-contract.test.ts": [13.9, 10.6, 15.9],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/clock.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/exam/commits-git-chain.test.ts": [77.1, 47.4, 61.7],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/exam/commits-git-person.test.ts": [49.8, 41.9, 77.7],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/exam/commits-git-signatures.test.ts": [70.1, 43.1, 63.8],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/exam/commits-git-steps.test.ts": [73.4, 72.7, 101.1],
  // A job 132292933270, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/commits.test.ts": [1.0, 1.0, 1.4],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/compiler.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/exam/deps.test.ts": [6.5, 4.1, 4.1],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/edge-comment.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/edges.test.ts": [2.8, 2.9, 4.2],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/effect-functions.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/laws-scan.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/layers.test.ts": [3.6, 4.0, 5.7],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/ledger-sql.test.ts": [6.4, 5.6, 7.7],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/no-effect-run-outside-edge.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/no-hand-tag.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/no-of.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/no-promises.test.ts": [31.2, 31.2, 44.2],
  // A job 132292933169, B job 132315559486, C job 132330500993.
  "next/apps/fabrika/src/exam/object-imports.test.ts": [1.3, 1.5, 2.0],
  // A job 132292933270, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/one-store-hook.test.ts": [0.4, 0.3, 0.4],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/exam/react-rules.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330501014.
  "next/apps/fabrika/src/exam/runner-contract.test.ts": [61.1, 56.4, 59.7],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/exam/secret-types.test.ts": [5.1, 5.3, 5.4],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/exam/twin.test.ts": [24.0, 16.0, 20.9],
  // A job 132292933169, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/file-services.laws.test.ts": [4.0, 4.4, 19.0],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/grant-readers.laws.test.ts": [1.5, 0.8, 1.2],
  // A job 132292933221, B job 132315559497, C job 132330500983.
  "next/apps/fabrika/src/inbox-runner.laws.test.ts": [7.3, 4.2, 9.2],
  // C job 132330501001.
  "next/apps/fabrika/src/input-recording.test.ts": [39.4],
  // A job 132292933192, B job 132315559467, C job 132330501025.
  "next/apps/fabrika/src/instance-one-file.test.ts": [25.7, 20.9, 34.9],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/instance-records.test.ts": [53.7, 42.1, 63.9],
  // A job 132292933270, B job 132315559508, C job 132330500993.
  "next/apps/fabrika/src/instance-watch.laws.test.ts": [0.4, 0.4, 0.4],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/instance-wire.test.ts": [145.4, 151.9, 155.0],
  // C job 132330501014.
  "next/apps/fabrika/src/jobs-wire.test.ts": [3.7],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/apps/fabrika/src/local-instance.test.ts": [2.6, 1.3, 1.5],
  // A job 132292933169, B job 132315559486, C job 132330500983.
  "next/apps/fabrika/src/port.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330501001.
  "next/apps/fabrika/src/record.laws.test.ts": [2.9, 1.9, 2.8],
  // A job 132292933221, B job 132315559497, C job 132330501025.
  "next/apps/fabrika/src/repository-open.test.ts": [19.3, 15.0, 27.2],
  // A job 132292933169, B job 132315559508, C job 132330501001.
  "next/apps/fabrika/src/runtime-recovery.laws.test.ts": [91.5, 96.7, 137.9],
  // A job 132292933192, B job 132315559467, C job 132330500993.
  "next/apps/fabrika/src/runtime.decode.test.ts": [0.2, 0.1, 0.4],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/apps/fabrika/src/runtime.laws.test.ts": [38.2, 48.4, 87.3],
  // A job 132292933270, B job 132315559508, C job 132330501014.
  "next/apps/fabrika/src/scheduled-job-alarm.test.ts": [6.7, 6.8, 5.2],
  // A job 132292933169, B job 132315559486, C job 132330500983.
  "next/apps/fabrika/src/settings-generated.test.ts": [3.0, 2.8, 3.6],
  // A job 132292933326, B job 132315559534, C job 132330501001.
  "next/apps/fabrika/src/settings-start.test.ts": [12.6, 11.4, 23.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/apps/fabrika/src/settings.test.ts": [0.0, 0.0, 0.1],
  // A job 132292933221, B job 132315559497, C job 132330501025.
  "next/apps/fabrika/src/sibling.laws.test.ts": [11.3, 7.4, 13.0],
  // A job 132292933192, B job 132315559467, C job 132330500993.
  "next/apps/fabrika/src/start-child.laws.test.ts": [175.9, 108.2, 190.2],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/apps/fabrika/src/worker-mail.test.ts": [30.6, 20.7, 42.8],
  // A job 132292933270, B job 132315559508, C job 132330501014.
  "next/apps/fabrika/src/worker-supervision.test.ts": [22.2, 19.8, 27.1],
  // A job 132292933169, B job 132315559486, C job 132330500983.
  "next/apps/fabrika/src/worker-usage.test.ts": [1.1, 1.1, 1.8],
  // A job 132292933326, B job 132315559534, C job 132330501001.
  "next/packages/libfabrika/src/Id.cause.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/Id.test.ts": [5.2, 2.6, 2.9],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/Id.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/Testing.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/access/Access.test.ts": [2.6, 2.0, 2.0],
  // A job 132292933221, B job 132315559497, C job 132330501025.
  "next/packages/libfabrika/src/access/AccessMachine.laws.test.ts": [2.8, 1.8, 3.6],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/access/AccessSpans.test.ts": [3.4, 5.2, 3.8],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/access/Authorization.test.ts": [16.0, 16.4, 30.9],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/access/ClientManager.test.ts": [25.9, 16.8, 12.1],
  // A job 132292933192, B job 132315559467, C job 132330500993.
  "next/packages/libfabrika/src/access/ClientManager.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/access/Passkey.test.ts": [0.1, 0.0, 0.0],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/access/SessionManager.test.ts": [8.0, 9.6, 14.7],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/access/Text.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933270, B job 132315559508, C job 132330501014.
  "next/packages/libfabrika/src/ci/Ci.test.ts": [0.2, 0.2, 0.2],
  // C job 132330500983.
  "next/packages/libfabrika/src/cloudflare/SettingsInput.test.ts": [0.8],
  // C job 132330501001.
  "next/packages/libfabrika/src/cloudflare/SettingsRecorded.test.ts": [2.3],
  // C job 132330501025.
  "next/packages/libfabrika/src/cloudflare/SettingsRuntime.test.ts": [0.3],
  // C job 132330500993.
  "next/packages/libfabrika/src/cloudflare/SettingsStarts.test.ts": [27.6],
  // A job 132292933169, B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/cloudflare/Watchers.test.ts": [0.2, 0.3, 0.3],
  // A job 132292933326, B job 132315559534, C job 132330500983.
  "next/packages/libfabrika/src/cloudflare/alarm.laws.test.ts": [0.4, 0.3, 0.7],
  // A job 132292933221, B job 132315559497, C job 132330501001.
  "next/packages/libfabrika/src/cloudflare/connection.test.ts": [12.9, 7.0, 17.3],
  // A job 132292933192, B job 132315559467, C job 132330501025.
  "next/packages/libfabrika/src/cloudflare/error-cause.test.ts": [0.4, 0.2, 0.6],
  // A job 132292933192, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/cloudflare/fetch.test.ts": [0.7, 0.3, 6.9],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/cloudflare/index.test.ts": [0.2, 0.2, 0.3],
  // A job 132292933270, B job 132315559508, C job 132330500993.
  "next/packages/libfabrika/src/cloudflare/mail.test.ts": [0.6, 0.6, 0.7],
  // A job 132292933169, B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/cloudflare/p14.test.ts": [0.4, 0.3, 0.6],
  // A job 132292933326, B job 132315559534, C job 132330500983.
  "next/packages/libfabrika/src/cloudflare/platform.test.ts": [0.2, 0.2, 0.1],
  // A job 132292933221, B job 132315559497, C job 132330501001.
  "next/packages/libfabrika/src/cloudflare/reach.laws.test.ts": [0.3, 0.2, 0.3],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/cloudflare/readers.laws.test.ts": [0.5, 0.5, 101.4],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts": [5.5, 5.4, 11.2],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/cloudflare/supervision.laws.test.ts": [29.3, 14.8, 27.0],
  // A job 132292933192, B job 132315559467, C job 132330501025.
  "next/packages/libfabrika/src/cloudflare/tail.test.ts": [0.3, 0.2, 0.2],
  // A job 132292933270, B job 132315559508, C job 132330500993.
  "next/packages/libfabrika/src/codehost/CodeHost.test.ts": [0.5, 0.4, 0.6],
  // B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/desktop/BrainLife.laws.test.ts": [5.5, 6.8],
  // B job 132315559534, C job 132330500983.
  "next/packages/libfabrika/src/desktop/BrainService.types.test.ts": [0.0, 0.0],
  // B job 132315559497, C job 132330501001.
  "next/packages/libfabrika/src/desktop/BrainServiceManaged.laws.test.ts": [2.3, 4.0],
  // C job 132330501025.
  "next/packages/libfabrika/src/desktop/Menu.laws.test.ts": [1.9],
  // C job 132330500993.
  "next/packages/libfabrika/src/desktop/Menu.types.test.ts": [0.0],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/gateway/GatewayRevocation.test.ts": [10.3, 10.4, 10.2],
  // C job 132330501014.
  "next/packages/libfabrika/src/gateway/JobAccess.test.ts": [0.1],
  // A job 132292933169, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/gateway/internal/rateLimit.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933326, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/gateway/internal/waiting.test.ts": [2.4, 1.8, 2.3],
  // A job 132292933326, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/jobs/Job.test.ts": [8.4, 10.7, 9.9],
  // A job 132292933221, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/jobs/Jobs.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933192, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/jobs/internal/job.test.ts": [31.4, 27.4, 37.6],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/ledger/Ledger.test.ts": [3.2, 2.9, 4.6],
  // A job 132292933270, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/ledger/Ledger.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933326, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/ledger/LedgerCallSpans.test.ts": [0.5, 0.6, 0.6],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/ledger/LedgerSpans.test.ts": [2.4, 2.3, 1.3],
  // C job 132330500983.
  "next/packages/libfabrika/src/ledger/LedgerStreams.types.test.ts": [0.0],
  // A job 132292933270, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/ledger/LedgerTransaction.test.ts": [0.3, 0.3, 0.4],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/ledger/Log.test.ts": [1.5, 1.4, 1.8],
  // A job 132292933270, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/ledger/Rings.test.ts": [0.3, 0.1, 0.1],
  // A job 132292933221, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/ledger/TraceId.test.ts": [0.9, 0.9, 0.7],
  // A job 132292933169, B job 132315559467, C job 132330501001.
  "next/packages/libfabrika/src/node/Chaos.laws.test.ts": [0.0, 0.0, 0.1],
  // A job 132292933326, B job 132315559508, C job 132330501025.
  "next/packages/libfabrika/src/node/Children.test.ts": [81.9, 84.4, 111.2],
  // A job 132292933221, B job 132315559486, C job 132330500993.
  "next/packages/libfabrika/src/node/ErrorCause.test.ts": [3.8, 1.9, 4.1],
  // A job 132292933192, B job 132315559534, C job 132330501014.
  "next/packages/libfabrika/src/node/ErrorCause.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933270, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/node/ExitReason.test.ts": [37.4, 23.5, 41.9],
  // A job 132292933169, B job 132315559467, C job 132330501001.
  "next/packages/libfabrika/src/node/IsolateUsage.test.ts": [54.5, 84.0, 62.4],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/node/Nemesis.laws.test.ts": [7.6, 7.3, 10.9],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/node/ProgramMail.test.ts": [31.7, 34.0, 37.8],
  // A job 132292933219, B job 132315559488, C job 132330501023.
  "next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts": [266.1, 169.1, 168.8],
  // A job 132292933326, B job 132315559508, C job 132330501025.
  "next/packages/libfabrika/src/node/RecordPart.test.ts": [0.8, 1.1, 1.2],
  // A job 132292933221, B job 132315559486, C job 132330500993.
  "next/packages/libfabrika/src/node/RecordPartResources.test.ts": [1.6, 0.9, 1.0],
  // A job 132292933192, B job 132315559534, C job 132330501014.
  "next/packages/libfabrika/src/node/RecoveryJournal.test.ts": [63.8, 52.6, 42.3],
  // A job 132292933270, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/node/Replies.test.ts": [84.4, 47.5, 70.8],
  // C job 132330501001.
  "next/packages/libfabrika/src/node/RunnerAdmission.test.ts": [258.9],
  // A job 132292933169, B job 132315559467, C job 132330501025.
  "next/packages/libfabrika/src/node/StartChild.test.ts": [349.9, 341.0, 598.2],
  // A job 132292933326, B job 132315559508, C job 132330500993.
  "next/packages/libfabrika/src/node/Watchers.test.ts": [488.0, 685.9, 492.4],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/node/build/build-assets.test.ts": [37.0, 34.1, 41.9],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/node/build/build-one-file.test.ts": [41.0, 44.8, 77.0],
  // A job 132292933221, B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/node/build/css.test.ts": [11.9, 13.3, 9.8],
  // A job 132292933192, B job 132315559534, C job 132330500983.
  "next/packages/libfabrika/src/node/build/error-cause.test.ts": [0.4, 0.3, 0.3],
  // A job 132292933270, B job 132315559497, C job 132330501001.
  "next/packages/libfabrika/src/node/dev/DevLife.laws.test.ts": [0.1, 0.1, 0.2],
  // A job 132292933169, B job 132315559467, C job 132330501025.
  "next/packages/libfabrika/src/node/dev/dev-control.laws.test.ts": [8.8, 10.4, 9.3],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/node/dev/dev-errors.laws.test.ts": [2.0, 0.9, 1.0],
  // A job 132292933169, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/node/dev/dev-recording.laws.test.ts": [0.0, 0.1, 0.0],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts": [4.3, 2.4, 3.5],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/node/dev/dev.laws.test.ts": [2.0, 2.1, 2.2],
  // A job 132292933326, B job 132315559508, C job 132330500993.
  "next/packages/libfabrika/src/node/dev/error-cause.test.ts": [0.2, 0.2, 0.3],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/node/dev/local-dev.test.ts": [3.8, 2.2, 5.6],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/node/dev/supervision-spans.test.ts": [3.0, 3.2, 4.1],
  // C job 132330501014.
  "next/packages/libfabrika/src/node/gateway/Jobs.test.ts": [147.5],
  // A job 132292933221, B job 132315559486, C job 132330500983.
  "next/packages/libfabrika/src/node/gateway/RateLimit.test.ts": [5.8, 3.0, 6.2],
  // A job 132292933192, B job 132315559534, C job 132330501001.
  "next/packages/libfabrika/src/node/jobs/JobsLedger.test.ts": [39.2, 35.4, 99.9],
  // B job 132315559497, C job 132330501025.
  "next/packages/libfabrika/src/node/launchd/BrainControlLaunchd.laws.test.ts": [30.5, 35.6],
  // B job 132315559467, C job 132330500993.
  "next/packages/libfabrika/src/node/launchd/LaunchdStatus.laws.test.ts": [0.2, 0.3],
  // B job 132315559508, C job 132330501014.
  "next/packages/libfabrika/src/node/launchd/ProcessGroups.laws.test.ts": [0.0, 0.0],
  // C job 132330500983.
  "next/packages/libfabrika/src/node/ledger/LedgerStreams.test.ts": [73.3],
  // A job 132292933270, B job 132315559486, C job 132330501001.
  "next/packages/libfabrika/src/node/repositories/OpenRepository.test.ts": [106.3, 100.2, 138.1],
  // A job 132292933169, B job 132315559534, C job 132330501025.
  "next/packages/libfabrika/src/node/repositories/RepositoriesGit.test.ts": [351.1, 379.3, 412.7],
  // A job 132292933326, B job 132315559497, C job 132330500993.
  "next/packages/libfabrika/src/node/repositories/RepositoryTrust.test.ts": [15.4, 11.1, 18.6],
  // A job 132292933221, B job 132315559467, C job 132330501014.
  "next/packages/libfabrika/src/node/repositories/Sources.test.ts": [52.0, 69.3, 59.8],
  // A job 132292933192, B job 132315559508, C job 132330500983.
  "next/packages/libfabrika/src/node/runtime/RunnerInit.test.ts": [4.5, 3.4, 3.6],
  // A job 132292933270, B job 132315559486, C job 132330501001.
  "next/packages/libfabrika/src/node/settings/Command.test.ts": [0.6, 0.6, 0.8],
  // A job 132292933169, B job 132315559534, C job 132330501025.
  "next/packages/libfabrika/src/node/settings/Load.test.ts": [0.8, 1.2, 1.8],
  // A job 132292933326, B job 132315559497, C job 132330500993.
  "next/packages/libfabrika/src/packs/ProgramName.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933221, B job 132315559467, C job 132330501014.
  "next/packages/libfabrika/src/packs/internal/open.test.ts": [12.0, 6.6, 9.4],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/presence/Connections.test.ts": [0.7, 0.7, 0.7],
  // A job 132292933192, B job 132315559508, C job 132330500983.
  "next/packages/libfabrika/src/processes/ExitReason.test.ts": [0.5, 0.4, 0.3],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/processes/Mailbox.test.ts": [4.3, 2.7, 4.2],
  // A job 132292933326, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/processes/MailboxHistory.test.ts": [0.5, 0.3, 0.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts": [1.0, 1.0, 1.2],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/processes/ProcessLifecycle.test.ts": [5.7, 4.6, 5.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessManager.test.ts": [0.8, 0.7, 1.0],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessMonitors.test.ts": [8.8, 7.6, 10.8],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/processes/ProcessSpans.test.ts": [2.0, 1.3, 1.5],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/processes/ProcessStreams.test.ts": [2.9, 1.8, 2.4],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/processes/ProcessTextCaps.test.ts": [2.3, 2.4, 4.3],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/processes/ProcessWindow.test.ts": [0.6, 0.4, 0.5],
  // A job 132292933270, B job 132315559486, C job 132330501001.
  "next/packages/libfabrika/src/processes/internal/processTable.laws.test.ts": [1.9, 1.5, 2.1],
  // A job 132292933169, B job 132315559534, C job 132330501025.
  "next/packages/libfabrika/src/processes/internal/programMail.test.ts": [0.0, 0.1, 0.1],
  // A job 132292933326, B job 132315559497, C job 132330500993.
  "next/packages/libfabrika/src/repositories/Repositories.types.test.ts": [0.0, 0.0, 0.0],
  // C job 132330501014.
  "next/packages/libfabrika/src/runtime/Audit.test.ts": [1.4],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/runtime/BrainLife.laws.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933221, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/runtime/Built.test.ts": [1.4, 0.8, 1.4],
  // A job 132292933192, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/runtime/Chaos.laws.test.ts": [0.2, 0.1, 0.2],
  // C job 132330501025.
  "next/packages/libfabrika/src/runtime/Client.laws.test.ts": [0.8],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/runtime/EffectFunctions.test.ts": [14.5, 7.5, 8.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/runtime/Entry.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933270, B job 132315559486, C job 132330500993.
  "next/packages/libfabrika/src/runtime/ErrorCause.test.ts": [0.3, 0.3, 0.6],
  // A job 132292933169, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/runtime/Execution.test.ts": [0.1, 0.1, 1.3],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/runtime/Gateway.laws.test.ts": [1.1, 1.1, 1.9],
  // A job 132292933169, B job 132315559534, C job 132330501014.
  "next/packages/libfabrika/src/runtime/IsolateUsage.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/runtime/Patch.test.ts": [0.1, 0.1, 0.4],
  // A job 132292933270, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/runtime/ProcessStore.test.ts": [2.4, 1.9, 2.3],
  // A job 132292933192, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/runtime/Program.test.ts": [1.7, 1.1, 1.8],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/runtime/Program.types.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933326, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/runtime/RecoveryGaps.test.ts": [5.6, 4.9, 7.8],
  // A job 132292933270, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/runtime/RecoveryStore.test.ts": [0.3, 0.3, 0.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/runtime/Runner.test.ts": [123.8, 116.9, 151.9],
  // A job 132292933326, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/runtime/RunnerOptions.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933192, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts": [2.7, 1.3, 2.2],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/runtime/RunnerSupervision.test.ts": [77.0, 45.9, 62.5],
  // A job 132292933169, B job 132315559508, C job 132330501001.
  "next/packages/libfabrika/src/runtime/State.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933221, B job 132315559467, C job 132330501001.
  "next/packages/libfabrika/src/runtime/internal/exitReason.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/runtime/internal/recovery.test.ts": [1.1, 1.2, 1.9],
  // A job 132292933192, B job 132315559508, C job 132330501025.
  "next/packages/libfabrika/src/runtime/internal/reply.test.ts": [0.3, 0.2, 0.2],
  // A job 132292933221, B job 132315559497, C job 132330501014.
  "next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts": [1.0, 0.6, 1.2],
  // A job 132292933270, B job 132315559486, C job 132330500993.
  "next/packages/libfabrika/src/runtime/internal/watchers.test.ts": [31.1, 15.9, 39.3],
  // A job 132292933169, B job 132315559534, C job 132330501014.
  "next/packages/libfabrika/src/schedules/ScheduledJob.test.ts": [0.2, 0.3, 0.3],
  // A job 132292933326, B job 132315559497, C job 132330500983.
  "next/packages/libfabrika/src/settings/Codec.test.ts": [0.2, 0.1, 0.2],
  // B job 132315559467, C job 132330501001.
  "next/packages/libfabrika/src/settings/DesktopBrain.test.ts": [0.2, 0.3],
  // C job 132330501025.
  "next/packages/libfabrika/src/settings/DesktopLink.test.ts": [0.2],
  // A job 132292933221, B job 132315559508, C job 132330500993.
  "next/packages/libfabrika/src/settings/Files.test.ts": [0.5, 0.5, 0.5],
  // A job 132292933192, B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/settings/JsonSchema.test.ts": [0.6, 0.3, 0.4],
  // A job 132292933270, B job 132315559534, C job 132330500983.
  "next/packages/libfabrika/src/settings/Print.test.ts": [0.2, 0.2, 0.2],
  // A job 132292933169, B job 132315559497, C job 132330501001.
  "next/packages/libfabrika/src/settings/Reference.test.ts": [0.3, 0.3, 0.3],
  // A job 132292933326, B job 132315559467, C job 132330501025.
  "next/packages/libfabrika/src/settings/Setting.test.ts": [0.2, 0.1, 0.2],
  // A job 132292933221, B job 132315559508, C job 132330500993.
  "next/packages/libfabrika/src/settings/Snapshot.test.ts": [1.1, 0.8, 1.2],
  // A job 132292933192, B job 132315559486, C job 132330501014.
  "next/packages/libfabrika/src/settings/Sources.test.ts": [0.2, 0.1, 0.1],
  // C job 132330500983.
  "next/packages/libfabrika/src/settings/Start.test.ts": [0.2],
  // A job 132292933270, B job 132315559534, C job 132330501001.
  "next/packages/libfabrika/src/settings/Toml.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933169, B job 132315559497, C job 132330501025.
  "next/packages/libfabrika/src/settings/TomlEdit.test.ts": [3.2, 3.8, 9.7],
  // A job 132292933326, B job 132315559467, C job 132330500993.
  "next/packages/libfabrika/src/settings/TomlParser.test.ts": [0.2, 0.1, 0.3],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/telemetry/ArchiveCryptoFailure.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933221, B job 132315559508, C job 132330501014.
  "next/packages/libfabrika/src/telemetry/ErrorCause.test.ts": [0.2, 0.2, 0.2],
  // A job 132292933221, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts": [0.2, 0.2, 0.1],
  // A job 132292933270, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/telemetry/Records.test.ts": [5.2, 3.2, 6.1],
  // A job 132292933192, B job 132315559486, C job 132330500983.
  "next/packages/libfabrika/src/telemetry/Sink.test.ts": [10.7, 13.1, 19.1],
  // A job 132292933270, B job 132315559534, C job 132330501001.
  "next/packages/libfabrika/src/telemetry/Trace.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933169, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/telemetry/internal/measurements.test.ts": [10.5, 10.7, 6.3],
  // A job 132292933169, B job 132315559497, C job 132330501025.
  "next/packages/libfabrika/src/telemetry/internal/sink.test.ts": [0.4, 0.3, 0.5],
  // A job 132292933326, B job 132315559467, C job 132330500993.
  "next/packages/libfabrika/src/telemetry/internal/sums.test.ts": [1.4, 1.0, 1.8],
  // A job 132292933192, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/transport/Answer.test.ts": [0.2, 0.2, 0.2],
  // A job 132292933221, B job 132315559508, C job 132330501014.
  "next/packages/libfabrika/src/transport/Connection.test.ts": [1.9, 1.7, 1.9],
  // A job 132292933192, B job 132315559486, C job 132330500983.
  "next/packages/libfabrika/src/transport/ErrorCause.test.ts": [0.3, 0.2, 0.2],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/transport/Hello.test.ts": [0.4, 0.4, 0.9],
  // C job 132330501001.
  "next/packages/libfabrika/src/transport/Link.laws.test.ts": [0.2],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/packages/libfabrika/src/transport/Sshsig.test.ts": [1.0, 0.5, 0.6],
  // A job 132292933221, B job 132315559486, C job 132330501025.
  "next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts": [0.6, 0.3, 0.6],
  // A job 132292933326, B job 132315559534, C job 132330500993.
  "next/packages/libfabrika/src/transport/internal/binaryCryptoFailure.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933270, B job 132315559534, C job 132330501025.
  "next/packages/libfabrika/src/transport/internal/connection.test.ts": [1.8, 1.8, 2.8],
  // C job 132330500993.
  "next/packages/tuval/src/window/machine.model.laws.test.ts": [18.7],
  // C job 132330501014.
  "next/packages/tuval/src/window/main.laws.test.ts": [11.5],
  // A job 132292933169, B job 132315559497, C job 132330500983.
  "next/programs/chaos/src/program.laws.test.ts": [1.3, 1.5, 1.6],
  // C job 132330501001.
  "next/programs/checklist/src/client.laws.test.ts": [0.1],
  // A job 132292933326, B job 132315559467, C job 132330501025.
  "next/programs/checklist/src/program.laws.test.ts": [0.2, 0.2, 0.2],
  // C job 132330500993.
  "next/programs/checklist/src/tile.laws.test.ts": [0.2],
  // C job 132330501014.
  "next/programs/checklist/src/window.laws.test.ts": [0.7],
  // C job 132330500983.
  "next/programs/checklist/src/window.types.test.ts": [0.0],
  // A job 132292933192, B job 132315559467, C job 132330500983.
  "next/programs/counter/src/program.laws.test.ts": [0.3, 0.3, 0.2],
  // A job 132292933221, B job 132315559508, C job 132330501001.
  "next/programs/counter/src/runner.laws.test.ts": [6.8, 5.1, 4.8],
  // A job 132292933221, B job 132315559508, C job 132330501001.
  "next/programs/counter/src/window.types.test.ts": [0.0, 0.0, 0.0],
  // A job 132292933192, B job 132315559486, C job 132330501025.
  "next/programs/inbox/src/program.laws.test.ts": [0.2, 0.1, 0.2],
  // A job 132292933270, B job 132315559534, C job 132330500993.
  "next/programs/pipeline/src/Change.test.ts": [0.7, 0.5, 0.9],
  // A job 132292933169, B job 132315559497, C job 132330501014.
  "next/programs/pipeline/src/Merger.laws.test.ts": [1.6, 1.7, 2.9],
  // A job 132292933326, B job 132315559467, C job 132330500983.
  "next/programs/pipeline/src/Queue.laws.test.ts": [8.4, 6.2, 8.5],
  // A job 132292933221, B job 132315559508, C job 132330501001.
  "next/programs/pipeline/src/Settings.test.ts": [0.3, 0.3, 0.4],
  // A job 132292933192, B job 132315559486, C job 132330501025.
  "next/programs/pipeline/src/handlers.test.ts": [0.1, 0.1, 0.1],
  // A job 132292933270, B job 132315559534, C job 132330500993.
  "next/programs/pipeline/src/node/queue.laws.test.ts": [148.4, 125.7, 119.0],
  // A job 132292933169, B job 132315559497, C job 132330501014.
  "next/programs/pipeline/src/node/runner.laws.test.ts": [22.7, 21.8, 10.8],
} as const;

it("vector: L5 all 257 next rows are the median of three samples, or the larger of one or two", () => {
  // The medians of runs 43544589151, 43551626086 and 43556494864, from the samples above.
  // Preserve exact file-set coverage as well as the weights, including measured zeroes: a row
  // with no samples here, or samples with no row, fails too.
  const expected = Object.fromEntries(Object.entries(nextSamples).map(([path, samples]) => [path, row(samples)]));
  expect(Object.fromEntries(Object.entries(measured).filter(([path]) => path.startsWith("next/")))).toEqual(expected);
});

// T342, today's sharding. Covers assign and the measured table. Plants: drop a file,
// restore equal-count assignment, or discard measured script times.
// T342: all three plants failed their laws. Equal-count placement initially survived
// the final load bound; checking the least measured load at each placement caught it.
it("L8: generated sharding assigns once to the least load including starts, independent of input order", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.record({ path: fc.string({ minLength: 1 }), seconds: fc.integer({ min: 0, max: 500 }) }), {
        selector: (f) => f.path,
        minLength: 1,
        maxLength: 40,
      }),
      fc.integer({ min: 1, max: 12 }),
      fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 12 }),
      (files, count, start) => {
        const machines = assign(files, count, start);
        expect(machines).toHaveLength(files.length);
        const running = Array.from({ length: count }, (_, i) => start[i] ?? 0);

        for (const { file, index } of files
          .map((file, index) => ({ file, index }))
          .toSorted(
            (a, b) =>
              b.file.seconds - a.file.seconds || (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0),
          )) {
          const machine = machines[index]!;
          expect(running[machine]).toBe(Math.min(...running));
          expect(machine).toBe(running.indexOf(Math.min(...running)));
          running[machine] = running[machine]! + file.seconds;
        }

        expect(machines.every((m) => m >= 0 && m < count && Number.isInteger(m))).toBe(true);
        const first = Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));
        const reversed = files.toReversed();
        expect(Object.fromEntries(reversed.map((f, i) => [f.path, assign(reversed, count, start)[i]]))).toEqual(first);
        expect(assign(files, count, [])).toEqual(assign(files, count));
        const empty = assign(files, count);
        const legacy = Array.from({ length: count }, () => 0);

        for (const file of files.toSorted(
          (a, b) => b.seconds - a.seconds || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
        )) {
          const least = legacy.indexOf(Math.min(...legacy));
          expect(empty[files.indexOf(file)]).toBe(least);
          legacy[least] = legacy[least]! + file.seconds;
        }

        const load = Array.from({ length: count }, (_, m) =>
          files.reduce((sum, f, i) => sum + (empty[i] === m ? f.seconds : 0), 0),
        );
        expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(Math.max(...files.map((f) => f.seconds)));
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: real CI medians include the previously unweighted scripts", () => {
  // Fixed medians from runs 42579837468, 42573088027 and 42571265116, rounded to one decimal.
  // T554 refresh: plancheck.test.ts is the median of runs 42803733957, 42807559589 and 42801440878.
  expect(measured[".agents/skills/plan/scripts/plancheck.test.ts"]).toBe(106.2);
  expect(measured["apps/fabrika/src/bundles.test.ts"]).toBe(3.7);
  expect(measured["packages/pipeline/src/laws/standard.test.ts"]).toBe(3.5);
});

it("vector: the four build files carry their refreshed main-run times", () => {
  // T502, next/ (A9, A10), refreshed by T890. Samples and jobs are recorded in nextSamples.
  // Attempt 1 of runs 43544589151, 43551626086 and 43556494864; each row is the median of its three.
  // Plant: drop these rows, so all four count the median row and the heavy build files can stack on one machine.
  for (const path of [
    "next/apps/fabrika/src/build.test.ts",
    "next/apps/fabrika/src/exam/bytes.test.ts",
    "next/packages/libfabrika/src/node/build/build-assets.test.ts",
    "next/packages/libfabrika/src/node/build/build-one-file.test.ts",
  ] as const) {
    expect.soft(measured[path], path).toBe(row(nextSamples[path]));
  }
});

it("vector: lead test medians match the three green main CI runs", () => {
  // T375 Amendment 1: fixed CI medians from 42631962689, 42631256491 and 42630840277.
  // Plant: discard these rows, leaving the scripts to count as 1 s.
  for (const [path, seconds] of [
    // T554 refresh: median of 10 runs, PR 757's check run 42874119130, attempts 5 to 14.
    [".agents/skills/lead/scripts/box.test.ts", 348.7],
    [".agents/skills/step-commit/scripts/stepcommit.test.ts", 18.2],
    [".agents/skills/lead/scripts/redact.test.ts", 7.2],
    [".agents/skills/lead/scripts/gc.test.ts", 0.1],
  ] as const) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});

// How the check's test machines split the test files: each gets about the same seconds, not the
// same count of files.

/** Twelve lane files of about two minutes each, and 300 files of a second. Made up. */
const HEAVY = Array.from({ length: 12 }, (_, i) => ({ path: `lane.${i}.test.ts`, seconds: 115 + i }));
const LIGHT = Array.from({ length: 300 }, (_, i) => ({ path: `small.${i}.test.ts`, seconds: 1 }));

const ROOT = dirname(fileURLToPath(import.meta.url));
const LANES = "packages/pipeline/src/stages/pipeline";

/** How many files each of `count` machines got. */
const perMachine = (machines: readonly number[], count: number) =>
  Array.from({ length: count }, (_, m) => machines.filter((at) => at === m).length);

/** Each path's machine. */
const byPath = (files: readonly { path: string }[], machines: readonly number[]) =>
  Object.fromEntries(files.map((f, i) => [f.path, machines[i]]));

describe("assign", () => {
  it("puts two of twelve heavy files on each of six machines, among 300 light ones", () => {
    const machines = assign([...HEAVY, ...LIGHT], 6);
    expect(machines).toHaveLength(312);
    expect(perMachine(machines.slice(0, 12), 6)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(machines.every((m) => m >= 0 && m < 6)).toBe(true);
  });

  it("gives each machine at most one file when there are fewer files than machines", () => {
    const machines = assign(HEAVY.slice(0, 3), 6);
    expect(machines).toHaveLength(3);
    expect(Math.max(...perMachine(machines, 6))).toBe(1);
  });

  it("gives each path the same machine, in whatever order the files come", () => {
    const files = [...HEAVY, ...LIGHT];
    const first = byPath(files, assign(files, 6));
    const reversed = files.toReversed();
    const interleaved = [...files.filter((_, i) => i % 2 === 1), ...files.filter((_, i) => i % 2 === 0)];
    expect(byPath(reversed, assign(reversed, 6))).toEqual(first);
    expect(byPath(interleaved, assign(interleaved, 6))).toEqual(first);
  });

  it("places the heaviest file first, and two as heavy by their paths", () => {
    // Each goes to the machine with the least so far; of empty machines, the first.
    const files = [
      { path: "b.test.ts", seconds: 10 },
      { path: "a.test.ts", seconds: 10 },
      { path: "c.test.ts", seconds: 30 },
    ];
    expect(assign(files, 3)).toEqual([2, 1, 0]);
  });

  it("gives files of equal seconds their machines by path alone, whatever their order", () => {
    const files = ["d", "b", "e", "a", "c"].map((name) => ({ path: `${name}.test.ts`, seconds: 5 }));
    const want = { "a.test.ts": 0, "b.test.ts": 1, "c.test.ts": 2, "d.test.ts": 3, "e.test.ts": 4 };
    expect(byPath(files, assign(files, 5))).toEqual(want);
    const sorted = files.toSorted((x, y) => (x.path < y.path ? -1 : 1));
    expect(byPath(sorted, assign(sorted, 5))).toEqual(want);
    expect(byPath(sorted.toReversed(), assign(sorted.toReversed(), 5))).toEqual(want);
  });
});

// T890, today's CI. A file with no row is placed, not refused: after every measured file, in
// path order, on the machine with the least seconds so far (ties: the first), counting the median
// row, so several new files spread over the machines.
// Plants, each run once on vitest.shards.ts and restored: a file with no row adds 0 s (red: the new
// files pile onto one machine); place files with no row first (red in L14); give Shards
// `measured[path] ?? 0` (red in the Shards scenario); take the upper middle, or 0 s of nothing
// (red in L16); count the table's median in place of `unmeasured` (red in L14).

// Files with and without a row. fast-check supplies them; no domain schema describes test paths.
const rowFiles = fc.uniqueArray(
  fc.record({
    path: fc.string({ minLength: 1 }),
    seconds: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  }),
  { selector: (f) => f.path, minLength: 1, maxLength: 40 },
);

/** Two tied measured files, a 0 s row and two files with no row. Made up. */
const tied = [
  { path: "new2.test.ts", seconds: undefined },
  { path: "new.test.ts", seconds: undefined },
  { path: "zero.test.ts", seconds: 0 },
  { path: "b.test.ts", seconds: 5 },
  { path: "a.test.ts", seconds: 5 },
];

describe("median", () => {
  it("L16: the median is an input of middle rank, the lower middle of an even count, 1 s of nothing, in any order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 0, max: 6000 }).map((tenths) => tenths / 10),
          { maxLength: 50 },
        ),
        fc.array(fc.nat(), { maxLength: 50 }),
        (seconds, order) => {
          const middle = median(seconds);

          if (seconds.length === 0) {
            expect(middle).toBe(1);
            return;
          }

          const rank = Math.floor((seconds.length - 1) / 2);
          expect(seconds).toContain(middle);
          expect(seconds.filter((value) => value < middle).length).toBeLessThanOrEqual(rank);
          expect(seconds.filter((value) => value <= middle).length).toBeGreaterThanOrEqual(rank + 1);
          const shuffled = seconds
            .map((value, i) => ({ value, key: order[i] ?? 0 }))
            .toSorted((x, y) => x.key - y.key)
            .map(({ value }) => value);
          expect(median(shuffled)).toBe(middle);
        },
      ),
      {
        seed: 119120,
        numRuns: 100,
        examples: [
          [[], []],
          [
            [4, 1, 3, 2],
            [3, 0, 2, 1],
          ],
        ],
      },
    );
  });

  it("L17: a file with no row counts the median of every row by default", () => {
    fc.assert(
      fc.property(rowFiles, fc.integer({ min: 1, max: 12 }), (files, count) => {
        expect(assign(files, count)).toEqual(assign(files, count, [], median(Object.values(measured))));
      }),
      { seed: 119120, numRuns: 100 },
    );
  });
});

describe("assign, for a file with no row", () => {
  it("L14: files with no row move no measured file, and each goes to the least load counting the median", () => {
    fc.assert(
      fc.property(
        rowFiles,
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.integer({ min: 0, max: 2000 }), { maxLength: 12 }),
        fc.integer({ min: 0, max: 50 }),
        (files, count, start, unmeasured) => {
          const machines = assign(files, count, start, unmeasured);
          const known = files.filter((file) => file.seconds !== undefined);
          const alone = assign(known, count, start, unmeasured);
          expect(known.map((file) => machines[files.indexOf(file)])).toEqual(alone);
          const load = Array.from({ length: count }, (_, m) =>
            known.reduce((sum, file, i) => sum + (alone[i] === m ? file.seconds! : 0), start[m] ?? 0),
          );

          for (const file of files
            .filter((file) => file.seconds === undefined)
            .toSorted((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))) {
            const least = load.indexOf(Math.min(...load));
            expect(machines[files.indexOf(file)]).toBe(least);
            load[least] = load[least]! + unmeasured;
          }
        },
      ),
      {
        seed: 119120,
        numRuns: 100,
        examples: [
          // Made up, median 2. a 10 -> 0, b 6 -> 1, c 5 -> 2 (10, 6, 5); m.new -> 2 (7); z.new -> 1.
          [
            [
              { path: "z.new.test.ts", seconds: undefined },
              { path: "a.test.ts", seconds: 10 },
              { path: "m.new.test.ts", seconds: undefined },
              { path: "c.test.ts", seconds: 5 },
              { path: "b.test.ts", seconds: 6 },
            ],
            3,
            [],
            2,
          ],
          // Made up, median 3: a tie goes to the first machine, a 0 s row is measured, new files
          // spread. a 5 -> 0, b 5 -> 1, zero -> 0; new -> 0 (8); new2 -> 1 (8).
          [tied, 2, [], 3],
          // The same with machine 0 starting at 8: a and b -> 1, zero -> 0, new -> 0, new2 -> 1.
          [tied, 2, [8], 3],
        ],
      },
    );
  });

  it("L15: new files with no row spread evenly over machines that start level", () => {
    // Nine new files, as one pull request can add, never pile onto one machine.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.double({ min: 0.1, max: 600, noNaN: true }),
        (files, count, level, unmeasured) => {
          const fresh = Array.from({ length: files }, (_, i) => ({ path: `next/new.${i}.test.ts` }));
          const per = perMachine(
            assign(
              fresh,
              count,
              Array.from({ length: count }, () => level),
              unmeasured,
            ),
            count,
          );
          expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
        },
      ),
      { seed: 119120, numRuns: 100 },
    );
  });

  it("scenario: Shards spreads two new next/ files with no row over two machines", async () => {
    // Today's CI. clock and compiler have rows of 0.0 s, so both stay on shard 1/2 with the
    // machines tied at 0. The first new file counts the median and goes to shard 1/2, which leaves
    // shard 2/2 the least for the second.
    const paths = [
      "next/apps/fabrika/src/exam/clock.test.ts",
      "next/apps/fabrika/src/exam/compiler.test.ts",
      "next/apps/toy/src/a.new.test.ts",
      "next/apps/toy/src/b.new.test.ts",
    ];
    expect(paths.map(rowOf)).toEqual([0, 0, undefined, undefined]);
    expect(noRow).toBeGreaterThan(0);
    const kept: string[][] = [];

    for (const index of [1, 2]) {
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/2` });

      try {
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(paths.map((path) => ({ moduleId: join(ROOT, path) })) as never);
        kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)));
      } finally {
        await vitest.close();
      }
    }

    expect(kept).toEqual([paths.slice(0, 3), [paths[3]]]);
  });
});

describe("measured", () => {
  it("names only files that are in the repo, so a renamed file cannot quietly keep a row", () => {
    const keys = Object.keys(measured);
    expect(keys.length).toBeGreaterThan(0);
    const isFile = (path: string) => statSync(join(ROOT, path), { throwIfNoEntry: false })?.isFile() === true;
    expect(keys.filter((path) => !isFile(path))).toEqual([]);
  });
});

describe("Shards", () => {
  it("is vitest's own sequencer with only its sharding changed: vitest's sort is kept", () => {
    expect(Object.getPrototypeOf(Shards.prototype)).toBe(BaseSequencer.prototype);
    expect(Object.hasOwn(Shards.prototype, "shard")).toBe(true);
    expect(Shards.prototype.sort).toBe(BaseSequencer.prototype.sort);
  });

  it("scenario: L13 lane-only shards cover every lane once and balance on top of the rest", async () => {
    // The real repo config selects lanes before sharding. Plant: start lanes from zero.
    const lanes = readdirSync(join(ROOT, LANES))
      .filter((name) => /^lane\..*\.test\.ts$/.test(name))
      .map((name) => `${LANES}/${name}`);
    const kept: string[][] = [];

    for (const index of [1, 2, 3, 4, 5, 6]) {
      // This repo's config, as `vitest run --shard k/6` reads it; nothing runs.
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/6` });

      try {
        const specs = (await vitest.globTestSpecifications()).filter((spec) =>
          inLaneStep(relative(ROOT, spec.moduleId)),
        );
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(specs);
        kept.push(mine.map((spec) => relative(ROOT, spec.moduleId)));
      } finally {
        await vitest.close();
      }
    }

    expect(
      kept
        .flat()
        .filter((p) => lanes.includes(p))
        .toSorted(),
    ).toEqual(lanes.toSorted());
    const rest = Object.entries(measured)
      .filter(([path]) => !path.startsWith("next/") && !inLaneStep(path))
      .map(([path, seconds]) => ({ path, seconds }));
    const placed = assign(rest, 6);
    const loads = Array.from({ length: 6 }, (_, i) =>
      wall(rest.filter((_, j) => placed[j] === i).map((file) => file.seconds)),
    );
    expect(restLoads(6)).toEqual(loads);
    const seconds = kept.map((paths, i) => paths.reduce((sum, p) => sum + (rowOf(p) ?? noRow), loads[i]!));
    const heaviestLane = Math.max(...lanes.map((path) => rowOf(path) ?? noRow));
    const biggest = Math.max(
      ...Object.entries(measured)
        .filter(([path]) => !path.startsWith("next/"))
        .map(([, seconds]) => seconds),
    );
    expect(Math.max(...seconds)).toBeLessThanOrEqual(Math.max(Math.min(...seconds) + heaviestLane, biggest));
  });

  it("scenario: a list holding a lane file and another file is split as `assign` does, from zeros", async () => {
    // Only a list of lane files only starts from `restLoads`: the rest step shares those machines.
    // Plant: start from `restLoads` when any file is a lane file.
    const lanes = readdirSync(join(ROOT, LANES))
      .filter((name) => /^lane\..*\.test\.ts$/.test(name))
      .map((name) => `${LANES}/${name}`);
    const others = Object.keys(measured).filter((path) => !path.startsWith("next/") && !inLaneStep(path));
    const paths = [...lanes, ...others];
    const files = paths.map((path) => ({ path, seconds: rowOf(path) }));
    const placed = assign(files, 6);

    for (const index of [1, 2, 3, 4, 5, 6]) {
      const vitest = await createVitest("test", { root: ROOT, watch: false, shard: `${index}/6` });

      try {
        const Sequencer = vitest.config.sequence.sequencer;
        const mine = await new Sequencer(vitest).shard(paths.map((path) => ({ moduleId: join(ROOT, path) })) as never);
        expect(mine.map((spec) => relative(ROOT, spec.moduleId))).toEqual(
          paths.filter((_, i) => placed[i] === index - 1),
        );
      } finally {
        await vitest.close();
      }
    }
  });
});

it("L9: wall equals the largest file or the shared worker load", () => {
  // Plant: return the plain sum, ignoring parallel workers.
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 10000 })), (seconds) => {
      const biggest = Math.max(0, ...seconds);
      const shared = seconds.reduce((sum, seconds) => sum + seconds, 0) / WORKERS;
      const actual = wall(seconds);
      expect(actual).toBeGreaterThanOrEqual(biggest);
      expect(actual).toBeGreaterThanOrEqual(shared);
      expect([biggest, shared]).toContain(actual);
    }),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: L12 stale non-lane rows hold the three T554 run medians", () => {
  // Runs 42803733957, 42807559589, 42801440878. Gap >20 s; a file with no row counts the median row.
  // The last four rows (box, boxrm, loosening, program-package-layout) come from PR 757's
  // check run 42874119130, attempts 5 to 14, a median of 10.
  // Plant: restore plancheck's older median. Lane rows await the PR's own run.
  // catchup.test.ts had a row here until catchup.sh was retired for GitHub's merge queue (0162).
  const expected = {
    ".agents/skills/lead/scripts/box.test.ts": 348.7,
    ".agents/skills/lead/scripts/boxrm.test.ts": 295.0,
    ".agents/skills/lead/scripts/loosening.test.ts": 234.6,
    "oxlint-plugins/program-package-layout.test.ts": 80.3,
    "packages/fabrika/src/host/fence.laws.test.ts": 117.1,
    "scripts/caps.test.ts": 108.5,
    ".agents/skills/plan/scripts/plancheck.test.ts": 106.2,
    "oxlint-plugins/plants.test.ts": 48.2,
    "oxlint-plugins/padding-line-between-statements.test.ts": 44.7,
    ".agents/skills/lead/scripts/leakgrep.test.ts": 34.2,
    ".agents/skills/lead/scripts/mutbox.test.ts": 34.0,
    ".agents/skills/lead/scripts/skillscheck.test.ts": 25.9,
  };

  for (const [path, seconds] of Object.entries(expected)) {
    expect.soft(measured[path], path).toBe(seconds);
  }
});
