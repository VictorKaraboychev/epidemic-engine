import { describe, expect, it } from "vitest";
import { growthWindow, logGrowth, shiftTheory } from "./growth.js";

describe("early growth", () => {
    it("is measured only on networks large enough to tell", () => {
        expect(growthWindow(250)).toBeNull();
        expect(growthWindow(100_000)).toEqual({ low: 200, high: 3000 });
        expect(growthWindow(1_000_000)?.high).toBe(30_000);
    });

    it("fits the log-growth rate within the window", () => {
        const counts = Array.from({ length: 40 }, (_, day) => 10 * Math.exp(0.2 * day));
        expect(logGrowth(counts, 50, 5000)).toBeCloseTo(0.2, 6);
        expect(logGrowth([1, 2], 0, 10)).toBeNaN();
    });

    it("shifts the reference curve later (holding its start) or earlier (holding its end)", () => {
        const theory = { days: 4, infected: Float64Array.of(1, 2, 3, 4, 5), series: [Float64Array.of(9, 8, 7, 6, 5)] };
        expect([...shiftTheory(theory, 2).infected]).toEqual([1, 1, 1, 2, 3]);
        expect([...shiftTheory(theory, -2).series[0]]).toEqual([7, 6, 5, 5, 5]);
    });
});
