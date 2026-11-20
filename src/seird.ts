/**
 * The SEIRD model the simulator runs, as data (see `model.ts`): infectious → recovered or died, each outcome with its
 * own infectious period, with an optional exposed (latent) compartment, gradually waning immunity and vaccination.
 * Lifelong protection and flat infectiousness are infinite half-lives.
 */
import { type CompartmentModel, SeirdCompartment, type SeirdParams, vaccineSusceptibility, waningSusceptibility } from "./model.js";

/** Every parameter any of the simulator's models reads (each model ignores the ones it doesn't use). */
export interface SeirdModelParams extends SeirdParams {
    /** Coefficient of variation of the latent period (its shape is 1 / CV²). */
    latentVariation: number;
    /** Days for infectiousness to halve over the infectious period (`Infinity`, or omitted: flat). */
    infectiousnessHalfLife?: number;
    /** Days for protection against reinfection to halve, once it starts to wane (`Infinity`: lifelong). */
    immunityHalfLife: number;
    /** Days of full protection after recovery before it starts to wane (0: it wanes from the start; `Infinity`: lifelong). */
    immunityDelay?: number;
    /** Vaccine protection against infection at first (0–1), and days for it to halve (`Infinity`: lifelong). */
    vaccineEfficacy?: number;
    vaccineHalfLife?: number;
    /** For people infected despite a vaccine, or reinfected: how much less likely to die, and less infectious (0–1). */
    vaccineDeathProtection?: number;
    vaccineSpreadProtection?: number;
    immunityDeathProtection?: number;
    immunitySpreadProtection?: number;
}

export type SeirdModel = CompartmentModel<SeirdModelParams>;

/** Optional parts of the model, each switched on separately. */
export interface ModelFeatures {
    /** An exposed compartment: infected, not yet infectious (SEIRD). */
    exposed: boolean;
    /** Immunity after recovery wanes gradually, so people can be infected again. */
    waning: boolean;
    /**
     * Superspreading: individual infectiousness varies (gamma, dispersion k) and so do contact numbers (a few people
     * have many), so most cases infect few and a few infect many. Doesn't change the compartments.
     */
    superspreading: boolean;
    /** A share of people vaccinated before the outbreak, protected by the vaccine's efficacy as it wanes. */
    vaccination: boolean;
}

export const MODEL_FEATURES = ["exposed", "waning", "superspreading", "vaccination"] as const satisfies (keyof ModelFeatures)[];

const models = new Map<string, SeirdModel>();

/**
 * The simulator's model for a set of features: SIRD (infectious → recovered or died, each outcome with its own
 * infectious period), plus an exposed compartment, gradually waning immunity and/or vaccination. One model per
 * combination, cached.
 */
