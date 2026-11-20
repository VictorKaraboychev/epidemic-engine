/**
 * Many outbreaks of the same setup at once: one run of a stochastic model says little, so `runOutbreaks` runs many on
 * one population (built once) and sums them up, separating the outbreaks that took off from those that fizzled.
 *
 *     const result = runOutbreaks({ pathogen: Pathogen.Measles, people: 20_000, runs: 200 });
 *     result.major.attackRate; // { median, low, high, mean } over the outbreaks that took off
 *     result.fizzled; // the share that died out early
 */
import { DEFAULT_MAX_DAYS, Outbreak, type OutbreakOptions, type OutbreakSetup, type OutbreakSummary, prepareOutbreak } from "./outbreak.js";
import type { Pathogen } from "./pathogens/pathogen.js";
import { seededRandom } from "./random.js";

export interface EnsembleOptions extends Omit<OutbreakOptions, "run"> {
    /** How many outbreaks. Default 100. */
    runs?: number;
    /** Days each runs at most. Default `DEFAULT_MAX_DAYS`. */
    maxDays?: number;
    /**
     * Draw the pathogen's values from their published uncertainty for each run (see `Pathogen.sample`), so the spread
     * reflects what isn't known as well as chance. Default false.
     */
    uncertainty?: boolean;
}

/** A measure across runs: its median and the middle 95% (2.5th to 97.5th percentiles), and its mean. */
export interface Spread {
    median: number;
    low: number;
    high: number;
    mean: number;
}

export interface EnsembleMeasures {
    /** How many runs these cover. */
    runs: number;
    attackRate: Spread;
    deaths: Spread;
    peakInfected: Spread;
    peakDay: Spread;
    /** How long outbreaks lasted (or ran, if cut off at `maxDays`). */
    days: Spread;
}

export interface EnsembleResult {
    /** Every run's summary, in order. */
    summaries: OutbreakSummary[];
    /** The share of runs that fizzled: died out having infected under `MAJOR_OUTBREAK_SHARE` of people. */
    fizzled: number;
    /** Over every run, and over those that took off (null if none did). */
    all: EnsembleMeasures;
    major: EnsembleMeasures | null;
}

/** An outbreak that infected at least this share of people took off (a major outbreak); below it, it fizzled. */
export const MAJOR_OUTBREAK_SHARE = 0.01;
/** Mixed into the seed for each run's draw of uncertain values. */
const UNCERTAINTY_SALT = 0x1b873593;

/** The value at quantile `q` (0–1) of sorted values, interpolated between neighbours. */
const quantile = (sorted: number[], q: number) => {
    if (!sorted.length) return NaN;
    const at = q * (sorted.length - 1);
    const below = Math.floor(at);
    const above = Math.min(sorted.length - 1, below + 1);
    return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
};

/** Median, middle 95% and mean of some values. */
export const spreadOf = (values: number[]): Spread => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        median: quantile(sorted, 0.5),
        low: quantile(sorted, 0.025),
        high: quantile(sorted, 0.975),
        mean: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
    };
};

const measuresOf = (summaries: OutbreakSummary[]): EnsembleMeasures => ({
    runs: summaries.length,
    attackRate: spreadOf(summaries.map((summary) => summary.attackRate)),
    deaths: spreadOf(summaries.map((summary) => summary.deaths)),
    peakInfected: spreadOf(summaries.map((summary) => summary.peak.infected)),
    peakDay: spreadOf(summaries.map((summary) => summary.peak.day)),
    days: spreadOf(summaries.map((summary) => summary.days)),
});

/**
 * Runs `runs` outbreaks of one setup: the same people and contacts, each run with its own luck and index cases (and,
 * with `uncertainty`, its own draw of the pathogen's values). Seeded: the same options give the same result.
 */
export const runOutbreaks = ({ runs = 100, maxDays = DEFAULT_MAX_DAYS, uncertainty = false, ...options }: EnsembleOptions = {}): EnsembleResult => {
    if (!(runs >= 1 && Number.isInteger(runs))) throw new RangeError(`runs must be a whole number of at least 1, not ${runs}`);
    const setup = prepareOutbreak(options);
    const seed = setup.population.seed;
    const sampling = uncertainty && setup.pathogen ? seededRandom(seed ^ UNCERTAINTY_SALT) : null;
    const summaries: OutbreakSummary[] = [];
    for (let run = 0; run < runs; run++) {
        const runSetup: OutbreakSetup = sampling ? prepareOutbreak({ ...options, pathogen: (setup.pathogen as Pathogen).sample(sampling) }, setup) : setup;
        summaries.push(new Outbreak({ ...options, run }, runSetup).run(maxDays));
    }
    const major = summaries.filter((summary) => summary.attackRate >= MAJOR_OUTBREAK_SHARE);
    return {
        summaries,
        fizzled: (summaries.length - major.length) / summaries.length,
        all: measuresOf(summaries),
        major: major.length ? measuresOf(major) : null,
    };
};
