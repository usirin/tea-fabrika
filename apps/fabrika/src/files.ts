import {Effect, FileSystem, Path} from "effect";

// What the app's own protocol serves: its own three files, from its own folder, and nothing
// else. Never `file://`, never a remote site (Electron's security checklist). A path is one of
// the names below or it is not found, so no path can climb out of the folder.
//
//   fileOf("fabrika://app/")                    "/index.html"
//   fileOf("fabrika://app/window.js?x=1")       "/window.js"
//   fileOf("fabrika://app/../main.mjs")         null: the url reads as /main.mjs, not one of them
//   fileOf("https://example.com/window.js")     null
//
// It names no platform: Effect's `FileSystem` reads the file, and main.ts hands it Node's.

export const SCHEME = "fabrika";
/** The app's own host on its scheme. Everything it loads is under it. */
const HOST = "app";
/** Where the window starts. */
export const START = `${SCHEME}://${HOST}/index.html`;

const FILES = {
	"/index.html": "text/html; charset=utf-8",
	"/window.js": "text/javascript; charset=utf-8",
	"/window.css": "text/css; charset=utf-8",
} as const;

/** A file the protocol serves, by its path. */
export type Served = keyof typeof FILES;

/**
 * The Content Security Policy every answer carries: scripts and styles from the app's own files,
 * and nothing else. No inline script, no eval, no connection out, no frame.
 */
export const CSP =
	"default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

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
	const path = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
	return isServed(path) ? path : null;
};

const headers = (type: string | null) => ({
	"content-security-policy": CSP,
	"x-content-type-options": "nosniff",
	...(type === null ? {} : {"content-type": type}),
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
		return new Response(text, {headers: headers(FILES[file])});
	}).pipe(
		Effect.catchTag("PlatformError", (e) =>
			Effect.succeed(
				new Response(`cannot read: ${e.message}`, {status: 500, headers: headers(null)}),
			),
		),
	);
