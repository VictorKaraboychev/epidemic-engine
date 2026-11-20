/**
 * epidemic-engine: stochastic epidemics on contact networks of up to a million people, with a deterministic
 * reference, and pathogens set from published estimates (every value cited). No UI; one small dependency (pure-rand).
 *
 * - Start here: `Outbreak` (one outbreak) and `runOutbreaks` (many, summed up).
 * - Pathogens: `Pathogen` (`Pathogen.Measles`, `new Pathogen({ … })` for your own), `Group`, `CITATIONS`.
 * - People: `Population` (ages, households, contacts; `US_2024` by default).
 * - Model: `seirdModel` and its parameters, `SeirdCompartment`.
 * - Results: `History` and its readers, the reference curve (`Theory`), `infectionTimeline`.
 *
 * The building blocks behind these are in `epidemic-engine/advanced`.
 */
export { DEFAULT_MAX_DAYS, DEFAULT_PEOPLE, Outbreak, type OutbreakOptions, type OutbreakSummary, type TheoryOptions } from "./outbreak.js";
export { MAJOR_OUTBREAK_SHARE, runOutbreaks, type EnsembleMeasures, type EnsembleOptions, type EnsembleResult, type Spread } from "./ensemble.js";
export { Pathogen } from "./pathogens/pathogen.js";
export {
    type AgeRange,
    Bound,
    CITATIONS,
    Caveat,
    type Citation,
    type CitationId,
    type Cited,
    FatalityMeasure,
    Group,
    type Interval,
    IntervalKind,
    PathogenId,
    type PathogenProfile,
    type PathogenSpec,
    type PathogenValues,
    type PopulationGroup,
    PopulationKind,
    type Populations,
    type Protection,
    type ProtectionSpec,
    type Vaccination,
} from "./pathogens/index.js";
export { DEFAULT_CONTACTS, Population, type PopulationOptions, type PopulationProfile, US_2024 } from "./population.js";
export {
    type ModelFeatures,
    type ProtectionParams,
    type SeirdModel,
    type SeirdModelParams,
    type VaccineParams,
    seirdModel,
    seirdParams,
    withParams,
} from "./seird.js";
export { SeirdCompartment } from "./model.js";
export { EdgeKind, type Network } from "./network.js";
export { type History, countsOn, peakInfections, seriesOf } from "./history.js";
export type { Theory } from "./deterministic.js";
export { infectionTimeline } from "./profile.js";
export { type Random, randomSeed, seededRandom } from "./random.js";
