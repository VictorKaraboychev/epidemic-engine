/**
 * A pathogen's values drawn from their published uncertainty, for runs that reflect what isn't known as well as
 * chance. Each value with an interval is drawn independently:
 * - a confidence, credible or uncertainty interval, or an interquartile range: from a split normal centred on the
 *   published value, each side's spread set by the interval (95%: ±1.96 SD; 90%: ±1.645; IQR: ±0.674), kept within
 *   3 SDs and above 0;
 * - a range: uniformly within it.
 * Values without an interval (and bounds) stay as published; shares (fatality, coverage, efficacy, protection) stay
 * within 0–1.
 */
import { type Random, standardNormal } from "../random.js";
import { type Cited, IntervalKind, type PathogenProfile, type PopulationGroup, type Protection, type Group } from "./types.js";

/** How many standard deviations each side of an interval spans. */
const SPREAD: Record<Exclude<IntervalKind, IntervalKind.Range>, number> = {
    [IntervalKind.CI95]: 1.96,
    [IntervalKind.CrI95]: 1.96,
    [IntervalKind.UI95]: 1.96,
    [IntervalKind.CI90]: 1.645,
    [IntervalKind.IQR]: 0.674,
};
/** Draws stay within this many standard deviations of the published value. */
const MAX_SPREAD = 3;

/** One value drawn from its interval (unchanged without one). `share`: kept within 0–1. */
export const sampleCited = (value: Cited, random: Random, share = false): Cited => {
    const interval = value.interval;
    if (!interval) return value;
    let draw: number;
    if (interval.kind === IntervalKind.Range) draw = interval.low + random() * (interval.high - interval.low);
    else {
        const z = standardNormal(random);
        const sd = (z < 0 ? value.value - interval.low : interval.high - value.value) / SPREAD[interval.kind];
        draw = value.value + Math.max(-MAX_SPREAD, Math.min(MAX_SPREAD, z)) * sd;
    }
    draw = Math.max(draw, value.value * 1e-3);
    return { ...value, value: share ? Math.min(1, draw) : draw };
};

const maybe = (value: Cited | undefined, random: Random, share = false) => (value ? sampleCited(value, random, share) : undefined);

const sampleProtection = <P extends Protection>(protection: P, random: Random): P => ({
    ...protection,
    ...(protection.efficacy ? { efficacy: maybe(protection.efficacy, random, true) } : {}),
    ...(protection.halfLife ? { halfLife: maybe(protection.halfLife, random) } : {}),
    ...(protection.delay ? { delay: maybe(protection.delay, random) } : {}),
    ...(protection.deathProtection ? { deathProtection: maybe(protection.deathProtection, random, true) } : {}),
    ...(protection.spreadProtection ? { spreadProtection: maybe(protection.spreadProtection, random, true) } : {}),
});

/** A pathogen's data with every value that has an interval drawn from it. */
export const sampleProfile = (profile: PathogenProfile, random: Random): PathogenProfile => {
    const values = Object.fromEntries(
        Object.entries(profile.values).map(([key, value]) => [key, sampleCited(value as Cited, random)]),
    ) as unknown as PathogenProfile["values"];
    const sampleGroup = <G extends PopulationGroup<Group>>(group: G): G => ({
        ...group,
        ...(group.ifr ? { ifr: sampleCited(group.ifr, random, true) } : {}),
        ...(group.vaccineCoverage ? { vaccineCoverage: sampleCited(group.vaccineCoverage, random, true) } : {}),
    });
    const [base, ...others] = profile.populations.groups;
    return {
        ...profile,
        values,
        ...(profile.immunity ? { immunity: sampleProtection(profile.immunity, random) } : {}),
        populations: { ...profile.populations, groups: [sampleGroup(base), ...others.map(sampleGroup)] },
        ...(profile.vaccination && !("none" in profile.vaccination) ? { vaccination: sampleProtection(profile.vaccination, random) } : {}),
    };
};
