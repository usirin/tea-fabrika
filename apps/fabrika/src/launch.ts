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
//
// A quiet window is hidden before it is ever shown (`hidden`, main.ts applies it): opacity 0,
// click-through, in the work area's bottom-right corner (`corner`). A test window starts on
// `quietEnv`, through test-window.ts, so it is always quiet:
//
//   quietEnv(parent, home)            ok    the parent's env, less FABRIKA_FOREGROUND, on that home
//                                     long  the home's socket path passes macOS's limit

import { fitsSocket } from "./host/socket.ts";

/** One start of the app: whose it is, and so how it shows itself. */
export type Launch =
  | { readonly kind: "owner" }
  | { readonly kind: "quiet"; readonly home: string }
  | { readonly kind: "foreground"; readonly home: string };

/** The launch the environment asks for. An empty FABRIKA_HOME is no home, as before. */
export const launchOf = (env: Readonly<Record<string, string | undefined>>): Launch => {
  const home = env.FABRIKA_HOME;

  if (home === undefined || home === "") {
    return { kind: "owner" };
  }

  return env.FABRIKA_FOREGROUND === "1" ? { kind: "foreground", home } : { kind: "quiet", home };
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

/** A screen's usable rectangle, as Electron's `workArea` gives it. */
interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** A quiet window, as it must look the moment it exists. The types allow only the hidden values. */
interface Hidden {
  readonly opacity: 0;
  readonly ignoreMouse: true;
  readonly x: number;
  readonly y: number;
}

/** The work area's bottom-right corner for a window of this size, kept inside the area's top-left. */
export const corner = (area: Area, size: Size): { readonly x: number; readonly y: number } => ({
  x: Math.max(area.x, area.x + area.width - size.width),
  y: Math.max(area.y, area.y + area.height - size.height),
});

export const hidden = (area: Area, size: Size): Hidden => ({ opacity: 0, ignoreMouse: true, ...corner(area, size) });

/** The environment for a test window: the parent's, minus FABRIKA_FOREGROUND, on this home. */
export const quietEnv = (
  parent: Readonly<Record<string, string | undefined>>,
  home: string,
): { readonly kind: "ok"; readonly env: Record<string, string> } | { readonly kind: "long"; readonly home: string } => {
  if (!fitsSocket(home)) {
    return { kind: "long", home };
  }

  const env: Record<string, string> = {};

  for (const [name, value] of Object.entries(parent)) {
    if (value !== undefined && name !== "FABRIKA_FOREGROUND") {
      env[name] = value;
    }
  }

  return { kind: "ok", env: { ...env, FABRIKA_HOME: home } };
};
