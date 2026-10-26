// Experiment 148's stand-in for an agent run: one call to the model, from inside a box. It has
// no key and sends none. The call goes to http://model.internal, which only the box's catch
// answers: a Worker outside puts the key of the person who started the job on it.
//
//   node /app/ask.mjs hello
//   standin answered github:1
const q = process.argv.slice(2).join(" ") || "hello";
const res = await fetch("http://model.internal/v1/messages", {
	method: "POST",
	headers: {
		"content-type": "application/json",
		"anthropic-version": "2023-06-01",
		// What a box might send to pass as someone: the relay drops it.
		authorization: "Bearer placeholder",
	},
	signal: AbortSignal.timeout(30000),
	body: JSON.stringify({
		model: "claude-haiku-4-5",
		max_tokens: 64,
		messages: [{role: "user", content: q}],
	}),
});
if (!res.ok) {
	console.log(`ask failed: ${res.status} ${await res.text()}`);
	process.exit(1);
}
const body = await res.json();
console.log(body.content.map((c) => c.text).join(""));
