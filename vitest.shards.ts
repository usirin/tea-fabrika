import {relative} from "node:path";
import {BaseSequencer, type TestSpecification} from "vitest/node";

// How `--shard k/n` splits the test files over the check's machines: each machine gets about the
// same seconds, not the same count of files. vitest's own split gives each the same count, so two
// two-minute lane files can land on one machine while another runs only one-second files.

const LANE = "packages/pipeline/src/stages/pipeline/lane";

/**
 * Seconds a file took, from the repo root. Lane files: the laptop, each alone, 2026-11-06. The
 * rest: the CI log of shard 3, 2026-11-06. A file not named here counts 1.
 */
export const measured: Record<string, number> = {
	[`${LANE}.github.test.ts`]: 124,
	[`${LANE}.decided.test.ts`]: 116,
	[`${LANE}.decided.let-through.test.ts`]: 114,
	[`${LANE}.asked.test.ts`]: 111,
	[`${LANE}.github.heads.test.ts`]: 110,
	[`${LANE}.exam-pull.redo-on-main.test.ts`]: 100,
	[`${LANE}.typed-again.test.ts`]: 100,
	[`${LANE}.might-answer.test.ts`]: 98,
	[`${LANE}.exam-pull.test.ts`]: 93,
	[`${LANE}.test-writer.test.ts`]: 92,
	[`${LANE}.whole.test.ts`]: 87,
	[`${LANE}.typed-again.merge-and-old-saves.test.ts`]: 78,
	[`${LANE}.exam-pull.person-pushes.test.ts`]: 75,
	[`${LANE}.decided.words.test.ts`]: 66,
	[`${LANE}.whole.races.test.ts`]: 59,
	[`${LANE}.leaves-behind.test.ts`]: 47,
	[`${LANE}.rubrics.test.ts`]: 37,
	[`${LANE}.exam-side-tree.test.ts`]: 19,
	"packages/fabrika/src/host/fence.laws.test.ts": 63,
	"packages/pipeline/src/stages/pipeline/carry.laws.test.ts": 26,
	"packages/pipeline/src/stages/pipeline/github.test.ts": 20,
	"packages/pipeline/src/laws/tea-host.test.ts": 16,
	"packages/pipeline/src/stages/pipeline/work.test.ts": 13,
	"packages/pipeline/src/asks/ledger.test.ts": 12,
	"packages/pipeline/src/stages/operate/program.test.ts": 11,
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
