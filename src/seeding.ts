/**
 * Seeded choices for a run: who starts infected, who is vaccinated, and each run's luck. The same seed always makes
 * the same choices, so a seed and a run number replay an outbreak exactly.
 */
import type { Network } from "./network.js";
import { seededOrder, seededRandom } from "./random.js";

/** Mixed into the seed for the index-case draw, so it is independent of the network layout draw. */
const INDEX_CASE_SALT = 0x9e3779b9;
/** Mixed into the seed (with the run number) for each run's transmission and recovery luck. */
const LUCK_SALT = 0x85ebca6b;
/** Mixed into the seed for the order people are vaccinated in. */
const VACCINATION_SALT = 0xc2b2ae35;

/**
 * Seeded order in which people become index cases: k initial cases are always the first k connected people in this
 * order, so changing k adds and removes the same people instead of re-drawing them.
 */
export const indexCaseOrder = (seed: number, population: number) => seededOrder(population, seededRandom(seed ^ INDEX_CASE_SALT));

/** Who gets vaccinated first, from the seed (its own order, so the vaccinated aren't the first index cases). */
export const vaccinationOrder = (seed: number, population: number) => seededOrder(population, seededRandom(seed ^ VACCINATION_SALT));

/** How many people a coverage vaccinates. */
export const vaccinatedCount = (coverage: number, population: number) => Math.round(Math.min(1, Math.max(0, coverage)) * population);

/** The vaccinated: the first `count` people in `order` who aren't index cases (they start infected instead). */
export const seededVaccinated = (order: number[], indexCases: number[], count: number) => {
    const cases = new Set(indexCases);
    const vaccinated: number[] = [];
    for (let k = 0; k < order.length && vaccinated.length < count; k++) if (!cases.has(order[k])) vaccinated.push(order[k]);
    return vaccinated;
};

/** The first `count` people in `order` who have at least one contact on `network`. */
export const seededIndexCases = (order: number[], network: Pick<Network, "offsets" | "count">, count: number) => {
    const cases: number[] = [];
    for (let k = 0; k < order.length && cases.length < count; k++) {
        const node = order[k];
        if (node < network.count && network.offsets[node + 1] > network.offsets[node]) cases.push(node);
    }
    return cases;
};

/** The seed for a run's luck: the same setup seed and run number replay the same outbreak exactly. */
export const luckSeed = (seed: number, run: number) => (Math.imul(seed ^ LUCK_SALT, 0x27d4eb2d) + Math.imul(run + 1, 0x165667b1)) | 0;

/**
 * The vaccinated when coverage differs by person (by age): within each coverage level, that share of its people,
 * taken in `order` (index cases skipped), so the same seed vaccinates the same people.
 */
export const seededVaccinatedByCoverage = (order: number[], indexCases: number[], coverageOf: (person: number) => number) => {
    const cases = new Set(indexCases);
    const sizes = new Map<number, number>();
    for (const person of order) sizes.set(coverageOf(person), (sizes.get(coverageOf(person)) ?? 0) + 1);
    const left = new Map([...sizes].map(([coverage, size]) => [coverage, vaccinatedCount(coverage, size)]));
    const vaccinated: number[] = [];
    for (const person of order) {
        const coverage = coverageOf(person);
        const quota = left.get(coverage)!;
        if (quota <= 0 || cases.has(person)) continue;
        vaccinated.push(person);
        left.set(coverage, quota - 1);
    }
    return vaccinated;
};
