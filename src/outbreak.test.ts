import { Pathogen } from "./pathogens/pathogen.js";
import { describe, expect, it } from "vitest";
import { SeirdCompartment } from "./model.js";
import { DEFAULT_MAX_DAYS, Outbreak } from "./outbreak.js";
import { Population } from "./pathogens/types.js";

describe("Outbreak", () => {
    it("runs a pathogen's outbreak from its published data", () => {
        const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 5000, seed: 1 });
        expect(outbreak.r0).toBe(15);
        expect(outbreak.features).toEqual({ exposed: true, waning: false, vaccination: false, superspreading: false });
        const summary = outbreak.run();
        expect(summary.over).toBe(true);
        // R₀ 15: nearly everyone is infected.
        expect(summary.attackRate).toBeGreaterThan(0.95);
        expect(summary.peak.infected).toBeGreaterThan(0);
        expect(outbreak.count(SeirdCompartment.Recovered) + outbreak.count(SeirdCompartment.Died)).toBe(summary.everInfected);
    });

    it("replays exactly from the same seed", () => {
        const run = () => new Outbreak({ pathogen: Pathogen.CovidAncestral, people: 3000, seed: 42 }).run();
        expect(run()).toEqual(run());
    });

    it("steps a day at a time, keeping every day's counts, and stops when it's over", () => {
        const outbreak = new Outbreak({ pathogen: Pathogen.InfluenzaA, people: 2000, seed: 3, initialCases: 5 });
        expect(outbreak.indexCases).toHaveLength(5);
        outbreak.step(10);
        expect(outbreak.day).toBe(10);
        expect(outbreak.series(SeirdCompartment.Susceptible)).toHaveLength(11);
        expect(outbreak.series(SeirdCompartment.Vaccinated)).toHaveLength(0);
        outbreak.run();
        const days = outbreak.day;
        outbreak.step(5);
        expect(outbreak.day).toBe(days);
        expect(days).toBeLessThan(DEFAULT_MAX_DAYS);
    });

    it("takes your own parameters without a pathogen, solving the rate for an R₀", () => {
        const outbreak = new Outbreak({ people: 3000, seed: 5, r0: 2, params: { recoveryDays: 7, deathDays: 7, ifr: 0 } });
        expect(outbreak.pathogen).toBeNull();
        expect(outbreak.r0).toBe(2);
        const summary = outbreak.run();
        expect(summary.deaths).toBe(0);
        expect(summary.attackRate).toBeGreaterThan(0.3);
        expect(summary.attackRate).toBeLessThan(1);
    });

    it("vaccinates the pathogen's coverage for a population, and needs the data for each feature", () => {
        const outbreak = new Outbreak({ pathogen: Pathogen.Measles, population: Population.All, people: 4000, seed: 2, vaccination: true });
        expect(outbreak.vaccinated.length / 4000).toBeCloseTo(0.77, 2);
        expect(outbreak.count(SeirdCompartment.Vaccinated)).toBe(outbreak.vaccinated.length);
        expect(() => new Outbreak({ pathogen: Pathogen.Sars, people: 500, vaccination: true })).toThrow(/vaccination/);
        expect(() => new Outbreak({ pathogen: Pathogen.Ebola, people: 500, waning: true })).toThrow(/waning/);
    });

    it("gives the deterministic reference for the same model and R₀", () => {
        const outbreak = new Outbreak({ pathogen: Pathogen.CovidOmicron, people: 2000, seed: 8 });
        const theory = outbreak.theory(200);
        expect(theory.days).toBe(200);
        expect(theory.series).toHaveLength(outbreak.model.compartments.length);
        expect(Math.max(...theory.infected)).toBeGreaterThan(1);
    });
});
