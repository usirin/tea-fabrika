import type {Assets, ProgramSource} from "@kampus/libfabrika/workers";

// Rolldown replaces this module with the checked program bundles and the built window's page and
// script (P14). Unbuilt, there is no window to serve.
export const programs: Readonly<Record<string, ProgramSource>> = {};
export const assets: Assets | undefined = undefined;