export const seirdModel = ({
    exposed,
    waning,
    vaccination = false,
}: Pick<ModelFeatures, "exposed" | "waning"> & Partial<Pick<ModelFeatures, "vaccination">>): SeirdModel => {
    const id = `s${exposed ? "e" : ""}ird${waning ? "-waning" : ""}${vaccination ? "-vaccination" : ""}`;
    const additions = [waning && "waning immunity", vaccination && "vaccination"].filter(Boolean).join(" and ");
    const cached = models.get(id);
    if (cached) return cached;
    const model: SeirdModel = {
        id,
        name: `${exposed ? "SEIRD" : "SIRD"}${additions ? ` with ${additions}` : ""}`,
        compartments: [
            { key: SeirdCompartment.Susceptible, name: "susceptible", susceptibility: () => 1 },
            // Vaccinated before the outbreak: partly protected, less so as the vaccine wanes; infection moves them on.
            ...(vaccination
                ? [
                      {
                          key: SeirdCompartment.Vaccinated,
                          name: "vaccinated",
                          susceptibilityAfter: (p: SeirdModelParams) => vaccineSusceptibility(p.vaccineEfficacy ?? 0, p.vaccineHalfLife ?? Infinity),
                          // Breakthrough infections: less likely to be fatal, and less infectious.
                          protects: (p: SeirdModelParams) => ({ death: p.vaccineDeathProtection ?? 0, spread: p.vaccineSpreadProtection ?? 0 }),
                      },
                  ]
                : []),
            ...(exposed
                ? [
                      {
                          key: SeirdCompartment.Exposed,
                          name: "exposed",
                          infected: true,
                          // How variable latent periods are: shape 1 / CV², from the incubation period's spread.
                          exits: [
                              {
                                  to: SeirdCompartment.Infected,
                                  days: (p: SeirdModelParams) => p.latentDays,
                                  shape: (p: SeirdModelParams) => 1 / p.latentVariation ** 2,
                              },
                          ],
                      },
                  ]
                : []),
            {
                key: SeirdCompartment.Infected,
                name: "infected",
                infected: true,
                infectious: true,
                // Infectiousness halves every so many days into the infectious period (flat for an infinite half-life).
                infectiousnessByDay: (p) => {
                    const halfLife = p.infectiousnessHalfLife ?? Infinity;
                    return (day) => 2 ** (-day / halfLife);
                },
                exits: [
                    { to: SeirdCompartment.Recovered, share: (p) => 1 - p.ifr, days: (p) => p.recoveryDays },
                    { to: SeirdCompartment.Died, share: (p) => p.ifr, days: (p) => p.deathDays },
                ],
            },
            waning
                ? {
                      key: SeirdCompartment.Recovered,
                      name: "recovered",
                      susceptibilityAfter: (p) => waningSusceptibility(p.immunityHalfLife, p.immunityDelay ?? 0),
                      // Reinfections: less likely to be fatal, and less infectious.
                      protects: (p) => ({ death: p.immunityDeathProtection ?? 0, spread: p.immunitySpreadProtection ?? 0 }),
                  }
                : { key: SeirdCompartment.Recovered, name: "recovered" },
            { key: SeirdCompartment.Died, name: "died", dead: true },
        ],
        infectionEntry: exposed ? SeirdCompartment.Exposed : SeirdCompartment.Infected,
        indexEntry: SeirdCompartment.Infected,
        ...(vaccination ? { vaccinatedEntry: SeirdCompartment.Vaccinated } : {}),
    };
    models.set(id, model);
    return model;
};

/**
 * The parameters with the disease's stages (latent and infectious periods, and how fast infectiousness fades) scaled by
 * `scale`: the reference curve's timing, matched to the network (see `growth.ts`). A flat profile stays flat.
 */
export const withStagesScaled = <P extends SeirdModelParams>(params: P, scale: number): P =>
    scale === 1
        ? params
        : {
              ...params,
              latentDays: params.latentDays * scale,
              recoveryDays: params.recoveryDays * scale,
              deathDays: params.deathDays * scale,
              // A flat profile (an infinite half-life) stays flat.
              ...(params.infectiousnessHalfLife !== undefined ? { infectiousnessHalfLife: params.infectiousnessHalfLife * scale } : {}),
          };

/**
 * A complete set of SEIRD parameters: `overrides` (e.g. a disease's `pathogenParams`) over defaults for a mild disease
 * with flat infectiousness, 1% fatality and no protection after infection or vaccination. The default `beta` is a
 * placeholder: solve it for an R₀ with `solveTransmission`.
 */
export const seirdParams = (overrides: Partial<SeirdModelParams> = {}): SeirdModelParams => ({
    beta: 0.3,
    dispersion: null,
    recoveryDays: 4,
    deathDays: 4,
    ifr: 0.01,
    latentDays: 3,
    latentVariation: 0.5,
    infectiousnessHalfLife: Infinity,
    immunityHalfLife: 180,
    immunityDelay: 0,
    vaccineEfficacy: 0.8,
    vaccineHalfLife: 365,
    vaccineDeathProtection: 0,
    vaccineSpreadProtection: 0,
    immunityDeathProtection: 0,
    immunitySpreadProtection: 0,
    ...overrides,
});
