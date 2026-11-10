import type {WindowProps} from "@kampus/fabrika-old";
import {type Text, textOf} from "@kampus/pipeline/tickets/approval";
import {type Suggested, suggestedName} from "@kampus/pipeline/tickets/area";
import {Kbd} from "@manti-ui/react";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState,
} from "react";
import {lineOf, waits} from "./head.ts";
import type {
	Head,
	Hint,
	OpenAsk,
	Opened,
	PullRequest,
	Row,
	Show,
	Shown,
	Summary,
	tracker,
	Write,
} from "./index.ts";
import {piecesOf} from "./links.ts";

// The tracker's window: plain React, keyboard first. It draws the view it is handed and sends one
// of its inputs: a write, the query, or quit. All it keeps is what a person is typing and which row
// is picked, so a half-written ticket or comment survives a look at another page. Which tickets
// show, and the search, are the machine's (`show`, `find`): this window only draws them and sends
// a query when they change, with the whole filter:
// `{type: "query", value: {status: "closed", find: "login"}}`.
//
//   the list     ↑ ↓ or j k pick a row, Enter opens it, c goes to the new ticket's title,
//                o x a show open, closed or all tickets, / goes to the search, q quits
//   the search   typing narrows tickets and pull requests by title; Esc or ↓ goes to the list
//   new ticket   Enter in the title goes to the body; Ctrl+Enter (⌘+Enter) files; Esc goes to the list
//   a ticket     the comment box has the focus; Ctrl+Enter comments; Esc goes back to the list
//   first areas  while the project has no area, the list opens on the suggestions: ↑ ↓ move,
//                Space ticks, Enter makes the ticked ones and the typed name, Esc skips
//
// The step only suggests. Each area it makes is a `make_area` the person sent, in the order shown:
// `{type: "make_area", value: {name: "lane", suggested: {_tag: "titles", word: "lane", tickets: 3}}}`.
//
// A URL in a body, and a pull request on the list, is a link. It opens a new window,
// `target="_blank"`, which the app never makes: it hands an http or https URL to the person's own
// browser instead.

type Send = WindowProps<typeof tracker>["send"];

/** A write in words, for "saving" and "not saved". */
const said = (w: Write): string => {
	switch (w.kind) {
		case "file":
			return `new ticket "${w.title}"`;
		case "comment":
			return w.asks === "changes" ? `changes asked on #${w.ticket}` : `comment on #${w.ticket}`;
		case "close":
			return `close #${w.ticket}`;
		case "reopen":
			return `reopen #${w.ticket}`;
		case "answer":
			return `answer "${w.pick}" on #${w.ticket}`;
		case "rate_duplicate":
			return `${w.says} the hint #${w.of} on #${w.ticket}`;
		case "make_area":
			return `new area "${w.name}"`;
		case "rename_area":
			return `rename area ${w.area} to "${w.name}"`;
		case "merge_area":
			return `merge area ${w.area} into area ${w.into}`;
	}
};

