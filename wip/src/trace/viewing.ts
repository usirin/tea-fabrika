import type {Viewing} from "../../../packages/tsh/src/trace/view.ts";
import {wentWrong} from "../stages/outcome.ts";
import {KEPT_OUT} from "./agent.ts";

/**
 * How fabrika's spans are shown (./view.ts): a stage outcome that went wrong
 * (stuck, ask, sent back to the builder) is red, and a value an agent's spans
 * kept out of export is dropped. The view itself knows neither.
 */
export const FABRIKA_VIEWING: Viewing = {wentWrong, keptOut: KEPT_OUT};
