/**
 * Basic reproduction number on a network, for any `CompartmentModel`: R₀ = the network's measured reproduction at
 * transmissibility T (see `reproduction.ts`), where T is the chance an infection passes along one contact before it ends.
 * T follows each infection's possible paths through the infected compartments (e.g. exposed → infectious → recovered
 * or died), weighted by their shares; only time in infectious compartments can transmit.
 */
import { type CompartmentModel, type ModelParams, atLeastOneDay, compileModel, exitShares, infectiousnessTable, stayDistribution, stayShape } from "./model.js";
import { gammaMeanOne, seededRandom } from "./random.js";
import { type ReproductionCurve, reproductionAt } from "./reproduction.js";

/** Total relative infectiousness over the first `days` days of a stay (the sum of days 0…days − 1). */
type Cumulative = (days: number) => number;
const flat: Cumulative = (days) => days;
const cumulativeOf = (profile: Float64Array | null): Cumulative => {
    if (!profile) return flat;
    const sums = new Float64Array(profile.length + 1);
    profile.forEach((weight, day) => (sums[day + 1] = sums[day] + weight));
    const last = profile[profile.length - 1];
    return (days) => (days <= profile.length ? sums[days] : sums[profile.length] + (days - profile.length) * last);
};

/** Expected value of `of(D)` over a stay averaging `days` (see `stayDistribution`). */
const overStay = (days: number, shape: number, of: (whole: number) => number) => {
    const probability = stayDistribution(days, shape);
    let total = 0;
    probability.forEach((chance, whole) => chance > 0 && (total += chance * of(whole)));
    return total;
};

/**
 * Chance a contact is infected during one stay at daily probability `beta`, scaled each day by the infectiousness
 * profile: 1 − E[(1 − β)^W], where W is the stay's total relative infectiousness.
 */
const passAlong = (beta: number, days: number, shape: number, cumulative: Cumulative) => {
    const escape = 1 - beta;
    return 1 - overStay(days, shape, (whole) => escape ** cumulative(whole));
};

/** Walks the infected compartments from where infections start, combining each path's value. */
const walkInfection = <P extends ModelParams>(
    model: CompartmentModel<P>,
    params: P,
    combine: (stay: { infectious: boolean; days: number; shape: number; cumulative: Cumulative }, rest: number) => number,
) => {
    const compiled = compileModel(model);
    const walk = (index: number): number => {
        const compartment = model.compartments[index];
        if (!compiled.infected[index] || !compartment.exits?.length) return 0;
        const shares = exitShares(compartment, params);
        const cumulative = cumulativeOf(infectiousnessTable(compartment, params));
        return compartment.exits.reduce(
            (sum, exit, i) =>
                sum +
                shares[i] *
                    combine(
                        { infectious: Boolean(compiled.infectious[index]), days: exit.days(params), shape: stayShape(exit, params), cumulative },
                        walk(compiled.indexOf[exit.to]),
                    ),
            0,
        );
    };
    return walk(compiled.entry);
};

/** Chance an infection passes along one contact before it ends, for someone of average infectiousness. */
const transmissibilityAt = <P extends ModelParams>(model: CompartmentModel<P>, params: P, beta: number) =>
    walkInfection(model, params, (stay, rest) => 1 - (1 - (stay.infectious ? passAlong(beta, stay.days, stay.shape, stay.cumulative) : 0)) * (1 - rest));

/**
 * Relative infectiousness (gamma, mean 1) per dispersion k, as the means of 128 equal-probability bins of a large
 * fixed-seed sample: deterministic, and cheap enough to solve for β many times.
 */
const INFECTIOUSNESS_BINS = 48;
const samples = new Map<number, Float64Array>();
const infectiousnessSample = (dispersion: number) => {
    let sample = samples.get(dispersion);
    if (!sample) {
        const random = seededRandom(0x5eed);
        const perBin = 64;
        const draws = Float64Array.from({ length: INFECTIOUSNESS_BINS * perBin }, () => gammaMeanOne(random, dispersion)).sort();
        sample = Float64Array.from(
            { length: INFECTIOUSNESS_BINS },
            (_, bin) => draws.subarray(bin * perBin, (bin + 1) * perBin).reduce((sum, value) => sum + value, 0) / perBin,
        );
        samples.set(dispersion, sample);
    }
    return sample;
};

/**
 * Chance an infection passes along one contact before it ends. With superspreading, averaged over individual
 * infectiousness ν (daily chance 1 − (1 − β)^ν): the average is a little below the average person's, since the most
 * infectious can't infect a contact more than once.
 */
export const transmissibility = <P extends ModelParams>(model: CompartmentModel<P>, params: P) => {
    if (!params.dispersion) return transmissibilityAt(model, params, params.beta);
    const sample = infectiousnessSample(params.dispersion);
    let total = 0;
    for (const relative of sample) total += transmissibilityAt(model, params, 1 - (1 - params.beta) ** relative);
    return total / sample.length;
};

/**
 * Expected infectious days, each weighted by the profile (relative to the first day of the stay): how much
 * infectiousness an infection has in total. A flat profile gives the expected days spent infectious.
 */
export const meanInfectiousDays = <P extends ModelParams>(model: CompartmentModel<P>, params: P) =>
    walkInfection(
        model,
        params,
        (stay, rest) =>
            (stay.infectious ? (stay.cumulative === flat ? atLeastOneDay(stay.days) : overStay(atLeastOneDay(stay.days), stay.shape, stay.cumulative)) : 0) +
            rest,
    );

/** R₀ on a network with this reproduction curve. Never negative (rounding can make "−0"). */
export const estimateR0 = <P extends ModelParams>(model: CompartmentModel<P>, params: P, curve: ReproductionCurve) =>
    Math.max(0, reproductionAt(curve, transmissibility(model, params)));

/**
 * The β that gives a target R₀, clamped to [min, max]. R₀ rises monotonically with β, so bisection finds it to
 * well below display precision.
 */
export const betaForR0 = <P extends ModelParams>(
    model: CompartmentModel<P>,
    params: P,
    curve: ReproductionCurve,
    targetR0: number,
    min: number,
    max: number,
) => {
    const r0At = (beta: number) => estimateR0(model, { ...params, beta }, curve);
    if (r0At(max) <= targetR0) return max;
    if (r0At(min) >= targetR0) return min;
    let low = min;
    let high = max;
    for (let iteration = 0; iteration < 28; iteration++) {
        const mid = (low + high) / 2;
        if (r0At(mid) < targetR0) low = mid;
        else high = mid;
    }
    return (low + high) / 2;
};
