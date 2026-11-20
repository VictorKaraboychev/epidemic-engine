/**
 * The simple way in: one outbreak, from a pathogen (or your own parameters) to day-by-day counts.
 *
 *     const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 1 });
 *     const summary = outbreak.run();
 *     outbreak.count(SeirdCompartment.Recovered);
 *
 * It wires together the lower-level pieces (`buildPopulationNetwork`, `seirdModel`, `solveTransmission`,
 * `createEpidemic`, `advanceEpidemic`), which stay available for anything it doesn't cover.
 */
import { type Theory, deterministicCurve } from "./deterministic.js";
import { type History, appendDay, peakInfections, seriesOf, startHistory } from "./history.js";
import { type CompiledModel, type Rates, SeirdCompartment, compileModel, ratesFor } from "./model.js";
import type { Network } from "./network.js";
import { type PathogenProfile, Population, getPathogen } from "./pathogens/index.js";
import type { Pathogen } from "./pathogens/types.js";
import { buildPopulationNetwork, indexCaseOrder, luckSeed, seededIndexCases, seededVaccinated, vaccinatedCount, vaccinationOrder } from "./population.js";
import { availableFeatures, pathogenParams, solveTransmission } from "./presets.js";
import { estimateR0 } from "./r0.js";
import { type Random, seededRandom, randomSeed } from "./random.js";
import { reproductionCurve } from "./reproduction.js";
import { type ModelFeatures, type SeirdModel, type SeirdModelParams, seirdModel, seirdParams } from "./seird.js";
import { type EpidemicState, createEpidemic, infectedCount, advanceEpidemic } from "./stochastic.js";

export interface OutbreakOptions {
    /**
     * A built-in pathogen (`Pathogen.Measles`), or your own (`createPathogen({ … })`, or a changed copy of a built-in
     * one). Omit it to set everything with `params` and `r0` (or `params.beta`).
     */
    pathogen?: Pathogen | PathogenProfile;
    /** Whose fatality rate and vaccine coverage to use. Default `Population.All` (the pathogen's base group). */
    population?: Population;
    /** People in the network. Default 10,000. */
    people?: number;
    /** Average everyday contacts per person. Default: the pathogen's; 3 without one. */
    contacts?: number;
    /** Seeds the network, who starts infected and the run's luck: the same options replay the same outbreak. Default: random. */
    seed?: number;
    /** Who starts infected: how many (seeded people with contacts), or which people. Default 1. */
    initialCases?: number | number[];
    /** Include the latent (exposed) period. Default true. */
    latentPeriod?: boolean;
    /** Immunity after recovery wanes, so people can be infected again. Needs the pathogen's data. Default false. */
    waning?: boolean;
    /** Vaccinate a share of people before the outbreak. Needs the pathogen's data (or `vaccineCoverage`). Default false. */
    vaccination?: boolean;
    /** Individual variation in infectiousness and contacts (dispersion k). Needs the pathogen's data (or `dispersion`). Default false. */
    superspreading?: boolean;
    /** The basic reproduction number to set the transmission rate by. Default: the pathogen's published R₀. */
    r0?: number;
    /** With superspreading: the dispersion k of offspring counts to aim for. Default: the pathogen's. */
    dispersion?: number;
    /** With vaccination: the share of people vaccinated (0–1). Default: the pathogen's coverage for `population`. */
    vaccineCoverage?: number;
    /** Model parameters to use instead of the pathogen's (e.g. `{ ifr: 0 }`). */
    params?: Partial<SeirdModelParams>;
    /** The area people are placed in (see `buildPopulationNetwork`). */
    world?: { width: number; height: number };
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

/** Days `run()` simulates at most, unless told otherwise: an outbreak near R₀ = 1 can smoulder for years. */
export const DEFAULT_MAX_DAYS = 3650;
/** Mixed into the seed for measuring the network's reproduction curve. */
const REPRODUCTION_SALT = 0x2545f491;
/** Without a pathogen: contacts per person, and superspreading's dispersion k. */
const DEFAULT_CONTACTS = 3;
const DEFAULT_DISPERSION = 0.3;

/** A stochastic outbreak on a contact network: set up from options, advanced a day at a time. */
export class Outbreak {
    /** The pathogen's data, or null when the parameters were set by hand. */
    readonly pathogen: PathogenProfile | null;
    readonly seed: number;
    readonly features: ModelFeatures;
    readonly model: SeirdModel;
    readonly network: Network;
    /** The parameters in effect, with the transmission rate (`beta`) solved for `r0` on this network. */
    readonly params: SeirdModelParams;
    readonly r0: number;
    /** Who started infected, and who was vaccinated before the outbreak. */
    readonly indexCases: number[];
    readonly vaccinated: number[];

