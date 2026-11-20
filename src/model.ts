/**
 * Compartmental models as data. A model lists its compartments and how people move between them; the stochastic
 * simulation (`stochastic.ts`), R₀ (`r0.ts`) and the deterministic reference (`deterministic.ts`) all read the same
 * description, so a new model (SEIR, SIRS with waning immunity, vaccination…) is a new description, not new code.
 *
 * Movement: people leave a compartment by one of its `exits`. Which exit, and how many days until they take it, are
 * chosen when they enter: the exit by `share`, the stay from a gamma distribution with mean `days` (see
 * `STAGE_SHAPE`). Choosing the exit
 * up front lets each outcome have its own duration: e.g. fatal infections can be infectious for less time than
 * survivable ones, so a disease that kills quickly spreads less from its fatal cases.
 * Infection is separate: each day every infectious person infects each contact with probability β × the contact's
 * `susceptibility`, moving them to `infectionEntry`.
 */
import { type Random, gammaMeanOne, seededRandom } from "./random.js";

/** Daily transmission probability per contact, plus whatever the model's exits and susceptibilities read. */
export interface ModelParams {
    beta: number;
    /**
     * Superspreading: each infected person's infectiousness is drawn from a gamma distribution with mean 1 and this
     * dispersion k (Lloyd-Smith et al. 2005), so a few people infect many and most infect few. Null: everyone the same.
     */
    dispersion?: number | null;
}

export interface Exit<P extends ModelParams> {
    /** The compartment people move to. */
    to: string;
    /** Share of people who take this exit, chosen when they enter. Omit for a compartment with one exit. */
    share?: (params: P) => number;
    /** Mean days before they leave this way. */
    days: (params: P) => number;
    /** Shape of the stay's gamma distribution (1 / its coefficient of variation²); `STAGE_SHAPE` by default. */
    shape?: (params: P) => number;
}

export interface Compartment<P extends ModelParams> {
    /** Short key, e.g. "s" (`SeirdCompartment`). */
    key: string;
    /** Its name, e.g. "susceptible". */
    name: string;
    /** Can be infected, at this relative risk (1 = fully susceptible). */
    susceptibility?: (params: P) => number;
    /**
     * The share of people susceptible after so many days in the compartment, e.g. as immunity wanes after recovery.
     * Each person is protected or not (they lose protection in turn, so the share matches this curve). Overrides
     * `susceptibility`. A compartment with this has no exits: people leave it only by being infected again.
     */
    susceptibilityAfter?: (params: P) => (days: number) => number;
    /**
     * Protection carried into an infection that starts here (a vaccine breakthrough, a reinfection): the share by
     * which the infected are less likely to die, and less infectious, than someone infected without it.
     */
    protects?: (params: P) => { death: number; spread: number };
    /** Carries the infection (whether or not infectious yet), e.g. exposed and infectious. */
    infected?: boolean;
    /** Passes the infection on. */
    infectious?: boolean;
    /**
     * How infectious people are on each day of their stay here, relative to the first (0 = the first day): flat if
     * omitted. Infectiousness typically peaks early (around symptom onset) and declines; the transmission rate is
     * solved with it, so only the shape matters.
     */
    infectiousnessByDay?: (params: P) => (day: number) => number;
    /** Counts as a death. */
    dead?: boolean;
    exits?: Exit<P>[];
}

export interface CompartmentModel<P extends ModelParams = ModelParams> {
    id: string;
    /** Its name, e.g. "SEIRD". */
    name?: string;
    /** Everyone starts in the first compartment. */
    compartments: Compartment<P>[];
    /** Where a new infection starts, e.g. "e" in SEIR, "i" in SIRD. */
    infectionEntry: string;
    /** Where index cases start: usually the infectious compartment, so the outbreak starts at once. */
    indexEntry: string;
    /** Where people vaccinated before the outbreak start, if the model has vaccination. */
    vaccinatedEntry?: string;
}

/* ─── SIRD ─── */

/** The compartments of the SIRD and SEIRD models, by key (`CompartmentModel` keys are strings: these are theirs). */
export enum SeirdCompartment {
    Susceptible = "s",
    Vaccinated = "v",
    Exposed = "e",
    Infected = "i",
    Recovered = "r",
    Died = "d",
}

export interface SirdParams extends ModelParams {
    /** Mean infectious days for infections that end in recovery. */
    recoveryDays: number;
    /** Mean infectious days for infections that end in death. */
    deathDays: number;
    /** Share of infections that are fatal. */
    ifr: number;
}

