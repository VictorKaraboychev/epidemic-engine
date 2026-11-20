import { describe, expect, it } from "vitest";
import {
    CITATIONS,
    CITATION_ORDER,
    type Cited,
    PATHOGENS,
    MAX_POPULATION_GROUPS,
    NO_FATALITY,
    SUPERSPREADING_CITATION,
    VISIBLE_PATHOGENS,
    baseGroupOf,
    citationNumber,
    citationsFor,
    citationsOf,
    citedValuesOf,
    fatalityRate,
    effectivePopulation,
    fatalityGroups,
    getPathogen,
    hasOutcomeSpecificPeriods,
    parameterValues,
    populationGroup,
    vaccineCoverage,
} from "./index.js";
import { Caveat, Pathogen, Population } from "./types.js";

const valuesOf = (pathogen: (typeof PATHOGENS)[number]) => Object.entries(parameterValues(pathogen)) as [string, Cited][];

describe("pathogens", () => {
    it("are listed once each, in the order of their ids", () => {
        expect(PATHOGENS.map((pathogen) => pathogen.id)).toEqual(Object.values(Pathogen));
    });

    it("only use caveats and population groups that are declared", () => {
        for (const pathogen of PATHOGENS) {
            for (const group of pathogen.populations.groups) expect(Object.values(Population), pathogen.id).toContain(group.id);
            for (const [, value] of valuesOf(pathogen)) if (value.caveat) expect(Object.values(Caveat), pathogen.id).toContain(value.caveat);
        }
    });

    it("cite a source from the shared library for every value, population data included", () => {
        for (const pathogen of PATHOGENS) {
            for (const value of citedValuesOf(pathogen)) {
                expect(Number.isFinite(value.value)).toBe(true);
                expect(value.citation, `${pathogen.id}: ${value.value} has a source`).toBeDefined();
                for (const citation of citationsFor(value)) expect(CITATIONS[citation]).toBeDefined();
            }
        }
    });

    it("keep every value inside its published interval", () => {
        let intervals = 0;
        for (const pathogen of PATHOGENS) {
            for (const { value, interval } of citedValuesOf(pathogen)) {
                if (!interval) continue;
                intervals++;
                expect(interval.low, pathogen.id).toBeLessThan(interval.high);
                expect(value, `${pathogen.id}: ${value} in ${interval.low}–${interval.high}`).toBeGreaterThanOrEqual(interval.low);
                expect(value, `${pathogen.id}: ${value} in ${interval.low}–${interval.high}`).toBeLessThanOrEqual(interval.high);
            }
        }
        expect(intervals).toBeGreaterThan(20);
    });

    it("give a value a bound or an interval, never both", () => {
        for (const pathogen of PATHOGENS) for (const value of citedValuesOf(pathogen)) expect(Boolean(value.bound && value.interval)).toBe(false);
    });

    it("give positive, finite values and contacts", () => {
        for (const pathogen of PATHOGENS) {
            for (const [key, value] of valuesOf(pathogen)) expect(value.value > 0 && Number.isFinite(value.value), `${pathogen.id}.${key}`).toBe(true);
            expect(Number.isInteger(pathogen.contacts) && pathogen.contacts > 0).toBe(true);
        }
    });

    it("hide influenza B but keep its data", () => {
        expect(getPathogen(Pathogen.InfluenzaB).hidden).toBe(true);
        expect(VISIBLE_PATHOGENS.map((pathogen) => pathogen.id)).not.toContain(Pathogen.InfluenzaB);
    });

    it("give fatal cases their own infectious period only where a source estimates it", () => {
        const ebola = getPathogen(Pathogen.Ebola).values;
        expect([ebola.deathDays.value, ebola.recoveryDays.value]).toEqual([7.5, 16.4]);
        expect(PATHOGENS.filter(hasOutcomeSpecificPeriods).map((pathogen) => pathogen.id)).toEqual([Pathogen.Sars, Pathogen.Mers, Pathogen.Ebola]);
        for (const pathogen of PATHOGENS.filter((item) => !hasOutcomeSpecificPeriods(item))) {
            expect(pathogen.values.deathDays.citation).toBe(pathogen.values.recoveryDays.citation);
        }
    });

    it("make Ebola, MERS and SARS the deadliest, far above the rest", () => {
        const deadly = [Pathogen.Ebola, Pathogen.Mers, Pathogen.Sars];
        const others = VISIBLE_PATHOGENS.filter((pathogen) => !deadly.includes(pathogen.id)).map((pathogen) => baseGroupOf(pathogen).ifr!.value);
        for (const id of deadly) expect(baseGroupOf(getPathogen(id as Pathogen.Ebola)).ifr!.value).toBeGreaterThan(Math.max(...others) * 10);
    });
});

