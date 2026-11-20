/**
 * The simple way in: one outbreak, from a pathogen (or your own parameters) to day-by-day counts.
 *
 *     const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 1 });
 *     const summary = outbreak.run();
 *     outbreak.count(SeirdCompartment.Recovered);
 *
 * It wires together the lower-level pieces (`Population`, `seirdModel`, `solveTransmission`, `createEpidemic`,
 * `advanceEpidemic`), which stay available for anything it doesn't cover.
 */
import { type Theory, deterministicCurve } from "./deterministic.js";
import { calibrateTheory, measureEarlyGrowth, shiftTheory } from "./growth.js";
import { type History, appendDay, peakInfections, seriesOf, startHistory } from "./history.js";
import { type CompiledModel, type Rates, SeirdCompartment, compileModel, ratesFor } from "./model.js";
import type { Network } from "./network.js";
import { Group, coverageAtAge, fatalityAtAge } from "./pathogens/index.js";
import type { Pathogen } from "./pathogens/pathogen.js";
import { DEFAULT_CONTACTS, Population, type PopulationOptions } from "./population.js";
import { availableFeatures, pathogenParams, solveTransmission } from "./presets.js";
import { estimateR0 } from "./r0.js";
import { type Random, randomSeed, seededRandom } from "./random.js";
import { type ReproductionCurve, reproductionCurve } from "./reproduction.js";
import { type ModelFeatures, type SeirdModel, type SeirdModelParams, seirdModel, seirdParams, withParams, withStagesScaled } from "./seird.js";
import { indexCaseOrder, luckSeed, seededIndexCases, seededVaccinated, seededVaccinatedByCoverage, vaccinatedCount, vaccinationOrder } from "./seeding.js";
import { type EpidemicState, advanceEpidemic, createEpidemic, infectedCount } from "./stochastic.js";

export interface OutbreakOptions {
    /**
     * A built-in pathogen (`Pathogen.Measles`), your own (`new Pathogen({ … })`), or a changed copy of a built-in one
     * (`Pathogen.Measles.with({ contacts: 12 })`). Omit it to set everything with `params` and `r0` (or `params.beta`).
     */
    pathogen?: Pathogen;
    /**
     * The people: a `Population` (reused as is, e.g. across outbreaks), or options for one (default: 10,000 people of
     * the United States in 2024, with the pathogen's contacts per person).
     */
    population?: Population | Partial<Omit<PopulationOptions, "superspreading">>;
    /** Shorthand for `population: { people }`. */
    people?: number;
    /**
     * Use one group's fatality rate and vaccine coverage for everyone (e.g. `Group.Gbmsm` for mpox). By default each
     * person's come from their age, where the pathogen has data by age (else the pathogen's overall figures).
     */
    group?: Group;
    /** Seeds the population, who starts infected and the run's luck: the same options replay the same outbreak. Default: random. */
    seed?: number;
    /** Which replay of this setup: each has its own luck and index cases (the same people and contacts). Default 0. */
    run?: number;
    /** Who starts infected: how many (seeded people with contacts), or which people. Default 1. */
    initialCases?: number | number[];
    /** Include the latent (exposed) period. Default true. */
    latentPeriod?: boolean;
    /** Immunity after recovery wanes, so people can be infected again. Needs the pathogen's data. Default false. */
    waning?: boolean;
    /** Vaccinate before the outbreak. Needs the pathogen's data (or `vaccineCoverage`). Default false. */
    vaccination?: boolean;
    /** Individual variation in infectiousness and contacts (dispersion k). Needs the pathogen's data (or `dispersion`). Default false. */
    superspreading?: boolean;
    /** The basic reproduction number to set the transmission rate by. Default: the pathogen's published R₀. */
    r0?: number;
    /** With superspreading: the dispersion k of offspring counts to aim for. Default: the pathogen's. */
    dispersion?: number;
    /** With vaccination: the share vaccinated (0–1), the same at every age. Default: the pathogen's coverage, by age where published. */
    vaccineCoverage?: number;
    /** Model parameters to use instead of the pathogen's (e.g. `{ ifr: 0 }`; an `ifr` here applies at every age). */
    params?: Partial<SeirdModelParams>;
}