/** Susceptible → Infectious → Recovered or Died, each infection's outcome (and so its duration) chosen when it starts. */
export const SIRD_MODEL: CompartmentModel<SirdParams> = {
    id: "sird",
    compartments: [
        { key: SeirdCompartment.Susceptible, name: "susceptible", susceptibility: () => 1 },
        {
            key: SeirdCompartment.Infected,
            name: "infected",
            infected: true,
            infectious: true,
            exits: [
                { to: SeirdCompartment.Recovered, share: (p) => 1 - p.ifr, days: (p) => p.recoveryDays },
                { to: SeirdCompartment.Died, share: (p) => p.ifr, days: (p) => p.deathDays },
            ],
        },
        { key: SeirdCompartment.Recovered, name: "recovered" },
        { key: SeirdCompartment.Died, name: "died", dead: true },
    ],
    infectionEntry: SeirdCompartment.Infected,
    indexEntry: SeirdCompartment.Infected,
};

/* ─── SEIRD ─── */

export interface SeirdParams extends SirdParams {
    /** Mean days infected but not yet infectious. */
    latentDays: number;
}

/** The infectious → recovered or died exits, shared by SIRD and SEIRD. */
const INFECTIOUS_EXITS = SIRD_MODEL.compartments[1].exits!;

/** SIRD with a latent period: Susceptible → Exposed (infected, not yet infectious) → Infectious → Recovered or Died. */
export const SEIRD_MODEL: CompartmentModel<SeirdParams> = {
    id: "seird",
    compartments: [
        { key: SeirdCompartment.Susceptible, name: "susceptible", susceptibility: () => 1 },
        { key: SeirdCompartment.Exposed, name: "exposed", infected: true, exits: [{ to: SeirdCompartment.Infected, days: (p) => p.latentDays }] },
        { key: SeirdCompartment.Infected, name: "infected", infected: true, infectious: true, exits: INFECTIOUS_EXITS },
        { key: SeirdCompartment.Recovered, name: "recovered" },
        { key: SeirdCompartment.Died, name: "died", dead: true },
    ],
    infectionEntry: SeirdCompartment.Exposed,
    indexEntry: SeirdCompartment.Infected,
};

/* ─── Waning immunity ─── */

/**
 * Protection against reinfection after recovery: everyone protected for `delay` days, then the share protected halves
 * every `halfLife` days, so the share susceptible after t days is 1 − 2^(−max(0, t − delay) / halfLife). Each person
 * is protected or not (see `stochastic.ts`); the curve is the share who have lost it. The delay matters: studies measure protection months after infection, and
 * a pure exponential through those points would have it fall from 100% far too soon (Omicron: ≈ 44% at 4.5 months
 * instead of the measured ≈ 81%), letting people be reinfected within days.
 */
export const waningSusceptibility =
    (halfLife: number, delay = 0) =>
    (days: number) =>
        1 - 2 ** (-Math.max(0, days - delay) / Math.max(1, halfLife));

/**
 * Vaccine protection: a share `efficacy` of the vaccinated protected at first (the rest are vaccine failures), that
 * share halving every `halfLife` days after vaccination (on day 0, before the outbreak); the share susceptible t days
 * in is 1 − efficacy × 2^(−t / halfLife). All-or-nothing per person (see `stochastic.ts`), so the published efficacy,
 * a reduction in the share infected, holds however intense the exposure.
 */
export const vaccineSusceptibility = (efficacy: number, halfLife: number) => (days: number) =>
    1 - Math.min(1, Math.max(0, efficacy)) * 2 ** (-days / Math.max(1, halfLife));

/* ─── Compiled form ─── */

/** No exit chosen yet (index cases choose on their first day, with the parameters in force then). */
export const UNDECIDED = 255;

/** A model with compartments as indices, for fast inner loops. */
export interface CompiledModel<P extends ModelParams = ModelParams> {
    model: CompartmentModel<P>;
    keys: string[];
    indexOf: Record<string, number>;
    infected: Uint8Array;
    infectious: Uint8Array;
    dead: Uint8Array;
    /** Compartments whose susceptibility changes with time spent in them. */
    waning: Uint8Array;
    /** Per compartment: its exits' target indices. */
    targets: number[][];
    entry: number;
    indexEntry: number;
}

const compiled = new WeakMap<CompartmentModel<never>, CompiledModel<never>>();

export const compileModel = <P extends ModelParams>(model: CompartmentModel<P>): CompiledModel<P> => {
    const cached = compiled.get(model as CompartmentModel<never>);
    if (cached) return cached as unknown as CompiledModel<P>;
    const keys = model.compartments.map((compartment) => compartment.key);
    const indexOf = Object.fromEntries(keys.map((key, index) => [key, index]));
    const flag = (test: (compartment: Compartment<P>) => boolean | undefined) => Uint8Array.from(model.compartments, (c) => (test(c) ? 1 : 0));
    const result: CompiledModel<P> = {
        model,
        keys,
        indexOf,
        infected: flag((c) => c.infected),
        infectious: flag((c) => c.infectious),
        dead: flag((c) => c.dead),
        waning: flag((c) => Boolean(c.susceptibilityAfter)),
        targets: model.compartments.map((c) => (c.exits ?? []).map((exit) => indexOf[exit.to])),
        entry: indexOf[model.infectionEntry],
        indexEntry: indexOf[model.indexEntry],
    };
    compiled.set(model as CompartmentModel<never>, result as unknown as CompiledModel<never>);
    return result;
};

