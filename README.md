# epidemic-engine

Stochastic epidemics on contact networks of up to a million people, with a deterministic reference curve, and
pathogens set from published estimates, every value cited. Pure TypeScript, no dependencies, runs in Node and
browsers (put it in a Web Worker for large networks).

## Use

```ts
import { Outbreak, Pathogen, Population, SeirdCompartment } from "epidemic-engine";

const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 1 });
const summary = outbreak.run(); // { days, over, everInfected, attackRate, deaths, peak: { day, infected } }

outbreak.count(SeirdCompartment.Recovered); // people recovered today
outbreak.series(SeirdCompartment.Infected); // infected people, day by day
outbreak.theory(); // the deterministic reference curve
```

`Outbreak` takes its parameters from the pathogen's published estimates; every option can override them:

```ts
new Outbreak({
    pathogen: Pathogen.CovidAncestral,
    population: Population.Elderly, // whose fatality rate and vaccine coverage
    people: 100_000,
    initialCases: 5,
    vaccination: true, // also `waning`, `superspreading`, where the pathogen has the data
    params: { ifr: 0 }, // any model parameter
});

// No pathogen: your own disease, with the transmission rate solved for R₀ on the network.
new Outbreak({ r0: 2.5, params: { latentDays: 3, recoveryDays: 7, deathDays: 7, ifr: 0.01 } });
```

Step a day at a time with `outbreak.step()`, or read the full state (`outbreak.state`: each person's compartment, who
infected whom) for anything the summary doesn't give.

### The pieces

`Outbreak` is a thin layer over functions you can use directly, e.g. to define your own compartmental model:

| Area        | Main exports                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pathogens   | `Pathogen`, `Population`, `getPathogen`, `pathogenParams`, `availableFeatures`, `PATHOGENS`, `CITATIONS`, `citationsOf`, `Caveat`                       |
| Populations | `buildPopulationNetwork` (households, everyday and distant contacts, optional gatherings), `buildNetwork`, seeded `indexCaseOrder` / `vaccinationOrder` |
| Models      | `seirdModel` (SEIRD with optional waning immunity and vaccination) and `seirdParams`, or any `CompartmentModel`                                         |
| Runs        | `solveTransmission`, `createEpidemic` + `advanceEpidemic` (event-driven) or `stepEpidemic`, `deterministicCurve`, `calibrateTheory`                     |
| Measures    | `estimateR0`, `reproductionCurve`, `infectionTimeline`, `outbreakSummary`, the daily `History`                                                          |

Conventions: times are in days; shares are 0–1; lifelong protection and flat infectiousness are `Infinity`. The
engine names things by enum (`Pathogen.Measles`, `Population.Elderly`, `Caveat.Proxy`); a UI supplies the words.

## Develop

```bash
npm install
npm test            # unit tests (Vitest)
npm run typecheck
npm run build       # dist/: ES modules with type declarations and source maps
npm run validate    # every preset on 20,000 people, against the literature (a few minutes)
```

Pathogens live in `src/pathogens/`, one file each (`definePathogen`), listed in `pathogens/index.ts` with its id in
the `Pathogen` enum. Every published value is `cited(value, citationId, details?)`, citing an entry in
`src/pathogens/citations.ts`; `pathogens.test.ts` checks every value is cited and inside its published interval.

## The model and its validation

The simulator follows standard practice for stochastic network models, and checks its outbreaks against the literature each preset cites. Every published period is used as published:

- **Stays** (latent, infectious) are gamma-distributed per person, not memoryless (Wearing, Rohani & Keeling 2005): shape 4 by default, and each disease's latent variability comes from its incubation period's (`latentVariation`, e.g. 0.21 for measles, 0.8 for Ebola).
- **Infectiousness profile**: people are most infectious early in their infectious period, halving every `infectiousnessHalfLife` days (`Infinity`: flat). Each preset's half-life is fitted so simulated generation intervals match the published ones (Wallinga & Lipsitch 2007), keeping the published latent and infectious periods (a `fitted` caveat; `validation/calibrate.test.ts` reproduces the fit). The Periods info tooltip charts the resulting infectiousness by day after infection (`epidemic-engine/src/profile.ts`).
- **Population network**: households of census sizes (US 2024), all members linked and exposed 3.5× as intensely as other contacts (Madewell et al. 2020); uneven contact numbers as in contact diaries (CV ≈ 0.74; Fu et al. 2012, POLYMOD); nearest-neighbour community contacts plus 18% distant ones (Fu et al. 2012). With superspreading, a few people have very many contacts (gatherings).
- **Event-driven**: rather than rolling every day for every infectious person's every contact, when someone becomes infectious the day they'd first infect each contact (or never, within their stay) is drawn at once from the same daily chances, and each stay's end is known on entry; a day handles only what happens on it (Kiss, Miller & Simon 2017). Outbreaks are the same in distribution (final size, peak, timing and die-out rates match the daily version), and a million-person outbreak runs 1.7× (8-day infectious periods) to 3.7× (21-day) faster, quiet days about 15×.
- **Theory curve**: the deterministic reference treats people exactly as the simulation does, only averaged (each stay's whole-day gamma distribution and the infectiousness profile, by days since entering), with the same R₀. On a contact network people are often exposed by several infectious contacts at once and the first one infects them, so infections follow each other faster than the disease's own timeline (generation-interval contraction, Kenah, Lipsitch & Robins 2008): measles' realized generation interval is ≈ 11.7 days, as published, against ≈ 15.5 for the timeline alone. So on networks of 2,000 people or more, the worker runs a dozen quick outbreaks on the network itself (`growth.ts`), and the reference keeps its R₀ but runs its stages at the measured pace from the measured start. Peaks then line up within ≈ 2–6% for every preset (they were up to 18% late for measles and pertussis); a single run can still lead or lag by luck in its first cases.
- **R₀** is the network's measured reproduction: the worker runs early epidemics on each network (`epidemic-engine/src/reproduction.ts`), and the transmission rate is solved against that curve rather than the tree-like formula T × excess degree, which overstates R on a clustered network.
- **Superspreading**: Lloyd-Smith et al.'s k is the total unevenness, so the network's own (measured with the reproduction curve) is taken out and individual infectiousness supplies the rest.
- **Protection** after vaccination or infection is all-or-nothing per person, and people infected anyway carry cited protection against death and onward spread.

`npm run validate` runs every preset on 20,000 people and checks the early reproduction number against R₀, the generation interval against the published one, and superspreading's dispersion against the published k's interval (a few minutes). Known gaps are documented in each disease's file: where a flat profile already gives a shorter interval than published (RSV, measles, pertussis, MERS), infectiousness stays flat, and pertussis's simulated interval stays about half its published serial interval. `AUDIT=1` prints the same measurements without assertions.

## Data and citations

The pathogen values (R₀, periods, fatality, vaccine efficacy and coverage, household sizes, contact patterns) are
published estimates, each cited to its source in `src/pathogens/citations.ts`. They are facts reported by those
sources, reproduced as numbers with references, not copies of the publications. If you use them in your own work,
cite the original sources, not this package. They describe particular populations and periods (see each disease's
file and caveats), so they are illustrative, not guidance for public health decisions.

## Authors

- Victor Karaboychev: design and implementation
- Ziyuan Zhang: epidemiological theory

## License

The code is [MIT](./LICENSE). The cited publications remain their authors' and publishers' own.