/** When, in a few words: the time today, else the day too, and the year when it is not this one. */
export const whenOf = (at: number, now: number): string => {
	const then = new Date(at);
	const today = new Date(now);
	const time = then.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});

	if (then.toDateString() === today.toDateString()) {
		return time;
	}

	const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

	if (then.toDateString() === yesterday.toDateString()) {
		return `yesterday ${time}`;
	}

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
							send({type: "query", value: {status: view.filter.show, find: text}});
						}}
						draft={{title, body, setTitle, setBody}}
						act={send}
					/>
				) : (
					<TicketPage
						number={page.number}
						opened={page.opened}
						saving={view.saving}
						draft={comments[page.number] ?? ""}
						setDraft={(text) => setComments((all) => ({...all, [page.number]: text}))}
						back={() => send({type: "query", value: {status: view.filter.show, find}})}
						act={send}
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
	const stepRef = useRef<HTMLFieldSetElement>(null);
	const making = view.saving.some((w) => w.kind === "make_area");
	// One list for the keys: the tickets, then the pull requests.
	const order = [...tickets.map((t) => ticketRow(t.number)), ...pullRequests.map(prRow)];
	const picked = order.find((r) => r === props.picked) ?? order[0];
	const counted = {open: counts.open, closed: counts.closed, all: counts.open + counts.closed};

	const toList = () => {
		if (picked === undefined) {
			pageRef.current?.focus();
		} else {
			rows.current.get(picked)?.focus();
		}
	};

	// Where the focus goes on coming to the list: the first areas' first row while that step shows,
	// else the row picked, or the title when there is none. Once, on coming to the list: a new view
	// must not pull the focus back.
	const focusStart = useEffectEvent(() => {
		if (stepRef.current !== null) {
			stepRef.current.querySelector("input")?.focus();
		} else if (picked === undefined) {
			titleRef.current?.focus();
		} else {
			rows.current.get(picked)?.focus();
		}
	});
	useEffect(() => {
		focusStart();
	}, []);

	// The first areas made or skipped: the step goes, and the focus goes to the list, once.
	const stepShows = page.onboarding !== null;
	const shown = useRef(stepShows);
	const stepGone = useEffectEvent(() => {
		if (shown.current && !stepShows) {
			toList();
		}

		shown.current = stepShows;
	});
	useEffect(() => {
		stepGone();
	}, [stepShows]);

	// A filter that hides the row in focus leaves the focus nowhere: it goes back to the list.
	// Checked when the rows shown change.
	const shownRows = order.join("\n");
	const refocus = useEffectEvent(() => {
		const at = document.activeElement;

		if (at === null || at === document.body) {
			toList();
		}
	});
	useEffect(() => {
		refocus();
	}, [shownRows]);

	const file = (e?: FormEvent) => {
		e?.preventDefault();
		const t = draft.title.trim();

		if (t === "") {
			return titleRef.current?.focus();
		}

		act({type: "file", value: {title: t, body: draft.body.trimEnd()}});
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

			if (picked === undefined) {
				e.currentTarget.blur();
			} else {
				rows.current.get(picked)?.focus();
			}
		}
	};
	const move = (by: number) => {
		const at = order.indexOf(picked ?? "");
		const next = order[Math.min(order.length - 1, Math.max(0, at + by))];

		if (next === undefined) {
			return;
		}

		pick(next);
		rows.current.get(next)?.focus();
	};
	const show = (s: Show) => act({type: "query", value: {status: s, find: props.find}});
	/** The list's own keys, anywhere on the page but in a box being typed in. */
	const onListKey = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) {
			return;
		}

		const target = e.target as HTMLElement;

		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
			return;
		}

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
			q: () => act({type: "quit", value: null}),
		};
		const key = keys[e.key];

		if (key === undefined) {
			return;
		}

		e.preventDefault();
		key();
	};
	const onFindKey = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key !== "Escape" && e.key !== "ArrowDown" && e.key !== "Enter") {
			return;
		}

		e.preventDefault();
		toList();
	};
	const keep = (row: string) => (el: HTMLElement | null) => {
		if (el === null) {
			rows.current.delete(row);
		} else {
			rows.current.set(row, el);
		}
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
					<Kbd>/</Kbd>
				</label>
			</div>
			{page.onboarding === null ? null : (
				<FirstAreas
					suggestions={page.onboarding}
					making={making}
					stepRef={stepRef}
					done={() => pageRef.current?.focus()}
					act={act}
				/>
			)}
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
						} else {
							onComposerKey(e);
						}
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
								<Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> files it
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
										onClick={() => act({type: "query", value: {ticket: t.number}})}
									>
										<StateGlyph state={t.state} />
										<span className="tracker-number">{t.number}</span>
										<span className="tracker-title">{t.title}</span>
										<span className="tracker-sub">
											<HeadLine head={t.head} />
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
					<Kbd>j</Kbd> <Kbd>k</Kbd> pick
				</span>
				<span>
					<Kbd>Enter</Kbd> open
				</span>
				<span>
					<Kbd>o</Kbd> <Kbd>x</Kbd> <Kbd>a</Kbd> open, closed, all
				</span>
				<span>
					<Kbd>/</Kbd> search
				</span>
				<span>
					<Kbd>c</Kbd> new ticket
				</span>
				<span>
					<Kbd>q</Kbd> quit
				</span>
			</footer>
		</section>
	);
}

