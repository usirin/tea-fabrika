// Experiment 148's stand-in for the model: it answers /v1/messages for a made-up key it knows,
// and says whose key it was, so a run shows whose key went out. No real model is ever called.
//
//   FAKE_KEYS='{"fake-key-<32 hex>":"github:1"}' node standin.ts <port>
//   POST /v1/messages  x-api-key: fake-key-...   ->  {content: [{type: "text", text: "standin answered github:1"}]}
//   GET  /log                                    ->  each call: whose key, and which headers came (names only)
//
// Node at the edge, said here: node:http, as the smallest server there is.
import {createServer} from "node:http";

const keys = JSON.parse(process.env.FAKE_KEYS ?? "{}") as Record<string, string>;
const log: {who: string | null; headers: string[]; authorization: boolean}[] = [];

const server = createServer((req, res) => {
	if (req.url === "/log") {
		res.writeHead(200, {"content-type": "application/json"});
		res.end(JSON.stringify(log));
		return;
	}
	const key = String(req.headers["x-api-key"] ?? "");
	const who = keys[key] ?? null;
	log.push({
		who,
		headers: Object.keys(req.headers).sort(),
		authorization: req.headers.authorization !== undefined,
	});
	req.resume();
	if (who === null) {
		res.writeHead(401, {"content-type": "application/json"});
		res.end(JSON.stringify({error: "unknown key"}));
		return;
	}
	res.writeHead(200, {"content-type": "application/json"});
	res.end(JSON.stringify({content: [{type: "text", text: `standin answered ${who}`}]}));
});
server.listen(Number(process.argv[2] ?? "8799"), "127.0.0.1", () => {
	console.log("standin listening");
});