export interface OutbreakSummary {
    /** Days simulated. */
    days: number;
    /** True once nobody carries the infection. */
    over: boolean;
    /** Everyone ever infected, index cases included, and as a share of people. */
    everInfected: number;
    attackRate: number;
    deaths: number;
    /** The day the most people were infected at once, and how many. */
    peak: { day: number; infected: number };
}

export interface TheoryOptions {
    /** Days to compute. Default: as long as the outbreak has run, at least a year. */
    days?: number;
    /**
     * Time it to this network: a dozen quick outbreaks measure how fast infections grow here and when they get going,
     * and the curve keeps its R₀ but runs at that pace from that start (networks of 2,000 people or more). Default false.
     */
    calibrated?: boolean;
}

/** Days `run()` simulates at most, unless told otherwise: an outbreak near R₀ = 1 can smoulder for years. */
export const DEFAULT_MAX_DAYS = 3650;
/** People in a population built from `people`, when not given. */
export const DEFAULT_PEOPLE = 10_000;
/** Mixed into the seed for measuring the network's reproduction curve and its early growth. */
const REPRODUCTION_SALT = 0x2545f491;
const GROWTH_SALT = 0x7f4a7c15;
/** Mixed into the seed (with the run) for a replay's index cases. */
const RUN_SALT = 0x6c8e9cf5;
/** Without a pathogen: superspreading's dispersion k. */
const DEFAULT_DISPERSION = 0.3;
/** Days the reference curve is compared over when timing it to the network. */
const CALIBRATION_DAYS = 400;

/** Everything an outbreak needs before its first day: shared by every replay of the same options. */
export interface OutbreakSetup {
    pathogen: Pathogen | null;
    population: Population;
    features: ModelFeatures;
    model: SeirdModel;
    /** With the transmission rate solved for `r0`, and `ifr` the population's average where it varies by age. */
    params: SeirdModelParams;
    r0: number;
    reproduction: ReproductionCurve;
    /** Each person's fatality relative to `params.ifr` (by age), or null when it's the same for everyone. */
    fatalityScale: Float32Array | null;
    /** Each person's vaccine coverage (by age), or null when it's the same for everyone (`coverage`). */
    coverageOf: ((person: number) => number) | null;
    coverage: number;
}

/** Each person's vaccine coverage from their age (worked out once per age). */
const coverageByPerson = (pathogen: Pathogen, ages: Uint8Array) => {
    const byYear = Float64Array.from({ length: 256 }, (_, age) => coverageAtAge(pathogen, age) ?? 0);
    return (person: number) => byYear[ages[person]];
};

/** Sets up an outbreak's population, model and parameters (reusing `reuse`'s population and its reproduction curve). */
export const prepareOutbreak = (options: OutbreakOptions = {}, reuse?: Pick<OutbreakSetup, "population" | "reproduction">): OutbreakSetup => {
    const pathogen = options.pathogen ?? null;
    const group = options.group ?? Group.All;
    const seed = options.seed ?? (options.population instanceof Population ? options.population.seed : randomSeed());
    const available = availableFeatures(pathogen);
    const {
        contacts: pathogenContacts,
        vaccineCoverage: groupCoverage,
        dispersion: pathogenDispersion,
        ...pathogenModelParams
    } = pathogen ? pathogenParams(pathogen, group) : {};
    const feature = (name: "waning" | "vaccination" | "superspreading", requested = false, given = false) => {
        if (requested && !available[name] && !given) throw new Error(`${pathogen!.id} has no data for ${name}`);
        return requested;
    };
    const features: ModelFeatures = {
        exposed: (options.latentPeriod ?? true) && available.exposed,
        waning: feature("waning", options.waning),
        vaccination: feature("vaccination", options.vaccination, options.vaccineCoverage !== undefined),
        superspreading: feature("superspreading", options.superspreading, options.dispersion !== undefined),
    };
    const given = options.population;
    const population =
        reuse?.population ??
        (given instanceof Population
            ? given
            : new Population({
                  people: options.people ?? DEFAULT_PEOPLE,
                  contacts: pathogenContacts ?? DEFAULT_CONTACTS,
                  seed,
                  ...given,
                  superspreading: features.superspreading,
              }));
    const model = seirdModel(features);

    // Fatality by age, where the pathogen has it and no one rate was asked for: each person's relative to the average.
    const ages = population.ages;
    const byAge = Boolean(pathogen && ages && options.group === undefined && options.params?.ifr === undefined);
    let fatalityScale: Float32Array | null = null;
    let ifr = pathogenModelParams.ifr;
    if (byAge) {
        const byYear = Float32Array.from({ length: 256 }, (_, age) => fatalityAtAge(pathogen!, age));
        const rates = Float32Array.from(ages!, (age) => byYear[age]);
        const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
        if (rates.some((rate) => rate !== rates[0])) fatalityScale = rates.map((rate) => (mean > 0 ? rate / mean : 1));
        ifr = mean;
    }
    const base = withParams(seirdParams({ ...pathogenModelParams, ...(ifr !== undefined ? { ifr } : {}) }), options.params);
    const reproduction = reuse?.reproduction ?? reproductionCurve(population.network, seededRandom(population.seed ^ REPRODUCTION_SALT));
    const r0 = options.r0 ?? pathogen?.values.r0.value ?? null;
    const solved = solveTransmission({
        model,
        params: base,
        reproduction,
        r0,
        dispersion: features.superspreading ? (options.dispersion ?? pathogenDispersion ?? DEFAULT_DISPERSION) : null,
    });
    const params: SeirdModelParams = { ...base, beta: solved.beta, dispersion: solved.dispersion && solved.dispersion > 0 ? solved.dispersion : null };
    const coverageByAge = Boolean(pathogen && ages && options.group === undefined && options.vaccineCoverage === undefined);
    return {
        pathogen,
        population,
        features,
        model,
        params,
        r0: r0 ?? estimateR0(model, params, reproduction),
        reproduction,
        fatalityScale,
        coverageOf: coverageByAge ? coverageByPerson(pathogen!, ages!) : null,
        coverage: options.vaccineCoverage ?? groupCoverage ?? 0,
    };
};

