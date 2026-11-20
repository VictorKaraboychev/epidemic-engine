/**
 * The stochastic epidemic on a contact network, in discrete days (Reed–Frost): each day every infectious person
 * infects each susceptible contact with probability β × susceptibility, and everyone may leave their compartment
 * by the exit they were given on entry, after a stay drawn then (gamma-distributed around its mean). Works for any
 * `CompartmentModel`.
 *
 * Simulated event by event (Kiss, Miller & Simon 2017, ch. 4), with the same odds: when someone becomes infectious,
 * the day they'd first infect each contact (or never, within their stay) is drawn at once from the daily chances, and
 * every stay's end is known on entry, so a day only handles what happens that day instead of rolling for everyone's
 * every contact and scanning everyone. A scheduled infection is checked when its day comes: the contact may have been
 * infected by someone else first, or be (partly) protected, in which case the infector keeps trying from the next day.
 *
 * Protection that changes with time (immunity after recovery, a vaccine) is all-or-nothing per person: each draws a
 * threshold on entry and is fully protected until the compartment's susceptibility curve reaches it, then fully
 * susceptible. So the share protected follows the published curve whatever the transmission rate. (A "leaky"
 * reduction of each day's risk would compound over days of exposure: with Omicron's β ≈ 0.8 a day, a 44%-effective
 * vaccine would still let ≈ 99% of exposed people be infected within a week.)
 */
import { type CompartmentModel, type CompiledModel, type ModelParams, type Rates, UNDECIDED, compileModel, drawStayDays } from "./model.js";
import type { Network } from "./network.js";
import { type Random, gammaMeanOne } from "./random.js";

/** Infectiousness not drawn yet (index cases, until their first day). */
const UNDRAWN = -1;

export interface EpidemicState {
    day: number;
    indexCases: number[];
    /** Each person's compartment (an index into the model's compartments). */
    states: Uint8Array;
    /** The exit each person will take from their current compartment (`UNDECIDED` until chosen). */
    exits: Uint8Array;
    /** The day each person leaves their current compartment by that exit (drawn with the exit; gamma-distributed). */
    leaveOn: Int32Array;
    /** Who infected each person most recently (-1 for index cases and the never-infected). */
    infectedBy: Int32Array;
    /** The day each person entered their current compartment (for susceptibility that changes with time, e.g. waning). */
    entered: Int32Array;
    /**
     * Each person's infectiousness relative to the average (1), drawn when they are infected (index cases: on their
     * first day). Stays 1 without superspreading. `UNDRAWN` until drawn.
     */
    infectiousness: Float32Array;
    /**
     * Each person's protection threshold in a compartment whose susceptibility changes with time (0–1, drawn on entry):
     * protected while the compartment's susceptibility curve is below it, fully susceptible from then on.
     */
    threshold: Float32Array;
    /**
     * The compartment each person's current infection started from, if it carries protection (a vaccine breakthrough
     * or a reinfection: lower death risk and infectiousness), else -1.
     */
    infectedFrom: Int8Array;
    /** 1 for everyone who has ever been infected (index cases included). */
    everInfected: Uint8Array;
    everInfectedCount: number;
    /** How many people each person infected (counting only each person's most recent infection), kept as it happens. */
    offspring: Int32Array;
    /** People per compartment today. */
    counts: number[];
    /** What happens on which day: see `Schedule`. */
    schedule: Schedule;
}

/** A day's events: transmissions as (infector, contact) pairs, or people whose stay ends. */
interface Bucket {
    items: Int32Array;
    length: number;
}

/**
 * Events by the day (step) they happen in: scheduled transmissions and the ends of stays. `chances` records the
 * transmission chances the pending transmissions were drawn with: if they change (the transmission rate is changed mid-run),
 * everyone infectious redraws theirs. Unprimed until the first day, which sets everyone up (index cases choose their
 * exit then, so setup changes still apply).
 */
