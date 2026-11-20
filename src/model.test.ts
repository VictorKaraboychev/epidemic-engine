import { describe, expect, it } from "vitest";
import { deterministicCurve, theoryEndDay } from "./deterministic.js";
import { appendDay, countsOn, peakInfections, seriesOf, startHistory } from "./history.js";
import { SIRD_MODEL, type SirdParams, UNDECIDED, compileModel, ratesFor } from "./model.js";
import { buildNetwork, excessDegree, neighboursOf } from "./network.js";
import { betaForR0, estimateR0, meanInfectiousDays, transmissibility } from "./r0.js";
import { seededRandom, randomSeed, seededOrder } from "./random.js";
import { treeCurve } from "./reproduction.js";
import { type EpidemicState, advanceEpidemic, createEpidemic, infectedCount, isOver, stepEpidemic } from "./stochastic.js";
import { DESKTOP, SEIRS_V_MODEL, type SeirsParams, star } from "./test-support.js";

const [S, I, R, D] = [0, 1, 2, 3];
const SIRD = compileModel(SIRD_MODEL);
const sird = (params: Partial<SirdParams> = {}): SirdParams => ({ beta: 0.3, infectiousDays: 5, fatalInfectiousDays: 5, ifr: 0.1, ...params });

/** Runs until the outbreak ends (or `maxDays`), returning every day's state. */
const runSird = (params: SirdParams, indexCases = [0, 1], seed = 3, network = buildNetwork(seededRandom(21), DESKTOP), maxDays = 1000) => {
    const random = seededRandom(seed);
    const rates = ratesFor(SIRD_MODEL, params);
    let state = createEpidemic(SIRD_MODEL, network, indexCases);
    const days: EpidemicState[] = [state];
    while (!isOver(SIRD, state) && state.day < maxDays) days.push((state = stepEpidemic(SIRD_MODEL, network, state, rates, random)));
    return { network, days, final: state };
};

describe("random numbers", () => {
    it("seededRandom is deterministic and stays in [0, 1)", () => {
        const [a, b] = [seededRandom(42), seededRandom(42)];
        const values = Array.from({ length: 1000 }, () => a());
        expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
        expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    });

    it("randomSeed returns different 32-bit integers", () => {
        const seeds = Array.from({ length: 200 }, randomSeed);
        for (const seed of seeds) expect(Number.isInteger(seed) && seed === (seed | 0)).toBe(true);
        expect(new Set(seeds).size).toBeGreaterThan(195);
    });

    it("seededOrder is a deterministic permutation", () => {
        const order = seededOrder(250, seededRandom(7));
        expect([...order].sort((x, y) => x - y)).toEqual(Array.from({ length: 250 }, (_, i) => i));
        expect(seededOrder(250, seededRandom(7))).toEqual(order);
        expect(seededOrder(250, seededRandom(8))).not.toEqual(order);
    });
});

describe("createEpidemic", () => {
    it("starts from exact index cases, ignoring duplicates and out-of-range ones", () => {
        const state = createEpidemic(SIRD_MODEL, star(), [2, 4, 4, 99, -1]);
        expect(state.indexCases).toEqual([2, 4]);
        expect([state.states[2], state.states[0]]).toEqual([I, S]);
        expect(state.counts).toEqual([4, 2, 0, 0]);
        expect(state.everInfectedCount).toBe(2);
    });

    it("can start with nobody infected, which is already over", () => {
        expect(isOver(SIRD, createEpidemic(SIRD_MODEL, star(), []))).toBe(true);
    });
});

