import { isAbsolute, relative, resolve } from "node:path";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

// The Check before each step of a shell: a pure function of one tool call,
// run in a PreToolUse hook, where experiment 43 found a refusal lands before
// the call runs and the agent reads it and works around it. It holds a shell
// to its own working copy and keeps the acts that only the ship verb may do
// out of its hands. A shell with Bash can still write anywhere a command can
// reach, so this stops the plain cases and the dangerous ones by name; the
// end state is still read from the lane and the folder, not from the log.

export interface GuardRules {
  /** The working copy the shell runs in. Writes belong here. */
  readonly tree: string;
  /** Folders outside the tree a shell may still write: the lane's ledger, the system's temp folders. */
  readonly alsoWritable: readonly string[];
  /** The skills already in the shell's context. Starting one again through the Skill tool would run it as a second agent. */
  readonly loaded?: readonly string[];
  /**
   * The agent only reads, and only inside the tree: Read, Grep and Glob, and
   * the SDK's own tool for handing back a typed answer. Every other tool is
   * refused, and so is a read of a path outside the tree. For a reviewer: it
   * is handed a copy of the code at one commit and nothing else.
   */
  readonly readOnly?: boolean;
}

const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const READS = new Set(["Read", "Grep", "Glob"]);
/** The SDK's tool for a typed answer (`outputFormat`). It touches nothing. */
const ANSWER = "StructuredOutput";