export interface Schedule {
    /** By day: index d holds day d's events (emptied once done). */
    transmissions: (Bucket | undefined)[];
    exits: (Bucket | undefined)[];
    primed: boolean;
    chances: string;
    /**
     * Each person's earliest scheduled infection day (`NOT_SCHEDULED` if none), kept only where a later one could
     * never matter: see `scheduleContact`.
     */
    earliest: Int32Array;
}

const NOT_SCHEDULED = 0x7fffffff;

const createSchedule = (count: number): Schedule => ({
    transmissions: [],
    exits: [],
    primed: false,
    chances: "",
    earliest: new Int32Array(count).fill(NOT_SCHEDULED),
});

const cloneBuckets = (buckets: (Bucket | undefined)[]) => buckets.map((bucket) => bucket && { items: bucket.items.slice(), length: bucket.length });

const push = (buckets: (Bucket | undefined)[], day: number, a: number, b?: number) => {
    let bucket = buckets[day];
    if (!bucket) buckets[day] = bucket = { items: new Int32Array(64), length: 0 };
    const size = b === undefined ? 1 : 2;
    if (bucket.length + size > bucket.items.length) {
        const bigger = new Int32Array(bucket.items.length * 2);
        bigger.set(bucket.items);
        bucket.items = bigger;
    }
    bucket.items[bucket.length++] = a;
    if (b !== undefined) bucket.items[bucket.length++] = b;
};

const countStates = (states: Uint8Array, compartments: number) => {
    const counts = new Array<number>(compartments).fill(0);
    for (const state of states) counts[state]++;
    return counts;
};

/** People carrying the infection today (exposed and infectious alike). */
export const infectedCount = (compiled: Pick<CompiledModel, "infected">, counts: number[]) =>
    counts.reduce((sum, count, c) => sum + (compiled.infected[c] ? count : 0), 0);

/**
 * People per compartment as they stand: in compartments whose protection wanes, those whose protection has lapsed
 * count as susceptible (the first compartment), so only the protected count as vaccinated or recovered. For display:
 * the model's own `counts` keep everyone in the compartment they're in.
 */
export const effectiveCounts = (compiled: Pick<CompiledModel, "waning">, state: EpidemicState, rates: Pick<Rates, "susceptibilityByDay">) => {
    if (!compiled.waning.some(Boolean)) return state.counts;
    const counts = state.counts.slice();
    for (let person = 0; person < state.states.length; person++) {
        const compartment = state.states[person];
        const table = rates.susceptibilityByDay[compartment];
        if (!table || table[Math.min(table.length - 1, state.day - state.entered[person])] < state.threshold[person]) continue;
        counts[compartment]--;
        counts[0]++;
    }
    return counts;
};

/** The outbreak is over when no one carries the infection. */
export const isOver = (compiled: Pick<CompiledModel, "infected">, state: EpidemicState) => infectedCount(compiled, state.counts) === 0;

/**
 * A fresh run at day 0: everyone in the first compartment except the index cases, and the vaccinated if the model
 * has vaccination (an index case is infected, not vaccinated; out-of-range people are ignored).
 */
export const createEpidemic = <P extends ModelParams>(
    model: CompartmentModel<P>,
    network: Network,
    indexCases: number[],
    vaccinated: number[] = [],
    /** Draws the vaccinated's protection thresholds (seeded in runs, so they replay). */
    random: Random = Math.random,
): EpidemicState => {
    const compiled = compileModel(model);
    const count = network.count;
    const cases = [...new Set(indexCases)].filter((node) => node >= 0 && node < count);
    const states = new Uint8Array(count);
    const threshold = new Float32Array(count);
    if (model.vaccinatedEntry) {
        const entry = compiled.indexOf[model.vaccinatedEntry];
        for (const node of vaccinated) {
            if (node < 0 || node >= count) continue;
            states[node] = entry;
            threshold[node] = drawThreshold(random);
        }
    }
    const everInfected = new Uint8Array(count);
    for (const node of cases) {
        states[node] = compiled.indexEntry;
        everInfected[node] = 1;
    }
    return {
        day: 0,
        indexCases: cases,
        states,
        exits: new Uint8Array(count).fill(UNDECIDED),
        leaveOn: new Int32Array(count),
        infectedBy: new Int32Array(count).fill(-1),
        entered: new Int32Array(count),
        infectiousness: new Float32Array(count).fill(UNDRAWN),
        threshold,
        infectedFrom: new Int8Array(count).fill(-1),
        everInfected,
        everInfectedCount: cases.length,
        offspring: new Int32Array(count),
        counts: countStates(states, model.compartments.length),
        schedule: createSchedule(count),
    };
};

