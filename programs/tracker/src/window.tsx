import type {WindowProps} from "@kampus/fabrika";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import type {Do, PullRequest, Show, Shown, Summary, Ticket, tracker, Write} from "./index.ts";
import {piecesOf} from "./links.ts";

// The tracker's window: plain React, keyboard first. It draws the view it is handed and sends
// `do`. All it keeps is what a person is typing and which row is picked, so a half-written
// ticket or comment survives a look at another page. Which tickets show, and the search, are the
// machine's (`show`, `find`): this window only draws them and says when they change.
//
//   the list     ↑ ↓ or j k pick a row, Enter opens it, c goes to the new ticket's title,
//                o x a show open, closed or all tickets, / goes to the search, q quits
//   the search   typing narrows tickets and pull requests by title; Esc or ↓ goes to the list
//   new ticket   Enter in the title goes to the body; Ctrl+Enter (⌘+Enter) files; Esc goes to the list
//   a ticket     the comment box has the focus; Ctrl+Enter comments; Esc goes back to the list
//
// A URL in a body, and a pull request on the list, is a link. It opens a new window,
// `target="_blank"`, which the app never makes: it hands an http or https URL to the person's own
// browser instead.

type Send = (d: Do) => void;

/** A write in words, for "saving" and "not saved". */
const said = (w: Write): string => {
	switch (w.kind) {
		case "file":
			return `new ticket "${w.title}"`;
		case "comment":
			return `comment on #${w.ticket}`;
		case "close":
			return `close #${w.ticket}`;
		case "reopen":
			return `reopen #${w.ticket}`;
	}
};

/** When, in a few words: the time today, else the day too, and the year when it is not this one. */
export const whenOf = (at: number, now: number): string => {
	const then = new Date(at);
	const today = new Date(now);
	const time = then.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});
	if (then.toDateString() === today.toDateString()) return time;
	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
	if (then.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
	const day = then.toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		...(then.getFullYear() === today.getFullYear() ? {} : {year: "numeric"}),
	});
	return `${day} ${time}`;
};

const isSubmit = (e: KeyboardEvent) => e.key === "Enter" && (e.ctrlKey || e.metaKey);

/** A row on the list, by what it is: a ticket by its number, a pull request by its link. */
const ticketRow = (n: number) => `ticket:${n}`;
const prRow = (pr: PullRequest) => `pr:${pr.url}`;

/** A repository's short name: the last part of its link. */
const shortOf = (repo: string): string => repo.split("/").filter(Boolean).at(-1) ?? repo;

export function TrackerWindow({view, send}: WindowProps<typeof tracker>) {
	const act: Send = (value) => send({type: "do", value});
	const [picked, setPicked] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [find, setFind] = useState(view.filter.find);
	const [comments, setComments] = useState<Readonly<Record<number, string>>>({});
	const {page} = view;
	return (
		<section className="tracker" aria-label="tracker">
			<div className="tracker-column">
				<Notices view={view} />
				{!view.ready ? (
					<p className="tracker-quiet">Reading the ledger…</p>
				) : page.kind === "list" ? (
					<ListPage
						view={view}
						page={page}
						picked={picked}
						pick={setPicked}
						find={find}
						setFind={(text) => {
							setFind(text);
							act({kind: "find", text});
						}}
						draft={{title, body, setTitle, setBody}}
						act={act}
					/>
				) : (
					<TicketPage
						number={page.number}
						ticket={page.ticket}
						saving={view.saving}
						draft={comments[page.number] ?? ""}
						setDraft={(text) => setComments((all) => ({...all, [page.number]: text}))}
						act={act}
					/>
				)}
			</div>
		</section>
	);
}

function Notices({view}: {readonly view: Shown}) {
	const saving = view.saving.length;
	return (
		<>
			{view.unreachable === null ? null : (
				<p role="alert" className="tracker-alert">
					Could not read the ledger: {view.unreachable}
				</p>
			)}
			{view.failed === null ? null : (
				<div role="alert" className="tracker-alert">
					<p>
						Not saved: {said(view.failed.write)}. {view.failed.why}
					</p>
					{"body" in view.failed.write && view.failed.write.body !== "" ? (
						<pre>{view.failed.write.body}</pre>
					) : null}
				</div>
			)}
			{view.problems.length === 0 ? null : (
				<details className="tracker-problems">
					<summary>
						{view.problems.length} row{view.problems.length === 1 ? "" : "s"} on the ledger did not
						read
					</summary>
					<ul>
						{view.problems.map((p) => (
							<li key={p}>{p}</li>
						))}
					</ul>
				</details>
			)}
			<output className="tracker-saving" aria-label="saving">
				{view.quitting ? "Saving, then quitting…" : saving === 0 ? "" : `Saving ${saving}…`}
			</output>
		</>
	);
}

