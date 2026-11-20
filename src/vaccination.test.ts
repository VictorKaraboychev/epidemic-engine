import { Pathogen } from "./pathogens/pathogen.js";
import { describe, expect, it } from "vitest";
import { compileModel, vaccineSusceptibility } from "./model.js";
import { buildNetwork } from "./network.js";
import { seededVaccinated, vaccinatedCount, vaccinationOrder } from "./seeding.js";
import { availableFeatures } from "./presets.js";
import { seededRandom } from "./random.js";
import { seirdModel } from "./seird.js";
import { createEpidemic } from "./stochastic.js";

const VACCINATED = seirdModel({ exposed: false, waning: false, vaccination: true });
const V = compileModel(VACCINATED).indexOf.v;
const I = compileModel(VACCINATED).indexOf.i;

describe("vaccination", () => {
    it("adds a vaccinated compartment after susceptible, named in the model", () => {
        expect(VACCINATED.compartments.map((c) => c.key)).toEqual(["s", "v", "i", "r", "d"]);
        expect(VACCINATED.name).toBe("SIRD with vaccination");
        expect(seirdModel({ exposed: true, waning: true, vaccination: true }).name).toBe("SEIRD with waning immunity and vaccination");
    });

    it("protects a share equal to the efficacy at first, fewer as the vaccine wanes", () => {
        const susceptibility = vaccineSusceptibility(0.8, 100);
        expect(susceptibility(0)).toBeCloseTo(0.2, 12);
        expect(susceptibility(100)).toBeCloseTo(0.6, 12);
        expect(vaccineSusceptibility(1, Infinity)(1000)).toBe(0);
    });

    it("vaccinates the first people in the seed's own order, never an index case", () => {
        const network = buildNetwork(seededRandom(1), { count: 100, width: 1200, height: 180 });
        const order = vaccinationOrder(7, 100);
        expect(vaccinationOrder(7, 100)).toEqual(order);
        const vaccinated = seededVaccinated(order, [order[0]], 30);
        expect(vaccinated).toHaveLength(30);
        expect(vaccinated).not.toContain(order[0]);
        const state = createEpidemic(VACCINATED, network, [order[0]], vaccinated);
        expect(state.counts[V]).toBe(30);
        expect(state.states[order[0]]).toBe(I);
        expect(vaccinatedCount(0.725, 1000)).toBe(725);
    });

    it("is unavailable without a licensed vaccine, and cites its sources", () => {
        expect(availableFeatures(Pathogen.Sars).vaccination).toBe(false);
        expect(availableFeatures(Pathogen.Mers).vaccination).toBe(false);
        expect(availableFeatures(Pathogen.Ebola).vaccination).toBe(true);
        const cited = Pathogen.all.flatMap((pathogen) => pathogen.citations);
        for (const citation of ["tartof-2021", "fast-2022", "li-2020-vaccines", "who-immunization-2026"] as const) expect(cited).toContain(citation);
    });
});
