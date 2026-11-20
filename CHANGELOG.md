# Changelog

All notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the package follows [semantic versioning](https://semver.org/): while it is 0.x, a minor version (0.2 → 0.3) can
break the API, and a patch version (0.2.0 → 0.2.1) doesn't.

## [0.2.0] - 2026-11-20

### Added

- `Outbreak`: one outbreak from a pathogen in a line (`new Outbreak({ pathogen: Pathogen.Measles }).run()`), with
  `step()`, `count()`, `series()`, `summary()`, `theory({ calibrated })` (the reference curve, optionally timed to the
  network), `setParams()` (change parameters mid-run, e.g. a lockdown) and replays (`run`).
- `runOutbreaks`: many outbreaks on one population, summed up as medians and middle 95% over all runs and over those
  that took off, and the share that fizzled; `uncertainty: true` draws each run's pathogen values from their
  published intervals (`Pathogen.sample`).
- `Pathogen` class: built-in pathogens as static members (`Pathogen.Measles`), your own with `new Pathogen({ … })`
  from plain numbers, `with()` for a changed copy, and `params()`, `features`, `fatalityRate()`, `fatalityAt(age)`,
  `vaccineCoverage()`, `vaccineCoverageAt(age)`, `citations`, `r0`, `profile()`.
- `Population` class, built from a `PopulationProfile` (`Population.US_2024` by default, every input cited; figures as
  plain numbers or cited, contact unevenness as a coefficient of variation, met at any number of contacts) or from
  your own data (`new Population({ network, ages })`, `Population.fromContacts`, `networkFromContacts`): each person has an
  age from the 2024 census estimates (every household with an adult), households of census sizes, uneven and distant
  contacts, and gatherings with superspreading; `describe()` says how it's modelled.
- Fatality by each person's age (published age bands, or log-linear between published ages) and vaccination by age
  where coverage is published by age.
- Enums for ids and kinds: `PathogenId`, `Group`, `Caveat`, `IntervalKind`, `Bound`, `PopulationKind`,
  `FatalityMeasure`, `EdgeKind`, `SeirdCompartment`.
- Data: a `setting` on cited values (where and when they were measured), `year` and `doi` on citations, age ranges
  on population groups.
- `epidemic-engine/advanced`: every building block, for your own models and runs.
- `VERSION`, this changelog, and CI on Node 20, 22 and 24 with the literature validation.

### Changed

- **Breaking.** The main entry exports what most uses need (28 runtime names); the rest moved to
  `epidemic-engine/advanced`.
- **Breaking.** Names: `Disease` → `PathogenProfile`, `simulationModel` → `seirdModel`, `SimulationModelParams` →
  `SeirdModelParams`, `buildSimulationNetwork` → `buildPopulationNetwork`, `mulberry32` → `seededRandom`,
  `diseaseIfr` → `fatalityRate`, `recoveryDays` / `deathDays` → `infectiousDays` / `fatalInfectiousDays`; the
  population groups enum is `Group` (`Population` is now the class).
- **Breaking.** Protection parameters are grouped: `immunity: { halfLife, delay, deathProtection, spreadProtection }`
  and `vaccine: { efficacy, … }` instead of `immunityHalfLife`, `vaccineEfficacy` and the like.
- **Breaking.** Seeded randomness uses pure-rand's xoroshiro128+ (period 2¹²⁸ − 1) instead of mulberry32 (2³²), so
  every seed gives a different outbreak than in 0.1.0; networks no longer draw a radius per person.
- `randomSeed()` returns any 32-bit integer; `superspreaders`, `outbreakSummary` and `infectionTimeline` take their
  display limits as options.

### Removed

- App-specific choices: `hidden` pathogens and `Pathogen.visible`, citation numbering (`CITATION_ORDER`,
  `citationNumber`), `MAX_POPULATION_GROUPS`, `DEFAULT_POPULATION`, `effectivePopulation`, and each person's dot radius
  (`Network.r`, `NODE_RADIUS`).
- `definePathogen`, `getPathogen`, `PATHOGENS` and `createPathogen` (see the `Pathogen` class).

## [0.1.0] - 2026-11-19

### Added

- The epidemic simulator's engine as a package: contact networks of up to a million people, compartmental models,
  the event-driven stochastic run, the deterministic reference, R₀ on a network, and eleven pathogens with cited data.

[0.2.0]: https://github.com/VictorKaraboychev/epidemic-engine/compare/54fb946...v0.2.0
[0.1.0]: https://github.com/VictorKaraboychev/epidemic-engine/tree/54fb946
