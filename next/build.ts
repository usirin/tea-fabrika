import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";

// What the hands do before a brain can run (A4): bundle each program into one module, keyed by the
// sha256 of its code, and bundle the brain and the window's script. Node at the edge, all of it.

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** One ES module for workerd: `cloudflare:*` is left to the runtime. */
const forWorkerd = async (entry: string, minify: boolean): Promise<string> => {
	const out = await build({
		entryPoints: [here(entry)],
		bundle: true,
		write: false,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		mainFields: ["module", "main"],
		conditions: ["workerd", "worker", "browser", "import"],
		external: ["cloudflare:workers"],
		minify,
		legalComments: "none",
		logLevel: "silent",
	});
	return out.outputFiles[0]?.text ?? "";
};

const forBrowser = async (entry: string): Promise<string> => {
	const out = await build({
		entryPoints: [here(entry)],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		target: "es2022",
		jsx: "automatic",
		define: {"process.env.NODE_ENV": '"production"'},
		minify: true,
		legalComments: "none",
		logLevel: "silent",
	});
	return out.outputFiles[0]?.text ?? "";
};

const program = async (entry: string) => {
	const code = await forWorkerd(entry, true);
	return {hash: createHash("sha256").update(code).digest("hex"), code};
};

export type Bundles = {
	readonly brain: string;
	readonly window: string;
	readonly programs: Readonly<Record<string, {readonly hash: string; readonly code: string}>>;
};

export const buildAll = async (): Promise<Bundles> => {
	const [brain, window, counter, desk] = await Promise.all([
		forWorkerd("src/brain.ts", false),
		forBrowser("src/window/main.tsx"),
		program("src/programs/counter/entry.ts"),
		program("src/desktop/desk-entry.ts"),
	]);
	return {brain, window, programs: {counter, desk}};
};
