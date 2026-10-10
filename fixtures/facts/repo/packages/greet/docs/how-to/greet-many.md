# Greet many people at once

Hand `greetAll` the names; it greets each the way `greet` does.

```ts
import { greetAll } from "@toy/greet/extra";
import { greet as hello } from "@toy/greet";

const names = ["ada", "bob"];
expect(greetAll(names)).toHaveLength(2);
console.log(hello("ada").text);
```
