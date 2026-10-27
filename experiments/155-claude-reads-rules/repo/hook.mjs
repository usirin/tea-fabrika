// Run by a hook, a plugin hook, the apiKeyHelper or the statusLine, if Claude Code runs them.
// It leaves a mark outside the copy, in the run's marks folder, and says whether the project's
// env reached it.
import {appendFileSync} from "node:fs";

const what = process.argv[2] ?? "unknown";
appendFileSync(`{{MARKS}}/${what}`, `env=${process.env.EXP155_ENV ?? "unset"}\n`);
if (what === "session")
	console.log("The code word of the hook's context is M155-HOOK-CONTEXT-n5k2.");
if (what === "apikeyhelper") process.exit(1);
