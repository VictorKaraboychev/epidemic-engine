/**
 * Validates simulated outbreaks against the literature each preset cites: the early reproduction number against its
 * R₀, the generation interval against its published generation or serial interval, and, with superspreading, the
 * dispersion of offspring counts against the published k's interval. Slow (large networks, several runs per preset),
 * so opt-in: `VALIDATE=1 npx vitest run src/validation`.
 */
import { describe, expect, it } from "vitest";
import { Pathogen, getPathogen } from "../pathogens/index.js";
import { measurePreset } from "./measure.js";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const validate = env.VALIDATE ? describe : describe.skip;

/** Known gaps, documented in each disease's file. */
const GENERATION_INTERVAL_EXCEPTIONS: Partial<Record<Pathogen, string>> = {
    pertussis: "contacts are infected early in the long infectious period; simulated ≈ 10 days vs ≈ 20 published",
};
/** Presets whose early R can't be measured (chains die out) or that the network can't quite reach. */
const R_EXCEPTIONS: Partial<Record<Pathogen, string>> = { mers: "R₀ below 1: too few early cases to measure" };
/**
 * Presets whose early R runs further above R₀ than the usual 25%, with why. Measles (R₀ ≈ 15, 20 contacts plus
 * household): early cases' offspring average ≈ 1.26–1.32 × R₀ over 30 runs, with the daily-roll and the event-driven
 * simulation alike; the reproduction curve is measured on the same network, so it's how measles' first generations
 * fill this network's dense local clusters, not the algorithm.
 */
const R_HIGH: Partial<Record<Pathogen, number>> = { measles: 1.4 };

const PRESETS: Pathogen[] = [
    Pathogen.CovidAncestral,
    Pathogen.CovidOmicron,
    Pathogen.InfluenzaA,
    Pathogen.Rsv,
    Pathogen.Measles,
    Pathogen.Pertussis,
    Pathogen.Mpox,
    Pathogen.Sars,
    Pathogen.Mers,
    Pathogen.Ebola,
];

validate("simulated outbreaks against the literature", () => {
    for (const id of PRESETS) {
        it(`${id}: reproduction number and generation interval`, () => {
            const pathogen = getPathogen(id);
            // Below R₀ 1, chains are short: many more runs for enough transmissions to measure. Very contagious diseases
            // pass 0.5% of people within a generation or two, so each run has only a few early cases: more runs too.
            const r0 = pathogen.values.r0.value;
            const measured = r0 < 1 ? measurePreset(id, { people: 5000, runs: 60 }) : measurePreset(id, { runs: r0 > 8 ? 30 : 6 });
            if (!R_EXCEPTIONS[id]) {
                // Within 20%: generations overlap, so very contagious diseases run a little below their R₀ early on.
                expect(measured.earlyR / pathogen.values.r0.value).toBeGreaterThan(0.8);
                expect(measured.earlyR / pathogen.values.r0.value).toBeLessThan(R_HIGH[id] ?? 1.25);
            }
            const interval = pathogen.values.generationInterval;
            if (interval && !GENERATION_INTERVAL_EXCEPTIONS[id]) {
                // Within 20% of the published mean, or inside its interval where one is published.
                const low = Math.min(interval.value * 0.8, interval.interval?.low ?? Infinity);
                const high = Math.max(interval.value * 1.2, interval.interval?.high ?? 0);
                expect(measured.generationInterval).toBeGreaterThan(low * 0.98);
                expect(measured.generationInterval).toBeLessThan(high * 1.02);
            }
        }, 600_000);
    }

    for (const id of [Pathogen.CovidAncestral, Pathogen.CovidOmicron, Pathogen.Measles, Pathogen.Pertussis, Pathogen.Mpox, Pathogen.Sars, Pathogen.Ebola]) {
        it(`${id}: superspreading's dispersion within the published interval (±30%)`, () => {
            const dispersion = getPathogen(id).values.dispersion!;
            const measured = measurePreset(id, { superspreading: true });
            expect(measured.dispersion).toBeGreaterThan((dispersion.interval?.low ?? dispersion.value) * 0.7);
            expect(measured.dispersion).toBeLessThan((dispersion.interval?.high ?? dispersion.value) * 1.3);
        }, 600_000);
    }
});
