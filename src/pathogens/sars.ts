import { Bound, Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Population, PopulationKind, between, cited } from "./types.js";

/**
 * SARS (2003). Similar R₀ to COVID-19, but almost no spread before symptoms and far deadlier; famous for superspreading
 * (in Singapore, 5 people caused over half of the first 201 cases).
 * - R₀ ≈ 2.7 (95% CI 2.2–3.7), Hong Kong, excluding superspreading events [Riley 2003].
 * - Symptom onset to death: mean 23.7 days; to discharge: 26.5 days [Leung 2004]. Clinical durations, so they overstate
 *   the infectious window (spread peaked around day 10 of illness, and isolation cut it short) [WHO consensus].
 * - Case fatality 9.6%: 774 deaths among 8,096 probable cases, 2002–03 [WHO].
 * - Latent ≈ 4.6 days: mean incubation, with no transmission before symptoms reported [Leung 2004; WHO consensus].
 * - No waning estimate: antibodies last about 2 years, then decline, but protection wasn't measured.
 * - Case fatality by age, May 2003: < 1% (24 and under), 6% (25–44), 15% (45–64), > 50% (65+) [WHO Update 49]. The
 *   outer two are bounds, used as the rate and shown with their sign; the estimates then (14–15% overall) ran above
 *   the final 9.6%.
 * - Superspreading: dispersion k ≈ 0.16 (90% CI 0.11–0.64), Singapore 2003 [Lloyd-Smith 2005].
 * - No licensed SARS vaccine has ever existed [Li 2020].
 */
export const SARS = {
    id: PathogenId.Sars,
    values: {
        r0: cited(2.7, "riley-2003", { interval: between(2.2, 3.7, IntervalKind.CI95) }),
        recoveryDays: cited(26.5, "leung-2004", { also: ["who-sars-consensus"], caveat: Caveat.ClinicalDuration }),
        deathDays: cited(23.7, "leung-2004", { also: ["who-sars-consensus"], caveat: Caveat.ClinicalDuration }),
        generationInterval: cited(8.4, "lipsitch-2003", { caveat: Caveat.Proxy }),
        infectiousnessHalfLife: cited(5, "lipsitch-2003", { caveat: Caveat.Fitted }),
        latentDays: cited(4.6, "leung-2004", { also: ["who-sars-consensus"], interval: between(3.8, 5.8, IntervalKind.CI95) }),
        latentVariation: cited(0.65, "lessler-2009", { interval: between(0.55, 0.75, IntervalKind.CI95), caveat: Caveat.Proxy }),
        dispersion: cited(0.16, "lloyd-smith-2005", { interval: between(0.11, 0.64, IntervalKind.CI90) }),
    },
    contacts: 4,
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Case,
        groups: [
            { id: Population.All, covers: "probable cases", ifr: cited(0.096, "who-sars-summary") },

            { id: Population.Young, covers: "24 and under", ifr: cited(0.01, "who-sars-update-49", { bound: Bound.Below }) },
            { id: Population.Adults, covers: "25–44", ifr: cited(0.06, "who-sars-update-49") },
            { id: Population.MiddleAged, covers: "45–64", ifr: cited(0.15, "who-sars-update-49") },
            { id: Population.Elderly, covers: "65+", ifr: cited(0.5, "who-sars-update-49", { bound: Bound.Above }) },
        ],
    },
    vaccination: { none: "li-2020-vaccines" },
} satisfies PathogenProfile<PathogenId>;
