import { greet } from "./greet";

export function greetAll(names: readonly string[]) {
  return names.map((name) => greet(name));
}

export function greetLoudly(name: string) {
  return greet(name, { loud: true });
}
