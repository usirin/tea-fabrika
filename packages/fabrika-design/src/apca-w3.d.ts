// apca-w3 0.1.9 has no declarations. Keep only the numeric API used by the checker.
declare module "apca-w3" {
	export function sRGBtoY(rgb: readonly [number, number, number]): number;
	export function APCAcontrast(text: number, background: number): number;
}
