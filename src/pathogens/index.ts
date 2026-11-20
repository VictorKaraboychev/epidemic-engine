/**
 * The diseases: one file each, every published value cited (`Cited`), citations from the shared library
 * (`citations.ts`). Add a disease by writing its file and listing it here and its id in `Pathogen`.
 */
import type { CitationId } from "./citations.js";
import { COVID_ANCESTRAL } from "./covid-ancestral.js";
import { COVID_OMICRON } from "./covid-omicron.js";
import { EBOLA } from "./ebola.js";
import { INFLUENZA_A } from "./influenza-a.js";
import { INFLUENZA_B } from "./influenza-b.js";
import { MEASLES } from "./measles.js";
import { MERS } from "./mers.js";
import { MPOX } from "./mpox.js";
import { PERTUSSIS } from "./pertussis.js";
import { RSV } from "./rsv.js";
import { SARS } from "./sars.js";
import {
    type Cited,
    type PathogenProfile,
    type Pathogen,
    type PathogenValues,
    type PopulationGroup,
    Population,
    citationsFor,
    protectionCitations,
} from "./types.js";

export { CITATIONS, type Citation, type CitationId } from "./citations.js";
export * from "./types.js";

/** At most this many population groups per disease besides its base group (a limit a compact UI can rely on). */
export const MAX_POPULATION_GROUPS = 4;

/** The figure opens on the elderly, where age-dependent fatality is easiest to see. */
export const DEFAULT_POPULATION: Population = Population.Elderly;

/** Every disease, in display order. */
export const PATHOGENS: PathogenProfile[] = [COVID_ANCESTRAL, COVID_OMICRON, INFLUENZA_A, INFLUENZA_B, RSV, MEASLES, PERTUSSIS, MPOX, SARS, MERS, EBOLA];

export const getPathogen = (id: Pathogen) => PATHOGENS.find((pathogen) => pathogen.id === id)!;

/** The diseases to offer (not `hidden`). */
export const VISIBLE_PATHOGENS = PATHOGENS.filter((pathogen) => !pathogen.hidden);

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

/**
 * The groups offered in the population picker besides the base group: those with fatality data (coverage-only groups
 * wait for vaccination).
 */
export const fatalityGroups = (pathogen: PathogenProfile | null) =>
    pathogen?.populations.groups.slice(1).filter((group): group is PopulationGroup => Boolean(group.ifr)) ?? [];

/**
 * The disease's data for a population group, or null for a group it has no data for. `Population.All` selects the base group,
 * whoever it covers.
 */
export const populationGroup = (pathogen: PathogenProfile | null, population: Population) =>
    !pathogen ? null : population === Population.All ? baseGroupOf(pathogen) : (pathogen.populations.groups.find((group) => group.id === population) ?? null);

/**
 * The population in effect: the chosen group if this disease has data for it, else the base group (`Population.All`). (The choice is kept, so
 * switching back to a disease with that group restores it.)
 */
export const effectivePopulation = (pathogen: PathogenProfile | null, population: Population): Population =>
    fatalityGroups(pathogen).some((group) => group.id === population) ? population : Population.All;

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
 * Every citation a disease uses, in the order the preset lines show them: R₀ and infectious periods, overall fatality,
 * the other values, immunity, then the population groups.
 */
export const citationsOf = (pathogen: PathogenProfile): CitationId[] => {
    const { r0, recoveryDays, deathDays, ...rest } = pathogen.values as PathogenValues;
    return [
        ...[r0, recoveryDays, deathDays, baseGroupOf(pathogen).ifr].flatMap((value) => (value ? citationsFor(value) : [])),
        ...Object.values(rest).flatMap(citationsFor),
        ...(pathogen.immunity ? protectionCitations(pathogen.immunity) : []),
        ...fatalityGroups(pathogen).flatMap((group) => citationsFor(group.ifr!)),
        ...vaccinationCitations(pathogen),
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

/** The sources for superspreading: individual variation in infectiousness, and variation in contacts. */
export const SUPERSPREADING_CITATION: CitationId = "lloyd-smith-2005";
export const CONTACTS_CITATION: CitationId = "mossong-2008";

/**
 * Citations in order of first use, so reference numbers read 1, 2, 3… down the disease list. Only visible diseases
 * (not `hidden`) contribute, so the list never cites a hidden one.
 */
export const CITATION_ORDER: CitationId[] = [...new Set([...VISIBLE_PATHOGENS.flatMap(citationsOf), SUPERSPREADING_CITATION, CONTACTS_CITATION])];

export const citationNumber = (id: CitationId) => CITATION_ORDER.indexOf(id) + 1;
