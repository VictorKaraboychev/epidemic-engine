import { Pathogen } from "./pathogens/types.js";
import { Population } from "./pathogens/types.js";
import { describe, expect, it } from "vitest";
import { deterministicCurve } from "./deterministic.js";
import { getPathogen } from "./pathogens/index.js";
import { compileModel, ratesFor, waningSusceptibility } from "./model.js";
import { buildNetwork } from "./network.js";
import { pathogenParams } from "./presets.js";
import { estimateR0 } from "./r0.js";
import { mulberry32 } from "./random.js";
import { treeCurve } from "./reproduction.js";
import { type SimulationModelParams, simulationModel } from "./seird.js";
import { createEpidemic, infectedCount, stepEpidemic } from "./stochastic.js";
import { DESKTOP } from "./test-support.js";

const PARAMS: SimulationModelParams = { beta: 0.35, recoveryDays: 5, deathDays: 5, ifr: 0, latentDays: 2, latentVariation: 0.5, immunityHalfLife: 60 };
const WANING = simulationModel({ exposed: false, waning: true });
const PLAIN = simulationModel({ exposed: false, waning: false });
const [, , R] = [0, 1, 2];

describe("waning immunity", () => {
    it("halves protection every half-life", () => {
        const susceptibility = waningSusceptibility(100);
        expect(susceptibility(0)).toBe(0);
        expect(susceptibility(100)).toBeCloseTo(0.5);
        expect(susceptibility(200)).toBeCloseTo(0.75);
    });

    it("builds one model per feature combination, named for its compartments", () => {
        expect(simulationModel({ exposed: true, waning: true })).toBe(simulationModel({ exposed: true, waning: true }));
        expect(simulationModel({ exposed: true, waning: true }).compartments.map((c) => c.key)).toEqual(["s", "e", "i", "r", "d"]);
        expect(WANING.name).toBe("SIRD with waning immunity");
        expect(compileModel(WANING).waning[R]).toBe(1);
    });

    it("lets recovered people be infected again only once they've lost protection, at the curve's pace", () => {
        const network = buildNetwork(mulberry32(41), DESKTOP);
        const random = mulberry32(7);
        const rates = ratesFor(WANING, PARAMS);
        let state = createEpidemic(WANING, network, [0, 1, 2]);
        const recoveredOn = new Map<number, number>();
        const delays: number[] = [];
        for (let day = 0; day < 400 && infectedCount(compileModel(WANING), state.counts) > 0; day++) {
            const before = state;
            state = stepEpidemic(WANING, network, state, rates, random);
            state.states.forEach((compartment, person) => {
                if (compartment === R && before.states[person] !== R) recoveredOn.set(person, state.day);
                if (before.states[person] === R && compartment !== R) delays.push(state.day - recoveredOn.get(person)!);
            });
        }
        expect(delays.length).toBeGreaterThan(0);
        // At most the share who have lost protection (it halves every 60 days) can be reinfected that soon.
        const lapsed = waningSusceptibility(PARAMS.immunityHalfLife);
        for (const days of [5, 15, 30]) {
            expect(delays.filter((delay) => delay <= days).length / recoveredOn.size).toBeLessThanOrEqual(lapsed(days) + 0.03);
        }
    });

    it("never reinfects anyone without waning", () => {
        const network = buildNetwork(mulberry32(41), DESKTOP);
        const random = mulberry32(7);
        const rates = ratesFor(PLAIN, PARAMS);
        let state = createEpidemic(PLAIN, network, [0, 1, 2]);
        for (let day = 0; day < 400; day++) {
            const before = state;
            state = stepEpidemic(PLAIN, network, state, rates, random);
            state.states.forEach((compartment, person) => expect(before.states[person] === R && compartment !== R).toBe(false));
        }
    });

    it("counts recovered people whose protection has lapsed as susceptible", () => {
        // Half-life 60 days, no delay: 60 days after recovering, about half of a cohort counts as susceptible.
        const theory = deterministicCurve(WANING, { ...PARAMS, beta: 0, immunityHalfLife: 60 }, 0.0001, 1000, 1000, 200);
        const recoveredOnDay = 6; // ≈ when the index cases have recovered
        expect(theory.series[R][recoveredOnDay + 60] / (theory.series[R][recoveredOnDay + 60] + theory.series[0][recoveredOnDay + 60])).toBeLessThan(0.7);
        for (const day of [0, 50, 200]) expect(theory.series.reduce((sum, series) => sum + series[day], 0)).toBeCloseTo(1000, 6);
    });

    it("keeps R₀ unchanged, and gives the theory curve a second wave once immunity has faded", () => {
        expect(estimateR0(WANING, PARAMS, treeCurve(4))).toBeCloseTo(estimateR0(PLAIN, PARAMS, treeCurve(4)));
        const theory = deterministicCurve(WANING, { ...PARAMS, immunityHalfLife: 90 }, 2.5, 1000, 1, 1095);
        for (const day of [0, 300, 1095]) expect(theory.series.reduce((sum, series) => sum + series[day], 0)).toBeCloseTo(1000, 6);
        const plain = deterministicCurve(PLAIN, PARAMS, 2.5, 1000, 1, 1095);
        expect(plain.infected[1095]).toBeLessThan(0.5);
        // Endemic: infection never dies out in the well-mixed model once immunity wanes.
        expect(Math.max(...theory.infected.slice(700))).toBeGreaterThan(1);
    });
});

describe("waning fitted to published protection", () => {
    const protection = (halfLife: number, delay: number) => (days: number) => 1 - waningSusceptibility(halfLife, delay)(days);

    it("matches Omicron's measured protection with its full-protection period, and wouldn't without it", () => {
        const { delay, halfLife } = getPathogen(Pathogen.CovidOmicron).immunity!;
        const omicron = protection(halfLife!.value, delay!.value);
        // Chemaitelly 2025: ≈ 81% at 3–6 months, ≈ 28% at 9–12 months.
        expect(omicron(137)).toBeCloseTo(0.81, 1);
        expect(omicron(320)).toBeCloseTo(0.28, 1);
        // Fully protected for the first months: no reinfection within days of recovering.
        expect(omicron(30)).toBe(1);
        expect(protection(halfLife!.value, 0)(137)).toBeLessThan(0.5);
    });

    it("matches RSV's measured protection", () => {
        const { delay, halfLife } = getPathogen(Pathogen.Rsv).immunity!;
        const rsv = protection(halfLife!.value, delay!.value);
        expect(rsv(91)).toBeCloseTo(0.7, 1);
        expect(rsv(274)).toBeCloseTo(0.19, 1);
    });

    it("resets the delay for presets that don't publish one", () => {
        expect(pathogenParams(getPathogen(Pathogen.CovidOmicron), Population.All).immunityDelay).toBe(100);
        expect(pathogenParams(getPathogen(Pathogen.CovidAncestral), Population.All).immunityDelay).toBe(0);
    });
});
