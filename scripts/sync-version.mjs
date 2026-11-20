// Writes package.json's version into src/version.ts (run by `npm version`, so the two never drift).
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
writeFileSync(
    new URL("../src/version.ts", import.meta.url),
    `/** This package's version (semantic versioning; see CHANGELOG.md). Kept in step with package.json by \`npm version\`. */\nexport const VERSION = "${version}";\n`,
);
console.log(`src/version.ts: ${version}`);
