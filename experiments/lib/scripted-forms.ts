// Forms a scripted reviewer hands back, worked out from the brief alone, so
// two pieces of code handed the same brief get the same form. Experiment 65
// gives the same two to the old review piece and to the review program.
//
// Types only from the review stage: this file is also loaded by code that
// runs from an older commit of this repo.
import type {Brief} from "@kampus/fabrika/pipeline/stages/review/gate";
import type {Form} from "@kampus/fabrika/pipeline/stages/review/sheet";

export type FormName = "pass" | "fail";

/** Every row passes, no finding. */
export const passForm = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass",
		where: [{file: brief.files[0]?.path ?? "README.md", first: 1, last: 1}],
		says: "Scripted: it does.",
		limit: null,
	})),
	findings: [],
	skipped: [{what: "Everything", why: "A scripted reviewer reads nothing."}],
});

/** The last row fails with a finding of the first kind owed, and a standing check of the same kind finds one more. */
export const failForm = (brief: Brief): Form => {
	const last = brief.criteria[brief.criteria.length - 1]?.n ?? 1;
	const kind = brief.kinds[0] ?? "review-code";
	const base = passForm(brief);
	return {
		...base,
		rows: base.rows.map((row) =>
			row.n === last ? {n: last, grade: "fail", where: [], says: "Scripted: it does not."} : row,
		),
		findings: [
			{
				kind,
				from: {source: "criterion", n: last},
				fault: `Scripted: criterion ${last} is not met.`,
				at: null,
				proof: "Scripted.",
				wants: `Criterion ${last} is met.`,
			},
			{
				kind,
				from: {source: "check", name: "tests-prove-it"},
				fault: "Scripted: no test fails without the change.",
				at: null,
				proof: "Scripted.",
				wants: "A test that fails at the base.",
			},
		],
	};
};

export const FORMS: Readonly<Record<FormName, (brief: Brief) => Form>> = {
	pass: passForm,
	fail: failForm,
};
