/** Seeded randomness: a run can be replayed exactly from its seeds. */

export type Random = () => number;

/** Small, fast, seeded PRNG so a run can be replayed from its seed. */
export const mulberry32 = (seed: number): Random => {
    let state = seed;
    return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export const MIN_SEED = 10000;
export const MAX_SEED = 99999;

/** A five-digit seed: short enough to read off the screen and type back in. */
export const randomSeed = () => MIN_SEED + Math.floor(Math.random() * (MAX_SEED - MIN_SEED + 1));

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
const normal = (random: Random) => {
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
            x = normal(random);
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = random();
        if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return (d * v) / shape;
    }
};
