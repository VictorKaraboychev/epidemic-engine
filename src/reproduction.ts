/**
 * How many people an early case infects on a particular network, as a function of transmissibility T (the chance an
 * infection passes along one contact before it ends). On a tree-like network that is T × the mean excess degree
 * (Newman 2002); on a clustered one it is less, because a case's contacts are often each other's contacts and get
 * infected by someone else first (Keeling 1999). So it is measured: early epidemics are run generation by
 * generation on the network itself (each case infecting each still-susceptible contact with chance T), and the mean
 * number infected by second- and third-generation cases is recorded at each T on a grid.
 */
import type { Network } from "./network.js";
import type { Random } from "./random.js";

/**
 * Network R at T = 0, 1/GRID, …, 1 (non-decreasing), and the dispersion k of those cases' offspring counts that the
 * network alone produces (uneven contact numbers, local saturation): Infinity where they are no more uneven than chance.
 */
export interface ReproductionCurve {
    r: Float64Array;
    dispersion: Float64Array;
}

export const REPRODUCTION_GRID = 32;
/** Early epidemics run per grid point (the same seeds at every T, so the curve is smooth). */
const SEEDS = 160;
/**
 * Cases counted per seed at most: in very contagious diseases a third generation can number in the hundreds, and a
 * sample of them measures their offspring as well (the rest are still infected, so depletion is unchanged).
 */
const MAX_COUNTED_PER_GENERATION = 48;
/**
 * Generations whose cases are counted: the index case's offspring (2nd) to the 4th. Later generations meet more
 * contacts already infected, as overlapping generations do in the simulation (households especially).
 */
const COUNTED_GENERATIONS = [2, 3, 4];
/**
 * Only cases infected while an early epidemic is still early count: until it has reached this share of the network
 * (at least `EARLY_MIN` people). For very contagious diseases the 4th generation would be a near-depleted crowd.
 */
const EARLY_SHARE = 0.02;
const EARLY_MIN = 50;

/** The measured curve for this network. Deterministic given `random`'s seed. */
export const reproductionCurve = (network: Network, random: Random): ReproductionCurve => {
    const people = network.count;
    const { offsets, neighbours } = network;
    const lastCounted = Math.max(...COUNTED_GENERATIONS);
    const isCounted = new Uint8Array(lastCounted + 1);
    for (const generation of COUNTED_GENERATIONS) isCounted[generation] = 1;
    const seeds = Array.from({ length: SEEDS }, () => {
        const start = Math.floor(random() * people);
        // A fixed stream of uniform draws per seed, shared by every T (common random numbers).
        const draws = Float64Array.from({ length: 4096 }, () => random());
        return { start, draws };
    });
    const infected = new Uint8Array(people);
    const r = new Float64Array(REPRODUCTION_GRID + 1);
    const dispersion = new Float64Array(REPRODUCTION_GRID + 1).fill(Infinity);
    for (let step = 1; step <= REPRODUCTION_GRID; step++) {
        const t = step / REPRODUCTION_GRID;
        // Household contacts: the same infection, `householdWeight` times as intense each day, so they escape it with
        // (1 − T)^weight (exact for a fixed stay; close for varying ones).
        const households = network.householdOf;
        const householdT = households ? 1 - (1 - t) ** (network.householdWeight ?? 1) : t;
        let cases = 0;
        let infections = 0;
        let squares = 0;
        const early = Math.max(EARLY_MIN, EARLY_SHARE * people);
        for (const { start, draws } of seeds) {
            if (offsets[start + 1] === offsets[start]) continue;
            const touched = [start];
            infected[start] = 1;
            let current = [start];
            let draw = 0;
            for (let generation = 1; generation <= lastCounted && current.length; generation++) {
                const next: number[] = [];
                let counted = 0;
                // A generation that takes the epidemic past early (counting itself) isn't counted, or expanded.
                if (generation > 1 && touched.length > early) break;
                for (const person of current) {
                    // Past the sample, a generation's later cases don't need their offspring measured.
                    if (isCounted[generation] && counted >= MAX_COUNTED_PER_GENERATION && generation === lastCounted) break;
                    let offspring = 0;
                    for (let k = offsets[person]; k < offsets[person + 1]; k++) {
                        const contact = neighbours[k];
                        if (infected[contact]) continue;
                        const edgeT = households && households[contact] === households[person] && households[person] >= 0 ? householdT : t;
                        if (draws[draw++ % draws.length] < edgeT) {
                            infected[contact] = 1;
                            touched.push(contact);
                            next.push(contact);
                            offspring++;
                        }
                    }
                    if (isCounted[generation]) {
                        counted++;
                        cases++;
                        infections += offspring;
                        squares += offspring * offspring;
                    }
                }
                current = next;
            }
            for (const person of touched) infected[person] = 0;
        }
        const mean = cases ? infections / cases : 0;
        const variance = cases ? squares / cases - mean * mean : 0;
        r[step] = Math.max(r[step - 1], mean);
        // Negative binomial k by moments: m² / (variance − m).
        if (variance > mean) dispersion[step] = (mean * mean) / (variance - mean);
    }
    return { r, dispersion };
};

/** The curve a tree-like network with this mean excess degree would have (R = T × excess degree): for tests. */
export const treeCurve = (excessDegree: number): ReproductionCurve => ({
    r: Float64Array.from({ length: REPRODUCTION_GRID + 1 }, (_, step) => (step / REPRODUCTION_GRID) * excessDegree),
    dispersion: new Float64Array(REPRODUCTION_GRID + 1).fill(Infinity),
});

const interpolate = (values: Float64Array, t: number) => {
    const position = Math.min(1, Math.max(0, t)) * REPRODUCTION_GRID;
    const below = Math.floor(position);
    if (below >= REPRODUCTION_GRID) return values[REPRODUCTION_GRID];
    if (!Number.isFinite(values[below]) || !Number.isFinite(values[below + 1])) return values[Math.round(position)];
    return values[below] + (values[below + 1] - values[below]) * (position - below);
};

/** Network R at transmissibility `t`, interpolated. */
export const reproductionAt = (curve: ReproductionCurve, t: number) => interpolate(curve.r, t);

/** The offspring dispersion the network alone produces at transmissibility `t` (Infinity: none beyond chance). */
export const contactDispersionAt = (curve: ReproductionCurve, t: number) => interpolate(curve.dispersion, Math.max(1 / REPRODUCTION_GRID, t));

/**
 * The dispersion individual infectiousness needs so the two sources of unevenness together give `target`: for
 * independent mean-one multipliers, 1 + 1/k_total = (1 + 1/k_contacts)(1 + 1/k_individual). Lloyd-Smith et al.'s k
 * is the total, so the network's own share is taken out. Null when the network alone is already as uneven.
 */
export const individualDispersion = (target: number, contacts: number) => {
    if (!Number.isFinite(contacts)) return target;
    const extra = (1 + 1 / target) / (1 + 1 / contacts) - 1;
    return extra > 0 ? 1 / extra : null;
};
