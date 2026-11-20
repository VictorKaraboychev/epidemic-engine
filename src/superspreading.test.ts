import { describe, expect, it } from "vitest";
import { compileModel, ratesFor } from "./model.js";
import { buildNetwork } from "./network.js";
import { estimateR0 } from "./r0.js";
import { gammaMeanOne, seededRandom } from "./random.js";
import { treeCurve } from "./reproduction.js";
import { type SeirdModelParams, seirdModel } from "./seird.js";
import { createEpidemic, infectedCount, stepEpidemic } from "./stochastic.js";
import { offspringCounts, superspreaders, topCasesShare } from "./superspreading.js";
import { DESKTOP } from "./test-support.js";

const MODEL = seirdModel({ exposed: false, waning: false });
const PARAMS: SeirdModelParams = {
    beta: 0.3,
    recoveryDays: 5,
    deathDays: 5,
    ifr: 0,
    latentDays: 3,
    latentVariation: 0.5,
    immunityHalfLife: 180,
    dispersion: null,
};

describe("gamma infectiousness", () => {
    it("has mean 1 and variance 1/k", () => {
        for (const k of [0.1, 0.5, 2]) {
            const random = seededRandom(11);
            const draws = Array.from({ length: 40000 }, () => gammaMeanOne(random, k));
            const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
            const variance = draws.reduce((sum, x) => sum + (x - mean) ** 2, 0) / draws.length;
            expect(mean).toBeCloseTo(1, 1);
            expect(variance / (1 / k)).toBeGreaterThan(0.8);
            expect(variance / (1 / k)).toBeLessThan(1.25);
        }
    });
});

describe("topCasesShare", () => {
    it("counts each person's infections and the share caused by the top 20%", () => {
        // Person 0 infected 1–8; person 1 infected 9; everyone 0–9 was infected; 10–24 never were.
        const infectedBy = Int32Array.from({ length: 25 }, (_, i) => (i >= 1 && i <= 8 ? 0 : i === 9 ? 1 : -1));
        expect(offspringCounts(infectedBy)[0]).toBe(8);
        const states = Uint8Array.from({ length: 25 }, (_, i) => (i < 10 ? 2 : 0));
        expect(topCasesShare(states, infectedBy)).toBeNull(); // only 10 cases: too few to say
        const many = Uint8Array.from({ length: 25 }, () => 2);
        // 25 cases → top 5; they caused all 9 infections.
        expect(topCasesShare(many, infectedBy)).toBe(1);
    });
});

describe("superspreading in the simulation", () => {
    /** Share of infections caused by the top 20% of cases, pooled over several outbreaks. */
    const concentration = (dispersion: number | null, contactVariation?: number) => {
        let shares = 0;
        let runs = 0;
        for (let seed = 1; seed <= 30 && runs < 8; seed++) {
            const network = buildNetwork(seededRandom(seed), { ...DESKTOP, contactVariation });
            const rates = ratesFor(MODEL, { ...PARAMS, dispersion });
            const random = seededRandom(seed * 7);
            let state = createEpidemic(MODEL, network, [0, 1, 2]);
            while (infectedCount(compileModel(MODEL), state.counts) > 0) state = stepEpidemic(MODEL, network, state, rates, random);
            const share = topCasesShare(state.states, state.infectedBy);
            if (share !== null && state.everInfectedCount > 50) {
                shares += share;
                runs++;
            }
        }
        return shares / runs;
    };

    it("concentrates infections in fewer people as dispersion falls and contacts vary", () => {
        const even = concentration(null);
        const superspreading = concentration(0.1, 0.5);
        expect(superspreading).toBeGreaterThan(even + 0.15);
        expect(superspreading).toBeGreaterThan(0.6);
    });

    it("lowers R₀ at the same transmission rate (the most infectious can't infect a contact twice), so presets solve for a higher β", () => {
        const even = estimateR0(MODEL, PARAMS, treeCurve(4));
        const varied = estimateR0(MODEL, { ...PARAMS, dispersion: 0.1 }, treeCurve(4));
        expect(varied).toBeLessThan(even * 0.6);
        expect(varied).toBeGreaterThan(even * 0.2);
    });
});

describe("superspreader options", () => {
    it("list everyone over the bar by default, or only the most prolific up to a limit", () => {
        const offspring = Int32Array.from([0, 5, 9, 2, 7, 12, 5]);
        const people = (pairs: Int32Array) => Array.from(pairs).filter((_, i) => i % 2 === 0);
        expect(people(superspreaders(offspring))).toEqual([1, 2, 4, 5, 6]);
        expect(people(superspreaders(offspring, { limit: 2 }))).toEqual([2, 5]);
        expect(people(superspreaders(offspring, { minInfected: 8 }))).toEqual([2, 5]);
    });
});