/** A protection threshold in (0, 1]: protected while susceptibility is below it. */
const drawThreshold = (random: Random) => 1 - random();

/** Scratch space for one person's exit shares (an infection at a time). */
let scaledShares = new Float64Array(8);

/**
 * Cumulative exit shares with the exits to death scaled by `scale` (capped so they total at most 1) and the others
 * sharing the rest in proportion.
 */
const scaledDeaths = (cumulative: Float64Array, dead: boolean[], scale: number) => {
    if (scaledShares.length < cumulative.length) scaledShares = new Float64Array(cumulative.length);
    let deaths = 0;
    for (let exit = 0; exit < cumulative.length; exit++) if (dead[exit]) deaths += cumulative[exit] - (exit ? cumulative[exit - 1] : 0);
    const scaled = Math.min(1, deaths * scale);
    const survivals = 1 - deaths;
    let total = 0;
    for (let exit = 0; exit < cumulative.length; exit++) {
        const share = cumulative[exit] - (exit ? cumulative[exit - 1] : 0);
        total += dead[exit] ? (deaths > 0 ? (share * scaled) / deaths : 0) : survivals > 0 ? (share * (1 - scaled)) / survivals : 0;
        scaledShares[exit] = exit === cumulative.length - 1 ? 1 : total;
    }
    return scaledShares.subarray(0, cumulative.length);
};

/** Picks an exit from cumulative shares (`UNDECIDED` for a compartment without exits). */
const drawExit = (cumulative: Float64Array, random: Random) => {
    if (cumulative.length === 0) return UNDECIDED;
    if (cumulative.length === 1) return 0;
    const draw = random();
    let exit = 0;
    while (exit < cumulative.length - 1 && draw >= cumulative[exit]) exit++;
    return exit;
};

/** A copy of a state that shares nothing with it. */
export const cloneEpidemic = (state: EpidemicState): EpidemicState => ({
    day: state.day,
    indexCases: state.indexCases,
    states: state.states.slice(),
    exits: state.exits.slice(),
    leaveOn: state.leaveOn.slice(),
    infectedBy: state.infectedBy.slice(),
    entered: state.entered.slice(),
    infectiousness: state.infectiousness.slice(),
    threshold: state.threshold.slice(),
    infectedFrom: state.infectedFrom.slice(),
    everInfected: state.everInfected.slice(),
    everInfectedCount: state.everInfectedCount,
    offspring: state.offspring.slice(),
    counts: state.counts.slice(),
    schedule: {
        transmissions: cloneBuckets(state.schedule.transmissions),
        exits: cloneBuckets(state.schedule.exits),
        primed: state.schedule.primed,
        chances: state.schedule.chances,
        earliest: state.schedule.earliest.slice(),
    },
});

/**
 * Who changed compartment, for a view that only redraws them: each person is added once (a stamp per person marks who
 * is already listed) until `takeChanges`.
 */
export interface ChangeLog {
    list: Int32Array;
    length: number;
    stamp: Int32Array;
    /** The current listing's stamp. */
    round: number;
}

export const createChangeLog = (count: number): ChangeLog => ({
    list: new Int32Array(Math.max(16, count >> 4)),
    length: 0,
    stamp: new Int32Array(count),
    round: 1,
});