/** Why the app suggests an area, in words: what it read. */
const whyOf = (s: Suggested): string =>
	s._tag === "titles"
		? `${s.tickets} open titles start with "${s.word}:"`
		: `the folder ${s.path} in the code`;

/**
 * The areas Enter makes: the ticked suggestions in the order shown, then the typed name unless a
 * ticked one has it already, ignoring case. A typed name has no `suggested`: nothing suggested it.
 *
 *   firstAreasOf([lane, apps/fabrika], {"lane"}, "  desk ")
 *   // [{name: "lane", suggested: lane}, {name: "desk"}]
 */
export const firstAreasOf = (
	suggestions: readonly Suggested[],
	ticked: ReadonlySet<string>,
	typed: string,
): readonly {readonly name: string; readonly suggested?: Suggested}[] => {
	const picked = suggestions
		.filter((s) => ticked.has(suggestedName(s)))
		.map((s) => ({name: suggestedName(s), suggested: s}));
	const name = typed.trim();
	const taken = picked.some((p) => p.name.toLowerCase() === name.toLowerCase());
	return name === "" || taken ? picked : [...picked, {name}];
};

/**
 * The first areas: the suggestions as a checklist, each with its why, and a box to type a name.
 * Nothing is made until Enter, and then only what the person ticked or typed. Esc skips the step
 * for as long as this tracker runs. Its buttons are plain: the accent is for "your turn" only.
 */
function FirstAreas(props: {
	readonly suggestions: readonly Suggested[];
	readonly making: boolean;
	readonly stepRef: RefObject<HTMLFieldSetElement | null>;
	readonly done: () => void;
	readonly act: Send;
}) {
	const {suggestions, making, act} = props;
	const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
	const [typed, setTyped] = useState("");
	// Two trackers can share a window, so the step's words get an id of their own.
	const about = useId();
	const made = firstAreasOf(suggestions, ticked, typed);
	const tick = (name: string) =>
		setTicked((all) => {
			const next = new Set(all);

			if (!next.delete(name)) {
				next.add(name);
			}

			return next;
		});
	const make = () => {
		if (made.length === 0) {
			return;
		}

		for (const value of made) {
			act({type: "make_area", value});
		}

		props.done();
	};
	const skip = () => {
		act({type: "skip_onboarding", value: null});
		props.done();
	};
	/** ↑ ↓ move between the rows and the box; Enter makes; Esc empties the box, then skips. */
	const onKey = (e: KeyboardEvent<HTMLFieldSetElement>) => {
		if (e.ctrlKey || e.metaKey || e.altKey) {
			return;
		}

		const target = e.target as HTMLElement;

		if (target.tagName !== "INPUT") {
			return;
		}

		const stops = [...e.currentTarget.querySelectorAll("input")];
		const at = stops.indexOf(target as HTMLInputElement);
		const by = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;

		if (by !== 0) {
			e.preventDefault();
			stops[Math.min(stops.length - 1, Math.max(0, at + by))]?.focus();
		} else if (e.key === "Enter") {
			e.preventDefault();
			make();
		} else if (e.key === "Escape") {
			e.preventDefault();

			if (target.getAttribute("type") === "text" && typed !== "") {
				setTyped("");
			} else {
				skip();
			}
		}
	};
	return (
		<fieldset
			className="tracker-first-areas"
			ref={props.stepRef}
			disabled={making}
			onKeyDown={onKey}
			aria-describedby={about}
		>
			<legend>Pick your first areas</legend>
			<p id={about}>
				An area is a part of the project, such as the app or the lane. Tick the ones you want, or
				type a name. Nothing is made until you press Enter.
			</p>
			{suggestions.length === 0 ? (
				<p className="tracker-note">Nothing to suggest from the titles or the folders yet.</p>
			) : (
				<ul aria-label="suggested areas">
					{suggestions.map((s) => {
						const name = suggestedName(s);
						return (
							<li key={name}>
								<label>
									<input type="checkbox" checked={ticked.has(name)} onChange={() => tick(name)} />
									<span className="tracker-title">{name}</span>
									<small>{whyOf(s)}</small>
								</label>
							</li>
						);
					})}
				</ul>
			)}
			<input
				type="text"
				aria-label="type an area's name"
				placeholder="Or type a name"
				value={typed}
				maxLength={32}
				onChange={(e) => setTyped(e.target.value)}
				spellCheck={false}
				autoComplete="off"
			/>
			<div className="tracker-row">
				<small>
					<Kbd>Space</Kbd> ticks <Kbd>Enter</Kbd> makes them <Kbd>Esc</Kbd> skips
				</small>
				<button type="button" onClick={skip}>
					Skip
				</button>
				<button type="button" onClick={make} disabled={made.length === 0}>
					{making
						? "Making…"
						: made.length === 0
							? "Make areas"
							: `Make ${made.length} area${made.length === 1 ? "" : "s"}`}
				</button>
			</div>
		</fieldset>
	);
}

