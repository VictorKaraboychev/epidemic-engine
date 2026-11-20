/**
 * Your own pathogens, from plain numbers: `new Pathogen({ id: "my-flu", r0: 1.8, latentDays: 2, recoveryDays: 5 })`
 * reads a `PathogenSpec` into the same data the built-in ones have (`profileFromSpec`).
 */
import { FatalityMeasure, type PathogenProfile, Population, PopulationKind, type Protection } from "./types.js";

/** Protection after recovery or vaccination: lifelong, or full for `delay` days and then halving every `halfLife`. */
export interface ProtectionSpec {
    /** Days for protection to halve once it starts to wane. */
    halfLife?: number;
    /** Days of full protection before it starts to wane (default 0). */
    delay?: number;
    /** Protection that never ends (instead of `halfLife`). */
    lifelong?: boolean;
    /** For people infected anyway: how much less likely to die, and less infectious (0–1; default 0). */
    deathProtection?: number;
    spreadProtection?: number;
}

export interface PathogenSpec {
    /** A name for it (shown nowhere by the engine; yours to use). */
    id: string;
    /** Basic reproduction number: the transmission rate is solved for it on each network. */
    r0: number;
    /** Mean days infectious, for infections that end in recovery. */
    recoveryDays: number;
    /** Mean days infectious, for infections that end in death (default `recoveryDays`). */
    deathDays?: number;
    /** Mean days infected but not yet infectious (default: none, an SIRD model). */
    latentDays?: number;
    /** How variable latent periods are: coefficient of variation (default 0.5). */
    latentVariation?: number;
    /** Days for infectiousness to halve over the infectious period (default: flat). */
    infectiousnessHalfLife?: number;
    /** Share of infections that are fatal (0–1; default 0). */
    ifr?: number;
    /** Everyday contacts per person (default 8). */
    contacts?: number;
    /** Dispersion k of how many people each case infects; allows superspreading (default: none). */
    dispersion?: number;
    /** Protection after recovery; with a half-life or lifelong, allows waning immunity (default: lifelong, no waning). */
    immunity?: ProtectionSpec;
    /** A vaccine, allowing vaccination (default: none). */
    vaccine?: ProtectionSpec & {
        /** Protection against infection at first (0–1). */
        efficacy: number;
        /** Share of people vaccinated before the outbreak (0–1). */
        coverage: number;
    };
}

/** Contacts per person when a spec doesn't say: mid-range for the built-in pathogens (3 to 20). */
export const DEFAULT_PATHOGEN_CONTACTS = 8;

const positive = (name: string, value: number | undefined) => {
    if (value !== undefined && !(value > 0 && Number.isFinite(value))) throw new RangeError(`${name} must be a positive number, not ${value}`);
};
const share = (name: string, value: number | undefined) => {
    if (value !== undefined && !(value >= 0 && value <= 1)) throw new RangeError(`${name} must be between 0 and 1, not ${value}`);
};

const protectionOf = (name: string, spec: ProtectionSpec): Protection => {
    positive(`${name}.halfLife`, spec.halfLife);
    share(`${name}.deathProtection`, spec.deathProtection);
    share(`${name}.spreadProtection`, spec.spreadProtection);
    if (spec.delay !== undefined && !(spec.delay >= 0)) throw new RangeError(`${name}.delay must be 0 or more, not ${spec.delay}`);
    if (spec.lifelong && spec.halfLife !== undefined) throw new Error(`${name}: give a halfLife or lifelong, not both`);
    const effects = {
        ...(spec.deathProtection !== undefined ? { deathProtection: { value: spec.deathProtection } } : {}),
        ...(spec.spreadProtection !== undefined ? { spreadProtection: { value: spec.spreadProtection } } : {}),
    };
    if (spec.lifelong) return { ...effects, lifelong: true };
    if (spec.halfLife !== undefined) return { ...effects, halfLife: { value: spec.halfLife }, ...(spec.delay ? { delay: { value: spec.delay } } : {}) };
    return effects;
};

/** A pathogen's data from your own numbers (checked: periods positive, shares between 0 and 1). Its values have no sources. */
export const profileFromSpec = (spec: PathogenSpec): PathogenProfile => {
    for (const key of ["r0", "recoveryDays", "deathDays", "latentDays", "latentVariation", "infectiousnessHalfLife", "contacts", "dispersion"] as const)
        positive(key, spec[key]);
    share("ifr", spec.ifr);
    if (spec.vaccine) {
        share("vaccine.efficacy", spec.vaccine.efficacy);
        share("vaccine.coverage", spec.vaccine.coverage);
    }
    return {
        id: spec.id,
        values: {
            r0: { value: spec.r0 },
            recoveryDays: { value: spec.recoveryDays },
            deathDays: { value: spec.deathDays ?? spec.recoveryDays },
            ...(spec.latentDays !== undefined ? { latentDays: { value: spec.latentDays } } : {}),
            ...(spec.latentVariation !== undefined ? { latentVariation: { value: spec.latentVariation } } : {}),
            ...(spec.infectiousnessHalfLife !== undefined ? { infectiousnessHalfLife: { value: spec.infectiousnessHalfLife } } : {}),
            ...(spec.dispersion !== undefined ? { dispersion: { value: spec.dispersion } } : {}),
        },
        contacts: Math.round(spec.contacts ?? DEFAULT_PATHOGEN_CONTACTS),
        ...(spec.immunity ? { immunity: protectionOf("immunity", spec.immunity) } : {}),
        populations: {
            kind: PopulationKind.Group,
            measure: FatalityMeasure.Infection,
            groups: [
                {
                    id: Population.All,
                    covers: "everyone",
                    ifr: { value: spec.ifr ?? 0 },
                    ...(spec.vaccine ? { vaccineCoverage: { value: spec.vaccine.coverage } } : {}),
                },
            ],
        },
        ...(spec.vaccine ? { vaccination: { ...protectionOf("vaccine", spec.vaccine), efficacy: { value: spec.vaccine.efficacy } } } : {}),
    };
};
