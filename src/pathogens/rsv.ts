import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Group, PopulationKind, between, cited } from "./types.js";

/**
 * Respiratory syncytial virus. Reinfection is common throughout life, so it's the disease where waning immunity matters
 * within a single outbreak.
 * - R₀ ≈ 3.0 (range 1.5–4 across US regions and seasons), fitted to US surveillance [Reis & Shaman 2016].
 * - Infectious ≈ 6.4 days on average, the same fit [Reis & Shaman 2016].
 * - ≈ 0.31% of RSV chest infections (lower respiratory) fatal in children under 5 worldwide, 2019:
 *   101,400 deaths ÷ 33.0 million episodes [Li 2022]. A per-episode rate for young children, applied to everyone.
 * - Latent ≈ 3 days: median incubation 4.4 days [Lessler 2009], less the 1–2 days people are contagious before
 *   symptoms [CDC].
 * - Protection against reinfection ≈ 70% in the 6 months after infection and ≈ 19% at 6–11 months, Kenyan birth
 *   cohort: half-life = 182.6 × ln 2 / ln(0.70 / 0.19) ≈ 97 days [Ohuma 2012]. Children only.
 * - No age data: published age-specific rates are per hospitalization, not per infection.
 * - No superspreading estimate: no published dispersion k for RSV.
 * - Vaccine (RSVPreF3 OA, age 60+), against RSV illness, not infection: 71.7% in the first season [Papi 2023], 40.6% in
 *   the second [Ison 2024]; half-life ≈ 445 days. ≈ 40% of Americans 75+ vaccinated by late 2024 [Kriss 2024].
 */
export const RSV = {
    id: PathogenId.Rsv,
    values: {
        r0: cited(3.0, "reis-2016", { interval: between(1.5, 4, IntervalKind.Range) }),
        infectiousDays: cited(6.4, "reis-2016"),
        fatalInfectiousDays: cited(6.4, "reis-2016"),
        // Flat infectiousness: simulated outbreaks run a little shorter (≈ 6 days).
        generationInterval: cited(7.5, "vink-2014", { caveat: Caveat.Proxy }),
        latentDays: cited(3, "lessler-2009", { also: ["cdc-rsv-spread"] }),
        latentVariation: cited(0.22, "lessler-2009", { interval: between(0.12, 0.31, IntervalKind.CI95), caveat: Caveat.Proxy }),
    },
    contacts: 5,
    // ≈ 70% over months 0–6 (day ≈ 91) and ≈ 19% at 6–11 months: halving every 97 days through both points needs
    // protection to stay full for 91 − 97 × log₂(1 / 0.70) ≈ 41 days first.
    immunity: { delay: cited(41, "ohuma-2012", { caveat: Caveat.OtherSetting }), halfLife: cited(97, "ohuma-2012", { caveat: Caveat.OtherSetting }) },
    vaccination: {
        efficacy: cited(0.717, "papi-2023", { interval: between(0.562, 0.823, IntervalKind.CI95), caveat: Caveat.Proxy }),
        halfLife: cited(445, "papi-2023", { also: ["ison-2024"] }),
    },
    // Coverage is for older adults only; no age-specific fatality per infection, so the overall rate applies to them.
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Illness,
        groups: [
            { id: Group.Under5, covers: "under 5", ages: { from: 0, to: 4 }, ifr: cited(0.0031, "li-2022", { caveat: Caveat.OtherSetting }) },
            { id: Group.Elderly, covers: "75+", ages: { from: 75, to: Infinity }, vaccineCoverage: cited(0.397, "kriss-2024") },
        ],
    },
} satisfies PathogenProfile<PathogenId>;