describe("immunity", () => {
    it("wanes with a cited half-life, is lifelong with a cited source, or is unmeasured", () => {
        expect(getPathogen(Pathogen.Measles).immunity).toEqual({ lifelong: "cdc-measles-clinical" });
        expect(getPathogen(Pathogen.CovidAncestral).immunity?.halfLife?.value).toBe(860);
        expect(getPathogen(Pathogen.Ebola).immunity).toBeUndefined();
        expect(getPathogen(Pathogen.Pertussis).immunity?.halfLife?.bound).toBe("above");
        for (const pathogen of PATHOGENS) {
            const immunity = pathogen.immunity;
            if (immunity) expect(Boolean(immunity.halfLife) !== Boolean(immunity.lifelong), pathogen.id).toBe(true);
        }
    });

    it("cites the source for lifelong immunity in the reference list", () => {
        expect(citationsOf(getPathogen(Pathogen.Measles))).toContain("cdc-measles-clinical");
        expect(citationsOf(getPathogen(Pathogen.CovidAncestral))).toContain("stein-2023");
    });
});

describe("vaccination data", () => {
    it("is cited for every pathogen, with fractions within 0–1", () => {
        for (const pathogen of PATHOGENS) {
            const vaccination = pathogen.vaccination;
            expect(vaccination, pathogen.id).toBeDefined();
            if (!vaccination || "none" in vaccination) {
                if (vaccination) expect(CITATIONS[vaccination.none]).toBeDefined();
                expect(vaccineCoverage(pathogen, Population.All)).toBeNull();
                continue;
            }
            const coverages = [...pathogen.populations.groups.map((group) => group.vaccineCoverage)].filter((value): value is Cited => Boolean(value));
            expect(coverages.length, `${pathogen.id} has coverage somewhere`).toBeGreaterThan(0);
            for (const value of [vaccination.efficacy, ...coverages, ...(vaccination.halfLife ? [vaccination.halfLife] : [])]) {
                expect(value.citation, `${pathogen.id}: ${value.value} has a source`).toBeDefined();
                for (const citation of citationsFor(value)) expect(CITATIONS[citation]).toBeDefined();
            }
            for (const fraction of [vaccination.efficacy.value, ...coverages.map((value) => value.value)]) expect(fraction >= 0 && fraction <= 1).toBe(true);
            if (vaccination.lifelong) expect(typeof vaccination.lifelong === "string" && CITATIONS[vaccination.lifelong]).toBeTruthy();
        }
    });

    it("keeps coverage on the population: a group's own figure, else everyone's", () => {
        expect(vaccineCoverage(getPathogen(Pathogen.Rsv), Population.Elderly)?.value).toBe(0.397);
        expect(vaccineCoverage(getPathogen(Pathogen.Rsv), Population.All)).toBeNull();
        expect(vaccineCoverage(getPathogen(Pathogen.InfluenzaA), Population.Elderly)?.value).toBe(0.472);
        expect(vaccineCoverage(getPathogen(Pathogen.InfluenzaA), Population.All)?.value).toBe(0.472);
        expect(vaccineCoverage(getPathogen(Pathogen.Ebola), Population.All)).toBeNull();
        expect(vaccineCoverage(getPathogen(Pathogen.Ebola), Population.Contacts)?.value).toBe(0.52);
        expect(vaccineCoverage(getPathogen(Pathogen.Mpox), Population.All)?.value).toBe(0.227);
    });
});

