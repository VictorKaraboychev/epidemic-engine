import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Group, PopulationKind, between, cited } from "./types.js";

/**
 * MERS. R₀ below 1, so most chains die out on their own, yet hospital superspreading caused large clusters (Korea
 * 2015: 186 cases, one patient infected 85). Pair with Superspreading to see both.
 * - R₀ ≈ 0.47 (95% CI 0.29–0.80), with dispersion k ≈ 0.26 (95% CI 0.09–1.24) [Kucharski & Althaus 2015].
 * - Illness onset to death: median 11.5 days; to discharge: 14 days, Middle East hospital outbreaks [Sha 2017].
 *   Clinical durations, so they overstate the infectious window.
 * - Case fatality ≈ 37%: 964 deaths among 2,635 reported cases, 2012–2025 [WHO]; likely high, as mild cases are missed.
 * - Latent ≈ 5.0 days: mean incubation, Saudi Arabia [Virlogeux 2016]; no evidence of spread before symptoms
 *   [Cowling 2015].
 * - Case fatality by age, Saudi Arabia 2012–15: 7/28 (< 15), 116/434 (25–54), 76/142 (55–64), 154/195 (65+)
 *   [Al-Raddadi 2020]. The youngest group is small, and mild cases in children go undetected.
 * - No waning estimate: neutralizing antibodies persist for years in some survivors and vanish within one in others.
 * - No licensed MERS vaccine [WHO fact sheet].
 */
export const MERS = {
    id: PathogenId.Mers,
    values: {
        r0: cited(0.47, "kucharski-althaus-2015", { interval: between(0.29, 0.8, IntervalKind.CI95) }),
        infectiousDays: cited(14, "sha-2017", { setting: "Middle East hospital outbreaks", caveat: Caveat.ClinicalDuration }),
        fatalInfectiousDays: cited(11.5, "sha-2017", { setting: "Middle East hospital outbreaks", caveat: Caveat.ClinicalDuration }),
        // Simulated outbreaks have ≈ this serial interval with flat infectiousness over the clinical durations.
        generationInterval: cited(12.6, "cowling-2015", { interval: between(12.1, 13.1, IntervalKind.CI95), caveat: Caveat.Proxy }),
        latentDays: cited(5, "virlogeux-2016", { setting: "Saudi Arabia", also: ["cowling-2015"], interval: between(4, 6.6, IntervalKind.CI95) }),
        latentVariation: cited(0.68, "virlogeux-2016", { caveat: Caveat.Proxy }),
        dispersion: cited(0.26, "kucharski-althaus-2015", { interval: between(0.09, 1.24, IntervalKind.CI95) }),
    },
    contacts: 3,
    populations: {
        kind: PopulationKind.Age,
        measure: FatalityMeasure.Case,
        groups: [
            {
                id: Group.All,
                covers: "reported cases",
                ifr: cited(0.37, "who-mers-2025", { setting: "Reported cases, 2012–2025", caveat: Caveat.UnderReported }),
            },

            {
                id: Group.Children,
                covers: "under 15",
                ages: { from: 0, to: 14 },
                ifr: cited(7 / 28, "al-raddadi-2020", { setting: "Saudi Arabia, 2012–15", caveat: Caveat.UnderReported }),
            },
            { id: Group.Adults, covers: "25–54", ages: { from: 25, to: 54 }, ifr: cited(116 / 434, "al-raddadi-2020", { setting: "Saudi Arabia, 2012–15" }) },
            {
                id: Group.MiddleAged,
                covers: "55–64",
                ages: { from: 55, to: 64 },
                ifr: cited(76 / 142, "al-raddadi-2020", { setting: "Saudi Arabia, 2012–15" }),
            },
            {
                id: Group.Elderly,
                covers: "65+",
                ages: { from: 65, to: Infinity },
                ifr: cited(154 / 195, "al-raddadi-2020", { setting: "Saudi Arabia, 2012–15" }),
            },
        ],
    },
    vaccination: { none: "who-mers-factsheet" },
} satisfies PathogenProfile<PathogenId>;
