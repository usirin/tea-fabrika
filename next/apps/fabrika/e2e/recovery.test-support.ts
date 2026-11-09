// T331, next/. Outside-run support. P19/P21/P26 entries are pending handoffs, not replacements.
import {spawn, type ChildProcess} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {resolve} from "node:path";
import {Effect, Schema} from "effect";
import {_electron, type Page} from "playwright";

class OutsideError extends Schema.TaggedError<OutsideError>()("OutsideError", {
	why: Schema.String,
}) {}
const call = <A>(f: () => Promise<A>) =>
	// oxlint-disable-next-line fabrika/no-promises -- edge: Playwright exposes Electron and pages through Promises
	Effect.tryPromise({
		try: f,
		catch: () => new OutsideError({why: "Electron or window operation failed"}),
	});
const root = resolve(import.meta.dirname, "../../../..");
const Home = Schema.String.check(Schema.isPattern(/^\/tmp\/fh\.[^/]+$/)).pipe(
	Schema.brand("RecoveryTestHome"),
);
type Home = typeof Home.Type;
const environment = (home: Home): Record<string, string> => ({
	...Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined &&
				entry[0] !== "TYPESAFE_API_KEY" &&
				entry[0] !== "FABRIKA_FOREGROUND",
		),
	),
	FABRIKA_HOME: home,
});
export const publicWords =
	"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".split(
		" ",
	);
export const disposableHome = Effect.acquireRelease(
	Effect.sync(() => Schema.decodeUnknownSync(Home)(mkdtempSync("/tmp/fh."))),
	(home) => Effect.sync(() => rmSync(home, {recursive: true, force: true})),
);
export const printer = (home: Home) => ({
	print: Effect.fn("test.print")(function* (pdf: Uint8Array) {
		const path = resolve(home, "printed-sheet.pdf");
		yield* Effect.sync(() => writeFileSync(path, pdf));
		return {completed: true, path};
	}),
	cancel: Effect.succeed({completed: false}),
});
export const personCheck = {
	approve: Effect.succeed("touch" as const),
	cancel: Effect.fail(new OutsideError({why: "canceled"})),
};
const stop = (child: ChildProcess) =>
	Effect.sync(() => {
		child.kill("SIGTERM");
	});
