import {Schema} from "effect";
import {createRemoteJWKSet, jwtVerify} from "jose";

const Https = Schema.String.check(
	Schema.makeFilter((value) => {
		const url = URL.parse(value);
		return url !== null && url.protocol === "https:" && url.origin === value;
	}),
);
const Configuration = Schema.Struct({
	origin: Https,
	issuer: Https,
	audience: Schema.String.check(Schema.isNonEmpty()),
	owners: Schema.Record(Schema.String, Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))),
});
type Configuration = typeof Configuration.Type;
const Identity = Schema.Struct({email: Schema.String});
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export const configuration = (env: {
	FABRIKA_ORIGIN: string;
	ACCESS_ISSUER: string;
	ACCESS_AUD: string;
	FABRIKA_OWNERS: string;
}) => {
	const config = Schema.decodeUnknownSync(Configuration)({
		origin: env.FABRIKA_ORIGIN,
		issuer: env.ACCESS_ISSUER,
		audience: env.ACCESS_AUD,
		owners: Schema.decodeUnknownSync(
			Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
		)(env.FABRIKA_OWNERS),
	});
	const entries = Object.entries(config.owners);
	if (
		entries.length !== 2 ||
		new Set(entries.map(([, owner]) => owner)).size !== 2 ||
		entries.some(([email]) => !/^[^\s@]+@[^\s@]+$/.test(email))
	)
		throw Error("Configure two approved owners with distinct private desk IDs.");
	return config;
};
export async function identity(token: string, config: Configuration) {
	let key = keys.get(config.issuer);
	if (!key) {
		key = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", config.issuer));
		keys.set(config.issuer, key);
	}
	const {payload} = await jwtVerify(token, key, {
		issuer: config.issuer,
		audience: config.audience,
		algorithms: ["RS256"],
		requiredClaims: ["exp", "sub", "email"],
	});
	return Schema.decodeUnknownSync(Identity)(payload);
}
export const allowedRequest = (request: Request, origin: string) => {
	const url = new URL(request.url);
	const supplied = request.headers.get("origin");
	const changing =
		!["GET", "HEAD"].includes(request.method) ||
		request.headers.get("upgrade")?.toLowerCase() === "websocket";
	return (
		url.origin === origin &&
		url.pathname.startsWith("/fabrika/") &&
		(!supplied || supplied === origin) &&
		(!changing || supplied === origin)
	);
};
export const forwarded = (request: Request) => {
	const headers = new Headers(request.headers);
	for (const name of [...headers.keys()])
		if (
			name.startsWith("cf-access-") ||
			["cookie", "authorization", "x-fabrika-gateway", "x-fabrika-owner"].includes(name)
		)
			headers.delete(name);
	return new Request(request, {headers});
};
