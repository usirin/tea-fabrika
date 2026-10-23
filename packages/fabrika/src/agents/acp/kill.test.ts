import {type ChildProcess, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

// The user's job when a session is cut off: an acp job in tsh, tsh killed
// with kill -9 mid turn, a new tsh on the same home, `attach %1`. The real
// launcher (`runTsh`), listing the small programs and acp
// (fixtures/acp-tsh/tsh.ts: fabrika's small shell lists no acp since
// experiment 114), the fake agent (./fake-agent.ts) as the harness. The session opens
// again, the prompt the kill cut off is sent again, and nobody types it twice.

const TSH = fileURLToPath(new URL("../../../../../fixtures/acp-tsh/tsh.ts", import.meta.url));

interface Life {
	readonly child: ChildProcess;
	readonly out: () => string;
	readonly exited: Promise<number | null>;
}

/** One tsh, on `home`, running `line`. */
const life = (home: string, line: string): Life => {
	const args = ["--disable-warning=ExperimentalWarning", TSH, "--json", "-c", line];
	const child = spawn(process.execPath, args, {
		env: {...process.env, TSH_HOME: home},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let out = "";
	child.stdout?.on("data", (chunk) => {
		out += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		out += String(chunk);
	});
	const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
	return {child, out: () => out, exited};
};

/** What the fake agent noted of each prompt it was sent: `prompt <session> <n> <first word>`. */
const prompts = (folder: string) => {
	const at = join(folder, ".fake-acp", "log");
	return existsSync(at) ? readFileSync(at, "utf8").split("\n").filter(Boolean) : [];
};

const until = async (check: () => boolean, what: string) => {
	const deadline = Date.now() + 20_000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`waited for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};

describe("acp in tsh, killed mid turn, attached again", () => {
	for (const reopen of ["load", "resume"])
		it(`kill -9 in the second of three turns, then attach (${reopen}): every prompt answered, the cut one sent again, none retyped`, async () => {
			const home = mkdtempSync(join(tmpdir(), "tsh-home-"));
			const folder = realpathSync(mkdtempSync(join(tmpdir(), "acp-kill-")));
			writeFileSync(join(folder, "a.txt"), "The river is called Kura.\n");
			writeFileSync(join(folder, "b.txt"), "The bridge has 7 arches.\n");

			// Each prompt's first word is its own, so a failure names the prompt that went missing.
			const told = ["'Read a.txt'", "'slowly read b.txt'", "'Then slowly say done'"]
				.map((p) => `prompt=${p}`)
				.join(" ");
			const a = life(
				home,
				`acp --agent fake --folder ${folder} --reopen ${reopen} ${told} & close %1 prompt; attach %1`,
			);
			await until(() => prompts(folder).length === 2, "the second prompt");
			a.child.kill("SIGKILL");
			await a.exited;

			const b = life(home, "attach %1");
			expect(await b.exited).toBe(0);

			const sent = prompts(folder).map((l) => l.split(" "));
			// One session across both lives; the cut prompt twice, the others once.
			expect(new Set(sent.map((p) => p[1])).size).toBe(1);
			expect(sent.map((p) => p[3])).toEqual(["Read", "slowly", "slowly", "Then"]);
			expect(sent.map((p) => p[2])).toEqual(["1", "2", "3", "4"]);

			// `--json`: each value as `<output> <JSON>`, after the job's number.
			const outputs = b
				.out()
				.split("\n")
				.flatMap((l) => {
					const found = /(opened|result) (\{.*\})$/.exec(l);
					return found === null ? [] : [{name: found[1], value: JSON.parse(found[2] ?? "")}];
				});
			const opened = outputs.find((o) => o.name === "opened")?.value;
			// The cut prompt and the one told after it, both waiting: sent from storage, not typed.
			expect(opened).toMatchObject({how: reopen, earlier: 1, resent: 2});
			const results = outputs.filter((o) => o.name === "result").map((o) => o.value);
			expect(results).toMatchObject([
				{turn: 2, stop: "end_turn"},
				{turn: 3, stop: "end_turn"},
			]);
		}, 60_000);
});