interface Draft {
	readonly title: string;
	readonly body: string;
	readonly setTitle: (t: string) => void;
	readonly setBody: (b: string) => void;
}

type ListView = Extract<Shown["page"], {kind: "list"}>;

const SHOWS: readonly {readonly show: Show; readonly label: string; readonly key: string}[] = [
	{show: "open", label: "Open", key: "o"},
	{show: "closed", label: "Closed", key: "x"},
	{show: "all", label: "All", key: "a"},
];

function ListPage(props: {
	readonly view: Shown;
	readonly page: ListView;
	readonly picked: string | null;
	readonly pick: (row: string) => void;
	readonly find: string;
	readonly setFind: (text: string) => void;
	readonly draft: Draft;
	readonly act: Send;
}) {
	const {view, page, pick, draft, act} = props;
	const {tickets, pullRequests, counts} = page;
	const pageRef = useRef<HTMLElement>(null);
	const titleRef = useRef<HTMLInputElement>(null);
	const bodyRef = useRef<HTMLTextAreaElement>(null);
	const findRef = useRef<HTMLInputElement>(null);
	const rows = useRef(new Map<string, HTMLElement>());
	// One list for the keys: the tickets, then the pull requests.
	const order = [...tickets.map((t) => ticketRow(t.number)), ...pullRequests.map(prRow)];
	const picked = order.find((r) => r === props.picked) ?? order[0];
	const counted = {open: counts.open, closed: counts.closed, all: counts.open + counts.closed};

	const toList = () => {
		if (picked === undefined) pageRef.current?.focus();
		else rows.current.get(picked)?.focus();
	};

	// Where the focus goes on coming to the list: the row picked, or the title when there is none.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on coming to the list, not on every new view.
	useEffect(() => {
		if (picked === undefined) titleRef.current?.focus();
		else rows.current.get(picked)?.focus();
	}, []);

	// A filter that hides the row in focus leaves the focus nowhere: it goes back to the list.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the rows shown change.
	useEffect(() => {
		const at = document.activeElement;
		if (at === null || at === document.body) toList();
	}, [order.join("\n")]);

	const file = (e?: FormEvent) => {
		e?.preventDefault();
		const t = draft.title.trim();
		if (t === "") return titleRef.current?.focus();
		act({kind: "file", title: t, body: draft.body.trimEnd()});
		draft.setTitle("");
		draft.setBody("");
		titleRef.current?.focus();
	};
	const onComposerKey = (e: KeyboardEvent<HTMLElement>) => {
		if (isSubmit(e)) {
			e.preventDefault();
			file();
		} else if (e.key === "Escape") {
			e.preventDefault();
			if (picked === undefined) e.currentTarget.blur();
			else rows.current.get(picked)?.focus();
		}
	};
	const move = (by: number) => {
		const at = order.indexOf(picked ?? "");
		const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
		if (next === undefined) return;
		pick(next);
		rows.current.get(next)?.focus();
	};
	const show = (s: Show) => act({kind: "show", show: s});
	/** The list's own keys, anywhere on the page but in a box being typed in. */
	const onListKey = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const target = e.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
		const keys: Readonly<Record<string, () => void>> = {
			ArrowDown: () => move(1),
			j: () => move(1),
			ArrowUp: () => move(-1),
			k: () => move(-1),
			c: () => titleRef.current?.focus(),
			"/": () => findRef.current?.focus(),
			o: () => show("open"),
			x: () => show("closed"),
			a: () => show("all"),
			q: () => act({kind: "quit"}),
		};
		const key = keys[e.key];
		if (key === undefined) return;
		e.preventDefault();
		key();
	};
	const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key !== "Escape" && e.key !== "ArrowDown" && e.key !== "Enter") return;
		e.preventDefault();
		toList();
	};
	const keep = (row: string) => (el: HTMLElement | null) => {
		if (el === null) rows.current.delete(row);
		else rows.current.set(row, el);
	};
	const searching = props.find.trim() !== "";

	return (
		// The list's keys are heard on the whole page, so they still work when a filter leaves no row.
		<section
			aria-label="list page"
			className="tracker-page"
			ref={pageRef}
			tabIndex={-1}
			onKeyDown={onListKey}
		>
			<div className="tracker-bar">
				<fieldset className="tracker-shows" aria-label="show">
					{SHOWS.map((s) => (
						<button
							key={s.show}
							type="button"
							aria-pressed={view.filter.show === s.show}
							title={`${s.label} tickets (${s.key})`}
							onClick={() => show(s.show)}
						>
							{s.label} <span className="tracker-count">{counted[s.show]}</span>
						</button>
					))}
				</fieldset>
				<label className="tracker-find">
					<SearchGlyph />
					<input
						ref={findRef}
						type="search"
						aria-label="search titles"
						placeholder="Search titles"
						value={props.find}
						maxLength={256}
						onChange={(e) => props.setFind(e.target.value)}
						onKeyDown={onFindKey}
						spellCheck={false}
						autoComplete="off"
					/>
					<kbd>/</kbd>
				</label>
			</div>
			<form className="tracker-composer" onSubmit={file} aria-label="new ticket">
				<input
					ref={titleRef}
					aria-label="new ticket title"
					placeholder="New ticket title"
					value={draft.title}
					maxLength={256}
					onChange={(e) => draft.setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !isSubmit(e)) {
							e.preventDefault();
							bodyRef.current?.focus();
						} else onComposerKey(e);
					}}
					spellCheck={false}
					autoComplete="off"
				/>
				{draft.title === "" && draft.body === "" ? null : (
					<>
						<textarea
							ref={bodyRef}
							aria-label="new ticket body"
							placeholder="Body, if it needs one"
							rows={draft.body === "" ? 2 : 5}
							value={draft.body}
							onChange={(e) => draft.setBody(e.target.value)}
							onKeyDown={onComposerKey}
						/>
						<div className="tracker-row">
							<small>
								<kbd>Ctrl</kbd> <kbd>Enter</kbd> files it
							</small>
							<button
								type="submit"
								className="tracker-primary"
								disabled={draft.title.trim() === ""}
							>
								File ticket
							</button>
						</div>
					</>
				)}
			</form>
			<div className="tracker-lists">
				{tickets.length === 0 ? (
					<p className="tracker-empty">{emptyOf(view.filter.show, searching, counts)}</p>
				) : (
					<ol className="tracker-list" aria-label="tickets">
						{tickets.map((t) => {
							const row = ticketRow(t.number);
							return (
								<li key={row}>
									<button
										type="button"
										ref={keep(row)}
										tabIndex={row === picked ? 0 : -1}
										aria-current={row === picked}
										onFocus={() => pick(row)}
										onClick={() => act({kind: "open", ticket: t.number})}
									>
										<StateGlyph state={t.state} />
										<span className="tracker-number">{t.number}</span>
										<span className="tracker-title">{t.title}</span>
										<span className="tracker-sub">
											{t.comments === 0 ? null : (
												<span title={`${t.comments} comment${t.comments === 1 ? "" : "s"}`}>
													<CommentGlyph /> {t.comments}
												</span>
											)}
											<time>{whenOf(t.at, Date.now())}</time>
										</span>
									</button>
								</li>
							);
						})}
					</ol>
				)}
				{view.filter.show === "closed" ? null : (
					<section className="tracker-pull-requests" aria-label="pull requests">
						<h3>
							Pull requests <span className="tracker-count">{counts.pullRequests}</span>
						</h3>
						{view.github.why === null ? null : (
							<p className="tracker-note">{view.github.why}. It tries again in a few minutes.</p>
						)}
						{!view.github.read ? (
							view.github.why === null ? (
								<p className="tracker-note">Reading pull requests…</p>
							) : null
						) : pullRequests.length === 0 ? (
							<p className="tracker-note">
								{searching ? "No pull request has that in its title." : "No open pull requests."}
							</p>
						) : (
							<ol className="tracker-list" aria-label="open pull requests">
								{pullRequests.map((pr) => {
									const row = prRow(pr);
									return (
										<li key={row}>
											<a
												className="tracker-pull-request"
												href={pr.url}
												target="_blank"
												rel="noreferrer"
												ref={keep(row)}
												tabIndex={row === picked ? 0 : -1}
												aria-current={row === picked}
												onFocus={() => pick(row)}
											>
												<PullRequestGlyph draft={pr.draft} />
												<span className="tracker-number">{pr.number}</span>
												<span className="tracker-title">
													{pr.title}
													{pr.draft ? <span className="tracker-draft">Draft</span> : null}
												</span>
												<span className="tracker-sub">
													<span>{shortOf(pr.repo)}</span>
													<time>{whenOf(pr.at, Date.now())}</time>
												</span>
											</a>
										</li>
									);
								})}
							</ol>
						)}
					</section>
				)}
			</div>
			<footer className="tracker-keys">
				<span>
					<kbd>j</kbd> <kbd>k</kbd> pick
				</span>
				<span>
					<kbd>Enter</kbd> open
				</span>
				<span>
					<kbd>o</kbd> <kbd>x</kbd> <kbd>a</kbd> open, closed, all
				</span>
				<span>
					<kbd>/</kbd> search
				</span>
				<span>
					<kbd>c</kbd> new ticket
				</span>
				<span>
					<kbd>q</kbd> quit
				</span>
			</footer>
		</section>
	);
}

