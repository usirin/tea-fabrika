import {spawn, type ChildProcessWithoutNullStreams} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import * as fc from "fast-check";
import {afterEach, expect, it} from "vitest";
import {home, options, plant} from "../project.test-support.ts";

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
	for (const child of children.splice(0)) child.kill();
});
const edits = fc.array(
	fc.record({
		left: fc.constantFrom("u", "v", "w"),
		right: fc.constantFrom("m", "n", "o"),
		reverse: fc.boolean(),
		watcher: fc.boolean(),
		undo: fc.boolean(),
	}),
	{minLength: 1, maxLength: 8},
);
const preserved = (text: string, left: string, right: string) => {
	expect(text).toContain(`<prefix>${left}`);
	expect(text).toContain(`<prefix>${right}`);
};
const worker = (folder: string) => {
	const child = spawn(
		process.execPath,
		[new URL("./settings.shared.fixture.ts", import.meta.url).pathname, folder],
		{
			env: {
				...process.env,
				FABRIKA_HOME: folder,
				FABRIKA_FOREGROUND: undefined,
				TYPESAFE_API_KEY: undefined,
			},
			stdio: "pipe",
		},
	);
	children.push(child);
	const lines: string[] = [];
	let pending = "";
	let failure = "";
	child.stderr.on("data", (part) => {
		failure += String(part);
	});
	child.stdout.on("data", (part) => {
		pending += String(part);
		const rows = pending.split("\n");
		pending = rows.pop() ?? "";
		for (const row of rows) if (row.startsWith("P13 ")) lines.push(row.slice(4));
	});
	const next = async () => {
		for (let i = 0; i < 500; i++) {
			const line = lines.shift();
			if (line !== undefined) return JSON.parse(line);
			if (child.exitCode !== null) throw new Error(`settings worker exited: ${failure}`);
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error(`settings worker did not answer: ${failure}`);
	};
	return {
		next,
		close: () => child.kill(),
		send: (request: object) => child.stdin.write(`${JSON.stringify(request)}\n`),
	};
};
// Multi-process timing law (two settings workers per run, over Stryker's 10 s limit): the lead runs it outside Stryker.
it.skipIf(process.env.STRYKER_MUTATOR_WORKER !== undefined)(
	"P13: two processes preserve independent concurrent edits, both watchers update, and stale Undo refuses",
	async () => {
		await fc.assert(
			fc.asyncProperty(edits, async (flow) => {
				expect(flow.length).toBeGreaterThan(0);
				const folder = home();
				const a = worker(folder);
				const b = worker(folder);
				try {
					await Promise.all([a.next(), b.next()]);
					for (const op of flow) {
						const pair = op.reverse
							? ([
									[b, "tezgah.fold", op.right],
									[a, "tezgah.zoom", op.left],
								] as const)
							: ([
									[a, "tezgah.zoom", op.left],
									[b, "tezgah.fold", op.right],
								] as const);
						for (const [client, does, key] of pair)
							client.send({type: "bind", does, key: `<prefix>${key}`});
						const answers = await Promise.all([a.next(), b.next()]);
						preserved(readFileSync(join(folder, "keybindings.toml"), "utf8"), op.left, op.right);
						if (op.watcher) {
							for (const client of [a, b])
								client.send({type: "watch", left: op.left, right: op.right});
							for (const answer of await Promise.all([a.next(), b.next()]))
								expect(answer.seen).toBe(true);
						}
						if (op.undo) {
							const before = readFileSync(join(folder, "keybindings.toml"), "utf8");
							const version = createHash("sha256").update(`file:${before}`).digest("hex");
							const first = answers.findIndex((answer) => answer.version !== version);
							if (first === -1) continue; // Both saves were no-ops. No newer version exists.
							const client = first === 0 ? a : b;
							client.send({type: "undo", version: answers[first].version});
							expect((await client.next()).refused).toBe(true);
							expect(readFileSync(join(folder, "keybindings.toml"), "utf8")).toBe(before);
						}
					}
				} finally {
					a.close();
					b.close();
				}
			}),
			{...options, numRuns: 3},
		);
	},
);
plant("P13 local semaphores lose the other process's edit", edits, (flow) =>
	preserved(`tezgah.zoom = "<prefix>${flow[0]!.left}"`, flow[0]!.left, flow[0]!.right),
);