describe("stepEpidemic (SIRD)", () => {
    it("conserves the population and moves people only forwards", () => {
        const { days, final } = runSird(sird());
        days.forEach((state, day) => {
            expect(state.counts.reduce((a, b) => a + b, 0)).toBe(250);
            if (day > 0) {
                expect(state.counts[S]).toBeLessThanOrEqual(days[day - 1].counts[S]);
                expect(state.counts[R]).toBeGreaterThanOrEqual(days[day - 1].counts[R]);
                expect(state.counts[D]).toBeGreaterThanOrEqual(days[day - 1].counts[D]);
            }
        });
        expect(isOver(SIRD, final)).toBe(true);
    });

    it("only infects through contacts and records who infected whom", () => {
        const { network, final } = runSird(sird({ beta: 0.5, ifr: 0 }), [0, 1], 3, buildNetwork(seededRandom(4), DESKTOP));
        final.infectedBy.forEach((infector, node) => {
            if (infector === -1) return;
            expect([...neighboursOf(network, node)]).toContain(infector);
            expect(final.indexCases).not.toContain(node);
        });
        expect(final.everInfectedCount).toBe(final.counts[R] + final.counts[D]);
    });

    it("never kills anyone at 0% fatality and never lets anyone recover at 100%", () => {
        expect(runSird(sird({ beta: 0.4, ifr: 0 })).final.counts[D]).toBe(0);
        const deadly = runSird(sird({ beta: 0.4, ifr: 1 })).final.counts;
        expect(deadly[R]).toBe(0);
        expect(deadly[D]).toBeGreaterThan(0);
    });

    it("does not spread at zero transmission", () => {
        const { final } = runSird(sird({ beta: 0 }));
        expect(final.counts[S]).toBe(248);
        expect(final.counts[R] + final.counts[D]).toBe(2);
    });

    it("leaves the previous day untouched", () => {
        const network = buildNetwork(seededRandom(5), DESKTOP);
        const start = createEpidemic(SIRD_MODEL, network, [0]);
        const copy = start.states.slice();
        stepEpidemic(SIRD_MODEL, network, start, ratesFor(SIRD_MODEL, sird({ beta: 0.9 })), seededRandom(1));
        expect(start.states).toEqual(copy);
    });

    it("is reproducible from the same random seed", () => {
        expect(runSird(sird(), [0, 1], 9).final.states).toEqual(runSird(sird(), [0, 1], 9).final.states);
    });

    it("advances in place exactly as it steps with copies, counts included", () => {
        const { network, final } = runSird(sird({ ifr: 0.2 }), [0, 1], 9);
        const random = seededRandom(9);
        const rates = ratesFor(SIRD_MODEL, sird({ ifr: 0.2 }));
        const state = createEpidemic(SIRD_MODEL, network, [0, 1]);
        while (!isOver(SIRD, state)) advanceEpidemic(SIRD_MODEL, network, state, rates, random);
        expect(state).toEqual(final);
    });
});

describe("outcome-specific infectious periods", () => {
    const network = buildNetwork(seededRandom(3), DESKTOP);
    const k = treeCurve(excessDegree(network));

    it("a pathogen that kills quickly has a lower R₀ than one that kills slowly", () => {
        expect(estimateR0(SIRD_MODEL, sird({ beta: 0.2, infectiousDays: 16, fatalInfectiousDays: 4, ifr: 0.5 }), k)).toBeLessThan(
            estimateR0(SIRD_MODEL, sird({ beta: 0.2, infectiousDays: 16, fatalInfectiousDays: 16, ifr: 0.5 }), k),
        );
        // With nobody dying, the death period can't matter.
        expect(estimateR0(SIRD_MODEL, sird({ beta: 0.2, infectiousDays: 16, fatalInfectiousDays: 4, ifr: 0 }), k)).toBeCloseTo(
            estimateR0(SIRD_MODEL, sird({ beta: 0.2, infectiousDays: 16, fatalInfectiousDays: 30, ifr: 0 }), k),
        );
    });

    it("decides index cases' outcomes on their first day, with the fatality rate in force then", () => {
        const start = createEpidemic(SIRD_MODEL, network, [0, 1, 2]);
        expect([...start.exits].every((exit) => exit === UNDECIDED)).toBe(true);
        const next = stepEpidemic(
            SIRD_MODEL,
            network,
            start,
            ratesFor(SIRD_MODEL, sird({ beta: 0, infectiousDays: 30, fatalInfectiousDays: 30, ifr: 1 })),
            seededRandom(1),
        );
        for (const node of start.indexCases) expect(next.exits[node]).toBe(1);
    });

    it("ends fatal infections at the death period's rate", () => {
        const meanDuration = (fatalInfectiousDays: number) => {
            let total = 0;
            for (let seed = 0; seed < 40; seed++)
                total += runSird(sird({ beta: 0, infectiousDays: 30, fatalInfectiousDays, ifr: 1 }), [0], seed, network).final.day;
            return total / 40;
        };
        expect(meanDuration(1)).toBe(1);
        expect(meanDuration(10)).toBeGreaterThan(5);
    });
});

