import { Pathogen } from "./pathogens/types.js";
import { Population } from "./pathogens/types.js";
import { describe, expect, it } from "vitest";
import { getPathogen } from "./pathogens/index.js";
import { EdgeKind, buildNetwork, degreeOf, neighboursOf } from "./network.js";
import { HOUSEHOLD_SIZES, HOUSEHOLD_WEIGHT } from "./population.js";
import { pathogenParams } from "./presets.js";
import { infectionTimeline, infectiousnessAfterInfection } from "./profile.js";
import { mulberry32 } from "./random.js";
import { type SimulationModelParams, simulationModel } from "./seird.js";
import { seirdParams } from "./test-support.js";

const SEIRD = simulationModel({ exposed: true, waning: false });
const params = (overrides: Partial<SimulationModelParams>) => seirdParams({ beta: 0.2, latentDays: 5, recoveryDays: 8, deathDays: 8, ...overrides });

describe("infectiousness profile", () => {
    it("is zero while latent, sums to one, and its mean is the intrinsic generation interval", () => {
        const { curve, mean } = infectiousnessAfterInfection(SEIRD, params({ infectiousnessHalfLife: Infinity }));
        expect(curve.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 6);
        expect(curve[0]).toBe(0);
        // Flat: latent 5 + about half the (gamma-distributed) 8-day stay, a little more for its spread.
        expect(mean).toBeGreaterThan(9);
        expect(mean).toBeLessThan(12);
    });

    it("shows the infectious as equally infectious throughout when it doesn't fade, and less so over time when it does", () => {
        const shown = (strength: Float64Array) => Array.from(strength).filter(Number.isFinite);
        const flat = shown(infectionTimeline(SEIRD, params({ infectiousnessHalfLife: Infinity })).strength);
        expect(flat.length).toBeGreaterThan(5);
        for (const value of flat) expect(value).toBeCloseTo(1, 9);
        const fading = shown(infectionTimeline(SEIRD, params({ infectiousnessHalfLife: 1.5 })).strength);
        expect(fading[0]).toBeGreaterThan(fading[fading.length - 1] * 2);
        for (let day = 1; day < fading.length; day++) expect(fading[day]).toBeLessThanOrEqual(fading[day - 1] + 1e-9);
    });

    it("moves infectiousness earlier as it fades faster, keeping the periods", () => {
        const flat = infectiousnessAfterInfection(SEIRD, params({ infectiousnessHalfLife: Infinity })).mean;
        const fading = infectiousnessAfterInfection(SEIRD, params({ infectiousnessHalfLife: 1.5 })).mean;
        expect(fading).toBeLessThan(flat - 2);
        expect(fading).toBeGreaterThan(5);
    });

    it("comes from the presets: fitted where published intervals call for it, flat (an infinite half-life) otherwise", () => {
        expect(pathogenParams(getPathogen(Pathogen.CovidAncestral), Population.All)).toMatchObject({ recoveryDays: 8, infectiousnessHalfLife: 1.3 });
        expect(pathogenParams(getPathogen(Pathogen.Measles), Population.All).infectiousnessHalfLife).toBe(Infinity);
    });
});

describe("population network", () => {
    const network = buildNetwork(mulberry32(2), {
        width: 1400,
        height: 800,
        count: 6000,
        minDistance: 9,
        neighbours: 4,
        maxEdgeLength: 32,
        contactVariation: 0.32,
        distantShare: 0.18,
        households: { sizes: HOUSEHOLD_SIZES, weight: HOUSEHOLD_WEIGHT },
    });

    it("groups people into households of census sizes, each fully linked", () => {
        const members = new Map<number, number[]>();
        network.householdOf!.forEach((household, person) => members.set(household, [...(members.get(household) ?? []), person]));
        const households = [...members.values()];
        const share = (size: number) => households.filter((list) => list.length === size).length / households.length;
        expect(share(1)).toBeCloseTo(HOUSEHOLD_SIZES[0], 1);
        expect(share(2)).toBeCloseTo(HOUSEHOLD_SIZES[1], 1);
        for (const list of households) for (const a of list) for (const b of list) if (a !== b) expect([...neighboursOf(network, a)]).toContain(b);
        expect(network.householdWeight).toBe(HOUSEHOLD_WEIGHT);
    });

    it("has uneven contact numbers as in contact diaries, and a share of distant contacts", () => {
        const degrees = Array.from({ length: network.count }, (_, i) => degreeOf(network, i));
        const mean = degrees.reduce((sum, d) => sum + d, 0) / degrees.length;
        const sd = Math.sqrt(degrees.reduce((sum, d) => sum + (d - mean) ** 2, 0) / degrees.length);
        expect(sd / mean).toBeGreaterThan(0.6);
        expect(sd / mean).toBeLessThan(0.9);
        const distant = network.edgeKind.filter((kind) => kind === EdgeKind.Distant).length / network.edgeKind.length;
        expect(distant).toBeGreaterThan(0.1);
        expect(distant).toBeLessThan(0.3);
    });
});
