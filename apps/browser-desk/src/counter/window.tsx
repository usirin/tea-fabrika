import type {Message, View} from "./view.ts";

export function CounterWindow({
	view,
	send,
	connected,
}: {
	view: View;
	send: (message: Message) => void;
	connected: boolean;
}) {
	return (
		<section className="counter" aria-label="Counter">
			<p className="eyebrow">A little work that keeps going</p>
			<output className="counter-value" aria-live="polite" data-count>
				{view.count}
			</output>
			<p data-phase>{view.running ? `${view.remaining} steps left` : "Ready when you are"}</p>
			<div className="actions">
				<button
					type="button"
					disabled={!connected || view.running}
					onClick={() => send({type: "add"})}
				>
					Add 1
				</button>
				<button
					type="button"
					disabled={!connected || view.running}
					onClick={() => send({type: "start"})}
				>
					Run 5 steps
				</button>
			</div>
			<p className="hint">Close this window while it runs. Open it again from Panes.</p>
		</section>
	);
}