describe("R₀", () => {
    it("excessDegree is ⟨k²⟩/⟨k⟩ − 1", () => {
        // Degrees 4,1,1,1,1,0 → ⟨k⟩ = 8/6, ⟨k²⟩ = 20/6 → 20/8 − 1 = 1.5
        expect(excessDegree(star())).toBeCloseTo(1.5);
    });

    it("is zero without transmission and grows with transmission and duration", () => {
        expect(estimateR0(SIRD_MODEL, sird({ beta: 0 }), treeCurve(3))).toBe(0);
        expect(estimateR0(SIRD_MODEL, sird({ beta: 0.4 }), treeCurve(3))).toBeGreaterThan(estimateR0(SIRD_MODEL, sird({ beta: 0.2 }), treeCurve(3)));
        expect(estimateR0(SIRD_MODEL, sird({ beta: 0.2, infectiousDays: 10, fatalInfectiousDays: 10 }), treeCurve(3))).toBeGreaterThan(
            estimateR0(SIRD_MODEL, sird({ beta: 0.2 }), treeCurve(3)),
        );
    });

    it("betaForR0 inverts estimateR0 when the target is reachable, and clamps when it isn't", () => {
        for (const target of [1.2, 1.5, 2.8]) {
            for (const params of [
                sird({ infectiousDays: 8, fatalInfectiousDays: 8, ifr: 0.01 }),
                sird({ infectiousDays: 8, fatalInfectiousDays: 2, ifr: 0.5 }),
            ]) {
                const beta = betaForR0(SIRD_MODEL, params, treeCurve(4), target, 0.01, 0.95);
                expect(estimateR0(SIRD_MODEL, { ...params, beta }, treeCurve(4))).toBeCloseTo(target, 6);
            }
        }
        expect(betaForR0(SIRD_MODEL, sird(), treeCurve(2), 50, 0.01, 0.95)).toBe(0.95);
        expect(betaForR0(SIRD_MODEL, sird(), treeCurve(2), 0, 0.01, 0.95)).toBe(0.01);
    });

    it("weights infectious days by outcome", () => {
        expect(meanInfectiousDays(SIRD_MODEL, sird({ infectiousDays: 10, fatalInfectiousDays: 2, ifr: 0.25 }))).toBeCloseTo(8);
    });
});

describe("deterministicCurve (SIRD)", () => {
    const total = (theory: ReturnType<typeof deterministicCurve>, day: number) => theory.series.reduce((sum, series) => sum + series[day], 0);

    it("conserves the population", () => {
        const theory = deterministicCurve(SIRD_MODEL, sird({ infectiousDays: 12, fatalInfectiousDays: 4, ifr: 0.4 }), 2.5, 250, 1, 120);
        for (let day = 0; day <= 120; day++) expect(total(theory, day)).toBeCloseTo(250, 6);
    });

    it("grows when R₀ > 1 and dies out when R₀ < 1", () => {
        const growing = deterministicCurve(SIRD_MODEL, sird({ ifr: 0 }), 2.5, 250, 1, 30);
        const fading = deterministicCurve(SIRD_MODEL, sird({ ifr: 0 }), 0.6, 250, 1, 30);
        expect(growing.infected[10]).toBeGreaterThan(growing.infected[0]);
        expect(fading.infected[10]).toBeLessThan(fading.infected[0]);
    });

    it("splits ended infections into deaths at the fatality rate", () => {
        for (const fatalInfectiousDays of [2, 5, 15]) {
            const theory = deterministicCurve(SIRD_MODEL, sird({ fatalInfectiousDays, ifr: 0.3 }), 3, 250, 1, 600);
            expect(theory.series[D][600] / (theory.series[R][600] + theory.series[D][600])).toBeCloseTo(0.3, 6);
        }
    });

    it("ends (under half a person infected) after the peak, or at the last day if it never does", () => {
        const theory = deterministicCurve(SIRD_MODEL, sird({ ifr: 0 }), 2.5, 250, 1, 730);
        const end = theoryEndDay(theory);
        expect(theory.infected[end]).toBeLessThan(0.5);
        expect(theory.infected[end - 1]).toBeGreaterThanOrEqual(0.5);
        expect(theoryEndDay(deterministicCurve(SIRD_MODEL, sird(), 2.5, 250, 0, 100))).toBe(0);
        expect(theoryEndDay(deterministicCurve(SIRD_MODEL, sird(), 2.5, 250, 1, 20))).toBe(20);
    });
});

