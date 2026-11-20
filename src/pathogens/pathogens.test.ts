import { Pathogen } from "./pathogen.js";
import { describe, expect, it } from "vitest";
import {
    CITATIONS,
    type Cited,
    NO_FATALITY,
    SUPERSPREADING_CITATION,
    baseGroupOf,
    citationsFor,
    citationsOf,
    citedValuesOf,
    fatalityRate,
    fatalityGroups,
    hasOutcomeSpecificPeriods,
    parameterValues,
    populationGroup,
    vaccineCoverage,
} from "./index.js";
import { Caveat, PathogenId, Group } from "./types.js";

const valuesOf = (pathogen: (typeof Pathogen.all)[number]) => Object.entries(parameterValues(pathogen)) as [string, Cited][];

describe("pathogens", () => {
    it("are listed once each, in the order of their ids", () => {
        expect(Pathogen.all.map((pathogen) => pathogen.id)).toEqual(Object.values(PathogenId));
    });

    it("only use caveats and population groups that are declared", () => {
        for (const pathogen of Pathogen.all) {
            for (const group of pathogen.populations.groups) expect(Object.values(Group), pathogen.id).toContain(group.id);
            for (const [, value] of valuesOf(pathogen)) if (value.caveat) expect(Object.values(Caveat), pathogen.id).toContain(value.caveat);
        }
    });

    it("cite a source from the shared library for every value, population data included", () => {
        for (const pathogen of Pathogen.all) {
            for (const value of citedValuesOf(pathogen)) {
                expect(Number.isFinite(value.value)).toBe(true);
                expect(value.citation, `${pathogen.id}: ${value.value} has a source`).toBeDefined();
                for (const citation of citationsFor(value)) expect(CITATIONS[citation]).toBeDefined();
            }
        }
    });

    it("keep every value inside its published interval", () => {
        let intervals = 0;
        for (const pathogen of Pathogen.all) {
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
        for (const pathogen of Pathogen.all) for (const value of citedValuesOf(pathogen)) expect(Boolean(value.bound && value.interval)).toBe(false);
    });

    it("give positive, finite values and contacts", () => {
        for (const pathogen of Pathogen.all) {
            for (const [key, value] of valuesOf(pathogen)) expect(value.value > 0 && Number.isFinite(value.value), `${pathogen.id}.${key}`).toBe(true);
            expect(Number.isInteger(pathogen.contacts) && pathogen.contacts > 0).toBe(true);
        }
    });

    it("give fatal cases their own infectious period only where a source estimates it", () => {
        const ebola = Pathogen.Ebola.values;
        expect([ebola.fatalInfectiousDays.value, ebola.infectiousDays.value]).toEqual([7.5, 16.4]);
        expect(Pathogen.all.filter(hasOutcomeSpecificPeriods).map((pathogen) => pathogen.id)).toEqual([PathogenId.Sars, PathogenId.Mers, PathogenId.Ebola]);
        for (const pathogen of Pathogen.all.filter((item) => !hasOutcomeSpecificPeriods(item))) {
            expect(pathogen.values.fatalInfectiousDays.citation).toBe(pathogen.values.infectiousDays.citation);
        }
    });

    it("make Ebola, MERS and SARS the deadliest, far above the rest", () => {
        const deadly = [Pathogen.Ebola, Pathogen.Mers, Pathogen.Sars];
        const others = Pathogen.all.filter((pathogen) => !deadly.includes(pathogen)).map((pathogen) => pathogen.fatalityRate());
        for (const pathogen of deadly) expect(pathogen.fatalityRate()).toBeGreaterThan(Math.max(...others) * 10);
    });
});

describe("immunity", () => {
    it("wanes with a cited half-life, is lifelong with a cited source, or is unmeasured", () => {
        expect(Pathogen.Measles.immunity).toEqual({ lifelong: "cdc-measles-clinical" });
        expect(Pathogen.CovidAncestral.immunity?.halfLife?.value).toBe(860);
        expect(Pathogen.Ebola.immunity).toBeUndefined();
        expect(Pathogen.Pertussis.immunity?.halfLife?.bound).toBe("above");
        for (const pathogen of Pathogen.all) {
            const immunity = pathogen.immunity;
            if (immunity) expect(Boolean(immunity.halfLife) !== Boolean(immunity.lifelong), pathogen.id).toBe(true);
        }
    });

    it("cites the source for lifelong immunity in the reference list", () => {
        expect(citationsOf(Pathogen.Measles)).toContain("cdc-measles-clinical");
        expect(citationsOf(Pathogen.CovidAncestral)).toContain("stein-2023");
    });
});

describe("vaccination data", () => {
    it("is cited for every pathogen, with fractions within 0–1", () => {
        for (const pathogen of Pathogen.all) {
            const vaccination = pathogen.vaccination;
            expect(vaccination, pathogen.id).toBeDefined();
            if (!vaccination || "none" in vaccination) {
                if (vaccination) expect(CITATIONS[vaccination.none]).toBeDefined();
                expect(vaccineCoverage(pathogen, Group.All)).toBeNull();
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
        expect(vaccineCoverage(Pathogen.Rsv, Group.Elderly)?.value).toBe(0.397);
        expect(vaccineCoverage(Pathogen.Rsv, Group.All)).toBeNull();
        expect(vaccineCoverage(Pathogen.InfluenzaA, Group.Elderly)?.value).toBe(0.472);
        expect(vaccineCoverage(Pathogen.InfluenzaA, Group.All)?.value).toBe(0.472);
        expect(vaccineCoverage(Pathogen.Ebola, Group.All)).toBeNull();
        expect(vaccineCoverage(Pathogen.Ebola, Group.Contacts)?.value).toBe(0.52);
        expect(vaccineCoverage(Pathogen.Mpox, Group.All)?.value).toBe(0.227);
    });
});

describe("population groups", () => {
    it("can be incomplete, bounded, or not ages at all", () => {
        expect(fatalityGroups(Pathogen.Pertussis).map((group) => group.id)).toEqual([Group.Infants, Group.Elderly]);
        expect(Pathogen.Sars.populations.groups.map((group) => group.ifr?.bound)).toEqual([undefined, "below", undefined, undefined, "above"]);
        expect(Pathogen.Mpox.populations.kind).toBe("group");
    });

    it('start with a base group like any other, selected by "all", whose fatality may be missing (then nobody dies)', () => {
        for (const pathogen of Pathogen.all) {
            const ids = pathogen.populations.groups.map((group) => group.id);
            expect(new Set(ids).size).toBe(ids.length);
            // "everyone" can only be the base group.
            expect(ids.slice(1)).not.toContain(Group.All);
            expect(populationGroup(pathogen, Group.All)).toBe(baseGroupOf(pathogen));
            expect(fatalityGroups(pathogen)).not.toContain(baseGroupOf(pathogen));
        }
        const covid = Pathogen.CovidAncestral;
        const [, ...groups] = covid.populations.groups;
        const unknown = {
            ...covid,
            populations: { ...covid.populations, groups: [{ id: Group.All, covers: "all ages" }, ...groups] as typeof covid.populations.groups },
        };
        expect(fatalityRate(unknown, Group.All)).toBe(NO_FATALITY);
        expect(fatalityRate(unknown, Group.Children)).toBe(NO_FATALITY);
        expect(fatalityRate(unknown, Group.Elderly)).toBe(0.046);
    });

    it("name the base group for who its rate was measured in: Everyone only when that's everyone", () => {
        // A per-case rate (reported, confirmed, probable) is everyone's: the cases come from the whole population.
        const everyone = /^(all ages|(reported|confirmed|probable) cases)$/;
        for (const pathogen of Pathogen.all) {
            const base = baseGroupOf(pathogen);
            expect(base.id === Group.All, `${pathogen.id}: ${base.covers}`).toBe(everyone.test(base.covers));
        }
        expect(baseGroupOf(Pathogen.Rsv).id).toBe(Group.Under5);
        expect(baseGroupOf(Pathogen.Measles).id).toBe(Group.Children);
        // Mpox's 2022 outbreak, and every value of it, was among GBMSM.
        expect(baseGroupOf(Pathogen.Mpox).id).toBe(Group.Gbmsm);
    });

    it("fall back to the base group (and its rate) for a group a pathogen has no data for", () => {
        expect(fatalityRate(Pathogen.Pertussis, Group.Adults)).toBe(baseGroupOf(Pathogen.Pertussis).ifr!.value);
        expect(fatalityRate(Pathogen.Measles, Group.All)).toBe(baseGroupOf(Pathogen.Measles).ifr!.value);
        expect(fatalityRate(Pathogen.Sars, Group.Elderly)).toBe(0.5);
    });
});

describe("citations", () => {
    it("list each pathogen's sources once, all in the library", () => {
        for (const pathogen of Pathogen.all) {
            expect(new Set(pathogen.citations).size, pathogen.id).toBe(pathogen.citations.length);
            for (const citation of pathogen.citations) expect(CITATIONS[citation]).toBeDefined();
        }
        expect(CITATIONS[SUPERSPREADING_CITATION]).toBeDefined();
    });

    it("all have a URL", () => {
        for (const citation of Object.values(CITATIONS)) expect(citation.url).toMatch(/^https:\/\//);
    });
});

describe("population (age) fatality", () => {
    it("uses the pathogen's own rate for all ages and for pathogens without age data", () => {
        expect(fatalityRate(Pathogen.CovidAncestral, Group.All)).toBe(baseGroupOf(Pathogen.CovidAncestral).ifr!.value);
        expect(fatalityRate(Pathogen.Measles, Group.Elderly)).toBe(baseGroupOf(Pathogen.Measles).ifr!.value);
    });

    it("rises with age for COVID-19 and influenza", () => {
        for (const id of [PathogenId.CovidAncestral, PathogenId.InfluenzaA]) {
            const rates = fatalityGroups(Pathogen.get(id)).map((group) => group.ifr!.value);
            expect(rates.slice(1).every((rate, i) => rate > rates[i])).toBe(true);
        }
    });

    it("matches the published values", () => {
        expect(fatalityRate(Pathogen.CovidAncestral, Group.Elderly)).toBe(0.046);
        expect(fatalityRate(Pathogen.CovidAncestral, Group.Infants)).toBe(0.000054);
        expect(fatalityRate(Pathogen.CovidOmicron, Group.Elderly)).toBe(0.0097);
        expect(fatalityRate(Pathogen.InfluenzaA, Group.Elderly)).toBeCloseTo(19_038 / 2_610_181, 12);
    });
});
