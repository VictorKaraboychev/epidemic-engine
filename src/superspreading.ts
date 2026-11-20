/** Measures of how unevenly infections spread: who infected how many. */

/** How many people each person infected (most recent infections only, if someone was reinfected). */
export const offspringCounts = (infectedBy: Int32Array) => {
    const counts = new Int32Array(infectedBy.length);
    for (const parent of infectedBy) if (parent >= 0) counts[parent]++;
    return counts;
};

/** Fewer cases than this and the share below says more about chance than about the disease. */
export const MIN_CASES_FOR_SHARE = 20;

/**
 * The share of all infections caused by the most infectious `fraction` of cases (everyone ever infected: anyone who
 * has left the first, susceptible compartment). The classic "20/80" measure: about 0.2 with no variation, 0.8 for
 * strong superspreading. Null with too few cases or no transmission yet.
 */
export const topCasesShare = (states: Uint8Array, infectedBy: Int32Array, fraction = 0.2, offspring = offspringCounts(infectedBy)) => {
    // How many cases infected each number of people: the top cases are then read off from the largest number down,
    // in one pass over everyone instead of a sort of a million cases.
    let most = 0;
    for (let person = 0; person < states.length; person++) if (states[person] !== 0 && offspring[person] > most) most = offspring[person];
    const casesWith = new Int32Array(most + 1);
    let cases = 0;
    let infections = 0;
    for (let person = 0; person < states.length; person++) {
        if (states[person] === 0) continue;
        casesWith[offspring[person]]++;
        cases++;
        infections += offspring[person];
    }
    if (cases < MIN_CASES_FOR_SHARE || infections === 0) return null;
    let left = Math.max(1, Math.round(cases * fraction));
    let caused = 0;
    for (let count = most; count >= 0 && left > 0; count--) {
        const taken = Math.min(left, casesWith[count]);
        caused += taken * count;
        left -= taken;
    }
    return caused / infections;
};

/** By default, people who infected at least this many others count as superspreaders. */
export const SUPERSPREADER_MIN_INFECTED = 5;

export interface SuperspreaderOptions {
    /** Who counts: people who infected at least this many others. Default `SUPERSPREADER_MIN_INFECTED`. */
    minInfected?: number;
    /** List at most this many, the most prolific (e.g. to highlight on a drawing). Default: all of them. */
    limit?: number;
}

/**
 * The superspreaders, as pairs (person, people infected): everyone who infected at least `minInfected`, or only the
 * most prolific if there are more than `limit` (a count of how many infected how many sets the bar, so no sort).
 */
export const superspreaders = (offspring: Int32Array, { minInfected = SUPERSPREADER_MIN_INFECTED, limit = Infinity }: SuperspreaderOptions = {}) => {
    let most = 0;
    for (let person = 0; person < offspring.length; person++) if (offspring[person] > most) most = offspring[person];
    if (most < minInfected) return new Int32Array(0);
    const withCount = new Int32Array(most + 1);
    for (let person = 0; person < offspring.length; person++) if (offspring[person] >= minInfected) withCount[offspring[person]]++;
    let least = minInfected;
    let listed = 0;
    for (let count = most; count >= minInfected; count--) {
        if (listed + withCount[count] > limit) {
            least = count + 1;
            break;
        }
        listed += withCount[count];
    }
    const pairs = new Int32Array(2 * listed);
    let at = 0;
    for (let person = 0; person < offspring.length && at < pairs.length; person++) {
        if (offspring[person] < least) continue;
        pairs[at++] = person;
        pairs[at++] = offspring[person];
    }
    return pairs;
};

/**
 * The run summary's superspreading figures in two passes over everyone (a count of how many cases infected how many,
 * then the list): the share of infections caused by the top 20% of cases (`topCasesShare`) and the biggest
 * superspreaders (`superspreaders`). `offspring` as kept by the simulation (or from `offspringCounts`).
 */
export const outbreakSummary = (
    states: Uint8Array,
    offspring: Int32Array,
    { fraction = 0.2, minInfected = SUPERSPREADER_MIN_INFECTED, limit = Infinity }: SuperspreaderOptions & { fraction?: number } = {},
) => {
    let most = 0;
    let casesWith = new Int32Array(64);
    // How many people (cases or not: someone reinfected) infected each number of others, for the superspreader bar.
    let peopleWith = new Int32Array(64);
    let cases = 0;
    let infections = 0;
    const grow = (counts: Int32Array, count: number) => {
        const bigger = new Int32Array(Math.max(count + 1, counts.length * 2));
        bigger.set(counts);
        return bigger;
    };
    for (let person = 0; person < states.length; person++) {
        const count = offspring[person];
        if (count >= minInfected) {
            if (count >= peopleWith.length) peopleWith = grow(peopleWith, count);
            peopleWith[count]++;
        }
        if (states[person] === 0) continue;
        if (count >= casesWith.length) casesWith = grow(casesWith, count);
        casesWith[count]++;
        if (count > most) most = count;
        cases++;
        infections += count;
    }
    let share: number | null = null;
    if (cases >= MIN_CASES_FOR_SHARE && infections > 0) {
        let left = Math.max(1, Math.round(cases * fraction));
        let caused = 0;
        for (let count = most; count >= 0 && left > 0; count--) {
            const taken = Math.min(left, casesWith[count]);
            caused += taken * count;
            left -= taken;
        }
        share = caused / infections;
    }
    // The bar for listing: the fewest infections such that at most `limit` people reach it.
    let least = Infinity;
    let listed = 0;
    for (let count = peopleWith.length - 1; count >= minInfected; count--) {
        if (listed + peopleWith[count] > limit) break;
        listed += peopleWith[count];
        if (peopleWith[count] > 0) least = count;
    }
    const list = new Int32Array(2 * listed);
    if (listed > 0) {
        let at = 0;
        for (let person = 0; person < offspring.length && at < list.length; person++) {
            if (offspring[person] < least) continue;
            list[at++] = person;
            list[at++] = offspring[person];
        }
    }
    return { topCasesShare: share, superspreaders: list };
};
