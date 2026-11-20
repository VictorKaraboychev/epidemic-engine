/**
 * A pathogen: its data and what can be read from it. The built-in ones are static members (`Pathogen.Measles`), every
 * value cited; make your own with `new Pathogen({ … })` from plain numbers, or change a built-in one with `with()`.
 */
import { type PathogenParams, availableFeatures, pathogenParams } from "../presets.js";
import type { ModelFeatures } from "../seird.js";
import type { CitationId } from "./citations.js";
import { type PathogenSpec, profileFromSpec } from "./custom.js";
import { COVID_ANCESTRAL } from "./covid-ancestral.js";
import { COVID_OMICRON } from "./covid-omicron.js";
import { EBOLA } from "./ebola.js";
import { INFLUENZA_A } from "./influenza-a.js";
import { INFLUENZA_B } from "./influenza-b.js";
import { citationsOf, fatalityRate, simulatedCoverage } from "./index.js";
import { MEASLES } from "./measles.js";
import { MERS } from "./mers.js";
import { MPOX } from "./mpox.js";
import { PERTUSSIS } from "./pertussis.js";
import { RSV } from "./rsv.js";
import { SARS } from "./sars.js";
import { type PathogenId, type PathogenProfile, type PathogenValues, Population, type Populations, type Protection, type Vaccination } from "./types.js";

export class Pathogen implements PathogenProfile {
    static readonly CovidAncestral = new Pathogen(COVID_ANCESTRAL);
    static readonly CovidOmicron = new Pathogen(COVID_OMICRON);
    static readonly InfluenzaA = new Pathogen(INFLUENZA_A);
    static readonly InfluenzaB = new Pathogen(INFLUENZA_B);
    static readonly Rsv = new Pathogen(RSV);
    static readonly Measles = new Pathogen(MEASLES);
    static readonly Pertussis = new Pathogen(PERTUSSIS);
    static readonly Mpox = new Pathogen(MPOX);
    static readonly Sars = new Pathogen(SARS);
    static readonly Mers = new Pathogen(MERS);
    static readonly Ebola = new Pathogen(EBOLA);

    /** Every built-in pathogen. */
    static readonly all: readonly Pathogen[] = [
        Pathogen.CovidAncestral,
        Pathogen.CovidOmicron,
        Pathogen.InfluenzaA,
        Pathogen.InfluenzaB,
        Pathogen.Rsv,
        Pathogen.Measles,
        Pathogen.Pertussis,
        Pathogen.Mpox,
        Pathogen.Sars,
        Pathogen.Mers,
        Pathogen.Ebola,
    ];

    /** A built-in pathogen by id (e.g. from a URL). Throws for an unknown one. */
    static get(id: PathogenId | string): Pathogen {
        const pathogen = Pathogen.all.find((candidate) => candidate.id === id);
        if (!pathogen) throw new Error(`Unknown pathogen "${id}"`);
        return pathogen;
    }

    /** A `PathogenId` for the built-in ones; any name for your own. */
    readonly id: string;
    readonly values: PathogenValues;
    readonly contacts: number;
    readonly immunity?: Protection;
    readonly populations: Populations;
    readonly vaccination?: Vaccination;

    /**
     * Your own pathogen from plain numbers (`{ id, r0, recoveryDays, latentDays?, ifr?, immunity?, vaccine?, … }`; see
     * `PathogenSpec`), or from full data (`PathogenProfile`, with sources).
     */
    constructor(data: PathogenSpec | PathogenProfile) {
        const profile = "values" in data ? data : profileFromSpec(data);
        this.id = profile.id;
        this.values = profile.values;
        this.contacts = profile.contacts;
        this.populations = profile.populations;
        if (profile.immunity) this.immunity = profile.immunity;
        if (profile.vaccination) this.vaccination = profile.vaccination;
    }

    /** A copy with some data changed: `Pathogen.Measles.with({ contacts: 12 })`. */
    with(changes: Partial<PathogenProfile>): Pathogen {
        return new Pathogen({ ...this.profile(), ...changes });
    }

    /** Its data as a plain object (e.g. to send to a worker, where class instances lose their methods). */
    profile(): PathogenProfile {
        return {
            id: this.id,
            values: this.values,
            contacts: this.contacts,
            populations: this.populations,
            ...(this.immunity ? { immunity: this.immunity } : {}),
            ...(this.vaccination ? { vaccination: this.vaccination } : {}),
        };
    }

    /** The basic reproduction number. */
    get r0(): number {
        return this.values.r0.value;
    }

    /** The model features it has data for (a latent period, waning immunity, vaccination, superspreading). */
    get features(): ModelFeatures {
        return availableFeatures(this);
    }

    /** Its sources, in the order its values cite them. */
    get citations(): CitationId[] {
        return citationsOf(this);
    }

    /** The model parameters it sets for a population group (lifelong protection and flat infectiousness: `Infinity`). */
    params(population: Population = Population.All): Partial<PathogenParams> {
        return pathogenParams(this, population);
    }

    /** The share of infections (or illnesses, or cases: see `populations.measure`) that are fatal, for a group. */
    fatalityRate(population: Population = Population.All): number {
        return fatalityRate(this, population);
    }

    /** The share vaccinated before an outbreak, for a group; null without a vaccine. */
    vaccineCoverage(population: Population = Population.All): number | null {
        return simulatedCoverage(this, population)?.value ?? null;
    }
}
