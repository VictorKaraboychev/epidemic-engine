/**
 * An infection's course from exposure: the latent stay (not infectious), then the infectious stay weighted by its
 * profile, then its outcome, over each stay's gamma distribution and each outcome's share. Infectiousness by day has
 * the shape of the generation interval's distribution before contacts run out (the "intrinsic" one), and its mean is
 * the mean generation interval.
 */
import { type CompartmentModel, type ModelParams, atLeastOneDay, compileModel, drawStayDays, exitShares, infectiousnessTable, stayShape } from "./model.js";
import { mulberry32 } from "./random.js";

/** Days after infection covered. */
export const PROFILE_DAYS = 90;
/** Below this share of infected people infectious on a day, their average infectiousness isn't shown (too few to say). */
export const STRENGTH_MIN_SHARE = 0.01;
/** Stays sampled per exit (a fixed seed, so the curve is the same each time). */
const SAMPLES = 2000;

/** The distribution of whole-day stays, as `drawStayDays` draws them: probability by number of days. */
const stayDistribution = (mean: number, shape: number) => {
    const random = mulberry32(0x9a1e);
    const probability = new Float64Array(PROFILE_DAYS + 1);
    for (let sample = 0; sample < SAMPLES; sample++) probability[Math.min(PROFILE_DAYS, drawStayDays(mean, random, shape))] += 1 / SAMPLES;
    return probability;
};

/**
 * An infection's course from exposure, on average: on each day, the share of infected people in each compartment of
 * the model (latent, infectious, then the outcome they end in); how infectious those who are infectious are on average
 * (`strength`, 1 on the day they become infectious: 1 throughout when infectiousness doesn't fade; NaN on days fewer than
 * `STRENGTH_MIN_SHARE` are infectious); and when infections are caused (`curve`, summing to one: the generation
 * interval's distribution, with mean `mean`, a hump even when infectiousness is flat, since people become and stop
 * being infectious on different days). Over each stay's gamma distribution and each outcome's share, as the simulation
 * draws them.
 */
export const infectionTimeline = <P extends ModelParams>(model: CompartmentModel<P>, params: P) => {
    const compiled = compileModel(model);
    const curve = new Float64Array(PROFILE_DAYS);
    const occupancy = model.compartments.map(() => new Float64Array(PROFILE_DAYS));
    // `start[d]`: the chance of entering this compartment `d` days after infection, on a path taken by `weight` of them.
    const visit = (index: number, start: Float64Array, weight: number) => {
        const compartment = model.compartments[index];
        if (weight === 0) return;
        // Where the infection ends (recovered, dead): people stay from the day they arrive.
        if (!compiled.infected[index] || !compartment.exits?.length) {
            let arrived = 0;
            for (let day = 0; day < PROFILE_DAYS; day++) occupancy[index][day] += weight * (arrived += start[day]);
            return;
        }
        const shares = exitShares(compartment, params);
        const profile = infectiousnessTable(compartment, params);
        compartment.exits.forEach((exit, e) => {
            const share = shares[e] * weight;
            if (share === 0) return;
            const stays = stayDistribution(atLeastOneDay(exit.days(params)), stayShape(exit, params));
            const next = new Float64Array(PROFILE_DAYS);
            for (let entered = 0; entered < PROFILE_DAYS; entered++) {
                if (start[entered] === 0) continue;
                for (let days = 1; days <= PROFILE_DAYS; days++) {
                    const chance = start[entered] * stays[days];
                    if (chance === 0) continue;
                    // Here on days `entered` to `entered + days − 1` (acting from the day after entering).
                    for (let day = 0; day < days && entered + day < PROFILE_DAYS; day++) {
                        occupancy[index][entered + day] += share * chance;
                        if (compiled.infectious[index]) curve[entered + day] += share * chance * (profile?.[day] ?? 1);
                    }
                    if (entered + days < PROFILE_DAYS) next[entered + days] += chance;
                }
            }
            visit(compiled.indexOf[exit.to], next, share);
        });
    };
    const start = new Float64Array(PROFILE_DAYS);
    start[0] = 1;
    visit(compiled.entry, start, 1);
    const infectious = new Float64Array(PROFILE_DAYS);
    occupancy.forEach((share, index) => compiled.infectious[index] && share.forEach((value, day) => (infectious[day] += value)));
    const strength = curve.map((value, day) => (infectious[day] >= STRENGTH_MIN_SHARE ? value / infectious[day] : NaN));
    const total = curve.reduce((sum, value) => sum + value, 0);
    // Infections caused on day d are infected the day after (d + 1): the generation interval.
    const mean = total > 0 ? curve.reduce((sum, value, day) => sum + value * (day + 1), 0) / total : 0;
    return { curve: total > 0 ? curve.map((value) => value / total) : curve, mean, occupancy, strength };
};

/** How infectious a new infection is on each day after it began (see `infectionTimeline`). */
export const infectiousnessAfterInfection = <P extends ModelParams>(model: CompartmentModel<P>, params: P) => {
    const { curve, mean } = infectionTimeline(model, params);
    return { curve, mean };
};
