import { Bound, Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Population, PopulationKind, between, cited } from "./types.js";

/**
 * Seasonal influenza B. In this model it behaves almost exactly like influenza A (R 1.23 vs 1.28, same fatality
 * data).
 * - Rₑ: median early-epidemic 1.23 (range 1.06–1.58) [Thompson 2022].
 * - Same infectious period as influenza A [CDC]. Fatality overall and by age, and vaccine coverage, are CDC's 2023–24
 *   figures, which cover all influenza types, so they match influenza A's [CDC burden; CDC FluVaxView].
 * - Latent period: under the median incubation of 0.6 days, experimental infections [Lessler 2009].
 * - Immunity: protection ≈65% after 2–3 years, ≈46% after 4–5 years: halving every ≈4 years [Frank 1987].
 * - No superspreading estimate: no published dispersion k for influenza B.
 * - Vaccine against influenza B: 62% at 15–90 days, 43% at 91–180 days; half-life ≈ 157 days [Young 2018].
 */
export const INFLUENZA_B = {
    id: PathogenId.InfluenzaB,
    values: {
        r0: cited(1.23, "thompson-2022", { interval: between(1.06, 1.58, IntervalKind.Range), caveat: Caveat.Proxy }),
        recoveryDays: cited(5, "cdc-flu"),
        deathDays: cited(5, "cdc-flu"),
        generationInterval: cited(3.6, "cowling-2009", { interval: between(2.9, 4.3, IntervalKind.CI95), caveat: Caveat.Proxy }),
        infectiousnessHalfLife: cited(1.6, "cowling-2009", { caveat: Caveat.Fitted }),
        latentDays: cited(0.6, "lessler-2009", { bound: Bound.Below }),
        latentVariation: cited(0.43, "lessler-2009", { interval: between(0.32, 0.53, IntervalKind.CI95), caveat: Caveat.Proxy }),
    },
    contacts: 4,
    immunity: { halfLife: cited(1460, "frank-1987") },
    // CDC's burden figures (overall, by age, and vaccine coverage) cover all influenza types.
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Illness,
        groups: [
            {
                id: Population.All,
                covers: "all ages",
                ifr: cited(0.0007, "cdc-flu-burden-2024"),
                vaccineCoverage: cited(0.472, "cdc-fluvaxview-2024"),
            },

            { id: Population.Infants, covers: "0–4", ifr: cited(268 / 2_903_633, "cdc-flu-burden-2024") },
            { id: Population.Adults, covers: "18–49", ifr: cited(2_705 / 16_351_383, "cdc-flu-burden-2024") },
            { id: Population.MiddleAged, covers: "50–64", ifr: cited(5_701 / 9_042_884, "cdc-flu-burden-2024") },
            { id: Population.Elderly, covers: "65+", ifr: cited(19_038 / 2_610_181, "cdc-flu-burden-2024") },
        ],
    },
    vaccination: {
        efficacy: cited(0.62, "young-2018", { interval: between(0.52, 0.7, IntervalKind.CI95), caveat: Caveat.Proxy }),
        halfLife: cited(157, "young-2018"),
        // In-hospital death among adults 65+ hospitalised with influenza: aOR 0.39 vaccinated vs not [Arriola 2017].
        deathProtection: cited(0.61, "arriola-2017", { interval: between(0.34, 0.83, IntervalKind.CI95), caveat: Caveat.OtherSetting }),
    },
} satisfies PathogenProfile<PathogenId>;
