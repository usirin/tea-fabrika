// How this start of the app shows itself, decided once from its environment. main.ts reads the
// answer, and nothing else in the app looks at the environment for it.
//
//   no FABRIKA_HOME                   owner       Electron's own folder, a normal window
//   FABRIKA_HOME=<folder>             quiet       a test or an agent: no Dock icon, never the
//                                                 active app, the window shown without focus
//   FABRIKA_HOME=<folder>
//     FABRIKA_FOREGROUND=1            foreground  a test home on purpose, as the owner's window
//
// Why quiet: agents start the app on a home of their own to test it, while a person works on the
// same screen. A window that takes focus takes the person's keys. The agent reads the window's
// frames and types into it over the DevTools protocol, which needs no focus.

/** One start of the app: whose it is, and so how it shows itself. */
export type Launch =
	| {readonly kind: "owner"}
	| {readonly kind: "quiet"; readonly home: string}
	| {readonly kind: "foreground"; readonly home: string};

/** The launch the environment asks for. An empty FABRIKA_HOME is no home, as before. */
export const launchOf = (env: Readonly<Record<string, string | undefined>>): Launch => {
	const home = env.FABRIKA_HOME;
	if (home === undefined || home === "") return {kind: "owner"};
	return env.FABRIKA_FOREGROUND === "1" ? {kind: "foreground", home} : {kind: "quiet", home};
};

/**
 * Chromium's switches for a quiet launch: a window that is not focused, or is covered, keeps
 * drawing and keeps its timers, because an agent reads its frames and types into it.
 */
export const QUIET_SWITCHES = [
	"disable-backgrounding-occluded-windows",
	"disable-renderer-backgrounding",
	"disable-background-timer-throttling",
] as const;
