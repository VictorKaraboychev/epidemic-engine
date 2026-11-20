import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Population, PopulationKind, between, cited } from "./types.js";

/**
 * Measles.
 * - R₀: often cited as 12–18 [Guerra 2017].
 * - Contagious 4 days before to 4 days after rash onset [CDC].
 * - 1–2 deaths per 1,000 children who get measles (0.15%) [CDC].
 * - Latent period ≈10 days: rash ≈14 days after exposure, infectious from 4 days before it [CDC Pink Book].
 * - Immunity is lifelong after infection, so it doesn't wane [CDC].
 * - Superspreading: dispersion k ≈ 0.23 (90% CI 0.16–0.39), US 1997–99 [Lloyd-Smith 2005]. Estimated near elimination
 *   (R below 1), so using it with the textbook R₀ is an extrapolation.
 * - Vaccine: 2-dose MMR ≈ 97% effective, protection lifelong for most [CDC]; 77% of children worldwide got a second
 *   measles dose in 2025 [WHO].
 * - Known gap: early cases on the network infect ≈ 1.26–1.32 × R₀ on average (validation, 30 runs), as its first
 *   generations fill the dense local clusters; within 40% rather than the usual 25%.
 */
export const MEASLES = {
    id: PathogenId.Measles,
    values: {
        r0: cited(15, "guerra-2017", { interval: between(12, 18, IntervalKind.Range) }),
        recoveryDays: cited(8, "cdc-measles"),
        deathDays: cited(8, "cdc-measles"),
        // Serial interval 11.7 days [Vink 2014]. Flat infectiousness: simulated outbreaks already run a little shorter
        // (≈ 9–12 days), as with R₀ 15 the first of a person's contacts to become infectious usually infects them.
        generationInterval: cited(11.7, "vink-2014", { caveat: Caveat.Proxy }),
        latentDays: cited(10, "cdc-pinkbook-measles"),
        latentVariation: cited(0.21, "lessler-2009", { interval: between(0.17, 0.25, IntervalKind.CI95), caveat: Caveat.Proxy }),
        dispersion: cited(0.23, "lloyd-smith-2005", { interval: between(0.16, 0.39, IntervalKind.CI90), caveat: Caveat.OtherSetting }),
    },
    contacts: 20,
    immunity: { lifelong: "cdc-measles-clinical" },
    vaccination: {
        efficacy: cited(0.97, "cdc-measles-vaccine"),
        lifelong: "cdc-measles-vaccine",
        // Hospitalised: 2 of 26 cases with 2+ doses (8%) vs 53 of 186 unvaccinated (29%) [Cherry & Zahn 2018].
        deathProtection: cited(0.73, "cherry-zahn-2018", { caveat: Caveat.Proxy }),
    },
    // Coverage is children's second dose, worldwide.
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Case,
        groups: [
            {
                id: Population.Children,
                covers: "children",
                ifr: cited(0.0015, "cdc-measles-global", { interval: between(0.001, 0.002, IntervalKind.Range) }),
                vaccineCoverage: cited(0.77, "who-immunization-2026"),
            },
        ],
    },
} satisfies PathogenProfile<PathogenId>;