/** The model evaluated at one set of parameters: plain numbers for the daily loop. */
/** Time-dependent susceptibility is tabulated by whole day up to this long; after that it stays at the last value. */
export const SUSCEPTIBILITY_TABLE_DAYS = 3650;

export interface Rates {
    beta: number;
    /** Dispersion k of individual infectiousness, or null when everyone is equally infectious. */
    dispersion: number | null;
    susceptibility: Float64Array;
    /** Per compartment: susceptibility by days spent in it, for compartments where it changes (else null). */
    susceptibilityByDay: (Float64Array | null)[];
    /** Per compartment: cumulative exit shares (for drawing an exit) and each exit's mean stay in days. */
    cumulativeShares: Float64Array[];
    meanDays: Float64Array[];
    /** Per compartment: each exit's stay shape (see `Exit.shape`). */
    shapes: Float64Array[];
    /** Per compartment: relative infectiousness by day of the stay, where it varies (else null). */
    infectiousnessByDay: (Float64Array | null)[];
    /**
     * Per compartment people can be infected from: the protection they carry into the infection (see `protects`), as
     * a factor on infectiousness and the cumulative exit shares with deaths reduced; null where there is none.
     */
    protection: ({ infectiousness: number; cumulativeShares: Float64Array[] } | null)[];
}

/** Cumulative exit shares, in exit order (the last is 1). */
const cumulative = (shares: number[]) => {
    let total = 0;
    return Float64Array.from(shares, (share, i) => (i === shares.length - 1 ? 1 : (total += share)));
};

/** Exit shares with every exit to a death compartment cut by `death` (a share), the others scaled up to make 1. */
export const sharesWithDeathsCut = <P extends ModelParams>(model: CompartmentModel<P>, compartment: Compartment<P>, params: P, death: number) => {
    const shares = exitShares(compartment, params);
    const dead = (compartment.exits ?? []).map((exit) => Boolean(model.compartments.find((c) => c.key === exit.to)?.dead));
    const deaths = shares.reduce((total, share, i) => total + (dead[i] ? share : 0), 0);
    const survivals = dead.filter((isDead) => !isDead).length;
    if (deaths === 0 || survivals === 0) return shares;
    const kept = deaths * (1 - Math.min(1, Math.max(0, death)));
    // The survivors' exits take the rest in proportion (equally if every share was a death).
    return shares.map((share, i) => (dead[i] ? (share * kept) / deaths : deaths >= 1 ? (1 - kept) / survivals : (share * (1 - kept)) / (1 - deaths)));
};

/** Durations below one day count as one: the simulation moves in whole days. */
export const atLeastOneDay = (days: number) => Math.max(1, days);

/**
 * Shape of every stay's gamma distribution (coefficient of variation 1 / √4 = 0.5). Fitted incubation and infectious
 * periods vary about this much; a memoryless (geometric) stay, the shape-1 case, varies twice as much and distorts
 * epidemic timing (Wearing, Rohani & Keeling 2005): with a 10-day mean, 10% of latent periods would last a single day,
 * and on a dense network those fast cases do most of the infecting.
 */
export const STAGE_SHAPE = 4;

/** Relative infectiousness is tabulated by day of the stay up to this long; after that it stays at the last value. */
export const INFECTIOUSNESS_TABLE_DAYS = 400;

/** A compartment's relative infectiousness by day of the stay, or null if flat. */
export const infectiousnessTable = <P extends ModelParams>(compartment: Compartment<P>, params: P) => {
    if (!compartment.infectiousnessByDay) return null;
    const byDay = compartment.infectiousnessByDay(params);
    return Float64Array.from({ length: INFECTIOUSNESS_TABLE_DAYS }, (_, day) => Math.max(0, byDay(day)));
};

