import {Option, Schema} from "effect";
import {counter} from "./program.ts";

// The counter's window: it draws the count and sends presses. It holds no state: what it shows came
// from the process, whole or patched.

const decodeView = Schema.decodeUnknownOption(counter.view.data);

/** The count in a view, for a tile's strip when it is folded. */
export const countIn = (data: unknown): string =>
	Option.match(decodeView(data), {onNone: () => "...", onSome: (view) => String(view.n)});

export function CounterView(props: {
	readonly data: unknown;
	readonly press: (m: {readonly type: "plus"}) => void;
}) {
	return (
		<section className="counter">
			<output className="count" data-count="">
				{countIn(props.data)}
			</output>
			<button type="button" className="plus" onClick={() => props.press({type: "plus"})}>
				+1
			</button>
		</section>
	);
}
