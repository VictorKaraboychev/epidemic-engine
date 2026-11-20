/**
 * What can be read from a pathogen's data: fatality and vaccine coverage by population group, its values by
 * parameter, and its citations (the `Pathogen` class wraps these as methods). The built-in pathogens' data is in
 * `data.ts`, one file each.
 */
import type { CitationId } from "./citations.js";
import { type Cited, type PathogenProfile, type PathogenValues, type PopulationGroup, Population, citationsFor, protectionCitations } from "./types.js";

export { CITATIONS, type Citation, type CitationId } from "./citations.js";
export * from "./types.js";
export * from "./custom.js";

/** True when the disease gives fatal infections their own infectious period. */
export const hasOutcomeSpecificPeriods = (pathogen: PathogenProfile) => pathogen.values.deathDays.value !== pathogen.values.recoveryDays.value;

/** The disease's base group: its overall data, for everyone or whoever the sources measured it in (the first group). */
export const baseGroupOf = (pathogen: PathogenProfile) => pathogen.populations.groups[0];

/** The fatality rate when a disease has no published one, for the group or for everyone: nobody dies (not a guess). */
export const NO_FATALITY = 0;

/** The fatality rate a disease uses for a population: the group's own when it has one, else everyone's, else none. */
export const fatalityRate = (pathogen: PathogenProfile, population: Population) =>
    (populationGroup(pathogen, population)?.ifr ?? baseGroupOf(pathogen).ifr)?.value ?? NO_FATALITY;

/**
 * Vaccine coverage for a population: the group's own figure, else the base group's, else null (no figure that
 * applies, or no vaccine).
 */
export const vaccineCoverage = (pathogen: PathogenProfile, population: Population) => {
    if (!pathogen.vaccination || "none" in pathogen.vaccination) return null;
    return populationGroup(pathogen, population)?.vaccineCoverage ?? baseGroupOf(pathogen).vaccineCoverage ?? null;
};

/**
 * The coverage the simulator vaccinates for a population: the group's own figure, else the base group's, else the only
 * published one (e.g. RSV's, for people 75+; the preset's coverage line says whom it covers). Null without any.
 */
export const simulatedCoverage = (pathogen: PathogenProfile, population: Population) =>
    vaccineCoverage(pathogen, population) ?? pathogen.populations.groups.find((group) => group.vaccineCoverage)?.vaccineCoverage ?? null;

/** The groups besides the base group with their own fatality rate (others may have only vaccine coverage). */
export const fatalityGroups = (pathogen: PathogenProfile | null) =>
    pathogen?.populations.groups.slice(1).filter((group): group is PopulationGroup => Boolean(group.ifr)) ?? [];

/**
 * The disease's data for a population group, or null for a group it has no data for. `Population.All` selects the base group,
 * whoever it covers.
 */
export const populationGroup = (pathogen: PathogenProfile | null, population: Population) =>
    !pathogen ? null : population === Population.All ? baseGroupOf(pathogen) : (pathogen.populations.groups.find((group) => group.id === population) ?? null);

/**
 * The disease's values keyed by the simulator parameter each sets: its own values, plus immunity's half-life (which
 * lets immunity wane). Fatality is per population (`fatalityRate`), so it isn't here.
 */
export const parameterValues = (pathogen: PathogenProfile): Partial<Record<keyof PathogenValues | "immunityHalfLife" | "immunityDelay", Cited>> => ({
    ...pathogen.values,
    ...(pathogen.immunity?.halfLife ? { immunityHalfLife: pathogen.immunity.halfLife } : {}),
    ...(pathogen.immunity?.delay ? { immunityDelay: pathogen.immunity.delay } : {}),
});

/** Every cited value a disease has, wherever it lives (values, immunity, populations, vaccination). */
export const citedValuesOf = (pathogen: PathogenProfile): Cited[] => {
    const { groups } = pathogen.populations;
    const vaccination = pathogen.vaccination && !("none" in pathogen.vaccination) ? pathogen.vaccination : null;
    return [
        ...Object.values(pathogen.values),
        pathogen.immunity?.efficacy,
        pathogen.immunity?.halfLife,
        pathogen.immunity?.delay,
        pathogen.immunity?.deathProtection,
        pathogen.immunity?.spreadProtection,
        ...groups.flatMap((group) => [group.ifr, group.vaccineCoverage]),
        vaccination?.efficacy,
        vaccination?.halfLife,
        vaccination?.deathProtection,
        vaccination?.spreadProtection,
    ].filter((value): value is Cited => Boolean(value));
};

/**
 * Every source a pathogen cites, once each, in the order of its values: R₀ and infectious periods, overall fatality,
 * the other values, immunity, the population groups, then the vaccine.
 */
export const citationsOf = (pathogen: PathogenProfile): CitationId[] => {
    const { r0, recoveryDays, deathDays, ...rest } = pathogen.values as PathogenValues;
    // Each source once, where it's first cited.
    return [
        ...new Set([
            ...[r0, recoveryDays, deathDays, baseGroupOf(pathogen).ifr].flatMap((value) => (value ? citationsFor(value) : [])),
            ...Object.values(rest).flatMap(citationsFor),
            ...(pathogen.immunity ? protectionCitations(pathogen.immunity) : []),
            ...fatalityGroups(pathogen).flatMap((group) => citationsFor(group.ifr!)),
            ...vaccinationCitations(pathogen),
        ]),
    ];
};

/** The vaccine's sources (efficacy, waning, or why there is none) and every coverage figure's. */
const vaccinationCitations = (pathogen: PathogenProfile): CitationId[] => {
    const vaccination = pathogen.vaccination;
    if (!vaccination) return [];
    if ("none" in vaccination) return [vaccination.none];
    const coverages = pathogen.populations.groups.flatMap((group) => (group.vaccineCoverage ? citationsFor(group.vaccineCoverage) : []));
    return [...protectionCitations(vaccination), ...coverages];
};

/** The sources behind the model's superspreading: individual variation in infectiousness, and in contacts. */
export const SUPERSPREADING_CITATION: CitationId = "lloyd-smith-2005";
export const CONTACTS_CITATION: CitationId = "mossong-2008";
