import { describe, expect, it } from "vitest";
import { SeirdCompartment } from "../model.js";
import { Outbreak } from "../outbreak.js";
import { availableFeatures, pathogenParams } from "../presets.js";
import { createPathogen } from "./custom.js";
import { citationsOf, getPathogen } from "./index.js";
import { Pathogen, Population } from "./types.js";

describe("your own pathogens", () => {
    it("are made from plain numbers, without sources, and give the same parameters a built-in one would", () => {
        const flu = createPathogen({ id: "my-flu", r0: 1.8, latentDays: 2, recoveryDays: 5, ifr: 0.001, contacts: 6 });
        expect(flu.values.r0).toEqual({ value: 1.8 });
        expect(citationsOf(flu)).toEqual([]);
        expect(pathogenParams(flu, Population.All)).toMatchObject({ latentDays: 2, recoveryDays: 5, deathDays: 5, ifr: 0.001, contacts: 6 });
        expect(availableFeatures(flu)).toEqual({ exposed: true, waning: false, vaccination: false, superspreading: false });
    });

    it("switch on each feature with its data, and lifelong protection is an infinite half-life", () => {
        const full = createPathogen({
            id: "full",
            r0: 3,
            recoveryDays: 6,
            dispersion: 0.4,
            immunity: { halfLife: 200, delay: 30 },
            vaccine: { efficacy: 0.9, coverage: 0.6, lifelong: true },
        });
        expect(availableFeatures(full)).toEqual({ exposed: false, waning: true, vaccination: true, superspreading: true });
        expect(pathogenParams(full, Population.All)).toMatchObject({
            immunityHalfLife: 200,
            immunityDelay: 30,
            vaccineEfficacy: 0.9,
            vaccineCoverage: 0.6,
            vaccineHalfLife: Infinity,
            dispersion: 0.4,
        });
    });

    it("reject impossible values", () => {
        expect(() => createPathogen({ id: "x", r0: -1, recoveryDays: 5 })).toThrow(/r0/);
        expect(() => createPathogen({ id: "x", r0: 2, recoveryDays: 5, ifr: 1.5 })).toThrow(/ifr/);
        expect(() => createPathogen({ id: "x", r0: 2, recoveryDays: 5, immunity: { halfLife: 100, lifelong: true } })).toThrow(/not both/);
    });

    it("run in an Outbreak like built-in ones, as does a changed copy of a built-in one", () => {
        const pathogen = createPathogen({ id: "my-flu", r0: 2, latentDays: 2, recoveryDays: 5, vaccine: { efficacy: 1, coverage: 0.5 } });
        const outbreak = new Outbreak({ pathogen, people: 3000, seed: 4, vaccination: true });
        expect(outbreak.r0).toBe(2);
        expect(outbreak.count(SeirdCompartment.Vaccinated)).toBe(1500);
        const summary = outbreak.run();
        expect(summary.over).toBe(true);
        expect(summary.everInfected).toBeLessThan(1500);

        const denser = { ...getPathogen(Pathogen.CovidAncestral), contacts: 14 };
        expect(new Outbreak({ pathogen: denser, people: 2000, seed: 1 }).network.edgeA.length).toBeGreaterThan(
            new Outbreak({ pathogen: Pathogen.CovidAncestral, people: 2000, seed: 1 }).network.edgeA.length,
        );
        expect(() => new Outbreak({ pathogen, people: 500, waning: true })).toThrow(/my-flu has no data for waning/);
    });
});