describe("population groups", () => {
    it("can be incomplete, bounded, or not ages at all, and fit the reserved space", () => {
        expect(fatalityGroups(getPathogen(Pathogen.Pertussis)).map((group) => group.id)).toEqual([Population.Infants, Population.Elderly]);
        expect(getPathogen(Pathogen.Sars).populations.groups.map((group) => group.ifr?.bound)).toEqual([undefined, "below", undefined, undefined, "above"]);
        expect(getPathogen(Pathogen.Mpox).populations.kind).toBe("group");
        for (const pathogen of PATHOGENS) expect(fatalityGroups(pathogen).length).toBeLessThanOrEqual(MAX_POPULATION_GROUPS);
    });

    it('start with a base group like any other, selected by "all", whose fatality may be missing (then nobody dies)', () => {
        for (const pathogen of PATHOGENS) {
            const ids = pathogen.populations.groups.map((group) => group.id);
            expect(new Set(ids).size).toBe(ids.length);
            // "everyone" can only be the base group.
            expect(ids.slice(1)).not.toContain(Population.All);
            expect(populationGroup(pathogen, Population.All)).toBe(baseGroupOf(pathogen));
            expect(fatalityGroups(pathogen)).not.toContain(baseGroupOf(pathogen));
        }
        const covid = getPathogen(Pathogen.CovidAncestral);
        const [, ...groups] = covid.populations.groups;
        const unknown = {
            ...covid,
            populations: { ...covid.populations, groups: [{ id: Population.All, covers: "all ages" }, ...groups] as typeof covid.populations.groups },
        };
        expect(fatalityRate(unknown, Population.All)).toBe(NO_FATALITY);
        expect(fatalityRate(unknown, Population.Children)).toBe(NO_FATALITY);
        expect(fatalityRate(unknown, Population.Elderly)).toBe(0.046);
    });

    it("name the base group for who its rate was measured in: Everyone only when that's everyone", () => {
        // A per-case rate (reported, confirmed, probable) is everyone's: the cases come from the whole population.
        const everyone = /^(all ages|(reported|confirmed|probable) cases)$/;
        for (const pathogen of PATHOGENS) {
            const base = baseGroupOf(pathogen);
            expect(base.id === Population.All, `${pathogen.id}: ${base.covers}`).toBe(everyone.test(base.covers));
        }
        expect(baseGroupOf(getPathogen(Pathogen.Rsv)).id).toBe(Population.Under5);
        expect(baseGroupOf(getPathogen(Pathogen.Measles)).id).toBe(Population.Children);
        // Mpox's 2022 outbreak, and every value of it, was among GBMSM.
        expect(baseGroupOf(getPathogen(Pathogen.Mpox)).id).toBe(Population.Gbmsm);
    });

    it("fall back to the base group (and its rate) for a group a pathogen has no data for", () => {
        expect(effectivePopulation(getPathogen(Pathogen.Pertussis), Population.Adults)).toBe(Population.All);
        expect(fatalityRate(getPathogen(Pathogen.Pertussis), Population.Adults)).toBe(baseGroupOf(getPathogen(Pathogen.Pertussis)).ifr!.value);
        expect(effectivePopulation(getPathogen(Pathogen.Rsv), Population.Elderly)).toBe(Population.All);
        expect(fatalityRate(getPathogen(Pathogen.Measles), Population.All)).toBe(baseGroupOf(getPathogen(Pathogen.Measles)).ifr!.value);
        expect(fatalityRate(getPathogen(Pathogen.Sars), Population.Elderly)).toBe(0.5);
    });
});

describe("reference list", () => {
    it("numbers every visible pathogen's citations from 1, without gaps or duplicates", () => {
        expect(new Set(CITATION_ORDER).size).toBe(CITATION_ORDER.length);
        CITATION_ORDER.forEach((id, index) => expect(citationNumber(id)).toBe(index + 1));
        for (const pathogen of VISIBLE_PATHOGENS) for (const citation of citationsOf(pathogen)) expect(CITATION_ORDER).toContain(citation);
        expect(CITATION_ORDER).toContain(SUPERSPREADING_CITATION);
    });

    it("leaves out citations only a hidden pathogen uses", () => {
        expect(CITATION_ORDER).not.toContain("thompson-2022");
    });

    it("lists every citation with a URL", () => {
        for (const citation of Object.values(CITATIONS)) expect(citation.url).toMatch(/^https:\/\//);
    });
});

describe("population (age) fatality", () => {
    it("uses the pathogen's own rate for all ages and for pathogens without age data", () => {
        expect(fatalityRate(getPathogen(Pathogen.CovidAncestral), Population.All)).toBe(baseGroupOf(getPathogen(Pathogen.CovidAncestral)).ifr!.value);
        expect(fatalityRate(getPathogen(Pathogen.Measles), Population.Elderly)).toBe(baseGroupOf(getPathogen(Pathogen.Measles)).ifr!.value);
    });

    it("rises with age for COVID-19 and influenza", () => {
        for (const id of [Pathogen.CovidAncestral, Pathogen.InfluenzaA]) {
            const rates = fatalityGroups(getPathogen(id)).map((group) => group.ifr!.value);
            expect(rates.slice(1).every((rate, i) => rate > rates[i])).toBe(true);
        }
    });

    it("matches the published values", () => {
        expect(fatalityRate(getPathogen(Pathogen.CovidAncestral), Population.Elderly)).toBe(0.046);
        expect(fatalityRate(getPathogen(Pathogen.CovidAncestral), Population.Infants)).toBe(0.000054);
        expect(fatalityRate(getPathogen(Pathogen.CovidOmicron), Population.Elderly)).toBe(0.0097);
        expect(fatalityRate(getPathogen(Pathogen.InfluenzaA), Population.Elderly)).toBeCloseTo(19_038 / 2_610_181, 12);
    });
});
