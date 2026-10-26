// Experiment 148's network check, from inside a box: which hosts answer? A box that carries its
// starter's Claude token should reach api.anthropic.com and nothing else. It sends no token: it
// asks each place once, with no credential, and prints what came back.
//
//   node /app/net.mjs
//   {"https://api.anthropic.com/":"404", "https://example.com/":"refused: ...", ...}
import {connect} from "node:net";

const places = [
	"https://api.anthropic.com/",
	"https://example.com/",
	"http://example.com/",
	"https://claude.ai/",
	"https://statsig.anthropic.com/",
	"https://1.1.1.1/",
];
const said = {};
for (const url of places) {
	try {
		const res = await fetch(url, {signal: AbortSignal.timeout(4000)});
		said[url] = String(res.status);
	} catch (e) {
		said[url] = `refused: ${e.cause?.code ?? e.cause?.message ?? e.message}`;
	}
}
// A raw connection to a port the catches do not cover.
said["tcp 1.1.1.1:53"] = await new Promise((r) => {
	const s = connect({host: "1.1.1.1", port: 53, timeout: 4000});
	s.on("connect", () => {
		s.destroy();
		r("open");
	});
	s.on("timeout", () => {
		s.destroy();
		r("refused: timeout");
	});
	s.on("error", (e) => r(`refused: ${e.code ?? e.message}`));
});
console.log(JSON.stringify(said));
