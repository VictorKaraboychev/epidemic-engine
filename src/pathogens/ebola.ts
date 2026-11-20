import { Caveat, FatalityMeasure, IntervalKind, PathogenId, type PathogenProfile, Group, PopulationKind, between, cited } from "./types.js";

/**
 * Ebola virus disease, West Africa 2014. The one disease where deaths dominate, and where fatal cases have their own
 * infectious period. Close-contact spread, so few contacts.
 * - R₀: 1.71 Guinea, 1.83 Liberia, 2.02 Sierra Leone [WHO Ebola Response Team 2014].
 * - Infectious from symptom onset until death (mean 7.5 days) or hospital discharge (16.4 days) [same].
 * - Average case fatality ≈50% (25–90% across past outbreaks) [WHO fact sheet].
 * - Latent period: mean incubation 11.4 days; not infectious before symptoms [WHO Ebola Response Team 2014].
 * - Immunity: survivors keep neutralizing antibodies for decades; there is no published estimate of how protection wanes.
 * - Superspreading: dispersion k ≈ 0.18 (95% CI 0.10–0.26), Conakry 2014; 72% of cases infected no one [Althaus 2015].
 * - Vaccine: rVSV-ZEBOV, no cases among vaccinated contacts (efficacy 100%, 95% CI 68.9–100) in the 2015 Guinea ring
 *   trial; about half of contacts in rings were vaccinated at once [Henao-Restrepo 2017]. No waning estimate.
 */
export const EBOLA = {
    id: PathogenId.Ebola,
    values: {
        r0: cited(1.83, "who-ebola-nejm-2014", { interval: between(1.71, 2.02, IntervalKind.Range) }),
        infectiousDays: cited(16.4, "who-ebola-nejm-2014"),
        fatalInfectiousDays: cited(7.5, "who-ebola-nejm-2014"),
        generationInterval: cited(15.3, "who-ebola-nejm-2014", { caveat: Caveat.Proxy }),
        infectiousnessHalfLife: cited(7.9, "who-ebola-nejm-2014", { caveat: Caveat.Fitted }),
        latentDays: cited(11.4, "who-ebola-nejm-2014"),
        latentVariation: cited(0.8, "who-ebola-nejm-2014", { caveat: Caveat.Proxy }),
        dispersion: cited(0.18, "althaus-2015", { interval: between(0.1, 0.26, IntervalKind.CI95) }),
    },
    contacts: 3,
    vaccination: {
        efficacy: cited(1, "henao-restrepo-2017", { interval: between(0.689, 1, IntervalKind.CI95) }),
        // Death among confirmed cases vaccinated 10+ days before onset: aRR 0.40 (DRC 2018–20) [Coulborn 2024].
        deathProtection: cited(0.6, "coulborn-2024", { interval: between(0.31, 0.79, IntervalKind.CI95) }),
    },
    // Not population-wide: uptake among contacts of cases in the 2015 ring-vaccination trial.
    populations: {
        kind: PopulationKind.Group,
        measure: FatalityMeasure.Case,
        groups: [
            { id: Group.All, covers: "reported cases", ifr: cited(0.5, "who-ebola-factsheet", { interval: between(0.25, 0.9, IntervalKind.Range) }) },
            { id: Group.Contacts, covers: "contacts of cases in vaccination rings", vaccineCoverage: cited(0.52, "henao-restrepo-2017") },
        ],
    },
} satisfies PathogenProfile<PathogenId>;
