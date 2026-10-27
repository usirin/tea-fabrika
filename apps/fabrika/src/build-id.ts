// Which build of the app this code is: a short id that build.ts writes into every bundle, the
// app's and the host's the same, as a define. The host's hello names it (link.ts), so an app can
// tell a host that runs older code from one that runs its own.
//
//   build.ts       FABRIKA_BUILD = "3f9a0c21b7d4": the first 12 hex of a SHA-256 over the source
//                  files every bundle was made from, so a build of the same code has the same id
//   run unbundled  "source": a test, or the host run from src/ (host/one-host.test.ts)
//
// No platform here: the app's main and the host both import it, and a define needs nothing more.

declare const FABRIKA_BUILD: string | undefined;

/** This build's id, or "source" when the code runs as it is in src/, with no build. */
export const BUILD: string = typeof FABRIKA_BUILD === "string" ? FABRIKA_BUILD : "source";
