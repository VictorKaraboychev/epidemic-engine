import { describe, expect, it } from "vitest";
import {
    CITATIONS,
    CITATION_ORDER,
    type Cited,
    DISEASES,
    MAX_POPULATION_GROUPS,
    NO_FATALITY,
    POPULATION_IDS,
    SUPERSPREADING_CITATION,
    VISIBLE_DISEASES,
    baseGroupOf,
    citationNumber,
    citationsOf,
    citedValuesOf,
    diseaseIfr,
    effectivePopulation,
    fatalityGroups,
    getDisease,
    hasOutcomeSpecificPeriods,
    parameterValues,
    populationGroup,
    vaccineCoverage,
} from "./index.js";
import { CAVEAT_IDS, DISEASE_IDS } from "./types.js";

const valuesOf = (disease: (typeof DISEASES)[number]) => Object.entries(parameterValues(disease)) as [string, Cited][];

describe("diseases", () => {
    it("are listed once each, in the order of their ids", () => {
        expect(DISEASES.map((disease) => disease.id)).toEqual([...DISEASE_IDS]);
    });

    it("only use caveats and population groups that are declared", () => {
        for (const disease of DISEASES) {
            for (const group of disease.populations.groups) expect(POPULATION_IDS, disease.id).toContain(group.id);
            for (const [, value] of valuesOf(disease)) if (value.caveat) expect(CAVEAT_IDS, disease.id).toContain(value.caveat);
        }
    });

    it("cite a source from the shared library for every value, population data included", () => {
        for (const disease of DISEASES) {
            for (const value of citedValuesOf(disease)) {
                expect(Number.isFinite(value.value)).toBe(true);
                for (const citation of [value.citation, ...(value.also ?? [])]) expect(CITATIONS[citation]).toBeDefined();
            }
        }
    });

    it("keep every value inside its published interval", () => {
        let intervals = 0;
        for (const disease of DISEASES) {
            for (const { value, interval } of citedValuesOf(disease)) {
                if (!interval) continue;
                intervals++;
                expect(interval.low, disease.id).toBeLessThan(interval.high);
                expect(value, `${disease.id}: ${value} in ${interval.low}–${interval.high}`).toBeGreaterThanOrEqual(interval.low);
                expect(value, `${disease.id}: ${value} in ${interval.low}–${interval.high}`).toBeLessThanOrEqual(interval.high);
            }
        }
        expect(intervals).toBeGreaterThan(20);
    });

    it("give a value a bound or an interval, never both", () => {
        for (const disease of DISEASES) for (const value of citedValuesOf(disease)) expect(Boolean(value.bound && value.interval)).toBe(false);
    });

    it("give positive, finite values and contacts", () => {
        for (const disease of DISEASES) {
            for (const [key, value] of valuesOf(disease)) expect(value.value > 0 && Number.isFinite(value.value), `${disease.id}.${key}`).toBe(true);
            expect(Number.isInteger(disease.contacts) && disease.contacts > 0).toBe(true);
        }
    });

    it("hide influenza B but keep its data", () => {
        expect(getDisease("influenza-b").hidden).toBe(true);
        expect(VISIBLE_DISEASES.map((disease) => disease.id)).not.toContain("influenza-b");
    });

    it("give fatal cases their own infectious period only where a source estimates it", () => {
        const ebola = getDisease("ebola").values;
        expect([ebola.deathDays.value, ebola.recoveryDays.value]).toEqual([7.5, 16.4]);
        expect(DISEASES.filter(hasOutcomeSpecificPeriods).map((disease) => disease.id)).toEqual(["sars", "mers", "ebola"]);
        for (const disease of DISEASES.filter((item) => !hasOutcomeSpecificPeriods(item))) {
            expect(disease.values.deathDays.citation).toBe(disease.values.recoveryDays.citation);
        }
    });

    it("make Ebola, MERS and SARS the deadliest, far above the rest", () => {
        const deadly = ["ebola", "mers", "sars"];
        const others = VISIBLE_DISEASES.filter((disease) => !deadly.includes(disease.id)).map((disease) => baseGroupOf(disease).ifr!.value);
        for (const id of deadly) expect(baseGroupOf(getDisease(id as "ebola")).ifr!.value).toBeGreaterThan(Math.max(...others) * 10);
    });
});

