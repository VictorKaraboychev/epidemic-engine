import { describe, expect, it } from "vitest";
import { degreeOf } from "./network.js";
import { buildPopulationNetwork, indexCaseOrder, luckSeed, seededIndexCases } from "./population.js";
import { seirdModel } from "./seird.js";
import { createEpidemic } from "./stochastic.js";
import { FIGURE_POPULATION, WIDE_LAYOUT } from "./test-support.js";

const config = (overrides = {}) => ({ seed: 42, world: WIDE_LAYOUT, people: FIGURE_POPULATION, contacts: 4, ...overrides });

describe("population network", () => {
    it("builds the full population, the same for the same configuration", () => {
        for (const layout of [WIDE_LAYOUT, { width: 360, height: 320 }, { width: 1600, height: 900 }]) {
            const network = buildPopulationNetwork(config({ world: layout, superspreading: true }));
            expect(network.count).toBe(FIGURE_POPULATION);
            expect(buildPopulationNetwork(config({ world: layout, superspreading: true }))).toEqual(network);
        }
    });

    it("place tens of thousands of people quickly", () => {
        const started = performance.now();
        const network = buildPopulationNetwork(config({ world: { width: 1600, height: 1000 }, people: 20000, superspreading: true }));
        expect(performance.now() - started).toBeLessThan(2000);
        expect(network.count).toBe(20000);
        // Who-infected-whom must index past 32,767 people.
        expect(createEpidemic(seirdModel({ exposed: false, waning: false }), network, [19999]).infectedBy).toBeInstanceOf(Int32Array);
    });
});

describe("seeded choices", () => {
    it("take index cases with contacts in the seeded order, so a larger count extends a smaller one", () => {
        const network = buildPopulationNetwork(config({ seed: 7, contacts: 3 }));
        const order = indexCaseOrder(7, FIGURE_POPULATION);
        const three = seededIndexCases(order, network, 3);
        expect(three).toHaveLength(3);
        expect(seededIndexCases(order, network, 5).slice(0, 3)).toEqual(three);
        for (const node of three) expect(degreeOf(network, node)).toBeGreaterThan(0);
    });

    it("give each replay of a seed its own luck", () => {
        expect(luckSeed(12345, 0)).toBe(luckSeed(12345, 0));
        expect(new Set([0, 1, 2, 3].map((run) => luckSeed(12345, run))).size).toBe(4);
        expect(luckSeed(12345, 0)).not.toBe(luckSeed(12346, 0));
    });
});
