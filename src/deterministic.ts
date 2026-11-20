/**
 * The deterministic, well-mixed version of any `CompartmentModel`, stepped daily like the simulation, as a
 * reference curve (people whose protection has lapsed counted as susceptible, as in the simulation's counts).
 *
 * People are tracked as the simulation treats them, only averaged: in each compartment with exits, per chosen exit
 * and by days since they entered, leaving each day with the chance their stay (the same gamma distribution, in whole
 * days) ends then, and infectious each day by the same profile. New infections: each susceptible compartment loses
 * x·(1 − e^(−β·susceptibility·I/N)) a day, where I is the profile-weighted infectious and β = R₀ / mean weighted
 * infectious days, so R₀ matches the simulation's. The only difference left is mixing: everyone meets everyone.
 */
import {
    type CompartmentModel,
    type ModelParams,
    atLeastOneDay,
    compileModel,
    exitShares,
    infectiousnessTable,
    sharesWithDeathsCut,
    stayDistribution,
    stayShape,
} from "./model.js";
import { meanInfectiousDays } from "./r0.js";

export interface Theory {
    /** People per compartment, per day (index 0 = day 0), in model order. */
    series: Float64Array[];
    /** People carrying the infection, per day. */
    infected: Float64Array;
    days: number;
}

export const deterministicCurve = <P extends ModelParams>(
    model: CompartmentModel<P>,
    params: P,
    r0: number,
    population: number,
    initialCases: number,
    days: number,
    /** People vaccinated on day 0 (models with vaccination). */
    vaccinated = 0,
): Theory => {
    const compiled = compileModel(model);
    const compartments = model.compartments;
    // Infections are tracked by kind: unprotected (0), or carrying the protection of the compartment they started from
    // (a vaccine breakthrough, a reinfection), which lowers their death share and infectiousness, as in the simulation.
    const protection = compartments.map((c) => c.protects?.(params) ?? null);
    const kinds = [0, ...compartments.flatMap((_, index) => (protection[index] ? [index] : []))];
    const kindOf = (source: number) => (protection[source] ? kinds.indexOf(source) : 0);
    const sharesBy = kinds.map((source) =>
        compartments.map((c) => (source === 0 ? exitShares(c, params) : sharesWithDeathsCut(model, c, params, protection[source]!.death))),
    );
    const spreadBy = kinds.map((source) => (source === 0 ? 1 : 1 - Math.min(1, Math.max(0, protection[source]!.spread))));
    const susceptibility = compartments.map((c) => c.susceptibility?.(params) ?? 0);
    const susceptibilityAfter = compartments.map((c) => c.susceptibilityAfter?.(params) ?? null);
    const profile = compartments.map((c) => infectiousnessTable(c, params));
    const meanDays = meanInfectiousDays(model, params);
    const beta = meanDays > 0 ? r0 / meanDays : 0;

    // Compartments with exits: per kind and exit, people by days since they entered, and the chance a stay of that
    // age ends today (its hazard); the last age always ends.
    const hazards = compartments.map((c) =>
        (c.exits ?? []).map((exit) => {
            const probability = stayDistribution(atLeastOneDay(exit.days(params)), stayShape(exit, params));
            let remaining = 1;
            return Float64Array.from({ length: probability.length - 1 }, (_, age) => {
                const ends = probability[age + 1];
                const hazard = remaining > 1e-12 ? Math.min(1, ends / remaining) : 1;
                remaining -= ends;
                return age === probability.length - 2 ? 1 : hazard;
            });
        }),
    );
    const ages = compartments.map((c, index) => kinds.map(() => (c.exits ?? []).map((_, e) => new Float64Array(hazards[index][e].length))));
    // Compartments without exits or waning: one amount. Waning ones: a cohort per day since entry, split into the
    // still protected and the no longer protected (all-or-nothing, as in the simulation).
    const amounts = new Float64Array(compartments.length);
    const cohorts = susceptibilityAfter.map((after) => (after ? { protected: new Float64Array(days + 2), open: new Float64Array(days + 2) } : null));
    // Each cohort compartment's total and its unprotected part, kept as people come and go.
    const cohortTotals = new Float64Array(compartments.length);
    const openTotals = new Float64Array(compartments.length);

    const add = (index: number, amount: number, kind = 0) => {
        const cohort = cohorts[index];
        if (cohort) {
            const open = Math.min(1, Math.max(0, susceptibilityAfter[index]!(0)));
            cohort.open[0] += amount * open;
            cohort.protected[0] += amount * (1 - open);
            cohortTotals[index] += amount;
            openTotals[index] += amount * open;
        } else if (!compartments[index].exits?.length) amounts[index] += amount;
        else sharesBy[kind][index].forEach((share, exit) => (ages[index][kind][exit][0] += amount * share));
    };
    const vaccinatedEntry = model.vaccinatedEntry ? compiled.indexOf[model.vaccinatedEntry] : -1;
    const vaccinatedAtStart = vaccinatedEntry >= 0 ? Math.min(vaccinated, population - initialCases) : 0;
    add(0, population - initialCases - vaccinatedAtStart);
    add(compiled.indexEntry, initialCases);
    if (vaccinatedAtStart > 0) add(vaccinatedEntry, vaccinatedAtStart);

    const sum = (values: Float64Array) => values.reduce((total, value) => total + value, 0);
    const totalOf = (c: number) => {
        if (cohorts[c]) return cohortTotals[c];
        if (!compartments[c].exits?.length) return amounts[c];
        return ages[c].reduce((total, byExit) => total + byExit.reduce((subtotal, byAge) => subtotal + sum(byAge), 0), 0);
    };
    const series = compartments.map(() => new Float64Array(days + 1));
    const infected = new Float64Array(days + 1);
    // As in the simulation's counts: those whose protection has lapsed count as susceptible (the first compartment).
    const record = (day: number) => {
        compartments.forEach((_, c) => {
            const total = totalOf(c);
            const lapsed = cohorts[c] ? Math.max(0, openTotals[c]) : 0;
            series[c][day] += total - lapsed;
            series[0][day] += lapsed;
            if (compiled.infected[c]) infected[day] += total;
        });
    };
    record(0);

    for (let day = 1; day <= days; day++) {
        // Infectious, weighted by each person's day in the profile and by their kind's protection against spread.
        let infectious = 0;
        compartments.forEach((_, c) => {
            if (!compiled.infectious[c]) return;
            ages[c].forEach((byExit, kind) =>
                byExit.forEach((byAge) =>
                    byAge.forEach(
                        (amount, age) => (infectious += spreadBy[kind] * amount * (profile[c] ? profile[c]![Math.min(profile[c]!.length - 1, age)] : 1)),
                    ),
                ),
            );
        });
        const force = (beta * infectious) / population;
        // Today's moves are all computed from yesterday's amounts, then applied.
        const arrivals: [to: number, amount: number, kind: number][] = [];
        const reinfections = kinds.map(() => 0);
        compartments.forEach((_, c) => {
            const cohort = cohorts[c];
            const after = susceptibilityAfter[c];
            if (cohort && after) {
                // The unprotected are infected like anyone susceptible; then everyone left is a day older, and the
                // protected lose protection so the cohort's share susceptible follows the curve.
                const last = cohort.open.length - 1;
                for (let age = last; age >= 0; age--) {
                    const [isProtected, open] = [cohort.protected[age], cohort.open[age]];
                    if (isProtected === 0 && open === 0) continue;
                    const infections = open * (1 - Math.exp(-force));
                    reinfections[kindOf(c)] += infections;
                    cohortTotals[c] -= infections;
                    const [now, next] = [Math.min(1, after(age)), Math.min(1, after(age + 1))];
                    const lapsing = now >= 1 ? isProtected : (isProtected * Math.max(0, next - now)) / (1 - now);
                    cohort.protected[age] = 0;
                    cohort.open[age] = 0;
                    const older = Math.min(last, age + 1);
                    cohort.protected[older] += isProtected - lapsing;
                    cohort.open[older] += open - infections + lapsing;
                    openTotals[c] += lapsing - infections;
                }
                return;
            }
            if (!compartments[c].exits?.length) {
                if (susceptibility[c] > 0) {
                    const infections = amounts[c] * (1 - Math.exp(-force * susceptibility[c]));
                    amounts[c] -= infections;
                    arrivals.push([compiled.entry, infections, kindOf(c)]);
                }
                return;
            }
            // Each stay ages a day; those whose stay ends today leave by their exit, keeping their kind. In a compartment
            // people can also be infected from (e.g. vaccinated people with exits), today's infections leave first.
            const risk = susceptibility[c] > 0 ? 1 - Math.exp(-force * susceptibility[c]) : 0;
            ages[c].forEach((byExit, kind) =>
                byExit.forEach((byAge, exit) => {
                    const hazard = hazards[c][exit];
                    for (let age = byAge.length - 1; age >= 0; age--) {
                        let amount = byAge[age];
                        if (amount === 0) continue;
                        if (risk > 0) {
                            arrivals.push([compiled.entry, amount * risk, kindOf(c)]);
                            amount -= amount * risk;
                        }
                        const leaving = amount * hazard[age];
                        byAge[age] = 0;
                        if (age + 1 < byAge.length) byAge[age + 1] += amount - leaving;
                        if (leaving > 0) arrivals.push([compiled.targets[c][exit], leaving, kind]);
                    }
                }),
            );
        });
        for (const [to, amount, kind] of arrivals) add(to, amount, kind);
        reinfections.forEach((amount, kind) => amount > 0 && add(compiled.entry, amount, kind));
        record(day);
    }

    return { series, infected, days };
};

/** Theory infections below this count as over: under half a person rounds to nobody. */
export const THEORY_OVER_BELOW = 0.5;

/**
 * The day the theory's outbreak is over for good (under half a person infected from then on), or its last day if it
 * never gets there.
 */
export const theoryEndDay = (theory: Theory) => {
    // The day after the last one with anyone infected: with waning immunity a fading outbreak can return.
    for (let day = theory.days; day >= 0; day--) if (theory.infected[day] >= THEORY_OVER_BELOW) return Math.min(theory.days, day + 1);
    return 0;
};
