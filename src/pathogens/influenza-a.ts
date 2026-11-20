import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Group, PopulationKind, between, cited } from "./types.js";

/**
 * Seasonal influenza A.
 * - R: median 1.28 (IQR 1.19–1.37) for seasonal influenza [Biggerstaff 2014].
 * - Infectious ≈1 day before to 5–7 days after onset [CDC].
 * - ≈27,965 deaths among ≈40.2 million symptomatic illnesses, US 2023–24 (≈0.07%) [CDC burden].
 * - Deaths per symptomatic illness by age, US 2023–24 (preliminary) [CDC burden, table 1].
 * - Latent period: mean 1.6 days, fitted to viral shedding in experimental infections [Cori 2012].
 * - Immunity: protection halves every ≈4.1 years (H3N2, adults; 3.5–7 years by subtype and age), Hong Kong households
 *   [Ranjeva 2019].
 * - No superspreading estimate: no published dispersion k for seasonal influenza.
 * - Vaccine against A(H3N2), medically attended: 45% at 15–90 days, 13% at 91–180 days; half-life ≈ 46 days
 *   [Young 2018]. 47% of Americans vaccinated in 2023–24 [CDC FluVaxView].
 */
export const INFLUENZA_A = {
    id: PathogenId.InfluenzaA,
    values: {
        r0: cited(1.28, "biggerstaff-2014", { interval: between(1.19, 1.37, IntervalKind.IQR) }),
        infectiousDays: cited(5, "cdc-flu"),
        fatalInfectiousDays: cited(5, "cdc-flu"),
        generationInterval: cited(3.6, "cowling-2009", { interval: between(2.9, 4.3, IntervalKind.CI95), caveat: Caveat.Proxy }),
        infectiousnessHalfLife: cited(1.6, "cowling-2009", { caveat: Caveat.Fitted }),
        latentDays: cited(1.6, "cori-2012"),
        latentVariation: cited(0.43, "lessler-2009", { interval: between(0.37, 0.5, IntervalKind.CI95), caveat: Caveat.Proxy }),
    },
    contacts: 4,
    // 3.5–7 years by subtype and age.
    immunity: { halfLife: cited(1500, "ranjeva-2019", { interval: between(3.5 * 365.25, 7 * 365.25, IntervalKind.Range) }) },
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Illness,
        groups: [
            {
                id: Group.All,
                covers: "all ages",
                ifr: cited(0.0007, "cdc-flu-burden-2024"),
                vaccineCoverage: cited(0.472, "cdc-fluvaxview-2024"),
            },

            { id: Group.Infants, covers: "0–4", ifr: cited(268 / 2_903_633, "cdc-flu-burden-2024") },
            { id: Group.Adults, covers: "18–49", ifr: cited(2_705 / 16_351_383, "cdc-flu-burden-2024") },
            { id: Group.MiddleAged, covers: "50–64", ifr: cited(5_701 / 9_042_884, "cdc-flu-burden-2024") },
            { id: Group.Elderly, covers: "65+", ifr: cited(19_038 / 2_610_181, "cdc-flu-burden-2024") },
        ],
    },
    vaccination: {
        efficacy: cited(0.45, "young-2018", { interval: between(0.34, 0.54, IntervalKind.CI95), caveat: Caveat.Proxy }),
        halfLife: cited(46, "young-2018"),
        // In-hospital death among adults 65+ hospitalised with influenza: aOR 0.39 vaccinated vs not [Arriola 2017].
        deathProtection: cited(0.61, "arriola-2017", { interval: between(0.34, 0.83, IntervalKind.CI95), caveat: Caveat.OtherSetting }),
    },
} satisfies PathogenProfile<PathogenId>;
