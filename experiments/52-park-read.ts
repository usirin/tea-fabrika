// What would the machine have read? The operator asks a person about a park
// by posting a question on the issue (src/turn.ts, `parkAsk`), and reads the
// reply with the `park_read` Judge. In experiment 52 the park was cleared
// another way before any reply was read, so this asks the same Judge about
// the same texts, once per reply, and writes nothing anywhere.
//
//   ISSUE=<issue url>  WHO=<login>,<login>  TYPESAFE_API_KEY=...  node experiments/52-park-read.ts
//
// It finds the machine's question on the issue by its hidden mark, takes
// each later comment by someone on the list that is not a machine's, and
// prints how the reply would have been read: by code when it names a choice
// (`/resume`), by Jev otherwise, with the confidence and the floor. A reply
// is named by its link and its length, never by its words.
//
//   QUESTION=<text> REPLY=<text>   ask about these two texts instead, to check the wiring

import {execFileSync} from "node:child_process";
import {JEV_ENDPOINT} from "@demlik/tea/jev";
import {Effect} from "effect";
import {liveJev} from "../src/local.ts";
import {knobsOf} from "../src/operator-host.ts";
import {isMachines} from "../src/operator-live.ts";
import {parkAsk} from "../src/turn.ts";

const key = process.env.TYPESAFE_API_KEY;
if (!key) throw new Error("TYPESAFE_API_KEY is not set");
const {who, askFloor} = knobsOf(process.env);

interface Comment {
	readonly html_url: string;
	readonly created_at: string;
	readonly body: string;
	readonly user: {readonly login: string};
}

/** The texts to read: the question, and each reply with a name to print for it. */
function texts(): {
	readonly question: string;
	readonly replies: readonly {readonly name: string; readonly body: string}[];
} {
	const {QUESTION, REPLY, ISSUE} = process.env;
	if (QUESTION && REPLY)
		return {question: QUESTION, replies: [{name: "the REPLY given", body: REPLY}]};
	const at = /github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/.exec(ISSUE ?? "");
	if (at === null) throw new Error("ISSUE is not an issue URL");
	const out = execFileSync(
		"gh",
		["api", "--paginate", "--slurp", `repos/${at[1]}/issues/${at[2]}/comments?per_page=100`],
		{encoding: "utf8"},
	);
	const all = (JSON.parse(out) as Comment[][]).flat();
	const asked = all.findLast((c) => /<!-- tea-fabrika \S+\/ask\/\d+ -->/.test(c.body));
	if (asked === undefined) throw new Error("the issue holds no question from the machine");
	console.log(`question: ${asked.html_url}`);
	// The machine's Judge is shown the question without the choices under it or the hidden mark.
	const question = asked.body.split("\n\nAnswer in words, or with one of these:")[0] as string;
	const replies = all
		.filter(
			(c) =>
				c.created_at > asked.created_at &&
				!isMachines(c.body) &&
				who.includes(c.user.login.toLowerCase()),
		)
		.map((c) => ({
			name: `${c.html_url} (${c.user.login}, ${c.body.length} characters)`,
			body: c.body,
		}));
	return {question, replies};
}

const {question, replies} = texts();
if (replies.length === 0) console.log(`no reply since the question from ${who.join(", ")}`);
for (const reply of replies) {
	const named = /^\s*\/([a-z_]+)\b/.exec(reply.body)?.[1];
	if (named !== undefined && (parkAsk.judge.choices as readonly string[]).includes(named)) {
		console.log(`${reply.name}: \`${named}\`, read by code, no Jev call`);
		continue;
	}
	const started = Date.now();
	const judged = await Effect.runPromise(
		parkAsk.judge
			.handle("jev-latest")(parkAsk.judge.ask({key: "issue", texts: {question, reply: reply.body}}))
			.pipe(
				Effect.match({onSuccess: (answer) => answer, onFailure: () => null}),
				Effect.provide(liveJev(key, JEV_ENDPOINT)),
			),
	);
	if (judged === null) {
		console.log(
			`${reply.name}: Jev could not be asked; the machine would set the reply aside and wait on`,
		);
		continue;
	}
	const ruled = parkAsk.judge.rule(judged, askFloor);
	const ms = Date.now() - started;
	console.log(
		`${reply.name}: \`${judged.choice}\` at ${judged.confidence.toFixed(2)} (floor ${askFloor}, ${ms} ms): ${
			ruled.sure
				? "the machine would act on it"
				: "below the floor, so the machine would set it aside and wait on"
		}`,
	);
}
