/**
 * What can be read from a pathogen's data: fatality and vaccine coverage by population group, its values by
 * parameter, and its citations (the `Pathogen` class wraps these as methods). The built-in pathogens' data is in
 * `data.ts`, one file each.
 */
import type { CitationId } from "./citations.js";
import { type Cited, type PathogenProfile, type PathogenValues, type PopulationGroup, Group, citationsFor, protectionCitations } from "./types.js";

export { CITATIONS, type Citation, type CitationId } from "./citations.js";
export * from "./types.js";
export * from "./custom.js";

/** True when the disease gives fatal infections their own infectious period. */
export const hasOutcomeSpecificPeriods = (pathogen: PathogenProfile) => pathogen.values.fatalInfectiousDays.value !== pathogen.values.infectiousDays.value;

/** The disease's base group: its overall data, for everyone or whoever the sources measured it in (the first group). */
export const baseGroupOf = (pathogen: PathogenProfile) => pathogen.populations.groups[0];

/** The fatality rate when a disease has no published one, for the group or for everyone: nobody dies (not a guess). */
export const NO_FATALITY = 0;

/** The fatality rate a disease uses for a population: the group's own when it has one, else everyone's, else none. */
export const fatalityRate = (pathogen: PathogenProfile, population: Group) =>
    (populationGroup(pathogen, population)?.ifr ?? baseGroupOf(pathogen).ifr)?.value ?? NO_FATALITY;

/**
 * Vaccine coverage for a population: the group's own figure, else the base group's, else null (no figure that
 * applies, or no vaccine).
 */
export const vaccineCoverage = (pathogen: PathogenProfile, population: Group) => {
    if (!pathogen.vaccination || "none" in pathogen.vaccination) return null;
    return populationGroup(pathogen, population)?.vaccineCoverage ?? baseGroupOf(pathogen).vaccineCoverage ?? null;
};

/**
 * The coverage the simulator vaccinates for a population: the group's own figure, else the base group's, else the only
 * published one (e.g. RSV's, for people 75+; the preset's coverage line says whom it covers). Null without any.
 */
export const simulatedCoverage = (pathogen: PathogenProfile, population: Group) =>
    vaccineCoverage(pathogen, population) ?? pathogen.populations.groups.find((group) => group.vaccineCoverage)?.vaccineCoverage ?? null;

/** The groups besides the base group with their own fatality rate (others may have only vaccine coverage). */
export const fatalityGroups = (pathogen: PathogenProfile | null) =>
    pathogen?.populations.groups.slice(1).filter((group): group is PopulationGroup => Boolean(group.ifr)) ?? [];

/**
 * The disease's data for a population group, or null for a group it has no data for. `Group.All` selects the base group,
 * whoever it covers.
 */
export const populationGroup = (pathogen: PathogenProfile | null, population: Group) =>
    !pathogen ? null : population === Group.All ? baseGroupOf(pathogen) : (pathogen.populations.groups.find((group) => group.id === population) ?? null);

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
    const { r0, infectiousDays, fatalInfectiousDays, ...rest } = pathogen.values as PathogenValues;
    // Each source once, where it's first cited.
    return [
        ...new Set([
            ...[r0, infectiousDays, fatalInfectiousDays, baseGroupOf(pathogen).ifr].flatMap((value) => (value ? citationsFor(value) : [])),
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

/** How far past the oldest published age fatality keeps rising (COVID-19: from 75 to 85, ≈ 16%, as Levin et al.'s 15%). */
export const MAX_EXTRAPOLATION_YEARS = 10;

/** Whether a group's ages include `age`. */
const covers = (group: PopulationGroup<Group>, age: number) => Boolean(group.ages && age >= group.ages.from && age <= group.ages.to);

/**
 * Fatality at one age, from the pathogen's age-specific data:
 * - In an age band the data covers ("18–49", "65+"): that band's rate.
 * - Where the data gives rates at single ages (COVID-19: 1, 25, 55, 75), interpolated log-linearly between them, as
 *   fatality rises roughly exponentially with age (Levin et al. 2020); beyond the oldest, extended along the last
 *   segment for `MAX_EXTRAPOLATION_YEARS` and then held (estimates thin out in the very old), below the youngest,
 *   the youngest's rate.
 * - Otherwise (no age data, or an age between the bands given): the pathogen's overall rate.
 */
export const fatalityAtAge = (pathogen: PathogenProfile, age: number): number => {
    const groups = pathogen.populations.groups.filter((group) => group.ages && group.ifr);
    const band = groups.find((group) => group.ages!.from !== group.ages!.to && covers(group, age));
    if (band) return band.ifr!.value;
    const points = groups
        .filter((group) => group.ages!.from === group.ages!.to)
        .map((group) => ({ age: group.ages!.from, rate: group.ifr!.value }))
        .sort((a, b) => a.age - b.age);
    const exact = points.find((point) => point.age === age);
    if (exact) return exact.rate;
    if (points.length >= 2) {
        if (age < points[0].age) return points[0].rate;
        const upper = points.findIndex((point) => point.age > age);
        const [a, b] = upper === -1 ? [points[points.length - 2], points[points.length - 1]] : [points[upper - 1], points[upper]];
        const slope = Math.log(b.rate / a.rate) / (b.age - a.age);
        return Math.min(1, a.rate * Math.exp(slope * (Math.min(age, b.age + MAX_EXTRAPOLATION_YEARS) - a.age)));
    }
    return baseGroupOf(pathogen).ifr?.value ?? NO_FATALITY;
};

/**
 * The share vaccinated at one age: an age group's own coverage where the data gives it by age (RSV: 75 and over),
 * everyone else the base group's (or none); without coverage by age, the pathogen's overall coverage for everyone.
 * Null without a vaccine.
 */
export const coverageAtAge = (pathogen: PathogenProfile, age: number): number | null => {
    if (!pathogen.vaccination || "none" in pathogen.vaccination) return null;
    const byAge = pathogen.populations.groups.filter((group) => group.ages && group.vaccineCoverage);
    if (!byAge.length) return simulatedCoverage(pathogen, Group.All)?.value ?? 0;
    return byAge.find((group) => covers(group, age))?.vaccineCoverage!.value ?? baseGroupOf(pathogen).vaccineCoverage?.value ?? 0;
};
