/**
 * epidemic-engine: stochastic epidemics on contact networks of up to a million people, with a deterministic
 * reference, and pathogens set from published estimates (every value cited). No UI and no dependencies.
 *
 * - Pathogens: `DISEASES`, `getDisease`, `diseaseParams` (a disease's parameters for a population), `CITATIONS`.
 * - Populations: `buildSimulationNetwork` (households, everyday and distant contacts, gatherings), or `buildNetwork`.
 * - Models: `simulationModel` (SEIRD, with waning immunity and vaccination as options), or your own `CompartmentModel`.
 * - Runs: `solveTransmission` (the rate for a published R₀ on a network), `createEpidemic` + `advanceEpidemic` (a day
 *   at a time, event-driven), `deterministicCurve` (the averaged reference) and `calibrateTheory` (timed to the network).
 * - Measures: `estimateR0`, `infectionTimeline`, `outbreakSummary`, the daily `History`.
 */
export * from "./deterministic.js";
export * from "./diseases/index.js";
export * from "./growth.js";
export * from "./history.js";
export * from "./model.js";
export * from "./network.js";
export * from "./population.js";
export * from "./presets.js";
export * from "./profile.js";
export * from "./r0.js";
export * from "./random.js";
export * from "./reproduction.js";
export * from "./seird.js";
export * from "./spatial-grid.js";
export * from "./stochastic.js";
export * from "./superspreading.js";
