// P10's smallest failing case: Chromium exits before a WebAuthn assertion can be made.
// No credential, key file, server or network request is involved.
import {chromium} from "../apps/fabrika/node_modules/playwright/index.mjs";

const browser = await chromium.launch({headless: true});
console.log(await browser.version());
await browser.close();
