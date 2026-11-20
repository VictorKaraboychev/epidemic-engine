// Times the work that has to stay fast, and fails if any takes more than its budget. Budgets are about four times
// what a laptop takes (CI machines are slower and vary), so only a real slowdown fails: update them when a change
// makes something faster for good. Writes a table to the GitHub job summary when there is one.
import { appendFileSync } from "node:fs";
import { Outbreak, Pathogen, Population, runOutbreaks } from "../dist/index.js";

const BUDGETS_MS = {
    "1M people: population (network, ages)": 6_500,
    "1M people: outbreak setup (R₀ curve, transmission rate)": 1_200,
    "200k people: COVID-19 outbreak, whole run": 600,
    "100 runs of COVID-19 in 20k people (runOutbreaks)": 4_500,
};

const time = (fn) => {
    const start = performance.now();
    const result = fn();
    return { ms: performance.now() - start, result };
};
const results = [];
const measure = (name, fn) => {
    const { ms, result } = time(fn);
    results.push({ name, ms, budget: BUDGETS_MS[name] });
    return result;
};

const population = measure("1M people: population (network, ages)", () => new Population({ people: 1_000_000, contacts: 8, seed: 1 }));
measure("1M people: outbreak setup (R₀ curve, transmission rate)", () => new Outbreak({ pathogen: Pathogen.CovidAncestral, population }));
const outbreak = new Outbreak({ pathogen: Pathogen.CovidAncestral, people: 200_000, seed: 2, initialCases: 20 });
measure("200k people: COVID-19 outbreak, whole run", () => outbreak.run());
measure("100 runs of COVID-19 in 20k people (runOutbreaks)", () => runOutbreaks({ pathogen: Pathogen.CovidAncestral, people: 20_000, runs: 100, seed: 3 }));

const rows = results.map(({ name, ms, budget }) => `| ${name} | ${ms.toFixed(0)} ms | ${budget} ms | ${ms <= budget ? "✓" : "✗ over budget"} |`);
const table = ["| Work | Took | Budget | |", "| --- | --- | --- | --- |", ...rows].join("\n");
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Performance\n\n${table}\n`);
const over = results.filter(({ ms, budget }) => ms > budget);
if (over.length) {
    console.error(`Over budget: ${over.map(({ name }) => name).join("; ")}`);
    process.exit(1);
}