/** Stays relative to their mean: the means of 64 equal-probability bins of gamma(shape), normalized to mean one. */
const stayQuantiles = new Map<number, Float64Array>();
export const stayQuantilesFor = (shape: number) => {
    let quantiles = stayQuantiles.get(shape);
    if (!quantiles) {
        const random = seededRandom(0x57a9);
        const draws = Float64Array.from({ length: 64 * 256 }, () => gammaMeanOne(random, shape)).sort();
        quantiles = Float64Array.from({ length: 64 }, (_, bin) => draws.subarray(bin * 256, (bin + 1) * 256).reduce((sum, value) => sum + value, 0) / 256);
        const mean = quantiles.reduce((sum, value) => sum + value, 0) / quantiles.length;
        quantiles = quantiles.map((value) => value / mean);
        stayQuantiles.set(shape, quantiles);
    }
    return quantiles;
};

/**
 * The distribution of whole-day stays with this mean and shape, as `drawStayDays` draws them: `probability[d]` is
 * the chance a stay lasts d days (d ≥ 1).
 */
const stayDistributions = new Map<string, Float64Array>();
export const stayDistribution = (mean: number, shape: number) => {
    const key = `${mean}:${shape}`;
    let cached = stayDistributions.get(key);
    if (!cached) {
        cached = computeStayDistribution(mean, shape);
        // A small cache: the R₀ solve asks for the same few many times.
        if (stayDistributions.size > 256) stayDistributions.clear();
        stayDistributions.set(key, cached);
    }
    return cached;
};

const computeStayDistribution = (mean: number, shape: number) => {
    if (mean <= 1) return Float64Array.of(0, 1);
    const quantiles = stayQuantilesFor(shape);
    const longest = Math.ceil(mean * quantiles[quantiles.length - 1]) + 1;
    const probability = new Float64Array(longest + 1);
    for (const relative of quantiles) {
        const stay = mean * relative;
        const whole = Math.max(1, Math.floor(stay));
        const fraction = stay < 1 ? 0 : stay - Math.floor(stay);
        probability[whole] += (1 - fraction) / quantiles.length;
        probability[Math.min(longest, whole + 1)] += fraction / quantiles.length;
    }
    return probability;
};

/** An exit's stay shape, within sensible bounds (1: memoryless; 64: nearly fixed). */
export const stayShape = <P extends ModelParams>(exit: Exit<P>, params: P) => Math.min(64, Math.max(1, exit.shape?.(params) ?? STAGE_SHAPE));

/**
 * A gamma draw with this shape and mean 1. A whole-number shape (the default 4) is a sum of that many exponential
 * draws: one logarithm of a product of uniforms, much cheaper than the general method (`gammaMeanOne`).
 */
const gammaStay = (random: Random, shape: number) => {
    if (!Number.isInteger(shape) || shape > 16) return gammaMeanOne(random, shape);
    let product = 1;
    for (let k = 0; k < shape; k++) product *= 1 - random();
    return -Math.log(product) / shape;
};

/**
 * How many whole days a stay lasts: gamma with this mean and `STAGE_SHAPE`, rounded up or down at random in
 * proportion (so the mean holds), at least one day.
 */
export const drawStayDays = (mean: number, random: Random, shape = STAGE_SHAPE) => {
    if (mean <= 1) return 1;
    const days = mean * gammaStay(random, shape);
    const whole = Math.floor(days);
    return Math.max(1, whole + (random() < days - whole ? 1 : 0));
};

export const ratesFor = <P extends ModelParams>(model: CompartmentModel<P>, params: P): Rates => ({
    beta: params.beta,
    dispersion: params.dispersion ?? null,
    susceptibility: Float64Array.from(model.compartments, (c) => c.susceptibility?.(params) ?? 0),
    susceptibilityByDay: model.compartments.map((c) => {
        if (!c.susceptibilityAfter) return null;
        const after = c.susceptibilityAfter(params);
        return Float64Array.from({ length: SUSCEPTIBILITY_TABLE_DAYS }, (_, day) => after(day));
    }),
    cumulativeShares: model.compartments.map((c) => cumulative(exitShares(c, params))),
    protection: model.compartments.map((source) => {
        if (!source.protects) return null;
        const { death, spread } = source.protects(params);
        return {
            infectiousness: 1 - Math.min(1, Math.max(0, spread)),
            cumulativeShares: model.compartments.map((c) => cumulative(sharesWithDeathsCut(model, c, params, death))),
        };
    }),
    meanDays: model.compartments.map((c) => Float64Array.from(c.exits ?? [], (exit) => atLeastOneDay(exit.days(params)))),
    shapes: model.compartments.map((c) => Float64Array.from(c.exits ?? [], (exit) => stayShape(exit, params))),
    infectiousnessByDay: model.compartments.map((c) => infectiousnessTable(c, params)),
});

/** The exit each share picks: shares as numbers, in exit order (1 for a single exit). */
export const exitShares = <P extends ModelParams>(compartment: Compartment<P>, params: P) =>
    (compartment.exits ?? []).map((exit, _, exits) => (exits.length === 1 ? 1 : (exit.share?.(params) ?? 0)));