export const logChange = (log: ChangeLog, person: number) => {
    if (log.stamp[person] === log.round) return;
    log.stamp[person] = log.round;
    if (log.length === log.list.length) {
        const bigger = new Int32Array(log.list.length * 2);
        bigger.set(log.list);
        log.list = bigger;
    }
    log.list[log.length++] = person;
};

/** The people listed so far, and a fresh listing. */
export const takeChanges = (log: ChangeLog) => {
    const changed = log.list.slice(0, log.length);
    log.length = 0;
    log.round++;
    return changed;
};

/** One simulated day. Returns a new state; the input is left untouched (see `advanceEpidemic` to save the copy). */
export const stepEpidemic = <P extends ModelParams>(
    model: CompartmentModel<P>,
    network: Network,
    state: EpidemicState,
    rates: Rates,
    random: Random,
): EpidemicState => advanceEpidemic(model, network, cloneEpidemic(state), rates, random);

/**
 * Which compartments people can be infected from, now or later: those with a susceptibility, or whose protection wanes,
 * and any from which one of those can be reached. A contact who can never be infected again (dead, or recovered for
 * good) isn't worth scheduling.
 */
const infectableLater = (compiled: CompiledModel, rates: Rates) => {
    const direct = compiled.keys.map((_, c) => rates.susceptibility[c] > 0 || Boolean(rates.susceptibilityByDay[c]));
    const reach = direct.slice();
    for (let changed = true; changed;) {
        changed = false;
        compiled.targets.forEach((targets, c) => {
            if (!reach[c] && targets.some((target) => reach[target])) changed = reach[c] = true;
        });
    }
    return Uint8Array.from(reach, (can) => (can ? 1 : 0));
};

/** Grows a scratch array to at least `length`. */
const atLeast = (array: Float64Array, length: number): Float64Array => (array.length >= length ? array : new Float64Array(Math.max(length, array.length * 2)));
let localChances: Float64Array = new Float64Array(64);
let homeChances: Float64Array = new Float64Array(64);

/**
 * One simulated day, in place: the engine's step, so a million people cost no copies. Anyone who changed compartment
 * today has `entered` = today, which is how the day tells the people it has already moved from those it hasn't.
 * Only the day's scheduled transmissions and stay ends are handled (see the module comment); the first day sets up.
 */
