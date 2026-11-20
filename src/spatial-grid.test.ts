import { describe, expect, it } from "vitest";
import { seededRandom } from "./random.js";
import { SpatialGrid } from "./spatial-grid.js";

const random = seededRandom(1);
const XS = Float64Array.from({ length: 500 }, () => random() * 400);
const YS = Float64Array.from({ length: 500 }, () => random() * 300);
const within = (x: number, y: number, radius: number) => [...XS.keys()].filter((i) => Math.hypot(XS[i] - x, YS[i] - y) <= radius);

describe("SpatialGrid", () => {
    it("visits every point within the radius (and may visit a few beyond it), once each", () => {
        const grid = new SpatialGrid(XS, YS, 20);
        const seen: number[] = [];
        grid.forEachNear(200, 150, 35, (index) => seen.push(index));
        expect(new Set(seen).size).toBe(seen.length);
        within(200, 150, 35).forEach((index) => expect(seen).toContain(index));
    });

    it("handles queries partly or wholly outside the points' extent", () => {
        const grid = new SpatialGrid(XS, YS, 20);
        const seen: number[] = [];
        grid.forEachNear(-5, -5, 30, (index) => seen.push(index));
        within(-5, -5, 30).forEach((index) => expect(seen).toContain(index));
        expect(grid.nearestWithin(-500, -500, 9)).toBe(-1);
    });

    it("finds the nearest point within reach, matching a brute-force search", () => {
        const grid = new SpatialGrid(XS, YS, 18);
        for (const [x, y] of [
            [10, 10],
            [200, 150],
            [399, 299],
            [123.4, 56.7],
        ]) {
            const brute = within(x, y, 9).sort((a, b) => Math.hypot(XS[a] - x, YS[a] - y) - Math.hypot(XS[b] - x, YS[b] - y))[0];
            expect(grid.nearestWithin(x, y, 9)).toBe(brute ?? -1);
        }
    });
});
