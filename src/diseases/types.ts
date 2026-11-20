import type { CitationId } from "./citations.js";

/** Every disease's id, in display order (each has a file in this folder, listed in `index.ts`). A UI names each one. */
export const DISEASE_IDS = [
    "covid-ancestral",
    "covid-omicron",
    "influenza-a",
    "influenza-b",
    "rsv",
    "measles",
    "pertussis",
    "mpox",
    "sars",
    "mers",
    "ebola",
] as const;
export type DiseaseId = (typeof DISEASE_IDS)[number];

/**
 * Population groups a disease can have data for ("all" is everyone); add one here to use it (it needn't be an age
 * group), and a UI names it. "all" also selects a disease's base group, whatever it is (see
 * `Populations.groups`).
 */
export const POPULATION_IDS = ["all", "infants", "under-5", "children", "young", "adults", "middle-aged", "elderly", "contacts", "gbmsm"] as const;
export type PopulationId = (typeof POPULATION_IDS)[number];
export type PopulationGroupId = Exclude<PopulationId, "all">;

/** How a source states a value's uncertainty. */
export type IntervalKind = "ci95" | "ci90" | "cri95" | "ui95" | "iqr" | "range";

/** The uncertainty around a published value: a confidence or credible interval, interquartile range, or plain range. */
export interface Interval {
    low: number;
    high: number;
    kind: IntervalKind;
}

/** Interval constructor, for reading order: `between(5.1, 5.9, "ci95")`. */
export const between = (low: number, high: number, kind: IntervalKind): Interval => ({ low, high, kind });

/** Why a value should be read with care; a UI explains each one beside the value. */
export const CAVEAT_IDS = ["otherSetting", "clinicalDuration", "proxy", "confounded", "underReported", "poorFit", "fitted"] as const;
export type CaveatId = (typeof CAVEAT_IDS)[number];

/** A published number, the source it comes from, and what else the source says about it. */
export interface Cited {
    value: number;
    citation: CitationId;
    /** Further sources, for values derived from more than one (e.g. incubation minus pre-symptom spread). */
    also?: CitationId[];
    /** The source's uncertainty around the value (the value lies within it). */
    interval?: Interval;
    /** The source gives a bound, not a point estimate ("< 1%", "> 21 years"): the bound is used and shown with its sign. */
    bound?: "below" | "above";
    /** Why the value should be read with care, if it should. */
    caveat?: CaveatId;
}

/** Everything about a value beyond the number and its main source. */
export type CitedDetails = Omit<Cited, "value" | "citation">;

/**
 * Pairs a value with its citation and anything else the source says about it: `cited(2.79, "liu-2020")`, or
 * `cited(3, "lessler-2009", { also: ["cdc-rsv-spread"], interval: between(1.5, 4, "range") })`.
 */
export const cited = (value: number, citation: CitationId, details: CitedDetails = {}): Cited => ({ value, citation, ...details });

/** Every source behind a value. */
export const citationsFor = (value: Cited): CitationId[] => [value.citation, ...(value.also ?? [])];

/**
 * Protection, after infection or vaccination: how strong it is at first (if measured) and how long it lasts, either
 * halving every `halfLife` days or `lifelong` (with the source that says so). Neither means duration wasn't measured.
 */
export type Protection = {
    efficacy?: Cited;
    /**
     * For people infected anyway (a breakthrough or a reinfection): how much less likely they are to die than someone
     * unprotected, as a share (0.8 = 80% less). Often measured as severe disease or hospitalisation (a `proxy` caveat).
     */
    deathProtection?: Cited;
    /** For people infected anyway: how much less infectious they are, as a share (0.2 = 20% less). */
    spreadProtection?: Cited;
} & (
    | {
          halfLife: Cited;
          /**
           * Days of full protection before it starts to halve. Studies measure protection months after infection;
           * a halving curve through those points can need protection to hold fully at first (it can't exceed 100%).
           * Without the delay, the curve would fall far too soon.
           */
          delay?: Cited;
          lifelong?: never;
      }
    | { lifelong: CitationId; halfLife?: never; delay?: never }
    | { halfLife?: never; delay?: never; lifelong?: never }
);

/** Every source behind a protection estimate. */
export const protectionCitations = (protection: Protection): CitationId[] => [
    ...(protection.efficacy ? citationsFor(protection.efficacy) : []),
    ...(protection.deathProtection ? citationsFor(protection.deathProtection) : []),
    ...(protection.spreadProtection ? citationsFor(protection.spreadProtection) : []),
    ...(protection.halfLife ? citationsFor(protection.halfLife) : []),
    ...(protection.delay ? citationsFor(protection.delay) : []),
    ...(protection.lifelong ? [protection.lifelong] : []),
];

