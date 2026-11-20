import { Bound, Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Group, PopulationKind, between, cited } from "./types.js";

/**
 * Mpox, 2022 clade IIb outbreak, which spread almost entirely among gay, bisexual and other men who have sex with men
 * (GBMSM) through sexual networks: every value here is from that population, so it's the simulated population too.
 * - R₀: 1.94 (95% CrI 1.81–2.19) among high-risk GBMSM, England 2022 [Zhang 2024].
 * - Illness lasts 2–4 weeks [CDC].
 * - 65 deaths among 82,624 confirmed cases, Jan–Dec 2022 (≈0.08%) [WHO].
 * - Latent period: at most the mean incubation of 7.6 days (some spread before symptoms), UK contact tracing [Ward 2022].
 * - Immunity: reinfection is documented but rare; there is no published estimate of how protection wanes.
 * - Superspreading: dispersion k ≈ 0.58 (90% CI 0.32–3.57), Zaire 1980–84 (clade I) [Lloyd-Smith 2005]; no reliable
 *   estimate for the 2022 clade IIb outbreak.
 * - Vaccine: 2-dose JYNNEOS ≈ 66% effective against medically attended mpox [Deputy 2023]; no waning estimate.
 *   ≈ 23% of Americans at risk (GBMSM and transgender people eligible for vaccination) were fully vaccinated by early
 *   2023 [Owens 2023].
 */
export const MPOX = {
    id: PathogenId.Mpox,
    values: {
        r0: cited(1.94, "zhang-2024", { interval: between(1.81, 2.19, IntervalKind.CrI95) }),
        infectiousDays: cited(21, "cdc-mpox", { interval: between(14, 28, IntervalKind.Range) }),
        fatalInfectiousDays: cited(21, "cdc-mpox", { interval: between(14, 28, IntervalKind.Range) }),
        generationInterval: cited(8.5, "madewell-2023", { interval: between(7.3, 9.9, IntervalKind.CrI95), caveat: Caveat.Proxy }),
        // Most spread is around symptom onset, though lesions take weeks to heal.
        infectiousnessHalfLife: cited(0.9, "madewell-2023", { caveat: Caveat.Fitted }),
        latentDays: cited(7.6, "ward-2022", { bound: Bound.Below }),
        latentVariation: cited(0.71, "ward-2022", { caveat: Caveat.Proxy }),
        dispersion: cited(0.58, "lloyd-smith-2005", { interval: between(0.32, 3.57, IntervalKind.CI90), caveat: Caveat.OtherSetting }),
    },
    contacts: 3,
    vaccination: {
        efficacy: cited(0.66, "deputy-2023", { interval: between(0.474, 0.781, IntervalKind.CI95), caveat: Caveat.Proxy }),
        // Hospitalisation, 2 doses vs none: OR 0.20 (California 2022–23) [Schildhauer 2023].
        deathProtection: cited(0.8, "schildhauer-2023", { interval: between(0.1, 0.99, IntervalKind.CI95), caveat: Caveat.Proxy }),
    },
    // The base group is the outbreak's population, GBMSM, not everyone (no published fatality by age or other group).
    populations: {
        kind: PopulationKind.Group,
        measure: FatalityMeasure.Case,
        groups: [
            {
                id: Group.Gbmsm,
                covers: "confirmed cases, almost all among gay, bisexual and other men who have sex with men (GBMSM)",
                ifr: cited(0.0008, "who-mpox-2022"),
                vaccineCoverage: cited(0.227, "owens-2023"),
            },
        ],
    },
} satisfies PathogenProfile<PathogenId>;
