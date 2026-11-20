import { describe, expect, it } from "vitest";
import { EdgeKind, buildNetwork, degreeOf, nearestNode, neighboursOf } from "./network.js";
import { mulberry32 } from "./random.js";
import { DESKTOP } from "./test-support.js";

const degrees = (network: ReturnType<typeof buildNetwork>) => Array.from({ length: network.count }, (_, i) => degreeOf(network, i));

describe("buildNetwork", () => {
    it("places the full population inside the canvas, deterministically", () => {
        const network = buildNetwork(mulberry32(123), DESKTOP);
        expect(network.count).toBe(250);
        for (let i = 0; i < network.count; i++) {
            expect(network.x[i] > 0 && network.x[i] < DESKTOP.width && network.y[i] > 0 && network.y[i] < DESKTOP.height).toBe(true);
        }
        expect(buildNetwork(mulberry32(123), DESKTOP)).toEqual(network);
    });

    it("keeps people at least the minimum distance apart", () => {
        const network = buildNetwork(mulberry32(4), DESKTOP);
        for (let i = 0; i < network.count; i++)
            for (let j = i + 1; j < network.count; j++)
                expect(Math.hypot(network.x[i] - network.x[j], network.y[i] - network.y[j])).toBeGreaterThan(DESKTOP.minDistance);
    });

    it("keeps edges unique and contact lists symmetric", () => {
        const network = buildNetwork(mulberry32(5), { ...DESKTOP, distantShare: 0.2, households: { sizes: [0.3, 0.3, 0.4], weight: 2 } });
        const keys = Array.from(network.edgeA, (a, e) => `${a}-${network.edgeB[e]}`);
        expect(new Set(keys).size).toBe(keys.length);
        network.edgeA.forEach((a, e) => {
            const b = network.edgeB[e];
            expect(a).toBeLessThan(b);
            expect([...neighboursOf(network, a)]).toContain(b);
            expect([...neighboursOf(network, b)]).toContain(a);
        });
        expect(network.neighbours.length).toBe(2 * network.edgeA.length);
        expect(new Set(network.edgeKind)).toEqual(new Set([EdgeKind.Local, EdgeKind.Distant, EdgeKind.Household]));
    });

    it("gives every node a contact and more contacts when asked", () => {
        const sparse = buildNetwork(mulberry32(9), { ...DESKTOP, neighbours: 2 });
        const dense = buildNetwork(mulberry32(9), { ...DESKTOP, neighbours: 8, maxEdgeLength: 128 });
        expect(degrees(sparse).every((degree) => degree > 0)).toBe(true);
        expect(dense.edgeA.length).toBeGreaterThan(sparse.edgeA.length * 2);
    });

    it("keeps the same people when only contacts change", () => {
        const a = buildNetwork(mulberry32(11), { ...DESKTOP, neighbours: 3 });
        const b = buildNetwork(mulberry32(11), { ...DESKTOP, neighbours: 6 });
        expect(b.x).toEqual(a.x);
        expect(b.y).toEqual(a.y);
    });

    it("varies contact numbers when asked, so a few people have many contacts", () => {
        const even = buildNetwork(mulberry32(8), DESKTOP);
        const varied = buildNetwork(mulberry32(8), { ...DESKTOP, contactVariation: 0.5 });
        const spread = (values: number[]) => {
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) / mean;
        };
        expect(spread(degrees(varied))).toBeGreaterThan(spread(degrees(even)) * 1.5);
        expect(Math.max(...degrees(varied))).toBeGreaterThan(Math.max(...degrees(even)) * 1.5);
        // The same people either way: only the links change.
        expect([varied.x, varied.y, varied.r]).toEqual([even.x, even.y, even.r]);
    });

    it("finds the nearest person to a point", () => {
        const network = buildNetwork(mulberry32(2), DESKTOP);
        expect(nearestNode(network, network.x[17] + 0.5, network.y[17] - 0.5)).toBe(17);
    });
});
