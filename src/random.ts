/** Seeded randomness: a run can be replayed exactly from its seeds. */
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";

export type Random = () => number;

/**
 * A seeded generator of uniform numbers in [0, 1): the same seed gives the same sequence, so a run can be replayed
 * from its seed. xoroshiro128+ (via pure-rand): 128 bits of state, so even a million-person outbreak's billions of
 * draws come nowhere near repeating it (period 2¹²⁸ − 1), at about the speed of a 32-bit generator.
 */
export const seededRandom = (seed: number): Random => {
    const generator = xoroshiro128plus(seed);
    return () => (generator.next() >>> 0) / 4294967296;
};

/** A random 32-bit seed, for a run nobody chose a seed for (keep it to replay the run). */
export const randomSeed = () => Math.floor(Math.random() * 2 ** 32) | 0;

/** A seeded shuffle of `0…n-1`. */
export const seededOrder = (n: number, random: Random) => {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
};

/** A standard normal draw (Box–Muller). */
export const standardNormal = (random: Random) => {
    const u = 1 - random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
};

/**
 * A gamma draw with this shape and mean 1 (Marsaglia & Tsang, 2000). Small shapes give a few large values and many
 * near zero: with shape k it is the distribution of individual infectiousness in Lloyd-Smith et al. 2005.
 */
export const gammaMeanOne = (random: Random, shape: number): number => {
    if (shape < 1) return gammaMeanOne(random, shape + 1) * ((shape + 1) / shape) * random() ** (1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
        let x: number;
        let v: number;
        do {
            x = standardNormal(random);
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = random();
        if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return (d * v) / shape;
    }
};