/** A stochastic outbreak on a contact network: set up from options, advanced a day at a time. */
export class Outbreak {
    /** The pathogen's data, or null when the parameters were set by hand. */
    readonly pathogen: Pathogen | null;
    /** The people, their ages and who meets whom. */
    readonly population: Population;
    readonly seed: number;
    readonly features: ModelFeatures;
    readonly model: SeirdModel;
    readonly r0: number;
    /** Who started infected, and who was vaccinated before the outbreak. */
    readonly indexCases: number[];
    readonly vaccinated: number[];

    private current: SeirdModelParams;
    private readonly setup: OutbreakSetup;
    private readonly compiled: CompiledModel;
    private rates: Rates;
    private readonly random: Random;
    private readonly epidemic: EpidemicState;
    private record: History;

    /** `setup` (from `prepareOutbreak`) lets replays share one population and solved parameters. */
    constructor(options: OutbreakOptions = {}, setup: OutbreakSetup = prepareOutbreak(options)) {
        const { population, model, features } = setup;
        const people = population.people;
        const seed = population.seed;
        const run = options.run ?? 0;
        const initial = options.initialCases ?? 1;
        const order = indexCaseOrder(run === 0 ? seed : luckSeed(seed, run) ^ RUN_SALT, people);
        const indexCases = Array.isArray(initial) ? initial : seededIndexCases(order, population.network, initial);
        const vaccinated = !features.vaccination
            ? []
            : setup.coverageOf
              ? seededVaccinatedByCoverage(vaccinationOrder(seed, people), indexCases, setup.coverageOf)
              : seededVaccinated(vaccinationOrder(seed, people), indexCases, vaccinatedCount(setup.coverage, people));

        this.setup = setup;
        this.pathogen = setup.pathogen;
        this.population = population;
        this.seed = seed;
        this.features = features;
        this.model = model;
        this.r0 = setup.r0;
        this.current = setup.params;
        this.compiled = compileModel(model) as CompiledModel;
        this.rates = this.ratesFor(setup.params);
        this.random = seededRandom(luckSeed(seed, run));
        this.epidemic = createEpidemic(model, population.network, indexCases, vaccinated, this.random);
        this.indexCases = this.epidemic.indexCases;
        this.vaccinated = vaccinated;
        this.record = startHistory(this.epidemic.counts, this.infected);
    }

    private ratesFor(params: SeirdModelParams): Rates {
        return { ...ratesFor(this.model, params), fatalityScale: this.setup.fatalityScale };
    }

    /** Who meets whom (the population's network). */
    get network(): Network {
        return this.population.network;
    }

