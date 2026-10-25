import type {WindowProps} from "@kampus/fabrika";
import {
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import type {Do, Shown, Summary, Ticket, tracker, Write} from "./index.ts";

// The tracker's window: plain React, keyboard first. It draws the view it is handed and sends
// `do`. All it keeps is what a person is typing and which ticket is picked, so a half-written
// ticket or comment survives a look at another page.
//
//   the list     ↑ ↓ or j k pick a ticket, Enter opens it, c goes to the new ticket's title, q quits
//   new ticket   Enter in the title goes to the body; Ctrl+Enter (⌘+Enter) files; Esc goes to the list
//   a ticket     the comment box has the focus; Ctrl+Enter comments; Esc goes back to the list

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

export function TrackerWindow({view, send}: WindowProps<typeof tracker>) {
	const act: Send = (value) => send({type: "do", value});
	const [picked, setPicked] = useState<number | null>(null);
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [comments, setComments] = useState<Readonly<Record<number, string>>>({});
	const {page} = view;
	return (
		<section className="tracker" aria-label="tracker">
			<Notices view={view} />
			{!view.ready ? (
				<p className="tracker-quiet">Reading the ledger…</p>
			) : page.kind === "list" ? (
				<ListPage
					tickets={page.tickets}
					picked={picked}
					pick={setPicked}
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
			<output className="tracker-quiet" aria-label="saving">
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

function ListPage(props: {
	readonly tickets: readonly Summary[];
	readonly picked: number | null;
	readonly pick: (n: number) => void;
	readonly draft: Draft;
	readonly act: Send;
}) {
	const {tickets, pick, draft, act} = props;
	const titleRef = useRef<HTMLInputElement>(null);
	const bodyRef = useRef<HTMLTextAreaElement>(null);
	const rows = useRef(new Map<number, HTMLButtonElement>());
	const picked = tickets.find((t) => t.number === props.picked)?.number ?? tickets[0]?.number;
	const empty = tickets.length === 0;

	// Where the focus goes on coming to the list: the ticket picked, or the title when there is none.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on coming to the list, not on every new view.
	useEffect(() => {
		if (picked === undefined) titleRef.current?.focus();
		else rows.current.get(picked)?.focus();
	}, []);

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
		const at = tickets.findIndex((t) => t.number === picked);
		const next = tickets[Math.min(tickets.length - 1, Math.max(0, at + by))];
		if (next === undefined) return;
		pick(next.number);
		rows.current.get(next.number)?.focus();
	};
	/** The list's own keys, on a picked ticket. In the composer they are only letters. */
	const onListKey = (e: KeyboardEvent) => {
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const keys: Readonly<Record<string, () => void>> = {
			ArrowDown: () => move(1),
			j: () => move(1),
			ArrowUp: () => move(-1),
			k: () => move(-1),
			c: () => titleRef.current?.focus(),
			q: () => act({kind: "quit"}),
		};
		const key = keys[e.key];
		if (key === undefined) return;
		e.preventDefault();
		key();
	};

	return (
		<div className="tracker-page">
			<form className="tracker-composer" onSubmit={file} aria-label="new ticket">
				<input
					ref={titleRef}
					aria-label="new ticket title"
					placeholder="New ticket: a title, then Enter for the body"
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
				<textarea
					ref={bodyRef}
					aria-label="new ticket body"
					placeholder="Body, if it needs one"
					rows={draft.body === "" ? 1 : 4}
					value={draft.body}
					onChange={(e) => draft.setBody(e.target.value)}
					onKeyDown={onComposerKey}
				/>
				<div className="tracker-row">
					<button type="submit" disabled={draft.title.trim() === ""}>
						File ticket
					</button>
					<small>Ctrl+Enter files</small>
				</div>
			</form>
			{empty ? (
				<p className="tracker-empty">
					No tickets yet. Type a title above and press Ctrl+Enter to file the first one.
				</p>
			) : (
				<ol className="tracker-list" aria-label="tickets">
					{tickets.map((t) => (
						<li key={t.number}>
							<button
								type="button"
								ref={(el) => {
									if (el === null) rows.current.delete(t.number);
									else rows.current.set(t.number, el);
								}}
								tabIndex={t.number === picked ? 0 : -1}
								aria-current={t.number === picked}
								onFocus={() => pick(t.number)}
								onKeyDown={onListKey}
								onClick={() => act({kind: "open", ticket: t.number})}
							>
								<span className="tracker-number">#{t.number}</span>
								<span className="tracker-title">{t.title}</span>
								<StateBadge state={t.state} />
								<span className="tracker-sub tracker-quiet">
									<time>{whenOf(t.at, Date.now())}</time>
									{t.comments === 0 ? "" : ` · ${t.comments} comment${t.comments === 1 ? "" : "s"}`}
								</span>
							</button>
						</li>
					))}
				</ol>
			)}
			<footer className="tracker-quiet">
				↑ ↓ or j k pick · Enter opens · c new ticket · q quits
			</footer>
		</div>
	);
}

const StateBadge = ({state}: {readonly state: Summary["state"]}) => (
	<span className={`tracker-state tracker-state-${state}`}>{state}</span>
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
				<button type="button" ref={backRef} onClick={back} onKeyDown={onPageKey}>
					← list
				</button>
				{ticket === null ? null : <StateBadge state={ticket.state} />}
			</div>
			{ticket === null ? (
				<p className="tracker-empty">No ticket #{number} on the ledger.</p>
			) : (
				<>
					<h2>
						<span className="tracker-number">#{ticket.number}</span> {ticket.title}
					</h2>
					<ol className="tracker-timeline" aria-label="timeline">
						{ticket.timeline.map((e) => (
							<li key={e.pos} className={`tracker-entry tracker-fact-${e.fact.type}`}>
								<p className="tracker-meta">
									<Who by={e.by} /> {verbOf(e.fact.type)}{" "}
									<time className="tracker-quiet">{whenOf(e.at, Date.now())}</time>
								</p>
								{"body" in e.fact && e.fact.body !== "" ? (
									<div className="tracker-body">{e.fact.body}</div>
								) : null}
							</li>
						))}
						{pending.map((w, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: two pending comments may say the same thing; their order is all that tells them apart.
							<li key={i} className="tracker-entry tracker-pending">
								<p className="tracker-meta">saving…</p>
								{"body" in w ? <div className="tracker-body">{w.body}</div> : null}
							</li>
						))}
					</ol>
					<form className="tracker-composer" onSubmit={comment} aria-label="comment">
						<textarea
							ref={boxRef}
							aria-label="comment"
							placeholder="Comment. Ctrl+Enter sends it, Esc goes back"
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
							<button type="submit" disabled={draft.trim() === ""} onKeyDown={onPageKey}>
								Comment
							</button>
							<button
								type="button"
								onKeyDown={onPageKey}
								onClick={() =>
									act({kind: ticket.state === "open" ? "close" : "reopen", ticket: number})
								}
							>
								{ticket.state === "open" ? "Close ticket" : "Reopen ticket"}
							</button>
						</div>
					</form>
				</>
			)}
		</div>
	);
}

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
		{by.kind === "agent" ? <small> agent</small> : null}
	</span>
);
