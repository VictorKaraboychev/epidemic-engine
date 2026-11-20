// Checks the package works in a browser: both entries bundle for the browser (esbuild refuses Node built-ins there),
// and the bundle runs an outbreak in a bare JavaScript sandbox, without Node's globals (no process, require or Buffer).
import { build } from "esbuild";
import vm from "node:vm";

const entries = { index: "dist/index.js", advanced: "dist/advanced.js" };
for (const [name, entry] of Object.entries(entries)) {
    const result = await build({ entryPoints: [entry], bundle: true, platform: "browser", format: "esm", minify: true, write: false, logLevel: "error" });
    console.log(`${name}: bundles for the browser, ${(result.outputFiles[0].contents.length / 1024).toFixed(0)} KB minified`);
}

const { outputFiles } = await build({
    entryPoints: [entries.index],
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "EpidemicEngine",
    write: false,
    logLevel: "error",
});
const sandbox = vm.createContext({ console });
vm.runInContext(outputFiles[0].text, sandbox);
const summary = vm.runInContext(`new EpidemicEngine.Outbreak({ pathogen: EpidemicEngine.Pathogen.Measles, people: 2000, seed: 1 }).run()`, sandbox);
if (!(summary.everInfected > 1)) throw new Error(`The browser bundle ran, but the outbreak didn't spread: ${JSON.stringify(summary)}`);
for (const global of ["process", "require", "Buffer"])
    if (vm.runInContext(`typeof ${global}`, sandbox) !== "undefined") throw new Error(`${global} leaked into the sandbox`);
console.log(`runs without Node's globals: measles in 2,000 people infected ${summary.everInfected} in ${summary.days} days`);
