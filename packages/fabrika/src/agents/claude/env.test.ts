import {execFileSync} from "node:child_process";
import {describe, expect, it} from "vitest";
import {agentEnv, hostEnv, runEnv, shellEnv} from "./env.ts";

// The short environments, on a made-up parent: no test here reads a real key.
// How each place that starts a process uses them is tested beside that place.

/** A parent with what a machine has set: the plain names, a login, an ssh agent, and keys nobody named. */
const PARENT = {
	PATH: "/bin",
	HOME: "/home/someone",
	TMPDIR: "/tmp/someone",
	LANG: "en_US.UTF-8",
	USER: "someone",
	SSH_AUTH_SOCK: "/tmp/someone/agent.sock",
	TYPESAFE_API_KEY: "not-a-key",
	GH_TOKEN: "not-a-token",
	SOME_SERVICE_SECRET: "not-a-secret",
	EDITOR: "vi",
};

const RUN = {PATH: "/bin", HOME: "/home/someone", TMPDIR: "/tmp/someone", LANG: "en_US.UTF-8"};

describe("the environment a started process is handed", () => {
	it("is what a program needs to run, for code a ticket or an agent wrote", () => {
		expect(runEnv(PARENT)).toEqual(RUN);
	});

	it("adds the agent's own login for an agent, wherever that login is kept", () => {
		expect(agentEnv(PARENT)).toEqual({...RUN, USER: "someone"});
		expect(
			agentEnv({
				...PARENT,
				ANTHROPIC_API_KEY: "a",
				CLAUDE_CODE_OAUTH_TOKEN: "b",
				CLAUDE_CONFIG_DIR: "c",
			}),
		).toEqual({
			...RUN,
			USER: "someone",
			ANTHROPIC_API_KEY: "a",
			CLAUDE_CODE_OAUTH_TOKEN: "b",
			CLAUDE_CONFIG_DIR: "c",
		});
	});

	it("adds where git finds its key for a shell, and for nothing else", () => {
		expect(shellEnv(PARENT)).toEqual({
			...RUN,
			USER: "someone",
			SSH_AUTH_SOCK: "/tmp/someone/agent.sock",
		});
		expect(agentEnv(PARENT)).not.toHaveProperty("SSH_AUTH_SOCK");
		expect(runEnv(PARENT)).not.toHaveProperty("SSH_AUTH_SOCK");
	});

	it("never holds the Jev key, or any other variable it does not name", () => {
		for (const env of [runEnv(PARENT), agentEnv(PARENT), shellEnv(PARENT)]) {
			expect(env).not.toHaveProperty("TYPESAFE_API_KEY");
			expect(env).not.toHaveProperty("GH_TOKEN");
			expect(env).not.toHaveProperty("SOME_SERVICE_SECRET");
			expect(env).not.toHaveProperty("EDITOR");
		}
	});

	it("adds gh's login and git's key for code's own git and gh, and never the Jev key", () => {
		expect(hostEnv(PARENT)).toEqual({
			...RUN,
			USER: "someone",
			GH_TOKEN: "not-a-token",
			SSH_AUTH_SOCK: "/tmp/someone/agent.sock",
		});
		expect(hostEnv(PARENT)).not.toHaveProperty("TYPESAFE_API_KEY");
		expect(hostEnv(PARENT)).not.toHaveProperty("SOME_SERVICE_SECRET");
		// An agent's is never a host's: it holds no gh login.
		expect(agentEnv(PARENT)).not.toHaveProperty("GH_TOKEN");
	});

	it("leaves a name out when the parent does not set it, and never hands it on empty", () => {
		expect(shellEnv({PATH: "/bin", HOME: undefined})).toEqual({PATH: "/bin"});
		expect(Object.keys(runEnv({}))).toEqual([]);
	});

	it("is what a real child process sees: the marker of its parent does not reach it", () => {
		const parent = {...process.env, TEA_FABRIKA_MARKER: "set", TYPESAFE_API_KEY: "not-a-key"};
		const names = (env: NodeJS.ProcessEnv): string[] =>
			JSON.parse(
				execFileSync(
					process.execPath,
					["-e", "console.log(JSON.stringify(Object.keys(process.env)))"],
					{
						env,
						encoding: "utf8",
					},
				),
			);

		// The same child, handed everything, does see it: the test can tell the two apart.
		expect(names(parent)).toContain("TEA_FABRIKA_MARKER");
		for (const env of [runEnv(parent), agentEnv(parent), shellEnv(parent)]) {
			expect(names(env)).toContain("PATH");
			expect(names(env)).not.toContain("TEA_FABRIKA_MARKER");
			expect(names(env)).not.toContain("TYPESAFE_API_KEY");
		}
	});
});
