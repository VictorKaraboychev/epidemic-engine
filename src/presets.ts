/**
 * From a pathogen's cited values to a run: the model parameters a disease sets (for a population group), the model
 * features it has data for, and the transmission rate that gives its published R₀ on a particular network.
 * Lifelong protection and flat infectiousness are infinite half-lives.
 */
import { type Cited, type PathogenProfile, Population, fatalityRate, parameterValues, simulatedCoverage } from "./pathogens/index.js";
import type { CompartmentModel } from "./model.js";
import { betaForR0, transmissibility } from "./r0.js";
import { type ReproductionCurve, contactDispersionAt, individualDispersion } from "./reproduction.js";
import type { ModelFeatures, SeirdModelParams } from "./seird.js";

/**
 * Everything a disease can set: the model's parameters except the transmission rate (solved for R₀ on the network:
 * see `solveTransmission`), plus contacts per person, vaccine coverage, and `dispersion`, the published k of offspring
 * counts (a target: the network's own unevenness supplies part of it).
 */
export type PathogenParams = Omit<SeirdModelParams, "beta" | "dispersion"> & { contacts: number; vaccineCoverage: number; dispersion: number };

/** Model parameters a disease's cited values set directly, where it has them. */
const CITED_PARAMS = [
    "recoveryDays",
    "deathDays",
    "latentDays",
    "latentVariation",
    "dispersion",
    "infectiousnessHalfLife",
    "immunityHalfLife",
    "immunityDelay",
] as const satisfies (keyof PathogenParams)[];

/**
 * A disease's vaccine as parameters: its efficacy, its half-life (`Infinity` when protection lasts or wasn't measured
 * to wane), and the coverage for this population. Nothing for a disease without a licensed vaccine.
 */
export const vaccineParams = (pathogen: PathogenProfile, populationId: Population): Partial<PathogenParams> => {
    const vaccination = pathogen.vaccination;
    if (!vaccination || "none" in vaccination) return {};
    return {
        vaccineEfficacy: vaccination.efficacy.value,
        vaccineHalfLife: vaccination.halfLife?.value ?? Infinity,
        vaccineCoverage: simulatedCoverage(pathogen, populationId)?.value ?? 0,
        vaccineDeathProtection: vaccination.deathProtection?.value ?? 0,
        vaccineSpreadProtection: vaccination.spreadProtection?.value ?? 0,
    };
};

/**
 * The parameters a disease sets: each of its cited values that is a parameter (so a disease file only has to add a
 * value for a new parameter to start setting it), its fatality for this population, its contacts and its vaccine.
 */
export const pathogenParams = (pathogen: PathogenProfile, populationId: Population): Partial<PathogenParams> => {
    const params: Partial<PathogenParams> = {
        contacts: pathogen.contacts,
        ifr: fatalityRate(pathogen, populationId),
        // No published delay means protection wanes from the start.
        immunityDelay: 0,
        // Flat infectiousness unless the disease has a fitted profile (set from its values below).
        infectiousnessHalfLife: Infinity,
        // Reinfections' protection, where published (else none).
        immunityDeathProtection: pathogen.immunity?.deathProtection?.value ?? 0,
        immunitySpreadProtection: pathogen.immunity?.spreadProtection?.value ?? 0,
        // Lifelong immunity: full protection that never ends.
        ...(pathogen.immunity?.lifelong ? { immunityDelay: Infinity, immunityHalfLife: Infinity } : {}),
        ...vaccineParams(pathogen, populationId),
    };
    const values = parameterValues(pathogen) as Partial<Record<keyof PathogenParams, Cited>>;
    for (const key of CITED_PARAMS) {
        const value = values[key];
        if (value) params[key] = value.value;
    }
    return params;
};

/**
 * The features a disease can run with: each needs its cited value (a latent period for exposed, an immunity half-life
 * or lifelong immunity for waning, a k for superspreading, a licensed vaccine with coverage data for vaccination).
 * `null` (no disease: parameters set by hand) can run with everything.
 */
export const availableFeatures = (pathogen: PathogenProfile | null): ModelFeatures => ({
    superspreading: !pathogen || Boolean(pathogen.values.dispersion),
    exposed: !pathogen || Boolean(pathogen.values.latentDays),
    waning: !pathogen || Boolean(pathogen.immunity?.halfLife || pathogen.immunity?.lifelong),
    vaccination: !pathogen || (Boolean(pathogen.vaccination && !("none" in pathogen.vaccination)) && simulatedCoverage(pathogen, Population.All) !== null),
});

/** The transmission rates `solveTransmission` searches between (daily chance per contact). */
export const BETA_RANGE = { min: 0.01, max: 0.95 } as const;
/** Rounds of solving the transmission rate and individual dispersion together (they settle within a few). */
const SPLIT_ROUNDS = 3;

export interface TransmissionTarget<P extends SeirdModelParams> {
    model: CompartmentModel<P>;
    /** The run's parameters; `beta` is kept when there's no `r0` to solve for, and `dispersion` is ignored. */
    params: P;
    /** The network's reproduction curve (`reproductionCurve`). */
    reproduction: ReproductionCurve;
    /** The published R₀ to solve the transmission rate for; null keeps `params.beta`. */
    r0: number | null;
    /** The published k of offspring counts, with superspreading on; null for none. */
    dispersion: number | null;
    range?: { min: number; max: number };
}

/**
 * The transmission rate (solved for `r0` on this network) and, with superspreading, the dispersion individual
 * infectiousness needs so that, with the network's own uneven contacts, offspring counts have the target k (0: the
 * network alone is as uneven). The two depend on each other (the network's share depends on transmissibility), so
 * they are found together in a few rounds.
 */
export const solveTransmission = <P extends SeirdModelParams>({
    model,
    params,
    reproduction,
    r0,
    dispersion: target,
    range = BETA_RANGE,
}: TransmissionTarget<P>): { beta: number; dispersion: number | null } => {
    const individual = (beta: number) =>
        individualDispersion(target!, contactDispersionAt(reproduction, transmissibility(model, { ...params, beta, dispersion: null }))) ?? 0;
    let dispersion = target;
    let beta = params.beta;
    for (let round = 0; round < (target !== null ? SPLIT_ROUNDS : 1); round++) {
        if (r0 !== null)
            beta = betaForR0(model, { ...params, dispersion: dispersion && dispersion > 0 ? dispersion : null }, reproduction, r0, range.min, range.max);
        if (target !== null) dispersion = individual(beta);
    }
    return { beta, dispersion };
};
