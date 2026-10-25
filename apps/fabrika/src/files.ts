import {Effect, FileSystem, Path} from "effect";

// What the app's own protocol serves: its own files, from its own folder, and nothing else.
// Never `file://`, never a remote site (Electron's security checklist). A path is one of the
// names below or it is not found, so no path can climb out of the folder.
//
//   fileOf("fabrika://app/")                    "/terminal.html"
//   fileOf("fabrika://app/terminal.js?x=1")     "/terminal.js"
//   fileOf("fabrika://app/../main.mjs")         null: the url reads as /main.mjs, not one of them
//   fileOf("https://example.com/terminal.js")   null
//   pageOf("fabrika://app/program.html")        "program": a program's window
//
// It names no platform: Effect's `FileSystem` reads the file, and main.ts hands it Node's.

export const SCHEME = "fabrika";
/** The app's own host on its scheme. Everything it loads is under it. */
const HOST = "app";

/**
 * The Content Security Policy every answer carries: scripts and styles from the app's own files,
 * and nothing else. No inline script, no eval, no connection out, no frame.
 */
export const CSP =
	"default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * The terminal's page's policy: the same, and WebAssembly may be compiled. Its screen is
 * ghostty-web, whose terminal is Ghostty's own, built to WebAssembly; Chromium compiles none
 * under `script-src 'self'` alone. `'wasm-unsafe-eval'` lets in WebAssembly and nothing else: no
 * `eval`, no `new Function`, no inline script. The bytes compiled are in the page's own script.
 */
export const TERMINAL_CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The two kinds of page: the terminal, and a program's window. */
export type Page = "terminal" | "program";

const FILES = {
	"/terminal.html": {type: "text/html; charset=utf-8", csp: TERMINAL_CSP, page: "terminal"},
	"/terminal.js": {type: "text/javascript; charset=utf-8", csp: CSP, page: null},
	"/program.html": {type: "text/html; charset=utf-8", csp: CSP, page: "program"},
	"/program.js": {type: "text/javascript; charset=utf-8", csp: CSP, page: null},
	"/window.css": {type: "text/css; charset=utf-8", csp: CSP, page: null},
} as const satisfies Record<string, {type: string; csp: string; page: Page | null}>;

/** A file the protocol serves, by its path. */
export type Served = keyof typeof FILES;

/** Where the terminal window starts. */
export const TERMINAL = `${SCHEME}://${HOST}/terminal.html`;
/** Where a program's window starts. */
export const PROGRAM = `${SCHEME}://${HOST}/program.html`;

const isServed = (path: string): path is Served => Object.hasOwn(FILES, path);

/** The app's own: a url on its scheme and host. */
export const isOurs = (url: string): boolean => {
	const parsed = URL.parse(url);
	return parsed !== null && parsed.protocol === `${SCHEME}:` && parsed.host === HOST;
};

/** The file a url names, or `null`: not the app's own, or not one of its files. */
export const fileOf = (url: string): Served | null => {
	const parsed = URL.parse(url);
	if (parsed === null || !isOurs(url)) return null;
	const path = parsed.pathname === "/" ? "/terminal.html" : parsed.pathname;
	return isServed(path) ? path : null;
};

/** The page a url shows, or `null`: not one of the app's two pages. */
export const pageOf = (url: string): Page | null => {
	const file = fileOf(url);
	return file === null ? null : FILES[file].page;
};

const headers = (file: Served | null) => ({
	"content-security-policy": file === null ? CSP : FILES[file].csp,
	"x-content-type-options": "nosniff",
	...(file === null ? {} : {"content-type": FILES[file].type}),
});

/** The answer to a request for `url`, from the files in `dir`: the file, 404 or 500. */
export const answer = (dir: string, url: string) =>
	Effect.gen(function* () {
		const file = fileOf(url);
		if (file === null) return new Response("not found", {status: 404, headers: headers(null)});
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		// Every file it serves is text.
		const text = yield* fs.readFileString(path.join(dir, file.slice(1)));
		return new Response(text, {headers: headers(file)});
	}).pipe(
		Effect.catchTag("PlatformError", (e) =>
			Effect.succeed(
				new Response(`cannot read: ${e.message}`, {status: 500, headers: headers(null)}),
			),
		),
	);
