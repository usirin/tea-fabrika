import type {WindowProps} from "@kampus/fabrika-old";
import type {counter} from "./index.ts";

// The counter's window: a React component that draws its view and sends its presses. It is
// handed both by whatever shows it (the fabrika app, for now); it holds no state of its own.

export function CounterWindow({view, commands}: WindowProps<typeof counter>) {
	return (
		<section className="counter" aria-label="counter">
			<output className="counter-n" aria-label="count">
				{view.n}
			</output>
			<div className="counter-keys">
				<button type="button" {...commands.plus.control}>
					+1
				</button>
				<button type="button" {...commands.done.control}>
					done
				</button>
			</div>
		</section>
	);
}
