import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "./index.js";

describe("VERSION", () => {
    it("matches package.json and the changelog's latest release", () => {
        const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
        expect(VERSION).toBe(version);
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
        const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
        expect(changelog.match(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/m)?.[1]).toBe(VERSION);
    });
});