/**
 * A disease's published values, keyed by the simulator parameter each one sets (plus the R₀ to target). The optional
 * ones switch features on: a disease with a latent period can run with an exposed compartment, one with a dispersion k
 * can run with superspreading. What each value's source says is written out under `presets.details` in the catalog,
 * which takes the numbers from here.
 */
export interface DiseaseValues {
    /** R₀ the simulator targets (it solves for the daily transmission rate that gives it on the network). */
    r0: Cited;
    /** Mean infectious period (days) of infections that end in recovery. */
    recoveryDays: Cited;
    /**
     * Mean infectious period (days) of infections that end in death. Equal to `recoveryDays` unless a source gives an
     * outcome-specific estimate (Ebola: infectious until death, which comes sooner than recovery).
     */
    deathDays: Cited;
    /** Mean days infected but not yet infectious. */
    latentDays?: Cited;
    /**
     * How variable the latent period is (coefficient of variation), from the incubation period's spread: rarely
     * measured for the latent period itself (a `proxy` caveat).
     */
    latentVariation?: Cited;
    /** Dispersion k of individual infectiousness (Lloyd-Smith et al. 2005): small k, strong superspreading. */
    dispersion?: Cited;
    /**
     * Mean days from one infection to the next it causes (or the serial interval, onset to onset, where that is what's
     * published: a `proxy` caveat). The infectiousness profile is fitted to it (`infectiousnessHalfLife`), and
     * validation checks simulated outbreaks match.
     */
    generationInterval?: Cited;
    /**
     * Days for infectiousness to halve over the infectious period, fitted so simulated outbreaks have the published
     * generation interval with the published latent and infectious periods (a `fitted` caveat). Omitted where a flat
     * profile already gives an interval as long as published, or longer.
     */
    infectiousnessHalfLife?: Cited;
}

/** One population group's data, as its sources report it: fatality, vaccine coverage, both, or neither. */
export interface PopulationGroup<Id extends PopulationId = PopulationGroupId> {
    id: Id;
    /** Who exactly the numbers cover, as the source reports it: ages ("75", "0–4") or a short description. */
    covers: string;
    /** Fatality in this group, with its citation (without it, everyone's rate applies, or none if everyone has none either). */
    ifr?: Cited;
    /** Share of this group vaccinated, with its citation (without it, everyone's coverage applies). */
    vaccineCoverage?: Cited;
}

/**
 * Who dies, and who is vaccinated: data for everyone, and for groups within the population where it's published. Only
 * the groups the data covers are listed (incomplete data is fine), and groups needn't be ages.
 */
export interface Populations {
    /** What the groups split people by; names the section's explanation. */
    kind: "age" | "group";
    /**
     * What every fatality rate here is per: an infection (IFR), a symptomatic illness (CDC influenza burden), or a
     * reported case. One measure for everyone and every group, so the rates compare.
     */
    measure: "infection" | "illness" | "case";
    /**
     * The base group first: the disease's overall data (its fatality is the default rate, and without one nobody
     * dies), for whoever the sources measured it in. That's everyone ("all") for most diseases, but any group fits
     * (children under 5 for RSV, GBMSM for mpox), so a UI can name who the numbers are about. Then the narrower groups
     * with data, in display order. At most `MAX_POPULATION_GROUPS` besides the base with fatality data.
     */
    groups: [PopulationGroup<PopulationId>, ...PopulationGroup[]];
}

/**
 * Published vaccine data, for the simulator's vaccinated compartment (vaccinated people's susceptibility = 1 −
 * efficacy, waning with the half-life): the same shape as immunity after infection, with efficacy required. Coverage
 * is population data, so it lives on `populations`.
 */
export type Vaccination =
    | (Protection & {
          /** Effectiveness against infection (or the closest outcome measured; a `proxy` caveat says so). */
          efficacy: Cited;
      })
    | {
          /** No licensed vaccine, with the source that says so. */
          none: CitationId;
      };

export interface Disease {
    id: DiseaseId;
    values: DiseaseValues;
    /**
     * Nearest contacts per person: a modelling choice, not a published value. Each person can infect at most their
     * contacts, so the network's R₀ ceiling is roughly its mean excess degree; highly transmissible diseases need
     * dense networks to reach their R₀.
     */
    contacts: number;
    /**
     * Protection against reinfection after recovery. A half-life lets immunity wane in the simulator; lifelong means
     * there is nothing to wane (and says why the option is off).
     */
    immunity?: Protection;
    /** Fatality (overall and by group) and vaccine coverage. */
    populations: Populations;
    /** Vaccination data (not used by the simulator yet). */
    vaccination?: Vaccination;
    /** Kept in the data (and type-checked) but not offered in the UI. */
    hidden?: boolean;
}

/** Typed identity: lets each disease file be checked against `Disease` where it is written. */
export const defineDisease = (disease: Disease) => disease;
