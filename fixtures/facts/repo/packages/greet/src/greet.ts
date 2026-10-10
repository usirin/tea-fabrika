export type Greeting = { readonly text: string };

/** Greet one person by name. */
export function greet(name: string, options: { loud?: boolean } = {}): Greeting {
  return { text: options.loud === true ? shout(`hello ${name}`) : `hello ${name}` };
}

function shout(text: string): string {
  return text.toUpperCase();
}