describe("immunity", () => {
    it("wanes with a cited half-life, is lifelong with a cited source, or is unmeasured", () => {
        expect(getDisease("measles").immunity).toEqual({ lifelong: "cdc-measles-clinical" });
        expect(getDisease("covid-ancestral").immunity?.halfLife?.value).toBe(860);
        expect(getDisease("ebola").immunity).toBeUndefined();
        expect(getDisease("pertussis").immunity?.halfLife?.bound).toBe("above");
        for (const disease of DISEASES) {
            const immunity = disease.immunity;
            if (immunity) expect(Boolean(immunity.halfLife) !== Boolean(immunity.lifelong), disease.id).toBe(true);
        }
    });

    it("cites the source for lifelong immunity in the reference list", () => {
        expect(citationsOf(getDisease("measles"))).toContain("cdc-measles-clinical");
        expect(citationsOf(getDisease("covid-ancestral"))).toContain("stein-2023");
    });
});

describe("vaccination data", () => {
    it("is cited for every disease, with fractions within 0–1", () => {
        for (const disease of DISEASES) {
            const vaccination = disease.vaccination;
            expect(vaccination, disease.id).toBeDefined();
            if (!vaccination || "none" in vaccination) {
                if (vaccination) expect(CITATIONS[vaccination.none]).toBeDefined();
                expect(vaccineCoverage(disease, "all")).toBeNull();
                continue;
            }
            const coverages = [...disease.populations.groups.map((group) => group.vaccineCoverage)].filter((value): value is Cited => Boolean(value));
            expect(coverages.length, `${disease.id} has coverage somewhere`).toBeGreaterThan(0);
            for (const value of [vaccination.efficacy, ...coverages, ...(vaccination.halfLife ? [vaccination.halfLife] : [])]) {
                for (const citation of [value.citation, ...(value.also ?? [])]) expect(CITATIONS[citation]).toBeDefined();
            }
            for (const fraction of [vaccination.efficacy.value, ...coverages.map((value) => value.value)]) expect(fraction >= 0 && fraction <= 1).toBe(true);
            if (vaccination.lifelong) expect(CITATIONS[vaccination.lifelong]).toBeDefined();
        }
    });

    it("keeps coverage on the population: a group's own figure, else everyone's", () => {
        expect(vaccineCoverage(getDisease("rsv"), "elderly")?.value).toBe(0.397);
        expect(vaccineCoverage(getDisease("rsv"), "all")).toBeNull();
        expect(vaccineCoverage(getDisease("influenza-a"), "elderly")?.value).toBe(0.472);
        expect(vaccineCoverage(getDisease("influenza-a"), "all")?.value).toBe(0.472);
        expect(vaccineCoverage(getDisease("ebola"), "all")).toBeNull();
        expect(vaccineCoverage(getDisease("ebola"), "contacts")?.value).toBe(0.52);
        expect(vaccineCoverage(getDisease("mpox"), "all")?.value).toBe(0.227);
    });
});