/** What an empty list says: why it is empty, and what to do about it. */
const emptyOf = (
	show: Show,
	searching: boolean,
	counts: {readonly open: number; readonly closed: number},
): string => {
	if (searching) {
		return "No ticket has that in its title.";
	}

	if (show === "closed") {
		return "No closed tickets.";
	}

	if (show === "open" && counts.closed > 0) {
		return "No open tickets. Press x to see the closed ones.";
	}

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

/** A ticket's top line, from its facts. A line that waits on the owner is marked so. */
const HeadLine = ({head}: {readonly head: Head}) => (
	<span
		className={`tracker-head-line tracker-head-${head._tag}`}
		data-waits={waits(head) ? "" : undefined}
	>
		{lineOf(head, (at) => whenOf(at, Date.now()))}
	</span>
);

function TicketPage(props: {
	readonly number: number;
	readonly opened: Opened | null;
	readonly saving: readonly Write[];
	readonly draft: string;
	readonly setDraft: (text: string) => void;
	/** Back to the list, with the filter it had. */
	readonly back: () => void;
	readonly act: Send;
}) {
	const {number, opened, saving, draft, setDraft, back, act} = props;
	const ticket = opened?.ticket ?? null;
	const boxRef = useRef<HTMLTextAreaElement>(null);
	const backRef = useRef<HTMLButtonElement>(null);
	// The focus moves in on opening a ticket.
	useEffect(() => {
		(boxRef.current ?? backRef.current)?.focus();
	}, [number]);

	/** Esc goes back to the list, from anywhere on the page. A comment half written stays. */
	const onPageKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") {
			return;
		}

		e.preventDefault();
		back();
	};
	/** "Comment", or with `asks: "changes"`, "Request changes": the person says which, nothing guesses. */
	const comment = (e?: FormEvent, asks?: "changes") => {
		e?.preventDefault();

		if (draft.trim() === "") {
			return;
		}

		const body = draft.trimEnd();
		act({
			type: "comment",
			value: asks === undefined ? {ticket: number, body} : {ticket: number, body, asks},
		});
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
				<Kbd>Esc</Kbd>
			</div>
			{opened === null || ticket === null ? (
				<p className="tracker-empty">No ticket #{number} on the ledger.</p>
			) : (
				<>
					<header className="tracker-ticket-head">
						<h2>{ticket.title}</h2>
						<p>
							<StateBadge state={ticket.state} />
							<span className="tracker-quiet">#{ticket.number}</span>
							<HeadLine head={opened.head} />
						</p>
					</header>
					{opened.duplicates.map((hint) => (
						<DuplicateHint
							key={hint.of}
							number={number}
							hint={hint}
							saving={saving.some(
								(w) => w.kind === "rate_duplicate" && w.ticket === number && w.of === hint.of,
							)}
							act={act}
							onKey={onPageKey}
						/>
					))}
					<ol className="tracker-timeline" aria-label="timeline">
						{opened.rows.map((row) => (
							<TimelineRow key={row.pos} row={row} onKey={onPageKey} />
						))}
						{pending.map((w, i) => (
							// two pending comments may say the same thing; their order is all that tells them apart.
							<li key={i} className="tracker-entry tracker-pending">
								<p className="tracker-meta">saving…</p>
								{"body" in w ? <Body text={w.body} onKey={onPageKey} /> : null}
							</li>
						))}
					</ol>
					{opened.asks.map((ask) => (
						<AskBox
							key={ask.ask}
							number={number}
							ask={ask}
							saw={textOf(ticket)}
							saving={saving.some(
								(w) => w.kind === "answer" && w.ticket === number && w.ask === ask.ask,
							)}
							act={act}
							onKey={onPageKey}
						/>
					))}
					<form className="tracker-composer tracker-reply" onSubmit={comment} aria-label="comment">
						<textarea
							ref={boxRef}
							aria-label="comment"
							placeholder="Leave a comment"
							rows={3}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (!isSubmit(e)) {
									return onPageKey(e);
								}

								e.preventDefault();
								comment();
							}}
						/>
						<div className="tracker-row">
							<small>
								<Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> comments
							</small>
							<button
								type="button"
								onKeyDown={onPageKey}
								onClick={() =>
									act({type: ticket.state === "open" ? "close" : "reopen", value: {ticket: number}})
								}
							>
								{ticket.state === "open" ? "Close ticket" : "Reopen ticket"}
							</button>
							<button
								type="button"
								disabled={draft.trim() === ""}
								onKeyDown={onPageKey}
								onClick={() => comment(undefined, "changes")}
							>
								Request changes
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
				// the pieces are cut fresh from one body and never move; their order is all there is.
				<a key={i} href={piece.url} target="_blank" rel="noreferrer" onKeyDown={onKey}>
					{piece.url}
				</a>
			),
		)}
	</div>
);

