import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Group, PopulationKind, between, cited } from "./types.js";

/**
 * COVID-19, Omicron variant.
 * - R₀: mean 9.5 (range 5.5–24) [Liu & Rocklöv 2022].
 * - Culturable virus for a median of ≈8 days [Boucau 2022].
 * - IFR ≈79% lower than earlier variants in South Africa [Liu, IJID 2022]: 0.47% × 0.21 ≈ 0.1%.
 * - IFR by age: the ancestral strain's [COVID-19 Forecasting Team 2022 at age 1; Levin 2020 at 25, 55, 75] × 0.21, i.e.
 *   1 − 0.787 [Liu, IJID 2022], to two significant figures: 0.0011%, 0.0021%, 0.084%, 0.97%.
 * - Latent period: mean 2.65 days (2.53–2.78), five outbreaks in China, 2022 [Jiang 2023].
 * - Immunity: protection against Omicron reinfection ≈81% at 3–6 months, ≈28% at 9–12 months, halving every ≈117 days
 *   (partly new variants escaping immunity) [Chemaitelly 2025].
 * - Superspreading: dispersion k ≈ 0.33 (95% CrI 0.17–0.62), Hong Kong early chains (other Omicron estimates 0.10–0.27)
 *   [Guo 2022].
 * - Vaccine (primary series) against Omicron infection: 44% at 1 month, fitted half-life 143 days [Menegale 2023];
 *   ≈ 69% had completed it by mid-2022 [Fast 2022].
 */
export const COVID_OMICRON = {
    id: PathogenId.CovidOmicron,
    values: {
        r0: cited(9.5, "liu-rocklov-2022", { interval: between(5.5, 24, IntervalKind.Range) }),
        infectiousDays: cited(8, "boucau-2022"),
        fatalInfectiousDays: cited(8, "boucau-2022"),
        generationInterval: cited(2.99, "xu-2023", { interval: between(2.48, 3.49, IntervalKind.CI95) }),
        infectiousnessHalfLife: cited(2.5, "xu-2023", { caveat: Caveat.Fitted }),
        latentDays: cited(2.7, "jiang-2023", { interval: between(2.53, 2.78, IntervalKind.CI95) }),
        latentVariation: cited(0.69, "backer-2022", { caveat: Caveat.Proxy }),
        dispersion: cited(0.33, "guo-2022", { interval: between(0.17, 0.62, IntervalKind.CrI95) }),
    },
    contacts: 13,
    // ≈ 81% at 3–6 months (day ≈ 137) and ≈ 28% at 9–12 months (day ≈ 320): halving every 117 days through both
    // points needs protection to stay full for 137 − 117 × log₂(1 / 0.81) ≈ 100 days first (else ≈ 44% at day 137).
    // Reinfections: death HR 0.18 vs first infections [Nyberg 2022]; 23% less infectious [Tan 2023].
    immunity: {
        delay: cited(100, "chemaitelly-2025"),
        halfLife: cited(117, "chemaitelly-2025", { caveat: Caveat.Confounded }),
        deathProtection: cited(0.82, "nyberg-2022", { interval: between(0.43, 0.94, IntervalKind.CI95) }),
        spreadProtection: cited(0.23, "tan-2023", { interval: between(0.03, 0.39, IntervalKind.CI95) }),
    },
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Infection,
        groups: [
            { id: Group.All, covers: "all ages", ifr: cited(0.001, "liu-ijid-2022"), vaccineCoverage: cited(0.69, "fast-2022") },

            { id: Group.Infants, covers: "1", ifr: cited(0.000011, "liu-ijid-2022", { also: ["covid-forecasting-2022"] }) },
            { id: Group.Adults, covers: "25", ifr: cited(0.000021, "liu-ijid-2022", { also: ["levin-2020"] }) },
            { id: Group.MiddleAged, covers: "55", ifr: cited(0.00084, "liu-ijid-2022", { also: ["levin-2020"] }) },
            { id: Group.Elderly, covers: "75", ifr: cited(0.0097, "liu-ijid-2022", { also: ["levin-2020"] }) },
        ],
    },
    vaccination: {
        efficacy: cited(0.444, "menegale-2023"),
        halfLife: cited(143, "menegale-2023"),
        // Among the infected: 13.9% fewer Omicron infections but 84.5% fewer admissions, so ≈ 82% fewer admissions per
        // infection [Tseng 2022]; vaccinated cases 22% less infectious [Tan 2023].
        deathProtection: cited(0.82, "tseng-2022", { caveat: Caveat.Proxy }),
        spreadProtection: cited(0.22, "tan-2023", { interval: between(0.06, 0.36, IntervalKind.CI95) }),
    },
} satisfies PathogenProfile<PathogenId>;
