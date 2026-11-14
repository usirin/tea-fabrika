import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BaseSequencer, createVitest } from "vitest/node";
import { inLaneStep } from "./.github/ci/workflow-lint.ts";
import { assign, measured, Shards, wall, WORKERS, restLoads } from "./vitest.shards.ts";

it("vector: next medians and four provisional split estimates match the recorded main runs", () => {
  // Today's CI, both versions. Main runs 42717511599, 42716453289 and 42715921306.
  // The four split files are estimates: original commits-git median 247.6 / 4 = 61.9 s.
  // T871 adds medians from runs 43239450301, 43235822398 and 43234969237, attempt 1.
  // Split weights use ready run 43255323922: store 18.5 s, job 131312463038, shard 1;
  // runtime 290.9 s, job 131312462890, shard 4.
  const expected = {
    "next/apps/fabrika/src/brain-life.test.ts": 27.4,
    "next/apps/fabrika/src/build.test.ts": 39.9,
    "next/apps/fabrika/src/door-recovery.test.ts": 52.6,
    "next/apps/fabrika/src/door-spans.test.ts": 2.8,
    "next/apps/fabrika/src/door.test.ts": 17.2,
    "next/apps/fabrika/src/exam/alchemy-lifecycle.test.ts": 11.0,
    "next/apps/fabrika/src/exam/bytes.test.ts": 4.9,
    "next/apps/fabrika/src/exam/clock.test.ts": 0.0,
    "next/apps/fabrika/src/exam/commits-git-chain.test.ts": 61.9,
    "next/apps/fabrika/src/exam/commits-git-person.test.ts": 61.9,
    "next/apps/fabrika/src/exam/commits-git-signatures.test.ts": 61.9,
    "next/apps/fabrika/src/exam/commits-git-steps.test.ts": 61.9,
    "next/apps/fabrika/src/exam/commits.test.ts": 0.6,
    "next/apps/fabrika/src/exam/compiler.test.ts": 0.0,
    "next/apps/fabrika/src/exam/deps.test.ts": 1.1,
    "next/apps/fabrika/src/exam/edge-comment.test.ts": 0.0,
    "next/apps/fabrika/src/exam/edges.test.ts": 3.7,
    "next/apps/fabrika/src/exam/effect-functions.test.ts": 0.0,
    "next/apps/fabrika/src/exam/laws-scan.test.ts": 0.0,
    "next/apps/fabrika/src/exam/layers.test.ts": 0.0,
    "next/apps/fabrika/src/exam/ledger-sql.test.ts": 4.5,
    "next/apps/fabrika/src/exam/no-effect-run-outside-edge.test.ts": 0.0,
    "next/apps/fabrika/src/exam/no-hand-tag.test.ts": 0.0,
    "next/apps/fabrika/src/exam/no-of.test.ts": 0.0,
    "next/apps/fabrika/src/exam/no-promises.test.ts": 34.1,
    "next/apps/fabrika/src/exam/one-store-hook.test.ts": 0.3,
    "next/apps/fabrika/src/exam/react-rules.test.ts": 0.0,
    "next/apps/fabrika/src/exam/secret-types.test.ts": 4.6,
    "next/apps/fabrika/src/exam/twin.test.ts": 20.0,
    "next/apps/fabrika/src/file-services.laws.test.ts": 0.5,
    "next/apps/fabrika/src/grant-readers.laws.test.ts": 1.8,
    "next/apps/fabrika/src/local-instance.test.ts": 1.6,
    "next/apps/fabrika/src/runtime-recovery.laws.test.ts": 0.4,
    "next/apps/fabrika/src/runtime.laws.test.ts": 30.1,
    "next/apps/fabrika/src/settings.test.ts": 0.0,
    "next/apps/fabrika/src/instance-records.test.ts": 32.8,
    "next/apps/fabrika/src/instance-wire.test.ts": 68.6,
    "next/apps/fabrika/src/worker-mail.test.ts": 19.6,
    "next/packages/libfabrika/src/Id.test.ts": 3.8,
    "next/packages/libfabrika/src/Id.types.test.ts": 0.0,
    "next/packages/libfabrika/src/Testing.test.ts": 0.0,
    "next/packages/libfabrika/src/access/Access.test.ts": 1.4,
    "next/packages/libfabrika/src/access/AccessSpans.test.ts": 4.9,
    "next/packages/libfabrika/src/access/Authorization.test.ts": 16.4,
    "next/packages/libfabrika/src/access/ClientManager.test.ts": 13.0,
    "next/packages/libfabrika/src/access/Passkey.test.ts": 0.1,
    "next/packages/libfabrika/src/access/Text.test.ts": 0.0,
    "next/packages/libfabrika/src/cloudflare/fetch.test.ts": 0.4,
    "next/packages/libfabrika/src/cloudflare/index.test.ts": 0.0,
    "next/packages/libfabrika/src/cloudflare/readers.laws.test.ts": 0.6,
    "next/packages/libfabrika/src/cloudflare/runner-reply.laws.test.ts": 3.6,
    "next/packages/libfabrika/src/cloudflare/supervision.laws.test.ts": 11.5,
    "next/packages/libfabrika/src/gateway/GatewayRevocation.test.ts": 19.6,
    "next/packages/libfabrika/src/gateway/internal/waiting.test.ts": 0.1,
    "next/packages/libfabrika/src/ledger/Ledger.test.ts": 2.2,
    "next/packages/libfabrika/src/ledger/LedgerCallSpans.test.ts": 0.6,
    "next/packages/libfabrika/src/ledger/LedgerSpans.test.ts": 1.1,
    "next/packages/libfabrika/src/ledger/LedgerTransaction.test.ts": 0.1,
    "next/packages/libfabrika/src/ledger/Log.test.ts": 1.9,
    "next/packages/libfabrika/src/ledger/Rings.test.ts": 0.2,
    "next/packages/libfabrika/src/ledger/TraceId.test.ts": 0.8,
    "next/packages/libfabrika/src/node/build/build-assets.test.ts": 48.6,
    "next/packages/libfabrika/src/node/build/build-one-file.test.ts": 11.0,
    "next/packages/libfabrika/src/node/access/SessionManager.test.ts": 8.8,
    "next/packages/libfabrika/src/node/ProgramMail.test.ts": 18.5,
    "next/packages/libfabrika/src/node/ProgramMailRuntime.test.ts": 290.9,
    "next/packages/libfabrika/src/node/Nemesis.laws.test.ts": 79.2,
    "next/packages/libfabrika/src/node/dev/dev-errors.laws.test.ts": 2.1,
    "next/packages/libfabrika/src/node/dev/dev-recording.laws.test.ts": 0.1,
    "next/packages/libfabrika/src/node/dev/dev-secrets.laws.test.ts": 4.2,
    "next/packages/libfabrika/src/node/dev/dev.laws.test.ts": 2.3,
    "next/packages/libfabrika/src/node/dev/local-dev.test.ts": 2.5,
    "next/packages/libfabrika/src/node/dev/supervision-spans.test.ts": 11.3,
    "next/packages/libfabrika/src/presence/Connections.test.ts": 2.5,
    "next/packages/libfabrika/src/processes/Mailbox.test.ts": 36.1,
    "next/packages/libfabrika/src/processes/MailboxHistory.test.ts": 0.4,
    "next/packages/libfabrika/src/processes/ProcessIdGenerator.test.ts": 1.3,
    "next/packages/libfabrika/src/processes/ProcessLifecycle.test.ts": 14.8,
    "next/packages/libfabrika/src/processes/ProcessManager.test.ts": 2.5,
    "next/packages/libfabrika/src/processes/ProcessMonitors.test.ts": 20.2,
    "next/packages/libfabrika/src/processes/ProcessSpans.test.ts": 6.0,
    "next/packages/libfabrika/src/processes/ProcessStreams.test.ts": 8.5,
    "next/packages/libfabrika/src/processes/ProcessTextCaps.test.ts": 14.1,
    "next/packages/libfabrika/src/processes/ProcessWindow.test.ts": 1.2,
    "next/packages/libfabrika/src/runtime/BrainLife.laws.test.ts": 0.1,
    "next/packages/libfabrika/src/runtime/EffectFunctions.test.ts": 4.2,
    "next/packages/libfabrika/src/runtime/Entry.test.ts": 0.0,
    "next/packages/libfabrika/src/runtime/Execution.test.ts": 0.2,
    "next/packages/libfabrika/src/runtime/Gateway.laws.test.ts": 1.3,
    "next/packages/libfabrika/src/runtime/Patch.test.ts": 0.1,
    "next/packages/libfabrika/src/runtime/ProcessStore.test.ts": 2.0,
    "next/packages/libfabrika/src/runtime/Program.test.ts": 0.5,
    "next/packages/libfabrika/src/runtime/Program.types.test.ts": 0.1,
    "next/packages/libfabrika/src/runtime/RecoveryGaps.test.ts": 0.9,
    "next/packages/libfabrika/src/runtime/RecoveryStore.test.ts": 0.1,
    "next/packages/libfabrika/src/runtime/Runner.test.ts": 41.2,
    "next/packages/libfabrika/src/runtime/RunnerRecovery.laws.test.ts": 0.7,
    "next/packages/libfabrika/src/runtime/RunnerSupervision.test.ts": 67.5,
    "next/packages/libfabrika/src/runtime/State.test.ts": 0.1,
    "next/packages/libfabrika/src/runtime/internal/recovery.test.ts": 1.9,
    "next/packages/libfabrika/src/runtime/internal/supervisor.laws.test.ts": 0.1,
    "next/packages/libfabrika/src/telemetry/ArchiveCryptoFailure.test.ts": 0.0,
    "next/packages/libfabrika/src/telemetry/P12Readers.laws.test.ts": 0.2,
    "next/packages/libfabrika/src/telemetry/Records.test.ts": 0.6,
    "next/packages/libfabrika/src/telemetry/Sink.test.ts": 1.0,
    "next/packages/libfabrika/src/telemetry/internal/measurements.test.ts": 4.4,
    "next/packages/libfabrika/src/transport/Answer.test.ts": 0.2,
    "next/packages/libfabrika/src/transport/Hello.test.ts": 1.1,
    "next/packages/libfabrika/src/transport/Sshsig.test.ts": 1.1,
    "next/packages/libfabrika/src/transport/SshsigWebauthn.test.ts": 0.5,
    "next/packages/libfabrika/src/transport/internal/binaryCryptoFailure.test.ts": 0.0,
    "next/programs/counter/src/program.laws.test.ts": 0.1,
    "next/programs/counter/src/runner.laws.test.ts": 0.3,
  };
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

it("vector: the four build files carry their times from CI run 42922102030", () => {
  // T502, next/ (A9, A10): one time each from run 42922102030, on 2909594e, rounded to one decimal.
  // Plant: drop these rows, so all four count 1 s and the heavy build files can stack on one machine.
  for (const [path, seconds] of [
    ["next/apps/fabrika/src/build.test.ts", 39.9],
    ["next/apps/fabrika/src/exam/bytes.test.ts", 4.9],
    ["next/packages/libfabrika/src/node/build/build-assets.test.ts", 48.6],
    ["next/packages/libfabrika/src/node/build/build-one-file.test.ts", 11.0],
  ] as const) {
    expect.soft(measured[path], path).toBe(seconds);
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

describe("measured", () => {
  it("names only files that are in the repo, so a renamed file cannot quietly count 1", () => {
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
    const seconds = kept.map((paths, i) => paths.reduce((sum, p) => sum + (measured[p] ?? 1), loads[i]!));
    const heaviestLane = Math.max(...lanes.map((path) => measured[path] ?? 1));
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
    const files = paths.map((path) => ({ path, seconds: measured[path] ?? 1 }));
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
  // Runs 42803733957, 42807559589, 42801440878. Gap >20 s; missing rows count 1 s.
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
