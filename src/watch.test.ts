import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import {msgsOf, type Run, type Watch, type WatchMsg, watch} from "./watch.ts";

const run: Run = {
	id: "r1",
	prompt: "Implement parseDuration.",
	session: "00000000-0000-4000-8000-000000000001",
	rules: {allowed: ["duration.js"], repeats: 3},
};

const step = (s: Watch, msg: WatchMsg): Watch =>
	applyCell<Watch, WatchMsg, never>(watch, s, msg)[0];
const fold = (msgs: readonly WatchMsg[]): Watch => msgs.reduce(step, {phase: "idle"} as Watch);

const bash = (id: string, command: string): WatchMsg => ({
	type: "tool_called",
	id,
	tool: "Bash",
	file: null,
	command,
});
const read = (id: string, file: string): WatchMsg => ({
	type: "tool_called",
	id,
	tool: "Read",
	file,
	command: null,
});
const edit = (id: string, file: string): WatchMsg => ({
	type: "tool_called",
	id,
	tool: "Edit",
	file,
	command: null,
});
const back = (id: string, failed: boolean): WatchMsg => ({type: "tool_returned", id, failed});

/** The Sub's deps in a state: null means the engine closes the query. */
const agentDeps = (s: Watch) => watch.subs?.[0]?.deps(s);

describe("the watch's judge", () => {
	it("stops a run that asks to edit a file outside the allowed list, before the edit runs", () => {
		const s = fold([
			{type: "start", run},
			edit("a", "duration.js"),
			back("a", false),
			edit("b", "README.md"),
		]);
		expect(s.phase).toBe("stopped");
		if (s.phase !== "stopped") return;
		expect(s.verdict).toEqual({kind: "outside_allowed", file: "README.md"});
		expect(s.picture.touched).toEqual(["duration.js", "README.md"]);
		expect(agentDeps(s)).toBeNull();
	});

	it("lets reads of any file and edits of allowed ones go on", () => {
		const s = fold([
			{type: "start", run},
			read("a", "README.md"),
			back("a", false),
			edit("b", "duration.js"),
		]);
		expect(s.phase).toBe("running");
		expect(s.phase === "running" && s.picture.touched).toEqual(["duration.js"]);
		expect(agentDeps(s)).toEqual({id: "r1", prompt: run.prompt, session: run.session});
	});

	it("stops the third failure in a row of the same command, reads in between or not", () => {
		const s = fold([
			{type: "start", run},
			bash("a", "node --test"),
			back("a", true),
			read("b", "duration.js"),
			back("b", false),
			bash("c", "node --test"),
			back("c", true),
			bash("d", "node --test"),
			back("d", true),
		]);
		expect(s.phase === "stopped" && s.verdict).toEqual({
			kind: "repeated_failure",
			command: "node --test",
			times: 3,
		});
	});

	it("starts the count over when the command passes or changes", () => {
		const s = fold([
			{type: "start", run},
			bash("a", "node --test"),
			back("a", true),
			bash("b", "node --test"),
			back("b", true),
			bash("c", "node --test"),
			back("c", false),
			bash("d", "node --test"),
			back("d", true),
			bash("e", "node -e 1"),
			back("e", true),
			bash("f", "node --test"),
			back("f", true),
		]);
		expect(s.phase).toBe("running");
		if (s.phase !== "running") return;
		expect(s.picture.streak).toEqual({command: "node --test", failures: 1});
		expect(s.picture.commands).toHaveLength(6);
	});

	it("ignores what the stream says after the run is stopped", () => {
		const stopped = fold([{type: "start", run}, edit("a", "notes.md")]);
		expect(step(stopped, back("a", false))).toBe(stopped);
	});
});

describe("msgsOf", () => {
	it("reads a tool call's file relative to the folder, and a result's error flag", () => {
		const call = msgsOf(
			{
				type: "assistant",
				parent_tool_use_id: null,
				uuid: "00000000-0000-4000-8000-000000000002",
				session_id: "s",
				message: {
					content: [
						{
							type: "tool_use",
							id: "t1",
							name: "Write",
							input: {file_path: "/w/toy/notes.md", content: ""},
						},
					],
				},
			} as never,
			"/w/toy",
		);
		expect(call).toEqual([
			{type: "tool_called", id: "t1", tool: "Write", file: "notes.md", command: null},
		]);
		const result = msgsOf(
			{
				type: "user",
				parent_tool_use_id: null,
				session_id: "s",
				message: {
					role: "user",
					content: [
						{type: "tool_result", tool_use_id: "t1", is_error: true, content: "Exit code 1"},
					],
				},
			} as never,
			"/w/toy",
		);
		expect(result).toEqual([{type: "tool_returned", id: "t1", failed: true}]);
	});
});