    private readonly compiled: CompiledModel;
    private readonly rates: Rates;
    private readonly random: Random;
    private readonly epidemic: EpidemicState;
    private record: History;

    constructor(options: OutbreakOptions = {}) {
        const pathogen = typeof options.pathogen === "string" ? getPathogen(options.pathogen) : (options.pathogen ?? null);
        const population = options.population ?? Population.All;
        const people = options.people ?? 10_000;
        const seed = options.seed ?? randomSeed();
        const available = availableFeatures(pathogen);
        const preset = pathogen ? pathogenParams(pathogen, population) : {};
        const { contacts: pathogenContacts, vaccineCoverage: pathogenCoverage, dispersion: pathogenDispersion, ...pathogenModelParams } = preset;
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
        const contacts = options.contacts ?? pathogenContacts ?? DEFAULT_CONTACTS;
        const network = buildPopulationNetwork({ seed, people, contacts, world: options.world, superspreading: features.superspreading });
        const model = seirdModel(features);
        const base = seirdParams({ ...pathogenModelParams, ...options.params });
        const reproduction = reproductionCurve(network, seededRandom(seed ^ REPRODUCTION_SALT));
        const r0 = options.r0 ?? pathogen?.values.r0.value ?? null;
        const solved = solveTransmission({
            model,
            params: base,
            reproduction,
            r0,
            dispersion: features.superspreading ? (options.dispersion ?? pathogenDispersion ?? DEFAULT_DISPERSION) : null,
        });
        const params: SeirdModelParams = { ...base, beta: solved.beta, dispersion: solved.dispersion && solved.dispersion > 0 ? solved.dispersion : null };

        const initial = options.initialCases ?? 1;
        const indexCases = Array.isArray(initial) ? initial : seededIndexCases(indexCaseOrder(seed, people), network, initial);
        const coverage = options.vaccineCoverage ?? pathogenCoverage ?? 0;
        const vaccinated = features.vaccination ? seededVaccinated(vaccinationOrder(seed, people), indexCases, vaccinatedCount(coverage, people)) : [];

        this.pathogen = pathogen;
        this.seed = seed;
        this.features = features;
        this.model = model;
        this.network = network;
        this.params = params;
        this.r0 = r0 ?? estimateR0(model, params, reproduction);
        this.compiled = compileModel(model) as CompiledModel;
        this.rates = ratesFor(model, params);
        this.random = seededRandom(luckSeed(seed, 0));
        this.epidemic = createEpidemic(model, network, indexCases, vaccinated, this.random);
        this.indexCases = this.epidemic.indexCases;
        this.vaccinated = vaccinated;
        this.record = startHistory(this.epidemic.counts, this.infected);
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
     * The deterministic reference: the same model and R₀ in a well-mixed population, averaged over chance, for `days`
     * days (default: as long as the outbreak has run, at least a year). On a network outbreaks usually run ahead of it
     * (see `calibrateTheory` to time it to the network).
     */
    theory(days = Math.max(365, this.day)): Theory {
        return deterministicCurve(this.model, this.params, this.r0, this.network.count, this.indexCases.length, days, this.vaccinated.length);
    }
}
