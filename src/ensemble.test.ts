import { describe, expect, it } from "vitest";
import { MAJOR_OUTBREAK_SHARE, runOutbreaks, spreadOf } from "./ensemble.js";
import { Outbreak } from "./outbreak.js";
import { Pathogen } from "./pathogens/pathogen.js";
import { IntervalKind } from "./pathogens/types.js";
import { seededRandom } from "./random.js";

describe("runOutbreaks", () => {
    it("sums up many runs on one population, separating those that fizzled, and replays from its seed", () => {
        const options = { pathogen: Pathogen.InfluenzaA, people: 3000, runs: 30, seed: 4 };
        const result = runOutbreaks(options);
        expect(result.summaries).toHaveLength(30);
        // R₀ 1.28 from one case: many fizzle.
        expect(result.fizzled).toBeGreaterThan(0.1);
        expect(result.major!.runs + Math.round(result.fizzled * 30)).toBe(30);
        expect(result.major!.attackRate.low).toBeGreaterThanOrEqual(MAJOR_OUTBREAK_SHARE);
        expect(result.major!.attackRate.low).toBeLessThanOrEqual(result.major!.attackRate.median);
        expect(runOutbreaks(options)).toEqual(result);
        // Runs differ in their luck and index cases.
        expect(new Set(result.summaries.map((summary) => summary.everInfected)).size).toBeGreaterThan(5);
    });

    it("spreads wider when the pathogen's values are drawn from their uncertainty", () => {
        const options = { pathogen: Pathogen.Measles, people: 3000, runs: 40, seed: 5, initialCases: 3 };
        const width = (spread: { low: number; high: number }) => spread.high - spread.low;
        expect(width(runOutbreaks({ ...options, uncertainty: true }).all.deaths)).toBeGreaterThan(width(runOutbreaks(options).all.deaths));
    });

    it("gives medians and middle 95%", () => {
        expect(spreadOf(Array.from({ length: 101 }, (_, i) => i))).toEqual({ median: 50, low: 2.5, high: 97.5, mean: 50 });
    });
});

describe("Pathogen.sample", () => {
    it("draws values within their intervals, shares within 0–1, and leaves values without intervals alone", () => {
        const random = seededRandom(9);
        for (let draw = 0; draw < 200; draw++) {
            const sample = Pathogen.CovidAncestral.sample(random);
            for (const [key, value] of Object.entries(Pathogen.CovidAncestral.values)) {
                const drawn = sample.values[key as keyof typeof sample.values]!.value;
                if (!value.interval) expect(drawn).toBe(value.value);
                else if (value.interval.kind === IntervalKind.Range) expect(drawn >= value.interval.low && drawn <= value.interval.high).toBe(true);
                else expect(drawn).toBeGreaterThan(0);
            }
            for (const group of sample.populations.groups) if (group.ifr) expect(group.ifr.value).toBeLessThanOrEqual(1);
        }
    });
});

describe("Outbreak", () => {
    it("times the reference curve to the network when asked: earlier than the plain one", () => {
        const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 2 });
        const peakDay = (series: Float64Array) => series.reduce((best, value, day) => (value > series[best] ? day : best), 0);
        expect(peakDay(outbreak.theory({ calibrated: true }).infected)).toBeLessThan(peakDay(outbreak.theory().infected));
    });

    it("changes parameters mid-run: a lockdown on day 20 shrinks the outbreak", () => {
        const options = { pathogen: Pathogen.CovidAncestral, people: 10_000, seed: 8, initialCases: 10 };
        const free = new Outbreak(options).run();
        const locked = new Outbreak(options).step(20);
        locked.setParams({ beta: locked.params.beta / 3 });
        expect(locked.run().attackRate).toBeLessThan(free.attackRate * 0.6);
    });
});
