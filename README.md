# epidemic-engine

[![CI](https://github.com/VictorKaraboychev/epidemic-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorKaraboychev/epidemic-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Stochastic epidemics on contact networks of up to a million people, with a deterministic reference curve, and
pathogens set from published estimates, every value cited.

- **Realistic populations**: households of census sizes, uneven everyday contacts, distant contacts, and gatherings
  for superspreading.
- **Eleven pathogens** from COVID-19 to Ebola, with R₀, latent and infectious periods, fatality by population group,
  immunity and vaccines from the literature. Or your own parameters.
- **SEIRD with options**: latent period, gradually waning immunity, vaccination, superspreading (dispersion k).
- **Fast and reproducible**: event-driven; a million people take about 1.5 s to build and a whole outbreak among them
  under a second. The same seed replays the same outbreak.
- **Validated**: simulated outbreaks are checked against the published R₀, generation intervals and dispersion.
- Pure TypeScript with type declarations, ES modules, one small dependency (pure-rand). Runs in Node 20+ and browsers
  (put it in a Web Worker for large networks).

## Install

Not on npm yet; install from GitHub (it builds on install):

```bash
npm install github:VictorKaraboychev/epidemic-engine
```

## Quick start

```ts
import { Outbreak, Pathogen, SeirdCompartment } from "epidemic-engine";

const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 1 });
const summary = outbreak.run();
// { days: 88, over: true, everInfected: 20000, attackRate: 1, deaths: 42, peak: { day: 47, infected: 17421 } }

outbreak.count(SeirdCompartment.Recovered); // people recovered at the end
outbreak.series(SeirdCompartment.Infected); // infected people, day by day
outbreak.theory(); // the deterministic reference curve
```

## Examples

**Options.** `Outbreak` takes its parameters from the pathogen's published estimates; every option can override them.

```ts
import { Outbreak, Pathogen, Population } from "epidemic-engine";

new Outbreak({
    pathogen: Pathogen.CovidAncestral,
    population: Group.Elderly, // whose fatality rate and vaccine coverage to use
    people: 100_000,
    initialCases: 5, // or the people to start with: [12, 345]
    vaccination: true, // also `waning` and `superspreading`, where the pathogen has the data
    params: { ifr: 0 }, // any model parameter
    seed: 7,
});
```

**Your own pathogen.** `new Pathogen({ … })` takes plain numbers; it works anywhere a built-in one does. Each optional
part switches on its feature: `latentDays` the latent period, `immunity` waning, `vaccine` vaccination, `dispersion`
superspreading.

```ts
import { Outbreak, Pathogen, Population } from "epidemic-engine";

const myFlu = new Pathogen({
    id: "my-flu",
    r0: 1.8,
    latentDays: 2,
    infectiousDays: 5,
    ifr: 0.001,
    immunity: { halfLife: 365 }, // or { lifelong: true }
    vaccine: { efficacy: 0.6, coverage: 0.4, halfLife: 180 },
});
new Outbreak({ pathogen: myFlu, vaccination: true, waning: true }).run();

// Or change a built-in one:
new Outbreak({ pathogen: Pathogen.Measles.with({ contacts: 12 }) });
```

**Reading a pathogen.** Each one has its data and what follows from it:

```ts
Pathogen.Measles.r0; // 15
Pathogen.Measles.features; // { exposed: true, waning: true, vaccination: true, superspreading: true }
Pathogen.CovidAncestral.fatalityRate(Group.Elderly); // 0.046
Pathogen.Measles.vaccineCoverage(); // 0.77
Pathogen.Measles.params(); // the model parameters it sets
Pathogen.Measles.values.r0; // { value: 15, citation: "guerra-2017", interval: { low: 12, high: 18, kind: "range" } }
Pathogen.get("measles"); // by id, e.g. from a URL (`PathogenId.Measles`)
Pathogen.all; // every built-in one
```

The transmission rate is always solved for `r0` on the network. For a one-off, skip the pathogen and pass `r0` and
`params` to `Outbreak` directly.

**Day by day.** `step()` advances a day (or several) and keeps every day's counts.

```ts
const outbreak = new Outbreak({ pathogen: Pathogen.InfluenzaA, people: 50_000, initialCases: 10 });
while (!outbreak.isOver && outbreak.day < 365) {
    outbreak.step();
    console.log(outbreak.day, outbreak.infected);
}
```

**Comparing interventions.** The same seed gives the same people and contacts, so only the intervention differs.

```ts
const attackRate = (vaccination: boolean) => new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 3, vaccination }).run().attackRate;
attackRate(false); // 1: everyone
attackRate(true); // ≈ 0.25: 77% of children have two doses
```

**Who infected whom.** `outbreak.state` has each person's compartment (`states`), infector (`infectedBy`) and
number of people infected (`offspring`); `outbreak.network` has their positions and contacts.

## Pathogens

| `Pathogen.`      | R₀   | Latent | Infectious             | Fatality (base group)    | Waning | Vaccine | Superspreading |
| ---------------- | ---- | ------ | ---------------------- | ------------------------ | ------ | ------- | -------------- |
| `CovidAncestral` | 2.79 | 5.5 d  | 8 d                    | 0.47% per infection      | ✓      | ✓       | ✓              |
| `CovidOmicron`   | 9.5  | 2.7 d  | 8 d                    | 0.1% per infection       | ✓      | ✓       | ✓              |
| `InfluenzaA`     | 1.28 | 1.6 d  | 5 d                    | 0.07% per illness        | ✓      | ✓       |                |
| `InfluenzaB`     | 1.23 | 0.6 d  | 5 d                    | 0.07% per illness        | ✓      | ✓       |                |
| `Rsv`            | 3    | 3 d    | 6.4 d                  | 0.31% per illness, < 5s  | ✓      | ✓       |                |
| `Measles`        | 15   | 10 d   | 8 d                    | 0.15% per case, children | ✓      | ✓       | ✓              |
| `Pertussis`      | 5.5  | 8 d    | 15 d                   | 0.12% per case           | ✓      | ✓       | ✓              |
| `Mpox`           | 1.94 | 7.6 d  | 21 d                   | 0.08% per case, GBMSM    |        | ✓       | ✓              |
| `Sars`           | 2.7  | 4.6 d  | 26.5 d (fatal: 23.7 d) | 9.6% per case            |        |         | ✓              |
| `Mers`           | 0.47 | 5 d    | 14 d (fatal: 11.5 d)   | 37% per case             |        |         | ✓              |
| `Ebola`          | 1.83 | 11.4 d | 16.4 d (fatal: 7.5 d)  | 50% per case             |        | ✓       | ✓              |

Every value is cited (`Pathogen.Measles.values` has them with their sources, intervals and caveats;
`Pathogen.Measles.citations` lists the sources). Your own pathogens don't need sources. Fatality rates are
also given for population groups (`Group.Elderly`, `Group.Infants`, …) where published. A pathogen without
the data for a feature throws if you ask for it.

## API

`Outbreak` is a thin layer over functions you can use directly, e.g. to define your own compartmental model:

| Area        | Main exports                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start here  | `Outbreak`, `OutbreakOptions`, `OutbreakSummary`                                                                                                                                |
| Pathogens   | `Pathogen` (`Pathogen.Measles`, `new Pathogen({ … })`, `.with()`, `.params()`, `.features`, `.fatalityRate()`, `.citations`), `PathogenId`, `Population`, `CITATIONS`, `Caveat` |
| Populations | `buildPopulationNetwork` (households, everyday and distant contacts, optional gatherings), `buildNetwork`, seeded `indexCaseOrder` / `vaccinationOrder`                         |
| Models      | `seirdModel` (SEIRD with optional waning immunity and vaccination), `seirdParams`, `SeirdCompartment`, or any `CompartmentModel`                                                |
| Runs        | `solveTransmission`, `createEpidemic` + `advanceEpidemic` (event-driven) or `stepEpidemic`, `deterministicCurve`, `calibrateTheory`                                             |
| Measures    | `estimateR0`, `reproductionCurve`, `infectionTimeline`, `outbreakSummary`, the daily `History`                                                                                  |
| Randomness  | `seededRandom`, `randomSeed`                                                                                                                                                    |

Conventions: times are in days; shares are 0–1; lifelong protection and flat infectiousness are `Infinity`. Ids are
enums (`PathogenId.Measles`, `Group.Elderly`, `Caveat.Proxy`); a UI supplies the words. A `Pathogen` is a class:
to send one to a worker, send its id or `pathogen.profile()` (plain data) and rebuild it there.

## The model

The engine follows standard practice for stochastic network models, and checks its outbreaks against the literature each pathogen cites. Every published period is used as published:

- **Stays** (latent, infectious) are gamma-distributed per person, not memoryless (Wearing, Rohani & Keeling 2005): shape 4 by default, and each pathogen's latent variability comes from its incubation period's (`latentVariation`, e.g. 0.21 for measles, 0.8 for Ebola).
- **Infectiousness profile**: people are most infectious early in their infectious period, halving every `infectiousnessHalfLife` days (`Infinity`: flat). Each pathogen's half-life is fitted so simulated generation intervals match the published ones (Wallinga & Lipsitch 2007), keeping the published latent and infectious periods (a `fitted` caveat; `validation/calibrate.test.ts` reproduces the fit). `infectionTimeline` gives the resulting course of an infection by day since exposure.
- **Population network**: households of census sizes (US 2024), all members linked and exposed 3.5× as intensely as other contacts (Madewell et al. 2020); uneven contact numbers as in contact diaries (CV ≈ 0.74; Fu et al. 2012, POLYMOD); nearest-neighbour community contacts plus 18% distant ones (Fu et al. 2012). With superspreading, a few people have very many contacts (gatherings).
- **Event-driven**: rather than rolling every day for every infectious person's every contact, when someone becomes infectious the day they'd first infect each contact (or never, within their stay) is drawn at once from the same daily chances, and each stay's end is known on entry; a day handles only what happens on it (Kiss, Miller & Simon 2017). Outbreaks are the same in distribution (final size, peak, timing and die-out rates match the daily version), and a million-person outbreak runs 1.7× (8-day infectious periods) to 3.7× (21-day) faster, quiet days about 15×.
- **Theory curve**: the deterministic reference treats people exactly as the simulation does, only averaged (each stay's whole-day gamma distribution and the infectiousness profile, by days since entering), with the same R₀. On a contact network people are often exposed by several infectious contacts at once and the first one infects them, so infections follow each other faster than the disease's own timeline (generation-interval contraction, Kenah, Lipsitch & Robins 2008): measles' realized generation interval is ≈ 11.7 days, as published, against ≈ 15.5 for the timeline alone. `measureEarlyGrowth` and `calibrateTheory` correct for this on networks of 2,000 people or more: a dozen quick outbreaks on the network itself measure its pace, and the reference keeps its R₀ but runs its stages at that pace from the measured start. Peaks then line up within ≈ 2–6% for every pathogen (up to 18% late without it, for measles and pertussis); a single run can still lead or lag by luck in its first cases. (`Outbreak.theory()` gives the uncorrected curve.)
- **R₀** is the network's measured reproduction: early epidemics are run on each network (`reproductionCurve`), and the transmission rate is solved against that curve (`solveTransmission`) rather than the tree-like formula T × excess degree, which overstates R on a clustered network.
- **Superspreading**: Lloyd-Smith et al.'s k is the total unevenness, so the network's own (measured with the reproduction curve) is taken out and individual infectiousness supplies the rest.
- **Protection** after vaccination or infection is all-or-nothing per person, and people infected anyway carry cited protection against death and onward spread.

`npm run validate` runs every preset on 20,000 people and checks the early reproduction number against R₀, the generation interval against the published one, and superspreading's dispersion against the published k's interval (under a minute). Known gaps are documented in each pathogen's file: where a flat profile already gives a shorter interval than published (RSV, measles, pertussis, MERS), infectiousness stays flat, and pertussis's simulated interval stays about half its published serial interval. `AUDIT=1` prints the same measurements without assertions.

## Develop

```bash
npm install          # also builds dist/
npm test             # unit tests (Vitest)
npm run typecheck
npm run format       # Prettier (CI checks it with format:check)
npm run build        # dist/: ES modules with type declarations and source maps
npm run validate     # every pathogen on 20,000 people, against the literature (under a minute)
```

CI runs the checks on Node 20, 22 and 24, and the validation, on every pull request.

Pathogens live in `src/pathogens/`, one file of data each (checked with `satisfies PathogenProfile`), with an id in
`PathogenId` and a static member on `Pathogen`. Every published value is `cited(value, citationId, details?)`, citing an entry in
`src/pathogens/citations.ts`; `pathogens.test.ts` checks every value is cited and inside its published interval.

## Data and citations

The pathogen values (R₀, periods, fatality, vaccine efficacy and coverage, household sizes, contact patterns) are
published estimates, each cited to its source in `src/pathogens/citations.ts`. They are facts reported by those
sources, reproduced as numbers with references, not copies of the publications. If you use them in your own work,
cite the original sources, not this package. They describe particular populations and periods (see each pathogen's
file and caveats), so they are illustrative, not guidance for public health decisions.

## Authors

- Victor Karaboychev: design and implementation
- Ziyuan Zhang: epidemiological theory

## License

The code is [MIT](./LICENSE). The cited publications remain their authors' and publishers' own.
