// How a stage names the pull request a span is about: by OpenTelemetry's
// version-control names, the repository's url and the change's number. The
// url is an address anyone can read; nothing of the pull request's text is
// ever put on a span.

/** The attributes of a span about one pull request. A url that is not one gives none. */
export const prAttributes = (url: string): Readonly<Record<string, string>> => {
	const found = /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(url);
	if (found === null) return {};
	const [, repo = "", number = ""] = found;
	return {"vcs.repository.url.full": repo, "vcs.change.id": number};
};
