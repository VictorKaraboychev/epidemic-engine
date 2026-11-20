import { Pathogen } from "../pathogens/pathogen.js";
import { Population } from "../pathogens/types.js";
/**
 * Measures what a preset's simulated outbreaks actually do, for validation against the literature: the mean
 * generation interval (days from an infector's infection to their infectee's), the reproduction number in the early
 * epidemic (secondary infections per case among the first cases), the dispersion of those offspring counts
 * (negative binomial k, by moments) and the share caused by the most infectious 20%, and the doubling time.
 */
import { type PathogenId } from "../pathogens/index.js";
import { compileModel, ratesFor } from "../model.js";
import { buildPopulationNetwork, indexCaseOrder, luckSeed, seededIndexCases } from "../population.js";
import { availableFeatures, pathogenParams, solveTransmission } from "../presets.js";
import { seededRandom } from "../random.js";
import { reproductionCurve } from "../reproduction.js";
import { seirdModel } from "../seird.js";
import { createEpidemic, infectedCount, stepEpidemic } from "../stochastic.js";
import { seirdParams } from "../test-support.js";

/** Superspreading's k when a disease has none (it then has no superspreading either: only for completeness). */
const DEFAULT_DISPERSION = 0.3;

export interface Measured {
    beta: number;
    generationInterval: number;
    earlyR: number;
    dispersion: number;
    top20: number;
    doublingDays: number;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

export const measurePreset = (
    presetId: PathogenId,
    options: {
        superspreading?: boolean;
        contactsOnly?: boolean;
        people?: number;
        runs?: number;
        seed?: number;
        infectiousScale?: number;
        infectiousnessHalfLife?: number;
    } = {},
): Measured => {
    const people = options.people ?? 20_000;
    const intervals: number[] = [];
    const early: number[] = [];
    const doubling: number[] = [];
    let beta = 0;
    for (let run = 0; run < (options.runs ?? 6); run++) {
        const seed = (options.seed ?? 1000) + run;
        const pathogen = Pathogen.get(presetId);
        const { contacts, vaccineCoverage: _coverage, dispersion: k, ...preset } = pathogenParams(pathogen, Population.All);
        const superspreading = (options.superspreading ?? false) && availableFeatures(pathogen).superspreading;
        // Calibration: scale both infectious periods (the preset's R₀ is still solved for).
        const scale = options.infectiousScale ?? 1;
        const base = seirdParams({
            ...preset,
            ifr: 0,
            recoveryDays: preset.recoveryDays! * scale,
            deathDays: preset.deathDays! * scale,
            ...(options.infectiousnessHalfLife !== undefined ? { infectiousnessHalfLife: options.infectiousnessHalfLife } : {}),
        });
        const network = buildPopulationNetwork({ seed, people, contacts: contacts!, superspreading: superspreading });
        const model = seirdModel({ exposed: availableFeatures(pathogen).exposed, waning: false });
        const solved = solveTransmission({
            model,
            params: base,
            reproduction: reproductionCurve(network, seededRandom(seed)),
            r0: pathogen.values.r0.value,
            dispersion: superspreading ? (k ?? DEFAULT_DISPERSION) : null,
        });
        beta = solved.beta;
        const dispersion = superspreading && !options.contactsOnly && solved.dispersion ? solved.dispersion : null;
        const params = { ...base, beta, dispersion };
        const compiled = compileModel(model);
        const rates = ratesFor(model, params);
        const random = seededRandom(luckSeed(seed, 0));
        let state = createEpidemic(model, network, seededIndexCases(indexCaseOrder(seed, people), network, 5));
        const infectedOn = new Int32Array(people).fill(-1);
        for (const person of state.indexCases) infectedOn[person] = 0;
        let cumulative = state.indexCases.length;
        const cumulativeByDay = [cumulative];
        for (let day = 0; day < 730 && infectedCount(compiled, state.counts) > 0; day++) {
            const before = state.states;
            state = stepEpidemic(model, network, state, rates, random);
            for (let person = 0; person < people; person++) {
                if (before[person] === 0 && state.states[person] !== 0) {
                    infectedOn[person] = state.day;
                    cumulative++;
                }
            }
            cumulativeByDay.push(cumulative);
        }
        const offspring = new Int32Array(people);
        state.infectedBy.forEach((infector, person) => {
            if (infector < 0) return;
            offspring[infector]++;
            intervals.push(infectedOn[person] - infectedOn[infector]);
        });
        // Early cases: infected before 0.5% of people had been (index cases excluded: they have no infector).
        const earlyUntil = cumulativeByDay.findIndex((count) => count > 0.005 * people);
        if (earlyUntil > 0) infectedOn.forEach((day, person) => day > 0 && day <= earlyUntil && early.push(offspring[person]));
        const from = cumulativeByDay.findIndex((count) => count > 0.01 * people);
        const to = cumulativeByDay.findIndex((count) => count > 0.04 * people);
        if (from > 0 && to > from) doubling.push((to - from) / 2);
    }
    const r = mean(early);
    const variance = mean(early.map((count) => (count - r) ** 2));
    const sorted = [...early].sort((a, b) => b - a);
    const total = sorted.reduce((sum, count) => sum + count, 0);
    return {
        beta,
        generationInterval: mean(intervals),
        earlyR: r,
        dispersion: variance > r ? (r * r) / (variance - r) : Infinity,
        top20: sorted.slice(0, Math.ceil(sorted.length * 0.2)).reduce((sum, count) => sum + count, 0) / Math.max(1, total),
        doublingDays: doubling.length ? mean(doubling) : NaN,
    };
};