describe("history", () => {
    it("appends days without changing older snapshots, growing past its first buffer", () => {
        let history = startHistory([250, 0, 0, 0], 0);
        const early = history;
        for (let day = 1; day <= 300; day++) history = appendDay(history, [250 - day / 10, day / 10, 0, 0], day);
        expect(history.length).toBe(301);
        expect(early.length).toBe(1);
        expect(seriesOf(history, 1)[300]).toBe(30);
        expect(countsOn(early, 0)).toEqual([250, 0, 0, 0]);
        expect(peakInfections(history)).toEqual({ count: 300, day: 300 });
    });
});

describe("other models (SEIRS with vaccination)", () => {
    const params: SeirsParams = { beta: 0.25, latentDays: 3, infectiousDays: 6, immunityDays: 60, vaccinationDays: 200, efficacy: 0.8 };
    const compiled = compileModel(SEIRS_V_MODEL);
    const [S2, E, I2, R2, V] = [0, 1, 2, 3, 4];

    it("starts new infections in the exposed compartment, which is not infectious", () => {
        const network = buildNetwork(seededRandom(31), DESKTOP);
        const random = seededRandom(2);
        const rates = ratesFor(SEIRS_V_MODEL, { ...params, beta: 0.9 });
        let state = createEpidemic(SEIRS_V_MODEL, network, [0]);
        expect(state.states[0]).toBe(I2);
        state = stepEpidemic(SEIRS_V_MODEL, network, state, rates, random);
        state.infectedBy.forEach((by, node) => by >= 0 && expect([E, I2, R2]).toContain(state.states[node]));
        expect(state.counts[E]).toBeGreaterThan(0);
    });

    it("lets immunity wane and vaccinates people over time, conserving the population", () => {
        const network = buildNetwork(seededRandom(32), DESKTOP);
        const random = seededRandom(3);
        const rates = ratesFor(SEIRS_V_MODEL, params);
        let state = createEpidemic(SEIRS_V_MODEL, network, [0, 1, 2]);
        let reinfected = false;
        for (let day = 0; day < 400; day++) {
            const before = state;
            state = stepEpidemic(SEIRS_V_MODEL, network, state, rates, random);
            expect(state.counts.reduce((a, b) => a + b, 0)).toBe(250);
            reinfected ||= state.states.some((s, node) => s === E && before.everInfected[node] === 1);
        }
        expect(reinfected).toBe(true);
        expect(state.counts[V]).toBeGreaterThan(0);
        expect(infectedCount(compiled, state.counts)).toBe(state.counts[E] + state.counts[I2]);
        expect(state.counts[S2]).toBeLessThan(250);
    });

    it("has R₀ unaffected by the latent period and a theory curve that conserves the population", () => {
        expect(transmissibility(SEIRS_V_MODEL, { ...params, latentDays: 1 })).toBeCloseTo(transmissibility(SEIRS_V_MODEL, { ...params, latentDays: 10 }));
        expect(meanInfectiousDays(SEIRS_V_MODEL, params)).toBe(6);
        const theory = deterministicCurve(SEIRS_V_MODEL, params, 2, 250, 1, 300);
        for (const day of [0, 50, 300]) expect(theory.series.reduce((sum, series) => sum + series[day], 0)).toBeCloseTo(250, 6);
        // A latent period delays the peak.
        const peakDay = (latentDays: number) => {
            const curve = deterministicCurve(SEIRS_V_MODEL, { ...params, latentDays }, 2, 250, 1, 300).infected;
            return curve.indexOf(Math.max(...curve));
        };
        expect(peakDay(8)).toBeGreaterThan(peakDay(1));
    });
});
