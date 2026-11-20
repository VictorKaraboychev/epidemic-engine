import { Bound, Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Population, PopulationKind, between, cited } from "./types.js";

/**
 * Pertussis (whooping cough). Highly contagious, infectious for weeks, and immunity after infection fades over decades.
 * - R₀ ≈ 5.5 (5–6 across five European countries), from serological and contact data [Kretzschmar 2010]; estimates
 *   from the pre-vaccine era are higher (11–17) [Wearing & Rohani 2009].
 * - Infectious ≈ 15 days on average (a model estimate) [Wearing & Rohani 2009]; untreated, from the first cold-like
 *   symptoms until 3 weeks into the coughing fits [CDC Pink Book].
 * - ≈ 0.12% of reported cases fatal, US 2000–16 [Skoff 2019].
 * - Latent ≈ 8 days: infectious from symptom onset, so about the incubation period, commonly 7–10 days [CDC Pink Book].
 * - Immunity after infection lasts at least 30 years on average (exponential loss): half-life ≥ 30 × 365.25 × ln 2
 *   ≈ 7,595 days [Wearing & Rohani 2009]. CDC cites 4–20 years; a lower bound, then.
 * - Case fatality by age, US 2000–16: 261 of 50,950 cases under 1, 14 of 8,177 aged 65+ [Skoff 2019]. Only these two
 *   groups: the other deaths aren't broken down by age.
 * - Superspreading: dispersion k ≈ 0.23 (95% CI 0.11–0.53), one school outbreak in vaccinated pupils [Cho 2025].
 * - Vaccine (DTaP): 98.1% in the first year after the 5th dose, 71.2% after 5+ years; half-life ≈ 3,949 days (a poor
 *   fit: early efficacy is near 1) [Misegades 2012]. ≈ 81% of US toddlers had 4 doses by age 2 [Hill 2026].
 */
export const PERTUSSIS = {
    id: PathogenId.Pertussis,
    values: {
        r0: cited(5.5, "kretzschmar-2010", { interval: between(5, 6, IntervalKind.Range) }),
        recoveryDays: cited(15, "wearing-rohani-2009", { also: ["cdc-pinkbook-pertussis"] }),
        deathDays: cited(15, "wearing-rohani-2009", { also: ["cdc-pinkbook-pertussis"] }),
        // Household serial interval, mother to infant [te Beest 2014]. Flat infectiousness: simulated outbreaks still
        // run about half as long (≈ 11 days), as contacts are infected early in the long infectious period.
        generationInterval: cited(20, "te-beest-2014", { interval: between(16, 23, IntervalKind.CI95), caveat: Caveat.Proxy }),
        latentDays: cited(8, "cdc-pinkbook-pertussis", { interval: between(7, 10, IntervalKind.Range) }),
        dispersion: cited(0.23, "cho-2025", { interval: between(0.11, 0.53, IntervalKind.CI95), caveat: Caveat.OtherSetting }),
    },
    contacts: 7,
    immunity: { halfLife: cited(7595, "wearing-rohani-2009", { bound: Bound.Above }) },
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Case,
        groups: [
            { id: Population.All, covers: "all ages", ifr: cited(0.0012, "skoff-2019") },

            { id: Population.Infants, covers: "under 1", ifr: cited(261 / 50_950, "skoff-2019") },
            { id: Population.Children, covers: "4 DTaP doses by age 2", vaccineCoverage: cited(0.807, "hill-2026") },
            { id: Population.Elderly, covers: "65+", ifr: cited(14 / 8_177, "skoff-2019") },
        ],
    },
    vaccination: {
        efficacy: cited(0.981, "misegades-2012", { interval: between(0.961, 0.991, IntervalKind.CI95) }),
        halfLife: cited(3949, "misegades-2012", { caveat: Caveat.PoorFit }),
        // Severe pertussis (hospitalisation, pneumonia, seizures or death) in vaccinated children: aOR 0.41 [McNamara 2017].
        deathProtection: cited(0.59, "mcnamara-2017", { interval: between(0.29, 0.77, IntervalKind.CI95), caveat: Caveat.Proxy }),
    },
} satisfies PathogenProfile<PathogenId>;