/** A state change reads strong: it moves the ticket, a comment does not. */
const STRONG: ReadonlySet<string> = new Set(["closed", "reopened", "answered"]);

/** One fact's row: who, what, the quieter part, when, and the text written with it. */
const TimelineRow = ({
	row,
	onKey,
}: {
	readonly row: Row;
	readonly onKey: (e: KeyboardEvent) => void;
}): ReactNode => (
	<li className={`tracker-entry tracker-fact-${row.type}`}>
		<p className="tracker-meta">
			<Who of={row} /> {STRONG.has(row.type) ? <strong>{row.text}</strong> : row.text}{" "}
			{row.more === "" ? null : <span className="tracker-quiet">{row.more}</span>}{" "}
			<time className="tracker-quiet">{whenOf(row.at, Date.now())}</time>
		</p>
		{row.body === null ? null : <Body text={row.body} onKey={onKey} />}
	</li>
);

/**
 * An open ask's box: what it asks, a note, and one button per pick. A click sends `answer`, which
 * writes `answered`; a comment never does. `saw`: the ticket's text on the page, which the answer
 * covers. While the answer is saving, the buttons wait.
 */
function AskBox(props: {
	readonly number: number;
	readonly ask: OpenAsk;
	readonly saw: Text;
	readonly saving: boolean;
	readonly act: Send;
	readonly onKey: (e: KeyboardEvent) => void;
}) {
	const {number, ask, saw, saving, act, onKey} = props;
	const [note, setNote] = useState("");
	return (
		<section className="tracker-ask" aria-label={`ask: ${ask.what}`}>
			<p className="tracker-meta">
				<Who of={ask} /> asks you{" "}
				<time className="tracker-quiet">{whenOf(ask.at, Date.now())}</time>
			</p>
			<p className="tracker-ask-what">{ask.what}</p>
			<textarea
				aria-label="note with the answer"
				placeholder="A note with your answer, if it needs one"
				rows={2}
				value={note}
				onChange={(e) => setNote(e.target.value)}
				onKeyDown={onKey}
			/>
			<div className="tracker-row">
				{ask.picks.map((pick, i) => (
					<button
						key={pick}
						type="button"
						className={i === 0 ? "tracker-primary" : undefined}
						disabled={saving}
						onKeyDown={onKey}
						onClick={() =>
							act({
								type: "answer",
								value: {ticket: number, ask: ask.ask, pick, note: note.trimEnd(), saw},
							})
						}
					>
						{pick}
					</button>
				))}
				{saving ? <small>saving…</small> : null}
			</div>
		</section>
	);
}

