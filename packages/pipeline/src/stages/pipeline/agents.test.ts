import {jsonSchema} from "@kampus/fabrika-old/agents/claude";
import {strictOk} from "@kampus/fabrika-old/agents/codex";
import {describe, expect, it} from "vitest";
import {Built} from "../build/form.ts";
import {ExamWritten} from "../exam/machine.ts";
import {PlanDraft} from "../plan/plan.ts";
import {Form} from "../review/sheet.ts";
import {SortReply} from "../sort/answer.ts";
import {Answered} from "../test-writer/mutants.ts";
import {Written} from "../test-writer/written.ts";

// Today's version. A schema that strict mode would refuse is not handed to Codex at all, and the agent
// is only asked in words. So each answer a lane's agent gives has to pass, or its step gets no
// `--output-schema`.

describe("the answer schema of every step that runs an agent", () => {
	const SCHEMAS = [
		["triage", jsonSchema(SortReply)],
		["plan", jsonSchema(PlanDraft)],
		["exam", jsonSchema(ExamWritten)],
		["test writer", jsonSchema(Written)],
		["mutants", jsonSchema(Answered)],
		["build", jsonSchema(Built)],
		["review", jsonSchema(Form)],
	] as const;

	it("passes strict mode, so every step gets --output-schema", () => {
		const refused = SCHEMAS.filter(([, schema]) => !strictOk(schema)).map(([step]) => step);
		expect(refused).toEqual([]);
	});
});
