import {relative} from "node:path";
import {BaseSequencer, type TestSpecification} from "vitest/node";

// How `--shard k/n` splits the test files over the check's machines: each machine gets about the
// same seconds, not the same count of files. vitest's own split gives each the same count, so two
// two-minute lane files can land on one machine while another runs only one-second files.

const LANE = "packages/pipeline/src/stages/pipeline/lane";

/**
 * Seconds a file took, from the repo root: every file of 20 s or more in the CI run of pull request
 * 412 (2026-11-06), where vitest's log prints each file's time. A file not named here counts 1.
 */
export const measured: Record<string, number> = {
	"packages/fabrika/src/host/door.laws.test.ts": 170,
	[`${LANE}.asked.test.ts`]: 158,
	[`${LANE}.typed-again.test.ts`]: 147,
	[`${LANE}.exam-pull.redo-on-main.test.ts`]: 139,
	[`${LANE}.github.heads.test.ts`]: 134,
	[`${LANE}.github.test.ts`]: 126,
	[`${LANE}.might-answer.test.ts`]: 122,
	[`${LANE}.typed-again.merge-and-old-saves.test.ts`]: 114,
	[`${LANE}.decided.let-through.test.ts`]: 111,
	[`${LANE}.decided.test.ts`]: 108,
	[`${LANE}.exam-pull.person-pushes.test.ts`]: 102,
	[`${LANE}.whole.test.ts`]: 97,
	[`${LANE}.whole.races.test.ts`]: 92,
	[`${LANE}.exam-pull.test.ts`]: 92,
	[`${LANE}.test-writer.test.ts`]: 91,
	"packages/fabrika/src/host/fence.laws.test.ts": 82,
	[`${LANE}.decided.words.test.ts`]: 76,
	"apps/fabrika/src/host/one-host.test.ts": 64,
	"packages/fabrika/src/host/host-machine.laws.test.ts": 58,
	[`${LANE}.leaves-behind.test.ts`]: 53,
	"packages/fabrika/src/host/laws.test.ts": 52,
	[`${LANE}.rubrics.test.ts`]: 49,
	"packages/pipeline/src/laws/world/world.test.ts": 49,
	"packages/pipeline/src/tsh/pty.test.ts": 33,
	"packages/pipeline/src/stages/pipeline/carry.laws.test.ts": 33,
	"packages/pipeline/src/stages/pipeline/program.format.test.ts": 26,
	"packages/pipeline/src/hosted/lane-writes.laws.test.ts": 26,
	"apps/fabrika/src/host/agents-restart.test.ts": 24,
	"apps/fabrika/src/desk/desk.laws.test.ts": 24,
	"packages/pipeline/src/laws/tea-host.test.ts": 21,
	"packages/pipeline/src/tsh/desk.test.ts": 20,
	[`${LANE}.exam-side-tree.test.ts`]: 20,
};

/**
 * Each file's machine, `0` to `count - 1`, in the order the files came. Each file, heaviest first
 * (ties by path), goes to the machine with the least seconds so far (ties: the first). The same
 * files in any order get the same machines, so every machine computes the same split.
 */
export const assign = (
	files: readonly {readonly path: string; readonly seconds: number}[],
	count: number,
): number[] => {
	const order = files
		.map((file, at) => ({...file, at}))
		.toSorted((x, y) => y.seconds - x.seconds || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
	const load = Array.from({length: count}, () => 0);
	const machines = files.map(() => 0);
	for (const file of order) {
		const least = load.indexOf(Math.min(...load));
		machines[file.at] = least;
		load[least] = (load[least] ?? 0) + file.seconds;
	}
	return machines;
};

/** vitest's own sequencer, with only `shard` changed: it keeps this machine's files of `assign`. */
export class Shards extends BaseSequencer {
	override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
		const {root, shard} = this.ctx.config;
		// vitest calls `shard` only when `--shard` is given; the type does not know that.
		if (shard === undefined) throw new Error("Shards.shard: called without --shard");
		const machines = assign(
			files.map((spec) => {
				const path = relative(root, spec.moduleId);
				return {path, seconds: measured[path] ?? 1};
			}),
			shard.count,
		);
		return files.filter((_, i) => machines[i] === shard.index - 1);
	}
}
