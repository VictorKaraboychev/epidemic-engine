import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Population, PopulationKind, between, cited } from "./types.js";

/**
 * COVID-19, ancestral strain, before vaccines.
 * - R₀: pooled median 2.79 (mean 3.28) [Liu 2020].
 * - Infectious from ≈2 days before to ≈7 days after symptom onset [He 2020].
 * - IFR: median country, all ages, 0.47% in April 2020 [COVID-19 Forecasting Team 2022].
 * - IFR by age before vaccines: 0.01% at 25, 0.4% at 55, 4.6% at 75 (meta-regression from age 10) [Levin 2020];
 *   0.0054% (95% UI 0.0021–0.0114) at age 1 [COVID-19 Forecasting Team 2022, table 1].
 * - Latent period: mean 5.5 days (95% CI 5.1–5.9), contact tracing in China [Xin 2022].
 * - Immunity: protection against reinfection ≈85% at 1 month, ≈56% at 18 months, halving every ≈860 days [Stein 2023].
 * - Superspreading: dispersion k ≈ 0.1 (95% CrI 0.05–0.2): about 10% of cases cause 80% of infections [Endo 2020].
 * - Vaccine (2-dose mRNA, 2021): 88% effective against infection in the first month, 47% from 5 months; half-life
 *   ≈ 165 × ln 2 / ln(0.88 / 0.47) ≈ 182 days, partly Delta's arrival [Tartof 2021]. ≈ 69% of Americans 5+ had
 *   completed the primary series by mid-2022 [Fast 2022].
 */
export const COVID_ANCESTRAL = {
    id: PathogenId.CovidAncestral,
    values: {
        r0: cited(2.79, "liu-2020"),
        recoveryDays: cited(8, "he-2020"),
        deathDays: cited(8, "he-2020"),
        generationInterval: cited(5.2, "ganyani-2020", { interval: between(3.78, 6.78, IntervalKind.CrI95) }),
        // Fitted with the published latent and infectious periods; the 5.5-day latent period allows only the upper end
        // of the generation interval's credible interval (6.8 days).
        infectiousnessHalfLife: cited(1.3, "ganyani-2020", { also: ["he-2020"], caveat: Caveat.Fitted }),
        latentDays: cited(5.5, "xin-2022", { interval: between(5.1, 5.9, IntervalKind.CI95) }),
        latentVariation: cited(0.44, "lauer-2020", { interval: between(0.28, 0.59, IntervalKind.CI95), caveat: Caveat.Proxy }),
        dispersion: cited(0.1, "endo-2020", { interval: between(0.05, 0.2, IntervalKind.CrI95) }),
    },
    contacts: 4,
    // Reinfections: risk of death vs a first infection, HR 0.18 (Omicron and Delta, England) [Nyberg 2022]; 23% less
    // infectious (Omicron wave) [Tan 2023]. Both measured after the ancestral strain, so applied here as estimates.
    immunity: {
        halfLife: cited(860, "stein-2023"),
        deathProtection: cited(0.82, "nyberg-2022", { interval: between(0.43, 0.94, IntervalKind.CI95), caveat: Caveat.OtherSetting }),
        spreadProtection: cited(0.23, "tan-2023", { interval: between(0.03, 0.39, IntervalKind.CI95), caveat: Caveat.OtherSetting }),
    },
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Infection,
        groups: [
            { id: Population.All, covers: "all ages", ifr: cited(0.0047, "covid-forecasting-2022"), vaccineCoverage: cited(0.69, "fast-2022") },

            {
                id: Population.Infants,
                covers: "1",
                ifr: cited(0.000054, "covid-forecasting-2022", { interval: between(0.000021, 0.000114, IntervalKind.UI95) }),
            },
            { id: Population.Adults, covers: "25", ifr: cited(0.0001, "levin-2020") },
            { id: Population.MiddleAged, covers: "55", ifr: cited(0.004, "levin-2020") },
            { id: Population.Elderly, covers: "75", ifr: cited(0.046, "levin-2020") },
        ],
    },
    vaccination: {
        efficacy: cited(0.88, "tartof-2021", { interval: between(0.86, 0.89, IntervalKind.CI95) }),
        halfLife: cited(182, "tartof-2021", { caveat: Caveat.Confounded }),
        // Among the infected: 73% fewer infections but 90% fewer admissions, so 1 − 0.10 / 0.27 ≈ 63% fewer admissions
        // per infection [Tartof 2021]; vaccinated (BNT162b2) cases infected 68% fewer contacts (Alpha) [Eyre 2022].
        deathProtection: cited(0.63, "tartof-2021", { caveat: Caveat.Proxy }),
        spreadProtection: cited(0.68, "eyre-2022", { interval: between(0.52, 0.79, IntervalKind.CI95) }),
    },
} satisfies PathogenProfile<PathogenId>;