/** What an empty list says: why it is empty, and what to do about it. */
const emptyOf = (
	show: Show,
	searching: boolean,
	counts: {readonly open: number; readonly closed: number},
): string => {
	if (searching) return "No ticket has that in its title.";
	if (show === "closed") return "No closed tickets.";
	if (show === "open" && counts.closed > 0)
		return "No open tickets. Press x to see the closed ones.";
	return "No tickets yet. Type a title above and press Ctrl+Enter to file the first one.";
};

const StateGlyph = ({state}: {readonly state: Summary["state"]}) => (
	<svg
		className={`tracker-glyph tracker-state-${state}`}
		viewBox="0 0 16 16"
		role="img"
		aria-label={state}
	>
		{state === "open" ? (
			<circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
		) : (
			<>
				<circle cx="8" cy="8" r="6" fill="currentColor" />
				<path
					d="M5.4 8.2l1.8 1.8 3.4-3.6"
					fill="none"
					stroke="var(--ground)"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</>
		)}
	</svg>
);

const PullRequestGlyph = ({draft}: {readonly draft: boolean}) => (
	<svg
		className={`tracker-glyph ${draft ? "tracker-pull-request-draft" : "tracker-pull-request-open"}`}
		viewBox="0 0 16 16"
		role="img"
		aria-label={draft ? "draft pull request" : "pull request"}
	>
		<g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
			<circle cx="4.5" cy="3.75" r="1.6" />
			<circle cx="4.5" cy="12.25" r="1.6" />
			<circle cx="11.5" cy="12.25" r="1.6" />
			<path d="M4.5 5.35v5.3M11.5 10.65V6.5a2 2 0 0 0-2-2H7.5" />
		</g>
	</svg>
);

