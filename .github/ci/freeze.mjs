// The freeze guard (decision 0525): a change may delete a file under today's version's paths, never
// add or change one. It runs in the `changes` job on every event, with no install, on the runner's
// own Node, like changes.mjs. It only reads git: it cannot stop today's app or tools from running.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isFrozen } from "../../oxlint-plugins/frozen.mjs";
import { diffBase, git } from "./changes.mjs";

/** @typedef {{ status: string, path: string }} Entry  one `--name-status` line: A, M, D, T, ... */
/** @typedef {import("./changes.mjs").Runner} Runner */

/**
 * The entries the guard refuses, in their order: any status but a delete, on a frozen path.
 * @param {readonly Entry[]} entries
 * @returns {Entry[]}
 */
export const refused = (entries) => entries.filter(({ status, path }) => status !== "D" && isFrozen(path));

/**
 * The diff as changes.mjs reads it (the merge base on a pull request), with each path's status. A
 * rename is a delete and an add (`--no-renames`), so a move into a frozen path is an add there. NUL
 * keeps every legal Git name. `null` when history cannot be read: then the guard fails.
 * @param {string} base
 * @param {string} head
 * @param {string} event
 * @param {Runner} [run]
 * @returns {Entry[] | null}
 */
export const readEntries = (base, head, event, run = git) => {
  const from = diffBase(base, head, event, run);

  if (from === null) {
    return null;
  }

  const diff = run(["diff", "--no-renames", "--name-status", "-z", from, head, "--"]);

  if (diff.status !== 0 || typeof diff.stdout !== "string" || (diff.stdout !== "" && !diff.stdout.endsWith("\0"))) {
    return null;
  }

  const parts = diff.stdout === "" ? [] : diff.stdout.slice(0, -1).split("\0");

  if (parts.length % 2 !== 0) {
    return null;
  }

  /** @type {Entry[]} */
  const entries = [];

  for (let i = 0; i < parts.length; i += 2) {
    const status = parts[i] ?? "";
    const path = parts[i + 1] ?? "";

    // With renames off, every entry is one status letter and one path.
    if (!/^[A-Z]$/.test(status) || path === "") {
      return null;
    }

    entries.push({ status, path });
  }

  return entries;
};

const why = "(0525: today's version takes no edit; delete it or move the work to next/)";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = readEntries(process.env["BASE"] ?? "", process.env["HEAD"] ?? "", process.env["EVENT"] ?? "");
  const summary = process.env["GITHUB_STEP_SUMMARY"];

  if (entries === null) {
    console.error("freeze: history could not be read, so no change can pass the guard");
    process.exitCode = 1;
  } else {
    const lines = refused(entries).map(({ status, path }) => `frozen: ${status} ${path} ${why}`);

    for (const line of lines) {
      console.error(line);
    }

    if (summary && lines.length > 0) {
      appendFileSync(summary, `### Frozen paths\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`);
    }

    if (lines.length === 0) {
      console.log(`freeze: ${entries.length} paths, none frozen`);
    }

    process.exitCode = lines.length === 0 ? 0 : 1;
  }
}
