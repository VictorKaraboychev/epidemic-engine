// Checks the package as a user gets it: packs it, installs the tarball in an empty project, then type-checks (strict,
// as an ES module) and runs every TypeScript example in the README, as written, plus an import from /advanced.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = (command, args, cwd) => {
    try {
        return execFileSync(command, args, { cwd, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
    } catch (error) {
        // tsc reports on stdout: show it.
        process.stdout.write(error.stdout ?? "");
        throw error;
    }
};
const project = mkdtempSync(path.join(tmpdir(), "epidemic-engine-consumer-"));
try {
    const tarball = run("npm", ["pack", "--silent", "--pack-destination", project], root).trim().split("\n").pop();
    const { devDependencies } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
    run(
        "npm",
        [
            "install",
            "--no-audit",
            "--no-fund",
            "--silent",
            path.join(project, tarball),
            `typescript@${devDependencies.typescript}`,
            `@types/node@${devDependencies["@types/node"]}`,
        ],
        project,
    );

    // Every ```ts block in the README, each in its own scope, with their imports hoisted together.
    const blocks = [...readFileSync(path.join(root, "README.md"), "utf8").matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
    const imports = new Set();
    const bodies = blocks.map((block, index) => {
        for (const [, names] of block.matchAll(/import \{([^}]*)\} from "epidemic-engine";/g)) for (const name of names.split(",")) imports.add(name.trim());
        return `{ // README example ${index + 1}\n${block.replace(/import \{[^}]*\} from "epidemic-engine";\n/g, "")}}\n`;
    });
    const source = [
        `import { ${[...imports].filter(Boolean).sort().join(", ")} } from "epidemic-engine";`,
        `import { createEpidemic, solveTransmission } from "epidemic-engine/advanced";`,
        `if (typeof createEpidemic !== "function" || typeof solveTransmission !== "function") throw new Error("epidemic-engine/advanced is incomplete");`,
        ...bodies,
        `console.log("${blocks.length} README examples type-checked and ran");`,
    ].join("\n");
    writeFileSync(path.join(project, "readme.ts"), source);
    writeFileSync(
        path.join(project, "tsconfig.json"),
        JSON.stringify({
            compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, outDir: "out", lib: ["ES2023", "DOM"] },
            include: ["readme.ts"],
        }),
    );
    run("npx", ["tsc", "-p", "."], project);
    process.stdout.write(run("node", ["out/readme.js"], project));
} finally {
    rmSync(project, { recursive: true, force: true });
}