    /** The parameters in effect, with the transmission rate (`beta`) solved for `r0` on this network. */
    get params(): SeirdModelParams {
        return this.current;
    }

    /**
     * Changes parameters from the next day, e.g. a lockdown: `setParams({ beta: outbreak.params.beta / 2 })`. Pending
     * infections are redrawn at the new rate; who is already infected stays so.
     */
    setParams(changes: Partial<SeirdModelParams>): this {
        this.current = withParams(this.current, changes);
        this.rates = this.ratesFor(this.current);
        return this;
    }

    /** Days simulated so far. */
    get day() {
        return this.epidemic.day;
    }

    /** People carrying the infection today (latent or infectious). */
    get infected() {
        return infectedCount(this.compiled, this.epidemic.counts);
    }

    /** True once nobody carries the infection: nothing more can happen. */
    get isOver() {
        return this.infected === 0;
    }

    /** Everyone ever infected so far, index cases included. */
    get everInfected() {
        return this.epidemic.everInfectedCount;
    }

    /** People in a compartment today, e.g. `SeirdCompartment.Recovered` (0 for one this model doesn't have). */
    count(compartment: SeirdCompartment | string) {
        const index = this.compiled.indexOf[compartment];
        return index === undefined ? 0 : this.epidemic.counts[index];
    }

    /** People per compartment today, by compartment key (`SeirdCompartment`). */
    get counts(): Record<string, number> {
        return Object.fromEntries(this.model.compartments.map((compartment, index) => [compartment.key, this.epidemic.counts[index]]));
    }

    /** A compartment's count on every day so far (empty for one this model doesn't have). */
    series(compartment: SeirdCompartment | string): Int32Array {
        const index = this.compiled.indexOf[compartment];
        return index === undefined ? new Int32Array(0) : seriesOf(this.record, index);
    }

    /** Every day's counts so far (see `seriesOf`, `countsOn`, `peakInfections`). */
    get history(): History {
        return this.record;
    }

    /** The full state, for anything the summary doesn't give (who infected whom, each person's compartment, …). */
    get state(): Readonly<EpidemicState> {
        return this.epidemic;
    }

    /** Advances `days` days (default one), stopping early once the outbreak is over. */
    step(days = 1): this {
        for (let day = 0; day < days && !this.isOver; day++) {
            advanceEpidemic(this.model, this.network, this.epidemic, this.rates, this.random);
            this.record = appendDay(this.record, this.epidemic.counts, this.infected);
        }
        return this;
    }

    /** Runs until the outbreak is over, or for `maxDays` days at most, and sums it up. */
    run(maxDays = DEFAULT_MAX_DAYS): OutbreakSummary {
        this.step(Math.max(0, maxDays - this.day));
        return this.summary();
    }

    /** How the outbreak has gone so far. */
    summary(): OutbreakSummary {
        const peak = peakInfections(this.record);
        return {
            days: this.day,
            over: this.isOver,
            everInfected: this.everInfected,
            attackRate: this.everInfected / this.network.count,
            deaths: this.count(SeirdCompartment.Died),
            peak: { day: peak.day, infected: peak.count },
        };
    }

    /**
     * The deterministic reference: the same model and R₀ averaged over chance in a well-mixed population. On a network
     * outbreaks usually run ahead of it; `calibrated: true` times it to this network.
     */
    theory({ days = Math.max(365, this.day), calibrated = false }: TheoryOptions = {}): Theory {
        const people = this.network.count;
        const initial = this.indexCases.length;
        const curve = (scale: number, length: number) =>
            deterministicCurve(this.model, withStagesScaled(this.current, scale), this.r0, people, initial, length, this.vaccinated.length);
        if (!calibrated) return curve(1, days);
        const growth = measureEarlyGrowth(this.model, this.compiled, this.network, this.rates, initial, this.vaccinated, seededRandom(this.seed ^ GROWTH_SALT));
        if (!growth) return curve(1, days);
        const neverInfected = [0, ...(this.model.vaccinatedEntry ? [this.compiled.indexOf[this.model.vaccinatedEntry]] : [])];
        const { scale, shift } = calibrateTheory((s) => curve(s, CALIBRATION_DAYS), neverInfected, initial, growth);
        return shiftTheory(curve(scale, days), shift);
    }
}
