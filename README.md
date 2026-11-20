# epidemic-engine

[![CI](https://github.com/VictorKaraboychev/epidemic-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/VictorKaraboychev/epidemic-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Stochastic epidemics on contact networks of up to a million people, with a deterministic reference curve, and
pathogens set from published estimates, every value cited.

- **People modelled explicitly**: each person has an age from the census, lives in a household of census size and
  has everyday contacts as uneven as in contact diaries; fatality follows each person's age.
- **Eleven pathogens** from COVID-19 to Ebola, with R₀, latent and infectious periods, fatality by age, immunity and
  vaccines from the literature, and where each was measured. Or your own.
- **SEIRD with options**: latent period, gradually waning immunity, vaccination, superspreading (dispersion k).
- **Many runs and uncertainty**: medians and 95% ranges over hundreds of runs, optionally drawing each run's values
  from their published intervals.
- **Fast and reproducible**: event-driven; a million people take about 2 s to set up and an outbreak among them under
  a second. The same seed replays the same outbreak.
- **Validated**: simulated outbreaks are checked against the published R₀, generation intervals and dispersion.
- Pure TypeScript with type declarations, ES modules, one small dependency (pure-rand). Node 20+ and browsers (put
  it in a Web Worker for large populations).

## Install

Not on npm yet; install a release from GitHub (it builds on install):

```bash
npm install github:VictorKaraboychev/epidemic-engine#v0.2.0
```

## Quick start

```ts
import { Outbreak, Pathogen, SeirdCompartment } from "epidemic-engine";

const outbreak = new Outbreak({ pathogen: Pathogen.Measles, people: 20_000, seed: 1 });
outbreak.run();
// { days: 88, over: true, everInfected: 20000, attackRate: 1, deaths: 42, peak: { day: 47, infected: 17421 } }

outbreak.count(SeirdCompartment.Recovered); // people recovered at the end
outbreak.series(SeirdCompartment.Infected); // infected people, day by day
outbreak.theory({ calibrated: true }); // the deterministic reference, timed to this network
```

## Examples

**Many runs.** One stochastic run says little; `runOutbreaks` runs many on one population and sums them up,
separating the outbreaks that took off from those that fizzled.

```ts
import { runOutbreaks } from "epidemic-engine";

const result = runOutbreaks({ pathogen: Pathogen.CovidAncestral, people: 20_000, runs: 100, seed: 1 });
result.fizzled; // 0.04: the share that died out early
result.major!.deaths; // { median: 205, low: 178, high: 233, mean: 205 }: the middle 95% of runs
runOutbreaks({ pathogen: Pathogen.CovidAncestral, people: 20_000, runs: 100, uncertainty: true }); // values drawn from their published intervals too
```

**Options.** Every value comes from the pathogen's published estimates, and every option can override them.

```ts
import { Group } from "epidemic-engine";

new Outbreak({
    pathogen: Pathogen.CovidAncestral,
    people: 100_000,
    initialCases: 5, // or the people to start with: [12, 345]
    vaccination: true, // also `waning` and `superspreading`, where the pathogen has the data
    params: { infectiousDays: 10, immunity: { halfLife: 180 } }, // any model parameter
    seed: 7,
});
new Outbreak({ pathogen: Pathogen.Mpox, group: Group.Gbmsm }); // one group's figures for everyone, instead of by age
```

**Your own pathogen.** `new Pathogen({ … })` takes plain numbers; it works anywhere a built-in one does. Each optional
part switches on its feature: `latentDays` the latent period, `immunity` waning, `vaccine` vaccination, `dispersion`
superspreading.

```ts
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

new Outbreak({ pathogen: Pathogen.Measles.with({ contacts: 12 }) }); // or change a built-in one
```

**Interventions.** `setParams()` changes parameters from the next day. Halving transmission on day 30 (COVID-19,
50,000 people) cuts the share infected from 89% to 57%:

```ts
const outbreak = new Outbreak({ pathogen: Pathogen.CovidAncestral, people: 50_000, initialCases: 10 });
outbreak.step(30);
outbreak.setParams({ beta: outbreak.params.beta / 2 });
outbreak.run();
```

**Reading a pathogen.** Each has its data and what follows from it:

```ts
Pathogen.Measles.r0; // 15
Pathogen.Measles.features; // { exposed: true, waning: true, vaccination: true, superspreading: true }
Pathogen.CovidAncestral.fatalityAt(80); // 0.085: by age
Pathogen.Measles.vaccineCoverage(); // 0.77
Pathogen.Measles.values.r0; // { value: 15, citation: "guerra-2017", interval: { low: 12, high: 18, kind: "range" } }
Pathogen.Measles.params(); // the model parameters it sets
Pathogen.get("measles"); // by id, e.g. from a URL (`PathogenId.Measles`)
Pathogen.all; // every built-in one
```

**Who infected whom.** `outbreak.state` has each person's compartment (`states`), infector (`infectedBy`) and number
of people infected (`offspring`); `outbreak.population` has their ages and `outbreak.network` their contacts.

## The population

A `Population` is built from a `PopulationProfile`, by default `US_2024`, and `describe()` says how:

```ts
import { Population } from "epidemic-engine";

const population = new Population({ people: 50_000, seed: 1 });
population.describe();
// 50,000 people, modelled on United States, 2024.
// Ages: drawn from single-year counts [census-ages-2024], every household with an adult.
// Households: 21,144, of the sizes given [census-households-2024]; infection passes 3.5× as readily within them [madewell-2020].
// Contacts: 8 each on average, mostly neighbours, 18% with anyone [fu-2012], uneven as in contact diaries [fu-2012].
new Outbreak({ pathogen: Pathogen.CovidAncestral, population }); // reuse it across outbreaks
```

- **Ages**: each person's age in whole years, drawn from the US Census Bureau's 2024 single-year estimates. One
  member of every household is drawn from the adults (18+), the rest from what that leaves, so every household has an
  adult and the population as a whole still matches the census.
- **Households**: of US census sizes (table HH-4, 2024), everyone in one linked to everyone else in it, and infection
  passes 3.5× as readily within them (secondary attack rates of 16.6% vs 4.8%; Madewell et al. 2020).
- **Everyday contacts**: people are placed in an area and linked to their nearest neighbours, 18% of contacts instead
  with anyone (Fu et al. 2012); how many contacts people have varies as in contact diaries (coefficient of variation
  ≈ 0.74; Fu et al. 2012, as POLYMOD finds across Europe). With superspreading, it varies far more: gatherings.
- **Fatality by age**: in an age band a pathogen's data covers, that band's rate; between rates published at single
  ages (COVID-19: 1, 25, 55, 75), log-linear, as fatality rises roughly exponentially with age (Levin et al. 2020),
  extended ten years past the oldest and then held; otherwise the overall rate. Deaths in the same COVID-19 outbreak
  among 50,000 people: 500 by age, 2,050 if everyone had the elderly's rate.
- **Vaccination by age**, where coverage was published by age (RSV: 75 and over only); otherwise everyone at the
  pathogen's coverage.
- Contacts don't depend on age (households mix ages; schools and workplaces aren't modelled), and transmission
  doesn't either.

For another country or setting, write a `PopulationProfile` with its own age counts, household sizes and contact
data.

## Pathogens

| `Pathogen.`      | R₀   | Latent | Infectious             | Fatality (overall)       | By age | Waning | Vaccine | Superspreading |
| ---------------- | ---- | ------ | ---------------------- | ------------------------ | ------ | ------ | ------- | -------------- |
| `CovidAncestral` | 2.79 | 5.5 d  | 8 d                    | 0.47% per infection      | ✓      | ✓      | ✓       | ✓              |
| `CovidOmicron`   | 9.5  | 2.7 d  | 8 d                    | 0.1% per infection       | ✓      | ✓      | ✓       | ✓              |
| `InfluenzaA`     | 1.28 | 1.6 d  | 5 d                    | 0.07% per illness        | ✓      | ✓      | ✓       |                |
| `InfluenzaB`     | 1.23 | 0.6 d  | 5 d                    | 0.07% per illness        | ✓      | ✓      | ✓       |                |
| `Rsv`            | 3    | 3 d    | 6.4 d                  | 0.31% per illness, < 5s  |        | ✓      | ✓       |                |
| `Measles`        | 15   | 10 d   | 8 d                    | 0.15% per case, children |        | ✓      | ✓       | ✓              |
| `Pertussis`      | 5.5  | 8 d    | 15 d                   | 0.12% per case           | partly | ✓      | ✓       | ✓              |
| `Mpox`           | 1.94 | 7.6 d  | 21 d                   | 0.08% per case, GBMSM    |        |        | ✓       | ✓              |
| `Sars`           | 2.7  | 4.6 d  | 26.5 d (fatal: 23.7 d) | 9.6% per case            | ✓      |        |         | ✓              |
| `Mers`           | 0.47 | 5 d    | 14 d (fatal: 11.5 d)   | 37% per case             | ✓      |        |         | ✓              |
| `Ebola`          | 1.83 | 11.4 d | 16.4 d (fatal: 7.5 d)  | 50% per case             |        |        | ✓       | ✓              |

Every value is cited (`Pathogen.Measles.values` has them with their sources, intervals, caveats and the setting they
were measured in; `Pathogen.Measles.citations` lists the sources). Fatality is by each person's age where the data
has it; `group` picks one group's rate (`Group.Elderly`, `Group.Gbmsm`, …) for everyone. A pathogen without the data
for a feature throws if you ask for it. Your own pathogens don't need sources.

## API

| Import                     | What                                                                                                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `epidemic-engine`          | `Outbreak`, `runOutbreaks`, `Pathogen` (and `PathogenId`, `Group`, `Caveat`, …), `Population` and `US_2024`, `seirdModel` and its parameters, `SeirdCompartment`, history readers (`seriesOf`, `peakInfections`), `infectionTimeline`, `seededRandom`, `VERSION`            |
| `epidemic-engine/advanced` | Everything, building blocks included: networks, compartmental models (`CompartmentModel`, `ratesFor`), `createEpidemic` + `advanceEpidemic`, `deterministicCurve`, `calibrateTheory`, `solveTransmission`, `estimateR0`, the seeded choices and the pathogen data's helpers |

Conventions: times are in days; shares are 0–1; lifelong protection and flat infectiousness are `Infinity`. Ids are
enums (`PathogenId.Measles`, `Group.Elderly`, `Caveat.Proxy`); a UI supplies the words. A `Pathogen` is a class: to
send one to a worker, send its id or `pathogen.profile()` (plain data) and rebuild it there.

## The model

The engine follows standard practice for stochastic network models, and checks its outbreaks against the literature each pathogen cites. Every published period is used as published:

- **Stays** (latent, infectious) are gamma-distributed per person, not memoryless (Wearing, Rohani & Keeling 2005): shape 4 by default, and each pathogen's latent variability comes from its incubation period's (`latentVariation`, e.g. 0.21 for measles, 0.8 for Ebola).
- **Infectiousness profile**: people are most infectious early in their infectious period, halving every `infectiousnessHalfLife` days (`Infinity`: flat). Each pathogen's half-life is fitted so simulated generation intervals match the published ones (Wallinga & Lipsitch 2007), keeping the published latent and infectious periods (a `fitted` caveat; `validation/calibrate.test.ts` reproduces the fit). `infectionTimeline` gives the resulting course of an infection by day since exposure.
- **Population**: see [The population](#the-population).
- **Event-driven**: rather than rolling every day for every infectious person's every contact, when someone becomes infectious the day they'd first infect each contact (or never, within their stay) is drawn at once from the same daily chances, and each stay's end is known on entry; a day handles only what happens on it (Kiss, Miller & Simon 2017). Outbreaks are the same in distribution (final size, peak, timing and die-out rates match the daily version), and a million-person outbreak runs 1.7× (8-day infectious periods) to 3.7× (21-day) faster, quiet days about 15×.
- **Theory curve**: the deterministic reference treats people exactly as the simulation does, only averaged (each stay's whole-day gamma distribution and the infectiousness profile, by days since entering), with the same R₀. On a contact network people are often exposed by several infectious contacts at once and the first one infects them, so infections follow each other faster than the disease's own timeline (generation-interval contraction, Kenah, Lipsitch & Robins 2008): measles' realized generation interval is ≈ 11.7 days, as published, against ≈ 15.5 for the timeline alone. `measureEarlyGrowth` and `calibrateTheory` correct for this on networks of 2,000 people or more: a dozen quick outbreaks on the network itself measure its pace, and the reference keeps its R₀ but runs its stages at that pace from the measured start. Peaks then line up within ≈ 2–6% for every pathogen (up to 18% late without it, for measles and pertussis); a single run can still lead or lag by luck in its first cases. (`Outbreak.theory()` gives the uncorrected curve.)
- **R₀** is the network's measured reproduction: early epidemics are run on each network (`reproductionCurve`), and the transmission rate is solved against that curve (`solveTransmission`) rather than the tree-like formula T × excess degree, which overstates R on a clustered network.
- **Superspreading**: Lloyd-Smith et al.'s k is the total unevenness, so the network's own (measured with the reproduction curve) is taken out and individual infectiousness supplies the rest.
- **Protection** after vaccination or infection is all-or-nothing per person, and people infected anyway carry cited protection against death and onward spread.

`npm run validate` runs every pathogen on 20,000 people and checks the early reproduction number against R₀, the generation interval against the published one, and superspreading's dispersion against the published k's interval (under a minute). Known gaps are documented in each pathogen's file: where a flat profile already gives a shorter interval than published (RSV, measles, pertussis, MERS), infectiousness stays flat, and pertussis's simulated interval stays about half its published serial interval. `AUDIT=1` prints the same measurements without assertions.

## Versions

The package follows [semantic versioning](https://semver.org/); while it's 0.x, a minor version can break the API
(the main entry least, `/advanced` more often). Changes are in [CHANGELOG.md](./CHANGELOG.md), and each release is a
tag with a [GitHub release](https://github.com/VictorKaraboychev/epidemic-engine/releases). To release one: add its
section to the changelog, then

```bash
npm version minor        # or patch / major: bumps package.json and VERSION, commits and tags
git push --follow-tags   # the Release workflow checks it and publishes the GitHub release
```

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
`PathogenId` and a static member on `Pathogen`. Every published value is `cited(value, citationId, details?)`, citing
an entry in `src/pathogens/citations.ts`; `pathogens.test.ts` checks every value is cited and inside its published
interval. Population profiles live in `src/populations/`.

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