const CommentGlyph = () => (
	<svg className="tracker-glyph-small" viewBox="0 0 16 16" aria-hidden="true">
		<path
			d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinejoin="round"
		/>
	</svg>
);

const SearchGlyph = () => (
	<svg className="tracker-glyph-small" viewBox="0 0 16 16" aria-hidden="true">
		<circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
		<path d="M10.2 10.2l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
	</svg>
);

const StateBadge = ({state}: {readonly state: Summary["state"]}) => (
	<span className={`tracker-state tracker-state-${state}`}>
		<StateGlyph state={state} />
		{state === "open" ? "Open" : "Closed"}
	</span>
);

function TicketPage(props: {
	readonly number: number;
	readonly ticket: Ticket | null;
	readonly saving: readonly Write[];
	readonly draft: string;
	readonly setDraft: (text: string) => void;
	readonly act: Send;
}) {
	const {number, ticket, saving, draft, setDraft, act} = props;
	const boxRef = useRef<HTMLTextAreaElement>(null);
	const backRef = useRef<HTMLButtonElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on opening a ticket.
	useEffect(() => {
		(boxRef.current ?? backRef.current)?.focus();
	}, [number]);

	const back = () => act({kind: "list"});
	/** Esc goes back to the list, from anywhere on the page. A comment half written stays. */
	const onPageKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		back();
	};
	const comment = (e?: FormEvent) => {
		e?.preventDefault();
		if (draft.trim() === "") return;
		act({kind: "comment", ticket: number, body: draft.trimEnd()});
		setDraft("");
	};
	const pending = saving.filter((w) => w.kind === "comment" && w.ticket === number);

	return (
		<div className="tracker-page">
			<div className="tracker-head">
				<button
					type="button"
					className="tracker-back"
					ref={backRef}
					onClick={back}
					onKeyDown={onPageKey}
				>
					← Tickets
				</button>
				<kbd>Esc</kbd>
			</div>
			{ticket === null ? (
				<p className="tracker-empty">No ticket #{number} on the ledger.</p>
			) : (
				<>
					<header className="tracker-ticket-head">
						<h2>{ticket.title}</h2>
						<p>
							<StateBadge state={ticket.state} />
							<span className="tracker-quiet">#{ticket.number}</span>
						</p>
					</header>
					<ol className="tracker-timeline" aria-label="timeline">
						{ticket.timeline.map((e) => (
							<li key={e.pos} className={`tracker-entry tracker-fact-${e.fact.type}`}>
								<p className="tracker-meta">
									<Who by={e.by} /> {verbOf(e.fact.type)}{" "}
									<time className="tracker-quiet">{whenOf(e.at, Date.now())}</time>
								</p>
								{"body" in e.fact && e.fact.body !== "" ? (
									<Body text={e.fact.body} onKey={onPageKey} />
								) : null}
							</li>
						))}
						{pending.map((w, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: two pending comments may say the same thing; their order is all that tells them apart.
							<li key={i} className="tracker-entry tracker-pending">
								<p className="tracker-meta">saving…</p>
								{"body" in w ? <Body text={w.body} onKey={onPageKey} /> : null}
							</li>
						))}
					</ol>
					<form className="tracker-composer tracker-reply" onSubmit={comment} aria-label="comment">
						<textarea
							ref={boxRef}
							aria-label="comment"
							placeholder="Leave a comment"
							rows={3}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (!isSubmit(e)) return onPageKey(e);
								e.preventDefault();
								comment();
							}}
						/>
						<div className="tracker-row">
							<small>
								<kbd>Ctrl</kbd> <kbd>Enter</kbd> comments
							</small>
							<button
								type="button"
								onKeyDown={onPageKey}
								onClick={() =>
									act({kind: ticket.state === "open" ? "close" : "reopen", ticket: number})
								}
							>
								{ticket.state === "open" ? "Close ticket" : "Reopen ticket"}
							</button>
							<button
								type="submit"
								className="tracker-primary"
								disabled={draft.trim() === ""}
								onKeyDown={onPageKey}
							>
								Comment
							</button>
						</div>
					</form>
				</>
			)}
		</div>
	);
}

