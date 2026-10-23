import {KEPT_OUT} from "@kampus/fabrika/agents/trace";
import type {Viewing} from "@kampus/fabrika/otel";
import {wentWrong} from "../stages/outcome.ts";

/**
 * How fabrika's spans are shown (./view.ts): a stage outcome that went wrong
 * (stuck, ask, sent back to the builder) is red, and a value an agent's spans
 * kept out of export is dropped. The view itself knows neither.
 */
export const FABRIKA_VIEWING: Viewing = {wentWrong, keptOut: KEPT_OUT};