const inside = (folder: string, path: string) => {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * The `readOnly` rule, for one tool call. A path is judged as it is written:
 * a link inside the tree that points out of it is not followed here.
 */
function readOnlyRefusal(rules: GuardRules, tool: string, input: Readonly<Record<string, unknown>>): string | null {
  if (tool === ANSWER) return null;
  if (!READS.has(tool)) return `This run only reads. ${tool} is not allowed here: use Read, Grep and Glob, inside ${rules.tree}.`;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
  const from = resolve(rules.tree, text(input.path) ?? ".");
  // A Glob's pattern can name a folder of its own: the part before its first wildcard is where it looks.
  const looksIn = tool === "Glob" && text(input.pattern) !== null ? resolve(from, (input.pattern as string).split(/[*?[{]/)[0] ?? "") : from;
  const asked = [text(input.file_path) === null ? null : resolve(rules.tree, input.file_path as string), from, looksIn];
  const outside = asked.find((path) => path !== null && !inside(rules.tree, path));
  return outside === undefined || outside === null ? null : `${outside} is outside the code you were given. Read only inside ${rules.tree}.`;
}

const writable = (rules: GuardRules, path: string) =>
  inside(rules.tree, path) || rules.alsoWritable.some((folder) => inside(folder, path));

/** A command line cut into the commands it chains, each as its words. Quotes are not parsed: a quoted word keeps its quotes. */
const commands = (line: string): string[][] =>
  line
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().split(/\s+/).filter((w) => w !== ""))
    .filter((words) => words.length > 0);

const bare = (word: string) => word.replace(/^["']|["']$/g, "");

/** Whether a `git push` names the default branch as where it pushes to. */
function pushesToMain(words: readonly string[]): boolean {
  const at = words.indexOf("push");
  if (words[0] !== "git" || at === -1) return false;
  return words.slice(at + 1).some((raw) => {
    const word = bare(raw);
    const target = word.includes(":") ? word.slice(word.lastIndexOf(":") + 1) : word;
    return target === "main" || target === "refs/heads/main";
  });
}

/** The absolute paths a command writes by its shape: a redirect's target, or what `tee`, `rm`, `mv` and `cp` name. */
function writtenPaths(words: readonly string[]): string[] {
  // A path as a word carries it: quotes off, and whatever closes a subshell or a statement after it.
  const path = (word: string) => bare(word.replace(/[)\]};`]+$/, ""));
  const out: string[] = [];
  words.forEach((raw, i) => {
    const redirect = /^\d?>>?(.*)$/.exec(raw);
    if (redirect !== null) {
      const target = path(redirect[1] !== "" ? (redirect[1] as string) : (words[i + 1] ?? ""));
      if (isAbsolute(target)) out.push(target);
    }
  });
  if (["tee", "rm", "mv", "cp"].includes(words[0] ?? "")) {
    for (const raw of words.slice(1)) if (isAbsolute(path(raw))) out.push(path(raw));
  }
  // `/dev/null`, `/dev/stdout` and their kin are no file anyone keeps.
  return out.filter((p) => !p.startsWith("/dev/"));
}

/** The words a repo's one owner posts on their own pull request to approve it, as fabrika's ship verb reads them. */
const SELF_APPROVAL = "control-plane-self-approval";

/**
 * Whether a command line gives a pull request an approval: a review that
 * approves, by `gh pr review` or through the API, or a comment that carries
 * the owner's self-approval words. A shell runs under the account a person
 * approves from, so GitHub would take it. Reading for those words is fine.
 */
function approves(line: string): boolean {
  const all = commands(line);
  const gh = all.filter((words) => words[0] === "gh");
  const flag = (words: readonly string[], ...flags: string[]) => words.some((w) => flags.some((f) => bare(w) === f || bare(w).startsWith(`${f}=`)));
  if (gh.some((w) => w[1] === "pr" && w[2] === "review" && flag(w, "--approve", "-a"))) return true;
  const posts = (w: readonly string[]) => w[1] === "api" && flag(w, "-f", "-F", "--field", "--raw-field", "--input", "-X", "--method");
  if (/\/reviews\b/.test(line) && /\bAPPROVE\b/.test(line) && gh.some(posts)) return true;
  const comments = (w: readonly string[]) => (w[1] === "pr" || w[1] === "issue") && w[2] === "comment";
  const notes = all.some((w) => w.some((word) => /(^|\/)fabrika$/.test(bare(word))) && w.includes("note"));
  return line.includes(SELF_APPROVAL) && (gh.some((w) => comments(w) || posts(w)) || notes);
}

/** Why a tool call may not run, as a sentence the shell can act on, or `null`. */
export function refusal(rules: GuardRules, tool: string, input: Readonly<Record<string, unknown>>): string | null {
  if (rules.readOnly === true) return readOnlyRefusal(rules, tool, input);
  if (WRITES.has(tool)) {
    const raw = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : null;
    if (raw === null) return null;
    const path = resolve(rules.tree, raw);
    return writable(rules, path) ? null : `${raw} is outside your working copy. Write only inside ${rules.tree}.`;
  }
  if (tool === "Skill" && typeof input.skill === "string" && (rules.loaded ?? []).includes(input.skill)) {
    return `The ${input.skill} skill is already in your context, above your brief. Follow it there; do not start it again.`;
  }
  if (tool !== "Bash" || typeof input.command !== "string") return null;
  // A shell is the one agent of a one-shot session. When its turn ends the session ends, and
  // nothing wakes it for a command it left running: the wait dies, and so does the hand-off after it.
  if (input.run_in_background === true) {
    return "Run this in the foreground. Your session ends when your turn ends, so a command left in the background is never read: wait for it here, with a longer timeout if it needs one.";
  }
  if (approves(input.command)) {
    return "Do not approve a pull request. An approval is a person's to give: report that the lane waits on it, and end.";
  }
  for (const words of commands(input.command)) {
    const has = (flag: string) => words.some((w) => bare(w) === flag || bare(w).startsWith(`${flag}=`));
    if (words[0] === "gh" && words[1] === "pr" && words[2] === "merge") {
      return "Do not merge by hand. Only the ship verb lands a pull request, through the merge queue.";
    }
    if (has("--delete-branch")) return "Do not delete branches: `--delete-branch` is not allowed here.";
    if (has("--auto")) return "Do not arm an auto-merge: `--auto` is not allowed here. The ship verb queues the pull request.";
    if (pushesToMain(words)) return "Do not push to main. Push your own branch; the merge queue lands it.";
    if (words[0] === "git" && words.includes("worktree") && words.includes("add")) {
      return `Do not make another working copy. You are already in one made for this lane: ${rules.tree}. Work here.`;
    }
    const outside = writtenPaths(words).find((path) => !writable(rules, path));
    if (outside !== undefined) return `${outside} is outside your working copy. Write only inside ${rules.tree}.`;
  }
  return null;
}

/** The Check as the SDK's PreToolUse hook. `refused` hears of each refusal, for the log. */
export const guardHook =
  (rules: GuardRules, refused: (tool: string, why: string) => void = () => {}): HookCallback =>
  async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const why = refusal(rules, input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>);
    if (why === null) return {};
    refused(input.tool_name, why);
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } };
  };