/**
 * A duplicate hint: "maybe the same as #4", the other ticket a link to its page, and accept and
 * dismiss. Advice: neither button closes or hides a ticket. The person's newest word shows as the
 * pressed button, and the other one changes it.
 */
function DuplicateHint(props: {
	readonly number: number;
	readonly hint: Hint;
	readonly saving: boolean;
	readonly act: Send;
	readonly onKey: (e: KeyboardEvent) => void;
}) {
	const {number, hint, saving, act, onKey} = props;
	const rate = (says: "accept" | "dismiss") =>
		act({type: "rate_duplicate", value: {ticket: number, of: hint.of, says}});
	return (
		<section
			className="tracker-hint"
			data-says={hint.says ?? undefined}
			aria-label={`maybe the same as #${hint.of}`}
		>
			<p className="tracker-hint-what">
				Maybe the same as{" "}
				<button
					type="button"
					className="tracker-hint-link"
					onKeyDown={onKey}
					onClick={() => act({type: "query", value: {ticket: hint.of}})}
				>
					#{hint.of}
					{hint.title === null ? null : ` ${hint.title}`}
				</button>
				{hint.state === "closed" ? <span className="tracker-quiet"> (closed)</span> : null}
			</p>
			<div className="tracker-row">
				<small className="tracker-quiet">
					Jev {hint.yes.toFixed(2)}. A hint: nothing is closed.
				</small>
				<button
					type="button"
					aria-pressed={hint.says === "accept"}
					disabled={saving}
					onKeyDown={onKey}
					onClick={() => rate("accept")}
				>
					Accept
				</button>
				<button
					type="button"
					aria-pressed={hint.says === "dismiss"}
					disabled={saving}
					onKeyDown={onKey}
					onClick={() => rate("dismiss")}
				>
					Dismiss
				</button>
				{saving ? <small>saving…</small> : null}
			</div>
		</section>
	);
}

/** A writer, and the name its person goes by on this ledger if it is someone's agent. */
type Whose = {readonly by: Row["by"]; readonly whose?: string | undefined};

/**
 * What a row says after its writer's id: nothing for a person; whose agent it is, by its person's
 * name on this ledger (their id when the members do not name them); only "agent" for a row from
 * before the door, which does not say whose.
 */
export const agentOf = ({by, whose}: Whose): string | null => {
	if (by.kind === "user") {
		return null;
	}

	return "for" in by ? `${whose ?? by.for}'s agent` : "agent";
};

const Who = ({of}: {readonly of: Whose}) => {
	const tail = agentOf(of);
	return (
		<span className={`tracker-who tracker-by-${of.by.kind}`}>
			{of.by.id}
			{"for" in of.by ? "," : null}
			{tail === null ? null : <small>{tail}</small>}
		</span>
	);
};
