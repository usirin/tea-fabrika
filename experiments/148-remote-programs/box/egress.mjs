// Experiment 148's egress check, from inside a box started by `@cloudflare/containers` with an
// allow list (egress-worker.ts). It serves on 8080; each GET runs every try once, sends no
// credential, and answers what came back. `ip` is an address of api.anthropic.com, found by the
// driver, since the box may have no DNS of its own.
//
//   node /app/egress.mjs                  GET http://box:8080/?ip=160.79.104.10
//   {"https://api.anthropic.com/": {"status": "404"}, "tls api.anthropic.com": {"issuer": "..."}, ...}

import {lookup} from "node:dns/promises";
import {existsSync, readdirSync} from "node:fs";
import {createServer} from "node:http";
import {connect as tcp} from "node:net";
import {connect as tls} from "node:tls";

const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const MS = 5000;
const why = (e) => `refused: ${e?.cause?.code ?? e?.code ?? e?.cause?.message ?? e?.message ?? e}`;

const get = async (url) => {
	try {
		const res = await fetch(url, {signal: AbortSignal.timeout(MS)});
		return {status: String(res.status)};
	} catch (e) {
		return {status: why(e)};
	}
};
/** A TLS handshake only, no request: who signed the certificate the box was shown. */
const hello = (host, servername) =>
	new Promise((r) => {
		const s = tls({host, port: 443, servername, rejectUnauthorized: false, timeout: MS});
		const end = (v) => {
			s.destroy();
			r(v);
		};
		s.on("secureConnect", () => {
			const c = s.getPeerCertificate();
			end({
				issuer: [c.issuer?.O, c.issuer?.CN].filter(Boolean).join(" / "),
				subject: c.subject?.CN ?? "",
				trusted: s.authorized,
			});
		});
		s.on("timeout", () => end({issuer: "refused: timeout"}));
		s.on("error", (e) => end({issuer: why(e)}));
	});
const open = (host, port) =>
	new Promise((r) => {
		const s = tcp({host, port, timeout: MS});
		s.on("connect", () => {
			s.destroy();
			r("open");
		});
		s.on("timeout", () => {
			s.destroy();
			r("refused: timeout");
		});
		s.on("error", (e) => r(why(e)));
	});
const dns = async (host) => {
	try {
		return (await lookup(host, {all: true})).length > 0 ? "resolved" : "none";
	} catch (e) {
		return why(e);
	}
};

/** Every try at once, so a refusal by timeout costs 5 s in all, not 5 s each. */
const tries = async (ip) => {
	const all = {
		"https://api.anthropic.com/": get("https://api.anthropic.com/"),
		"tls api.anthropic.com": hello("api.anthropic.com", "api.anthropic.com"),
		"https://example.com/": get("https://example.com/"),
		"https://www.google.com/": get("https://www.google.com/"),
		"http://example.com/": get("http://example.com/"),
		"tls 1.1.1.1, no name": hello("1.1.1.1", undefined),
		"tcp 1.1.1.1:443": open("1.1.1.1", 443),
		"tcp 1.1.1.1:53": open("1.1.1.1", 53),
		"tls anthropic ip, name example.com": ip ? hello(ip, "example.com") : "no ip",
		"tls anthropic ip, name api.anthropic.com": ip ? hello(ip, "api.anthropic.com") : "no ip",
		"tcp anthropic ip:443": ip ? open(ip, 443) : "no ip",
		"dns api.anthropic.com": dns("api.anthropic.com"),
		"dns example.com": dns("example.com"),
	};
	const out = {};
	for (const [k, v] of Object.entries(all)) out[k] = await v;
	out["ca file"] = existsSync(CA) ? "yes" : "no";
	out["/etc/cloudflare"] = existsSync("/etc/cloudflare") ? readdirSync("/etc/cloudflare") : "none";
	return out;
};

createServer(async (req, res) => {
	const ip = new URL(req.url ?? "/", "http://box").searchParams.get("ip") ?? "";
	const out = await tries(/^[0-9.]+$/.test(ip) ? ip : "");
	res.writeHead(200, {"content-type": "application/json"});
	res.end(JSON.stringify(out));
}).listen(8080);
