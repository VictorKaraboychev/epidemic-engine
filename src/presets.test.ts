import { describe, expect, it } from "vitest";
import { getDisease } from "./diseases/index.js";
import { buildSimulationNetwork } from "./population.js";
import { availableFeatures, diseaseParams, solveTransmission } from "./presets.js";
import { estimateR0 } from "./r0.js";
import { mulberry32 } from "./random.js";
import { reproductionCurve } from "./reproduction.js";
import { simulationModel } from "./seird.js";
import { seirdParams } from "./test-support.js";

const network = buildSimulationNetwork({ seed: 3, layout: { width: 1600, height: 900 }, population: 5000, contacts: 6, contactVariation: false });
const reproduction = reproductionCurve(network, mulberry32(3));
const SEIRD = simulationModel({ exposed: true, waning: false });

describe("disease parameters", () => {
    it("are the disease's cited values, with infinite half-lives for lifelong protection and flat infectiousness", () => {
        const measles = diseaseParams(getDisease("measles"), "all");
        expect(measles).toMatchObject({ immunityDelay: Infinity, immunityHalfLife: Infinity, infectiousnessHalfLife: Infinity, vaccineHalfLife: Infinity });
        expect(diseaseParams(getDisease("covid-omicron"), "all")).toMatchObject({ immunityDelay: 100 });
        expect(diseaseParams(getDisease("sars"), "all").vaccineEfficacy).toBeUndefined();
    });

    it("switch on only the features a disease has data for", () => {
        expect(availableFeatures(null)).toEqual({ exposed: true, waning: true, superspreading: true, vaccination: true });
        expect(availableFeatures(getDisease("sars")).vaccination).toBe(false);
    });
});

describe("transmission", () => {
    it("solves the rate for a published R₀ on the network, or keeps the given one", () => {
        const params = seirdParams({ latentDays: 3, recoveryDays: 6, deathDays: 6 });
        const { beta } = solveTransmission({ model: SEIRD, params, reproduction, r0: 2.5, dispersion: null });
        expect(estimateR0(SEIRD, { ...params, beta }, reproduction)).toBeCloseTo(2.5, 1);
        expect(solveTransmission({ model: SEIRD, params: { ...params, beta: 0.12 }, reproduction, r0: null, dispersion: null }).beta).toBe(0.12);
    });

    it("finds the individual dispersion only with superspreading, less uneven than the target as the network adds its own", () => {
        const params = seirdParams({ recoveryDays: 6, deathDays: 6 });
        expect(solveTransmission({ model: SEIRD, params, reproduction, r0: 2.5, dispersion: null }).dispersion).toBeNull();
        const { dispersion } = solveTransmission({ model: SEIRD, params, reproduction, r0: 2.5, dispersion: 0.3 });
        expect(dispersion).toBeGreaterThanOrEqual(0.3);
    });
});
