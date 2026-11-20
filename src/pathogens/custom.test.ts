import { Pathogen } from "./pathogen.js";
import { describe, expect, it } from "vitest";
import { SeirdCompartment } from "../model.js";
import { Outbreak } from "../outbreak.js";
import { availableFeatures, pathogenParams } from "../presets.js";
import { citationsOf } from "./index.js";
import { PathogenId, Population } from "./types.js";

describe("your own pathogens", () => {
    it("are made from plain numbers, without sources, and give the same parameters a built-in one would", () => {
        const flu = new Pathogen({ id: "my-flu", r0: 1.8, latentDays: 2, recoveryDays: 5, ifr: 0.001, contacts: 6 });
        expect(flu.values.r0).toEqual({ value: 1.8 });
        expect(citationsOf(flu)).toEqual([]);
        expect(pathogenParams(flu, Population.All)).toMatchObject({ latentDays: 2, recoveryDays: 5, deathDays: 5, ifr: 0.001, contacts: 6 });
        expect(availableFeatures(flu)).toEqual({ exposed: true, waning: false, vaccination: false, superspreading: false });
    });

    it("switch on each feature with its data, and lifelong protection is an infinite half-life", () => {
        const full = new Pathogen({
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
        expect(() => new Pathogen({ id: "x", r0: -1, recoveryDays: 5 })).toThrow(/r0/);
        expect(() => new Pathogen({ id: "x", r0: 2, recoveryDays: 5, ifr: 1.5 })).toThrow(/ifr/);
        expect(() => new Pathogen({ id: "x", r0: 2, recoveryDays: 5, immunity: { halfLife: 100, lifelong: true } })).toThrow(/not both/);
    });

    it("run in an Outbreak like built-in ones, as does a changed copy of a built-in one", () => {
        const pathogen = new Pathogen({ id: "my-flu", r0: 2, latentDays: 2, recoveryDays: 5, vaccine: { efficacy: 1, coverage: 0.5 } });
        const outbreak = new Outbreak({ pathogen, people: 3000, seed: 4, vaccination: true });
        expect(outbreak.r0).toBe(2);
        expect(outbreak.count(SeirdCompartment.Vaccinated)).toBe(1500);
        const summary = outbreak.run();
        expect(summary.over).toBe(true);
        expect(summary.everInfected).toBeLessThan(1500);

        const denser = Pathogen.CovidAncestral.with({ contacts: 14 });
        expect(new Outbreak({ pathogen: denser, people: 2000, seed: 1 }).network.edgeA.length).toBeGreaterThan(
            new Outbreak({ pathogen: Pathogen.CovidAncestral, people: 2000, seed: 1 }).network.edgeA.length,
        );
        expect(() => new Outbreak({ pathogen, people: 500, waning: true })).toThrow(/my-flu has no data for waning/);
    });
});

describe("the Pathogen class", () => {
    it("has every built-in pathogen as a static member, also found by id", () => {
        expect(Pathogen.all.map((pathogen) => pathogen.id)).toEqual(Object.values(PathogenId));
        expect(Pathogen.get(PathogenId.Measles)).toBe(Pathogen.Measles);
        expect(Pathogen.get("measles")).toBe(Pathogen.Measles);
        expect(() => Pathogen.get("smallpox")).toThrow(/Unknown pathogen/);
    });

    it("reads its data through methods", () => {
        expect(Pathogen.Measles.r0).toBe(15);
        expect(Pathogen.Measles.features).toEqual({ exposed: true, waning: true, vaccination: true, superspreading: true });
        expect(Pathogen.Measles.params()).toMatchObject({ latentDays: 10, recoveryDays: 8, immunityHalfLife: Infinity });
        expect(Pathogen.CovidAncestral.fatalityRate(Population.Elderly)).toBeGreaterThan(Pathogen.CovidAncestral.fatalityRate(Population.Infants));
        expect(Pathogen.Measles.vaccineCoverage()).toBe(0.77);
        expect(Pathogen.Sars.vaccineCoverage()).toBeNull();
        expect(Pathogen.Measles.citations.length).toBeGreaterThan(3);
    });

    it("copies with changes, leaving the original alone, and round-trips through plain data", () => {
        const denser = Pathogen.Measles.with({ contacts: 30 });
        expect(denser).toBeInstanceOf(Pathogen);
        expect([denser.contacts, Pathogen.Measles.contacts]).toEqual([30, 20]);
        const sent = structuredClone(Pathogen.Measles.profile());
        expect(new Pathogen(sent).params()).toEqual(Pathogen.Measles.params());
    });
});