export const startStage = Effect.fn("test.stage")(function* () {
	const home = yield* disposableHome;
	const entry = resolve(root, "next/apps/fabrika/stage.ts");
	if (!existsSync(entry))
		return yield* new OutsideError({
			why: "missing upstream P26 stage entry: reconcile before build",
		});
	const child = yield* Effect.acquireRelease(
		Effect.sync(() =>
			spawn(process.execPath, [entry, "--listen=127.0.0.1:0", "--ready=json"], {
				cwd: root,
				env: environment(home),
				stdio: ["ignore", "pipe", "pipe"],
			}),
		),
		stop,
	);
	const ready = yield* Effect.callback<{url: string}, OutsideError>((resume) => {
		let pending = "";
		child.stdout?.on("data", (bytes: Buffer) => {
			pending += bytes.toString();
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const result = Schema.decodeUnknownResult(
					Schema.fromJsonString(Schema.Struct({url: Schema.String})),
				)(line);
				if (result._tag === "Success") resume(Effect.succeed(result.success));
			}
		});
		child.once("error", () =>
			resume(Effect.fail(new OutsideError({why: "stage could not start"}))),
		);
		child.once("exit", () =>
			resume(Effect.fail(new OutsideError({why: "stage exited before ready"}))),
		);
	});
	return {home, url: ready.url};
});
export const openDevice = Effect.fn("test.device")(function* (
	url: string,
	mode: "test" | "person" = "test",
	existing?: Home,
) {
	const home = existing ?? (yield* disposableHome);
	const entry = resolve(root, "next/apps/fabrika/src/entry/electron-main.ts");
	if (!existsSync(entry))
		return yield* new OutsideError({
			why: "missing upstream P19 Electron entry: reconcile before build",
		});
	const app = yield* Effect.acquireRelease(
		call(() =>
			_electron.launch({
				args: [
					entry,
					"--address",
					url,
					"--test-entropy=00000000000000000000000000000000",
					...(mode === "test" ? ["--test-person-check=touch", `--test-printer=${home}`] : []),
				],
				env: environment(home),
			}),
		),
		(app) => call(() => app.close()).pipe(Effect.ignore),
	);
	const page = yield* call(() => app.firstWindow());
	return {home, app, page};
});
export const enterWords = Effect.fn("test.words")(function* (page: Page) {
	for (const [i, word] of publicWords.entries())
		yield* call(() => page.getByLabel(`Word ${i + 1}`, {exact: true}).fill(word));
});
export const confirmWords = Effect.fn("test.confirmWords")(function* (page: Page) {
	const fields = yield* call(() => page.getByLabel(/^Confirm word \d+$/).all());
	if (fields.length !== 2)
		return yield* new OutsideError({why: "making needs exactly two confirmation fields"});
	const used = new Set<number>();
	for (const field of fields) {
		const label = yield* call(() =>
			field.evaluate(
				(element) =>
					element.getAttribute("aria-label") ??
					(element as HTMLInputElement).labels?.[0]?.textContent,
			),
		);
		const position = Number(label?.match(/\d+/)?.[0]);
		if (position < 1 || position > 12 || !Number.isInteger(position) || used.has(position))
			return yield* new OutsideError({why: "confirmation positions must be distinct and in 1..12"});
		used.add(position);
		const word = publicWords[position - 1];
		if (word === undefined) return yield* new OutsideError({why: "missing public fixture word"});
		yield* call(() => field.fill(word));
	}
});
// Metadata only, under the disposable test home. Never open, read or copy a key file.
export const sealedMetadata = (home: Home) => {
	const files: {path: string; size: number; modified: number}[] = [];
	const walk = (folder: string) => {
		for (const entry of readdirSync(resolve(home, folder), {withFileTypes: true})) {
			const path = folder ? `${folder}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(path);
			else if (/key|sealed/i.test(path) && !/\.(?:log|jsonl)$/.test(path)) {
				const stat = statSync(resolve(home, path));
				files.push({path, size: stat.size, modified: stat.mtimeMs});
			}
		}
	};
	walk("");
	return files.sort((a, b) => a.path.localeCompare(b.path));
};
export const click = (page: Page, name: string) =>
	call(() => page.getByRole("button", {name, exact: true}).click());
export const visible = (page: Page, text: string) =>
	call(() => page.getByText(text, {exact: true}).waitFor({state: "visible"}));
export const absent = (page: Page, text: string) =>
	call(() => page.getByText(text, {exact: true}).count());
export const ledger = Effect.fn("test.ledger")(function* (url: string) {
	const response = yield* call(() => fetch(`${url}/test/ledger`));
	if (!response.ok)
		return yield* new OutsideError({why: "P26 disposable stage must expose its test ledger"});
	const body = yield* call(() => response.json());
	return Schema.decodeUnknownSync(
		Schema.Struct({
			founded: Schema.Json,
			rev: Schema.Int,
			name: Schema.String,
			notes: Schema.Array(Schema.Json),
			keys: Schema.Array(Schema.String),
			spent: Schema.Array(Schema.String),
		}),
	)(body);
});
export const pictures = Effect.fn("test.pictures")(function* (page: Page, state: string) {
	const folder = resolve(root, "next/apps/fabrika/docs");
	yield* Effect.sync(() => mkdirSync(folder, {recursive: true}));
	for (const layout of ["full", "side-by-side", "stacked", "grid", "small"]) {
		yield* call(() =>
			page.setViewportSize(
				layout === "small" ? {width: 1024, height: 700} : {width: 1440, height: 1000},
			),
		);
		// P26's real desk controls, never a CSS stand-in for tiles.
		yield* click(page, "Close other tiles");
		if (layout === "side-by-side" || layout === "grid") yield* click(page, "Split right");
		if (layout === "stacked" || layout === "grid") yield* click(page, "Split below");
		if (layout === "grid") {
			yield* click(page, "Focus previous tile");
			yield* click(page, "Split below");
		}
		yield* call(() =>
			page.screenshot({path: resolve(folder, `recovery-${state}-${layout}.png`), fullPage: false}),
		);
	}
});
export {call};