describe("population groups", () => {
    it("can be incomplete, bounded, or not ages at all, and fit the reserved space", () => {
        expect(fatalityGroups(getDisease("pertussis")).map((group) => group.id)).toEqual(["infants", "elderly"]);
        expect(getDisease("sars").populations.groups.map((group) => group.ifr?.bound)).toEqual([undefined, "below", undefined, undefined, "above"]);
        expect(getDisease("mpox").populations.kind).toBe("group");
        for (const disease of DISEASES) expect(fatalityGroups(disease).length).toBeLessThanOrEqual(MAX_POPULATION_GROUPS);
    });

    it('start with a base group like any other, selected by "all", whose fatality may be missing (then nobody dies)', () => {
        for (const disease of DISEASES) {
            const ids = disease.populations.groups.map((group) => group.id);
            expect(new Set(ids).size).toBe(ids.length);
            // "everyone" can only be the base group.
            expect(ids.slice(1)).not.toContain("all");
            expect(populationGroup(disease, "all")).toBe(baseGroupOf(disease));
            expect(fatalityGroups(disease)).not.toContain(baseGroupOf(disease));
        }
        const covid = getDisease("covid-ancestral");
        const [, ...groups] = covid.populations.groups;
        const unknown = {
            ...covid,
            populations: {
                ...covid.populations,
                groups: [{ id: "all" as const, covers: "all ages" }, ...groups] as typeof covid.populations.groups,
            },
        };
        expect(diseaseIfr(unknown, "all")).toBe(NO_FATALITY);
        expect(diseaseIfr(unknown, "children")).toBe(NO_FATALITY);
        expect(diseaseIfr(unknown, "elderly")).toBe(0.046);
    });

    it("name the base group for who its rate was measured in: Everyone only when that's everyone", () => {
        // A per-case rate (reported, confirmed, probable) is everyone's: the cases come from the whole population.
        const everyone = /^(all ages|(reported|confirmed|probable) cases)$/;
        for (const disease of DISEASES) {
            const base = baseGroupOf(disease);
            expect(base.id === "all", `${disease.id}: ${base.covers}`).toBe(everyone.test(base.covers));
        }
        expect(baseGroupOf(getDisease("rsv")).id).toBe("under-5");
        expect(baseGroupOf(getDisease("measles")).id).toBe("children");
        // Mpox's 2022 outbreak, and every value of it, was among GBMSM.
        expect(baseGroupOf(getDisease("mpox")).id).toBe("gbmsm");
    });

    it("fall back to the base group (and its rate) for a group a disease has no data for", () => {
        expect(effectivePopulation(getDisease("pertussis"), "adults")).toBe("all");
        expect(diseaseIfr(getDisease("pertussis"), "adults")).toBe(baseGroupOf(getDisease("pertussis")).ifr!.value);
        expect(effectivePopulation(getDisease("rsv"), "elderly")).toBe("all");
        expect(diseaseIfr(getDisease("measles"), "all")).toBe(baseGroupOf(getDisease("measles")).ifr!.value);
        expect(diseaseIfr(getDisease("sars"), "elderly")).toBe(0.5);
    });
});

describe("reference list", () => {
    it("numbers every visible disease's citations from 1, without gaps or duplicates", () => {
        expect(new Set(CITATION_ORDER).size).toBe(CITATION_ORDER.length);
        CITATION_ORDER.forEach((id, index) => expect(citationNumber(id)).toBe(index + 1));
        for (const disease of VISIBLE_DISEASES) for (const citation of citationsOf(disease)) expect(CITATION_ORDER).toContain(citation);
        expect(CITATION_ORDER).toContain(SUPERSPREADING_CITATION);
    });

    it("leaves out citations only a hidden disease uses", () => {
        expect(CITATION_ORDER).not.toContain("thompson-2022");
    });

    it("lists every citation with a URL", () => {
        for (const citation of Object.values(CITATIONS)) expect(citation.url).toMatch(/^https:\/\//);
    });
});

describe("population (age) fatality", () => {
    it("uses the disease's own rate for all ages and for diseases without age data", () => {
        expect(diseaseIfr(getDisease("covid-ancestral"), "all")).toBe(baseGroupOf(getDisease("covid-ancestral")).ifr!.value);
        expect(diseaseIfr(getDisease("measles"), "elderly")).toBe(baseGroupOf(getDisease("measles")).ifr!.value);
    });

    it("rises with age for COVID-19 and influenza", () => {
        for (const id of ["covid-ancestral", "influenza-a"] as const) {
            const rates = fatalityGroups(getDisease(id)).map((group) => group.ifr!.value);
            expect(rates.slice(1).every((rate, i) => rate > rates[i])).toBe(true);
        }
    });

    it("matches the published values", () => {
        expect(diseaseIfr(getDisease("covid-ancestral"), "elderly")).toBe(0.046);
        expect(diseaseIfr(getDisease("covid-ancestral"), "infants")).toBe(0.000054);
        expect(diseaseIfr(getDisease("covid-omicron"), "elderly")).toBe(0.0097);
        expect(diseaseIfr(getDisease("influenza-a"), "elderly")).toBeCloseTo(19_038 / 2_610_181, 12);
    });
});
