import {describe, expect, it} from "vitest";
import {AGENTS_MD, NO_PROJECT_CONFIG, ownRules} from "./rules.ts";

describe("a run that reads the folder's own rules", () => {
	it("loads the project's rule files, its settings from the empty folder, AGENTS.md beside CLAUDE.md", () => {
		expect(ownRules({disableClaudeAiConnectors: true})).toEqual({
			settingSources: ["project"],
			projectConfigRoot: "/var/empty",
			settings: {
				disableClaudeAiConnectors: true,
				pluginConfigs: {
					"cc-plugin-agents-md@builtin": {options: {instructionFiles: "claude-md-and-agents-md"}},
				},
			},
		});
	});

	it("never loads the user's or the local settings", () => {
		expect(ownRules({}).settingSources).toEqual(["project"]);
	});

	it("the run's own settings cannot drop the AGENTS.md option", () => {
		expect(ownRules({pluginConfigs: {}}).settings.pluginConfigs).toBe(AGENTS_MD);
		expect(NO_PROJECT_CONFIG).toBe("/var/empty");
	});
});