export const advanceEpidemic = <P extends ModelParams>(
    model: CompartmentModel<P>,
    network: Network,
    state: EpidemicState,
    rates: Rates,
    random: Random,
    /** Lists everyone who changes compartment (or infector), if given. */
    log?: ChangeLog,
): EpidemicState => {
    const compiled = compileModel(model) as CompiledModel;
    const { states, exits, leaveOn, infectedFrom, infectedBy, entered, infectiousness, threshold, everInfected, offspring, counts, schedule } = state;
    const { offsets, neighbours } = network;
    const day = state.day;
    const today = day + 1;
    const households = network.householdOf;
    const householdWeight = network.householdWeight ?? 1;
    const infectable = infectableLater(compiled, rates);
    // Contacts certain to be infected by the first infection scheduled for them: fully susceptible where they are, with
    // nowhere else to go, and never infectable again once infected. A later one can then never happen, so it isn't
    // scheduled (it would only be discarded): the outbreak is exactly the same, with far fewer events.
    const firstWins = compiled.keys.map(
        (_, c) => !infectable[compiled.entry] && rates.susceptibility[c] === 1 && !rates.susceptibilityByDay[c] && rates.cumulativeShares[c].length === 0,
    );
    const { earliest } = schedule;
    const waning = rates.susceptibilityByDay.some((table) => table !== null && table !== undefined);
    let everInfectedCount = state.everInfectedCount;

    /** A contact's current risk: fixed per compartment, or (protection that wanes) all or nothing by their threshold. */
    const susceptibilityOf = (person: number) => {
        const table = rates.susceptibilityByDay[states[person]];
        if (!table) return rates.susceptibility[states[person]];
        return table[Math.min(table.length - 1, day - entered[person])] >= threshold[person] ? 1 : 0;
    };
    const move = (person: number, to: number) => {
        counts[states[person]]--;
        counts[to]++;
        states[person] = to;
        entered[person] = today;
        if (log) logChange(log, person);
    };
    /** A new infection's infectiousness: gamma-distributed with mean 1 when there is superspreading, else 1. */
    const drawInfectiousness = () => (rates.dispersion ? gammaMeanOne(random, rates.dispersion) : 1);

    // The daily chances for average infectiousness (everyone's, without superspreading), by day of the stay, worked
    // out once per compartment: 1 − (1 − β)^p for the profile p (household contacts: p × the household weight).
    const chanceTables = compiled.infectious.length
        ? rates.infectiousnessByDay.map((profile) => {
              const relative = profile ?? Float64Array.of(1);
              return {
                  local: relative.map((p) => (p === 1 ? rates.beta : 1 - (1 - rates.beta) ** p)),
                  home: relative.map((p) => 1 - (1 - rates.beta) ** (p * householdWeight)),
              };
          })
        : [];
    /**
     * Each day's chance that `node` infects a contact (and a household member), over the days `from` to the last of
     * their stay. Daily chance 1 − (1 − β)^ν, ν being their infectiousness times the profile on that day of the stay.
     * Returns how many days there are.
     */
    const fillChances = (node: number, from: number) => {
        const days = leaveOn[node] - from;
        if (days <= 0) return 0;
        localChances = atLeast(localChances, days);
        homeChances = atLeast(homeChances, days);
        const compartment = states[node];
        const nu = infectiousness[node];
        const table = chanceTables[compartment];
        const last = table.local.length - 1;
        const offset = from - entered[node];
        if (nu === 1) {
            for (let d = 0; d < days; d++) {
                const index = Math.min(last, offset + d);
                localChances[d] = table.local[index];
                homeChances[d] = table.home[index];
            }
        } else {
            const profile = rates.infectiousnessByDay[compartment];
            for (let d = 0; d < days; d++) {
                const relative = nu * (profile ? profile[Math.min(profile.length - 1, offset + d)] : 1);
                localChances[d] = 1 - (1 - rates.beta) ** relative;
                homeChances[d] = 1 - (1 - rates.beta) ** (relative * householdWeight);
            }
        }
        return days;
    };
    /** Draws the day (from `from`, within `days`) that `node` would first infect `contact`, and schedules it. */
    const scheduleContact = (node: number, contact: number, from: number, days: number) => {
        const chances = households && households[node] >= 0 && households[contact] === households[node] ? homeChances : localChances;
        // The first day the daily trials succeed: where the chance of having failed every day so far drops below a draw.
        const draw = random();
        let failing = 1;
        for (let d = 0; d < days; d++) {
            failing *= 1 - chances[d];
            if (failing < draw) {
                if (firstWins[states[contact]]) {
                    if (from + d >= earliest[contact]) return;
                    earliest[contact] = from + d;
                }
                push(schedule.transmissions, from + d, node, contact);
                return;
            }
        }
    };
    /** Everyone `node` might infect, from day `from` to the end of their infectious stay. */
    const scheduleInfections = (node: number, from: number) => {
        const days = fillChances(node, from);
        if (!days) return;
        for (let k = offsets[node]; k < offsets[node + 1]; k++) {
            const contact = neighbours[k];
            if (infectable[states[contact]]) scheduleContact(node, contact, from, days);
        }
    };
    // Per compartment with an exit to death: which of its exits lead there (null: none), for per-person fatality.
    const deathExits = compiled.targets.map((targets) =>
        targets.some((target) => compiled.dead[target]) ? targets.map((target) => Boolean(compiled.dead[target])) : null,
    );
    /** On entering `compartment` on `entry`: the exit they'll take (fewer deaths if protected), when, and what follows. */
    const enter = (person: number, compartment: number, entry: number) => {
        const protection = infectedFrom[person] >= 0 ? rates.protection[infectedFrom[person]] : null;
        const shares = (protection ?? rates).cumulativeShares[compartment];
        const scale = rates.fatalityScale ? rates.fatalityScale[person] : 1;
        const exit = drawExit(scale === 1 || !deathExits[compartment] ? shares : scaledDeaths(shares, deathExits[compartment]!, scale), random);
        exits[person] = exit;
        if (exit !== UNDECIDED) {
            leaveOn[person] = entry + drawStayDays(rates.meanDays[compartment][exit], random, rates.shapes[compartment][exit]);
            push(schedule.exits, Math.max(day, leaveOn[person] - 1), person);
        }
        if (compiled.infectious[compartment]) {
            if (infectiousness[person] === UNDRAWN) infectiousness[person] = drawInfectiousness();
            if (exit !== UNDECIDED) scheduleInfections(person, Math.max(day, entry));
        }
    };

    // The first day: everyone in a compartment with somewhere to go chooses their exit (index cases included), and
    // the infectious schedule their infections. Later, if the transmission chances change, everyone infectious redraws.
    const chances = `${rates.beta}|${householdWeight}|${rates.infectiousnessByDay.map((profile) => profile?.join(",") ?? "").join(";")}`;
    if (!schedule.primed) {
        schedule.primed = true;
        schedule.chances = chances;
        for (let node = 0; node < states.length; node++) if (exits[node] === UNDECIDED) enter(node, states[node], entered[node]);
    } else if (chances !== schedule.chances) {
        schedule.chances = chances;
        schedule.transmissions = [];
        earliest.fill(NOT_SCHEDULED);
        for (let node = 0; node < states.length; node++) if (compiled.infectious[states[node]] && exits[node] !== UNDECIDED) scheduleInfections(node, day);
    }

    // Today's transmissions. A contact infected earlier today, protected, or not infectable right now is spared today;
    // the infector keeps trying from tomorrow while infectious.
    const due = schedule.transmissions[day];
    schedule.transmissions[day] = undefined;
    if (due) {
        const items = due.items;
        for (let at = 0; at < due.length; at += 2) {
            const node = items[at];
            const contact = items[at + 1];
            const compartment = states[contact];
            if (!infectable[compartment]) continue;
            const susceptibility = waning ? susceptibilityOf(contact) : rates.susceptibility[compartment];
            if (entered[contact] === today || susceptibility <= 0 || (susceptibility < 1 && random() >= susceptibility)) {
                const days = fillChances(node, today);
                if (days) scheduleContact(node, contact, today, days);
                continue;
            }
            const protection = rates.protection[compartment];
            infectedFrom[contact] = protection ? compartment : -1;
            move(contact, compiled.entry);
            if (infectedBy[contact] >= 0) offspring[infectedBy[contact]]--;
            offspring[node]++;
            infectedBy[contact] = node;
            infectiousness[contact] = drawInfectiousness() * (protection?.infectiousness ?? 1);
            if (!everInfected[contact]) {
                everInfected[contact] = 1;
                everInfectedCount++;
            }
            enter(contact, compiled.entry, today);
        }
    }

    // Today's stay ends (a person moved earlier today, or since given another stay, is skipped: theirs is elsewhere).
    const leaving = schedule.exits[day];
    schedule.exits[day] = undefined;
    if (leaving) {
        for (let at = 0; at < leaving.length; at++) {
            const node = leaving.items[at];
            const exit = exits[node];
            if (exit === UNDECIDED || entered[node] === today || leaveOn[node] > today) continue;
            const next = compiled.targets[states[node]][exit];
            move(node, next);
            if (compiled.waning[next]) threshold[node] = drawThreshold(random);
            enter(node, next, today);
        }
    }

    state.day = today;
    state.everInfectedCount = everInfectedCount;
    return state;
};
