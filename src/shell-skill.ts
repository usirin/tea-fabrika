import { readFileSync } from "node:fs";
import { join } from "node:path";

// A fabrika shell is an agent definition that names the skill it runs
// (`skills: ["fabrika:build"]`). When Claude Code spawns it as a subagent, the
// harness puts that skill's text in the shell's context with its arguments
// blank, and the work's number arrives in the brief. Run as the main agent of
// an SDK session, the same definition gets no skill: the first dry run's
// builder had none, called the Skill tool, and the skill (`context: fork`,
// `background: true`) ran as a second agent behind it. So the host does the
// preload itself, in code: the skill's text, then the brief.

export interface Preload {
  /** The skills the shell's definition names, as `plugin:skill`. */
  readonly skills: readonly string[];
  /** Their text, as it goes in front of the brief. */
  readonly text: string;
}

/** A markdown file's frontmatter and body. */
function parts(markdown: string): { readonly front: string; readonly body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
  return m === null ? { front: "", body: markdown } : { front: m[1] as string, body: m[2] as string };
}

/** A frontmatter key whose value is an inline list: `skills: ["a:b"]`, `arguments: [pr_number]`. */
function list(front: string, key: string): string[] {
  const m = new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, "m").exec(front);
  if (m === null) return [];
  return (m[1] as string)
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter((item) => item !== "");
}

/** One skill's text as a preload has it: its folder named first, and each declared argument blank. */
function skillText(plugin: string, skill: string): string {
  const name = skill.slice(skill.indexOf(":") + 1);
  const dir = join(plugin, "skills", name);
  const { front, body } = parts(readFileSync(join(dir, "SKILL.md"), "utf8"));
  const blanked = [...list(front, "arguments"), "ARGUMENTS"].reduce(
    (text, arg) => text.replaceAll(new RegExp(`\\$${arg}\\b`, "g"), ""),
    body,
  );
  return `Base directory for this skill: ${dir}\n\n${blanked.trim()}`;
}

/** What a shell's definition preloads, read from the plugin's folder. */
export function preloadOf(plugin: string, shell: string): Preload {
  const skills = list(parts(readFileSync(join(plugin, "agents", `${shell}.md`), "utf8")).front, "skills");
  if (skills.length === 0) throw new Error(`the shell ${shell} names no skill to preload`);
  return { skills, text: skills.map((skill) => skillText(plugin, skill)).join("\n\n---\n\n") };
}

/**
 * What a shell is sent: its skill, then its brief, then how to give its last
 * word as data. The skill has it print a terminal token; the machine reads
 * that token only as the typed answer, and only when the shell's own report
 * to the lane did not land.
 */
export const shellPrompt = (preload: Preload, brief: string): string =>
  [
    `Your skill (${preload.skills.join(", ")}) is loaded below. It is already in your context: follow it from here, and do not start it again through the Skill tool.`,
    preload.text,
    "---",
    "Your brief, from the lane that started you:",
    brief,
    "---",
    "The folder you are in is the git worktree the brief asks for: it was made for this lane, and it is yours. Work in it and make no other; `git worktree add` is refused here. The shells before you on this lane worked in this same folder, so it may stand on the lane's branch.",
    "When you finish, give your final answer as data too: `token` is the terminal token your skill had you report, spelled exactly as the skill spells it, and `pr` is the pull request's full URL, or null when there is none.",
  ].join("\n\n");
