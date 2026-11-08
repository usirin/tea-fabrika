import {Toolbar} from "@kampus/fabrika-design/toolbar";
import {commandFor, commandsOf, type CommandRow, writerText, CommandVia} from "@kampus/fabrika-old";
import {Button, ScrollArea, Textarea} from "@manti-ui/react";
import {AskView, StopView} from "@tea-fabrika/tracker/ask-window";
import {
	createContext,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	type KeyboardEvent,
} from "react";
import type {InboxState, InboxRow} from "./inbox.ts";
import {inbox} from "./index.ts";

export const InboxCommands = createContext<readonly CommandRow[] | null>(null);
type Via = Extract<CommandVia, {_tag: "key" | "click"}>;
export const InboxDispatch = createContext<
	((msg: {type: string; value: unknown}, via: Via) => void) | null
>(null);
type Projection = Pick<InboxState, "rows" | "selected" | "look" | "reply"> &
	Partial<Pick<InboxState, "marks">>;
export interface InboxProps {
	readonly view: Projection;
	readonly send: (msg: any) => void;
}
export function InboxList({
	view,
	send: toProgram,
	glance = false,
}: InboxProps & {readonly glance?: boolean}) {
	const dispatch = useContext(InboxDispatch);
	const emit = (msg: {type: string; value: unknown}, via: Via = CommandVia.cases.click.make({})) =>
		dispatch === null ? toProgram(msg) : dispatch(msg, via);
	const send = (msg: {type: string; value: unknown}) => emit(msg);
	const root = useRef<HTMLDivElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const prepared = useContext(InboxCommands) ?? commandsOf(inbox);
	const selected = view.rows.find((row) => row.key === view.selected);
	const editing = view.reply._tag === "editing" || view.reply._tag === "failed";
	const replyingTo =
		"message" in view.reply ? `${writerText(view.reply.to)}/${view.reply.message}` : null;
	const markSeen = useEffectEvent(() => send({type: "seen", value: null}));
	useEffect(() => {
		root.current?.focus();
		markSeen();
	}, []);
	useEffect(() => {
		if (editing) field.current?.focus();
	}, [editing, replyingTo]);
	useEffect(() => {
		if (view.selected !== null)
			document
				.getElementById(`inbox-${glance ? "glance" : "tile"}-${view.selected}`)
				?.scrollIntoView({block: "nearest"});
	}, [view.selected, glance]);
	const closeReply = () => {
		send({type: "escape", value: null});
		root.current?.focus();
	};
	const submit = () =>
		send(
			view.reply._tag === "failed"
				? {type: "retry", value: null}
				: {type: "send", value: {id: crypto.randomUUID(), said: Date.now()}},
		);
	const onKey = (e: KeyboardEvent) => {
		const typing =
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLTextAreaElement ||
			(e.target instanceof HTMLElement && e.target.isContentEditable);
		if (e.key === "Escape" && (view.reply._tag !== "closed" || view.look)) {
			e.preventDefault();
			e.stopPropagation();
			closeReply();
			return;
		}
		if (typing) {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				e.stopPropagation();
				if (!e.repeat) submit();
			}
			return;
		}
		if (e.target !== root.current) return;
		if (e.key === "Escape" && !glance) {
			e.preventDefault();
			e.stopPropagation();
			send({type: "escape", value: null});
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			send({type: glance ? "open" : "enter", value: null});
			return;
		}
		const command = commandFor(
			prepared,
			{key: e.key, shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey},
			false,
		);
		if (command !== undefined) {
			e.preventDefault();
			e.stopPropagation();
			if (!e.repeat)
				emit(
					command.send,
					CommandVia.cases.key.make({
						keys: [
							e.ctrlKey ? "ctrl" : "",
							e.metaKey ? "meta" : "",
							e.altKey ? "alt" : "",
							e.shiftKey ? "shift" : "",
							e.key === " " ? "space" : e.key.toLowerCase(),
						]
							.filter(Boolean)
							.join("+"),
					}),
				);
		}
	};
	const allowed = prepared.filter(
		(c) =>
			c.id.endsWith(".open") ||
			(selected !== undefined &&
				(!c.id.endsWith(".reply") || selected._tag === "message") &&
				(!c.id.endsWith(".look") || !glance)),
	);
	const rowContent = (row: InboxRow) =>
		row._tag === "message"
			? row.message.text
			: row._tag === "stop"
				? row.stop.why
				: row.ask.shows.what;
	return (
		<div className="inbox" data-inbox-reply={view.reply._tag} data-inbox-look={view.look}>
			<Toolbar commands={allowed} send={emit} />
			<ScrollArea className="inbox-scroll" focusable={false}>
				<div
					ref={root}
					data-inbox-list
					role="grid"
					aria-label="Inbox"
					tabIndex={0}
					aria-activedescendant={
						view.selected === null
							? undefined
							: `inbox-${glance ? "glance" : "tile"}-${view.selected}`
					}
					onKeyDown={onKey}
				>
					{[false, true].map((messages) => (
						<div
							key={String(messages)}
							role="rowgroup"
							aria-label={messages ? "Messages" : "Your turn"}
						>
							<p className="inbox-group">{messages ? "Messages" : "Your turn"}</p>
							{view.rows
								.filter((r) => (r._tag === "message") === messages)
								.map((row) => {
									const active = row.key === view.selected;
									const reply =
										row._tag === "message" &&
										"message" in view.reply &&
										row.message.id === view.reply.message &&
										writerText(row.message.by) === writerText(view.reply.to)
											? view.reply
											: null;
									const later = view.marks?.later.includes(row.key);
									return (
										<div
											key={row.key}
											id={`inbox-${glance ? "glance" : "tile"}-${row.key}`}
											role="row"
											aria-selected={active}
											className="inbox-row"
											data-selected={active}
										>
											<div role="gridcell">
												<Button
													variant="tertiary"
													className="inbox-select"
													tabIndex={-1}
													onClick={() => {
														send({type: "select", value: row.key});
														root.current?.focus();
													}}
												>
													{row._tag === "message" && (
														<span
															aria-label={`${row.message.by.kind === "agent" ? "Agent" : "Person"} ${row.message.by.id}`}
															className="inbox-sender"
														>
															<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
																{row.message.by.kind === "agent" ? (
																	<>
																		<rect
																			x="1"
																			y="1"
																			width="10"
																			height="10"
																			rx="2"
																			fill="none"
																			stroke="currentColor"
																		/>
																		<path
																			d="M6 2.5 7 5 9.5 6 7 7 6 9.5 5 7 2.5 6 5 5Z"
																			fill="currentColor"
																		/>
																	</>
																) : (
																	<circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" />
																)}
															</svg>{" "}
															{row.message.by.id}
														</span>
													)}
													<span>{rowContent(row)}</span>
													{later && <span>Later</span>}
												</Button>
												{active && (glance || view.look) && (
													<div className="inbox-look">
														{row._tag === "ask" && row.ask.sealed !== undefined && (
															<AskView key={row.key} ticket={row.ask.ticket} ask={row.ask.sealed} />
														)}
														{row._tag === "stop" && <StopView {...row.stop} />}
														{row._tag === "message" && <p>{row.message.text}</p>}
													</div>
												)}
												{reply !== null && (
													<form
														className="inbox-reply"
														onKeyDown={onKey}
														onSubmit={(e) => {
															e.preventDefault();
															submit();
														}}
													>
														<Textarea
															ref={field}
															label="Reply"
															aria-label="Reply"
															rows={3}
															value={reply.text}
															disabled={!editing}
															onChange={(e) => send({type: "change", value: e.target.value})}
														/>
														{editing && (
															<Button type="submit" disabled={reply.text.trim() === ""}>
																{reply._tag === "failed" ? "Retry" : "Send"}
															</Button>
														)}
														<Button type="button" variant="tertiary" onClick={closeReply}>
															Cancel
														</Button>
														{reply._tag === "failed" ? (
															<p role="alert">{reply.why}</p>
														) : (
															reply._tag !== "editing" && (
																<p role="status">
																	{reply._tag === "sending"
																		? "Sending…"
																		: reply._tag === "queued"
																			? "Queued for the recipient."
																			: "Delivered."}
																</p>
															)
														)}
													</form>
												)}
											</div>
										</div>
									);
								})}
						</div>
					))}
					{view.rows.length === 0 && <p>Nothing waits on you.</p>}
				</div>
			</ScrollArea>
		</div>
	);
}
export function InboxWindow(props: InboxProps) {
	return <InboxList {...props} />;
}