/**
 * A ticket's or a comment's body, as written, with each http and https URL in it a link. The link
 * shows its own URL, so what it says is what opens. Esc on it goes back to the list, as everywhere
 * on the page.
 */
const Body = ({
	text,
	onKey,
}: {
	readonly text: string;
	readonly onKey: (e: KeyboardEvent) => void;
}) => (
	<div className="tracker-body">
		{piecesOf(text).map((piece, i) =>
			piece.kind === "text" ? (
				piece.text
			) : (
				// biome-ignore lint/suspicious/noArrayIndexKey: the pieces are cut fresh from one body and never move; their order is all there is.
				<a key={i} href={piece.url} target="_blank" rel="noreferrer" onKeyDown={onKey}>
					{piece.url}
				</a>
			),
		)}
	</div>
);

const verbOf = (type: Ticket["timeline"][number]["fact"]["type"]): ReactNode => {
	switch (type) {
		case "filed":
			return "filed it";
		case "commented":
			return "commented";
		case "closed":
			return <strong>closed it</strong>;
		case "reopened":
			return <strong>reopened it</strong>;
	}
};

const Who = ({by}: {readonly by: Ticket["timeline"][number]["by"]}) => (
	<span className={`tracker-who tracker-by-${by.kind}`}>
		{by.id}
		{by.kind === "agent" ? <small>agent</small> : null}
	</span>
);
