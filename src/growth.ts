/**
 * Timing the reference curve to the network. On a contact network, people are often exposed by several infectious
 * contacts at once and the first one infects them, so infections follow each other faster than the disease's own
 * infectiousness timeline (the realized generation interval is shorter: measles' ≈ 11.7 days, as published, against
 * ≈ 15.5 for the timeline alone), and the more contagious the disease the more so: generation-interval contraction
 * (Kenah, Lipsitch & Robins 2008). A well-mixed model has none of that, and an outbreak's first days on a network are a matter of luck. So a few
 * quick outbreaks are run on the network itself to measure how fast infections grow and when they get going, and the
 * reference curve keeps its R₀ but runs its stages at that pace, from that start.
 */
import type { Theory } from "./deterministic.js";
import type { CompartmentModel, CompiledModel, ModelParams, Rates } from "./model.js";
import type { Network } from "./network.js";
import type { Random } from "./random.js";
import { advanceEpidemic, createEpidemic, infectedCount } from "./stochastic.js";

/** How an outbreak on this network grows early on: the log-growth rate per day, and the mean day it passes `low`. */
export interface EarlyGrowth {
    rate: number;
    reachDay: number;
    low: number;
    high: number;
}

/** Quick outbreaks per measurement. */
export const GROWTH_RUNS = 12;
/** Below this many people, early growth is too short and noisy to measure: the reference curve keeps its own pace. */
export const MIN_GROWTH_PEOPLE = 2000;
/**
 * Growth is measured while between these shares of people have ever been infected: late enough that luck in the first
 * few cases has settled (a run that takes off from one case got lucky early), early enough that few are immune.
 */
const LOW_SHARE = 0.002;
const LOW_MIN = 50;
const HIGH_SHARE = 0.03;
/** Quick outbreaks stop at this many infections however large the network (enough to measure growth). */
const HIGH_MAX = 30_000;
/** A run that hasn't got going by then is dropped. */
const MAX_GROWTH_DAYS = 400;

/** The ever-infected counts growth is measured between, or null if the network is too small. */
export const growthWindow = (population: number) => {
    if (population < MIN_GROWTH_PEOPLE) return null;
    const low = Math.max(LOW_MIN, LOW_SHARE * population);
    const high = Math.min(HIGH_MAX, HIGH_SHARE * population);
    return high >= 4 * low ? { low, high } : null;
};

/** Least-squares slope of log(count) against day, over the days the count is within [low, high]; NaN with too few. */
export const logGrowth = (cumulative: ArrayLike<number>, low: number, high: number) => {
    let n = 0;
    let sumX = 0;
    let sumY = 0;
    for (let day = 0; day < cumulative.length; day++) {
        if (cumulative[day] < low || cumulative[day] > high) continue;
        n++;
        sumX += day;
        sumY += Math.log(cumulative[day]);
    }
    if (n < 3) return NaN;
    const [meanX, meanY] = [sumX / n, sumY / n];
    let covariance = 0;
    let variance = 0;
    for (let day = 0; day < cumulative.length; day++) {
        if (cumulative[day] < low || cumulative[day] > high) continue;
        covariance += (day - meanX) * (Math.log(cumulative[day]) - meanY);
        variance += (day - meanX) ** 2;
    }
    return variance > 0 ? covariance / variance : NaN;
};

/**
 * Runs `GROWTH_RUNS` quick outbreaks on the network (from `initialCases` random people with contacts, with the
 * `vaccinated` vaccinated first) until `high` people have been infected, and averages how fast those that take off
 * grow and when they pass `low`. Null for a small network, or if none take off.
 */
export const measureEarlyGrowth = <P extends ModelParams>(
    model: CompartmentModel<P>,
    compiled: CompiledModel,
    network: Network,
    rates: Rates,
    initialCases: number,
    vaccinated: number[],
    random: Random,
): EarlyGrowth | null => {
    const window = growthWindow(network.count);
    if (!window) return null;
    const { low, high } = window;
    const growthRates: number[] = [];
    const reach: number[] = [];
    for (let run = 0; run < GROWTH_RUNS; run++) {
        const cases: number[] = [];
        for (let tries = 0; cases.length < Math.max(1, initialCases) && tries < 1000; tries++) {
            const person = Math.floor(random() * network.count);
            if (network.offsets[person + 1] > network.offsets[person]) cases.push(person);
        }
        const state = createEpidemic(model, network, cases, vaccinated, random);
        const cumulative = [state.everInfectedCount];
        while (state.everInfectedCount < high && infectedCount(compiled, state.counts) > 0 && state.day < MAX_GROWTH_DAYS) {
            advanceEpidemic(model, network, state, rates, random);
            cumulative.push(state.everInfectedCount);
        }
        const rate = logGrowth(cumulative, low, high);
        if (!Number.isFinite(rate) || rate <= 0) continue;
        growthRates.push(rate);
        reach.push(cumulative.findIndex((count) => count >= low));
    }
    if (!growthRates.length) return null;
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    return { rate: mean(growthRates), reachDay: mean(reach), low, high };
};

/**
 * Ever infected in the reference curve, per day: the initial cases plus everyone who has left the never-infected
 * compartments (the first, and the vaccinated) since day 0.
 */
export const theoryInfections = (theory: Theory, neverInfected: number[], initialCases: number) => {
    const pool = (day: number) => neverInfected.reduce((sum, c) => sum + theory.series[c][day], 0);
    const start = pool(0);
    return Float64Array.from({ length: theory.days + 1 }, (_, day) => initialCases + start - pool(day));
};

/**
 * How to time the reference curve to the network: the factor its stages are scaled by so it grows as fast as `growth`
 * (found in a few steps: halving the stages doubles the growth rate), and the days it's then shifted by so it passes
 * `growth.low` on the same day on average.
 */
export const calibrateTheory = (theoryOf: (scale: number) => Theory, neverInfected: number[], initialCases: number, growth: EarlyGrowth) => {
    let scale = 1;
    for (let round = 0; round < 3; round++) {
        const rate = logGrowth(theoryInfections(theoryOf(scale), neverInfected, initialCases), growth.low, growth.high);
        if (!Number.isFinite(rate) || rate <= 0) return { scale: 1, shift: 0 };
        scale *= rate / growth.rate;
    }
    const reached = theoryInfections(theoryOf(scale), neverInfected, initialCases).findIndex((count) => count >= growth.low);
    return { scale, shift: reached < 0 ? 0 : Math.round(growth.reachDay - reached) };
};

/** The curve moved `shift` days later (holding day 0 before it) or earlier (from day `−shift`, holding the end). */
export const shiftTheory = (theory: Theory, shift: number): Theory => {
    if (!shift) return theory;
    const move = (values: Float64Array) =>
        Float64Array.from({ length: values.length }, (_, day) => values[Math.min(values.length - 1, Math.max(0, day - shift))]);
    return { ...theory, series: theory.series.map(move), infected: move(theory.infected) };
};
