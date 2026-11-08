import {Button} from "@manti-ui/react";
export function TrackerGlance({
	view,
	send,
}: {
	readonly view: {count: number};
	readonly send: (msg: unknown) => void;
}) {
	return (
		<div className="tracker-glance">
			<p>{view.count} open tickets</p>
			<Button variant="tertiary" onClick={() => send({type: "open", value: null})}>
				Open tracker
			</Button>
		</div>
	);
}
