// Experiment 148's view of the account, through Cloudflare's own API: what a run made, listed and
// deleted by its prefix only. Shared by the live box round (live-box.ts) and the egress round
// (egress.ts). Nothing here names, or counts by name, anything without the prefix.
export const PREFIX = "tf-exp-148";
const REGISTRY = "registry.cloudflare.com";

type App = {id: string; name: string};

export const cloudOf = (account: string, token: string) => {
	const cf = async (path: string, method = "GET", body?: unknown) => {
		const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body === undefined ? {} : {"content-type": "application/json"}),
			},
			...(body === undefined ? {} : {body: JSON.stringify(body)}),
		});
		const text = await res.text();
		try {
			return {status: res.status, ...(JSON.parse(text) as {success: boolean; result: unknown})};
		} catch {
			return {status: res.status, success: false, result: null};
		}
	};
	const apps = async () =>
		(((await cf("/containers/applications")).result ?? []) as App[]).filter((a) =>
			a.name.startsWith(PREFIX),
		);
	/** The registry, as wrangler's `containers images` reads it: a short-lived login, then the catalog. */
	const registry = async () => {
		const creds = (
			await cf(`/containers/registries/${REGISTRY}/credentials`, "POST", {
				expiration_minutes: 5,
				permissions: ["pull", "push"],
			})
		).result as {username?: string; user?: string; password?: string} | null;
		if (!creds?.password) return null;
		const auth = `Basic ${Buffer.from(`${creds.username ?? creds.user ?? "v1"}:${creds.password}`).toString("base64")}`;
		const res = await fetch(`https://${REGISTRY}/v2/_catalog?tags=true`, {
			headers: {authorization: auth},
		});
		const repos = res.ok
			? (((await res.json()) as {repositories?: Record<string, string[]>}).repositories ?? {})
			: {};
		const strip = (r: string) => r.replace(/^\/+/, "").replace(`${account}/`, "");
		const mine = Object.entries(repos)
			.filter(([r]) => strip(r).startsWith(PREFIX))
			.map(([r, tags]) => ({repo: strip(r), tags}));
		return {auth, status: res.status, mine, others: Object.keys(repos).length - mine.length};
	};
	const instances = async (app: App) => {
		const r = await cf(`/containers/dash/applications/${app.id}/instances`);
		const rows = (
			Array.isArray(r.result) ? r.result : ((r.result as {instances?: unknown[]})?.instances ?? [])
		) as Record<string, unknown>[];
		return {
			status: r.status,
			// The answer's shape, in names only: this endpoint is the dashboard's, not documented.
			shape: Array.isArray(r.result) ? "array" : Object.keys(r.result ?? {}).join(","),
			count: rows.length,
			states: rows.map((i) => i.state ?? i.status ?? i.current_state ?? Object.keys(i).join("|")),
		};
	};
	const ours = async () => {
		const scripts = (((await cf("/workers/scripts")).result ?? []) as {id: string}[]).map(
			(s) => s.id,
		);
		const spaces = ((await cf("/workers/durable_objects/namespaces?per_page=1000")).result ??
			[]) as {
			script: string | null;
			name: string;
		}[];
		const ns = (n: {script: string | null; name: string}) => n.script ?? n.name ?? "";
		const reg = await registry();
		return {
			scripts: scripts.filter((s) => s.startsWith(PREFIX)),
			namespaces: spaces.filter((n) => ns(n).startsWith(PREFIX)).map((n) => n.name),
			containerApps: (await apps()).map((a) => a.name),
			images: reg?.mine ?? "registry login failed",
			otherScripts: scripts.filter((s) => !s.startsWith(PREFIX)).length,
			otherNamespaces: spaces.filter((n) => !ns(n).startsWith(PREFIX)).length,
			otherRepos: reg?.others ?? null,
		};
	};
	const sweepImages = async (reg: Awaited<ReturnType<typeof registry>>, swept: string[]) => {
		for (const {repo, tags} of reg?.mine ?? []) {
			if (!repo.startsWith(PREFIX)) continue;
			for (const tag of tags) {
				const url = `https://${REGISTRY}/v2/${account}/${repo}/manifests/${tag}`;
				const accept =
					"application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json";
				const head = await fetch(url, {
					method: "HEAD",
					headers: {authorization: reg?.auth ?? "", accept},
				});
				const del = await fetch(url, {
					method: "DELETE",
					headers: {authorization: reg?.auth ?? "", accept},
				});
				const why = del.ok ? "" : ` ${(await del.text()).slice(0, 300)}`;
				swept.push(`image ${repo}:${tag}: head ${head.status}, delete ${del.status}${why}`);
			}
		}
		if ((reg?.mine.length ?? 0) > 0) {
			const gc = await fetch(`https://${REGISTRY}/v2/gc/layers`, {
				method: "PUT",
				headers: {authorization: reg?.auth ?? "", "content-type": "application/json"},
			});
			swept.push(`registry gc: ${gc.status}`);
		}
		return swept;
	};
	/** Delete by hand anything named tf-exp-148 that Alchemy left, found by listing, by prefix only. */
	const sweep = async () => {
		const swept: string[] = [];
		for (const a of await apps()) {
			if (!a.name.startsWith(PREFIX)) continue;
			swept.push(
				`app ${a.name}: ${(await cf(`/containers/applications/${a.id}`, "DELETE")).status}`,
			);
		}
		const found = await ours();
		for (const s of found.scripts) {
			if (!s.startsWith(PREFIX)) continue;
			swept.push(
				`script ${s}: ${(await cf(`/workers/scripts/${s}?force=true`, "DELETE")).success}`,
			);
		}
		// Images: a tag first, then the manifests under it, so a few passes. A manifest an index
		// still points at answers 409 until the index is gone.
		for (let pass = 0; pass < 3; pass++) {
			const reg = await registry();
			if ((reg?.mine.length ?? 0) === 0) break;
			await sweepImages(reg, swept);
		}
		return swept;
	};
	return {cf, apps, instances, ours, sweep};
};
