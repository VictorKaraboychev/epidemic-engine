import { describe, expect, it } from "vitest";
import { Outbreak } from "./outbreak.js";
import { Group } from "./pathogens/index.js";
import { Pathogen } from "./pathogens/pathogen.js";
import { ADULT_AGE, Population, US_2024, contactCv } from "./population.js";

const census = US_2024.ages!.counts;
const censusShare = (from: number, to: number) => census.slice(from, to + 1).reduce((a, b) => a + b, 0) / census.reduce((a, b) => a + b, 0);

describe("Population", () => {
    const population = new Population({ people: 40_000, seed: 3 });

    it("gives everyone an age, matching the census as a whole", () => {
        expect(population.ages).toHaveLength(40_000);
        for (const [from, to] of [
            [0, 4],
            [5, 17],
            [18, 49],
            [50, 64],
            [65, 100],
        ])
            expect(population.countAged(from, to) / 40_000, `${from}–${to}`).toBeCloseTo(censusShare(from, to), 2);
    });

    it("puts an adult in every household", () => {
        const { householdOf } = population.network;
        const hasAdult = new Map<number, boolean>();
        population.ages!.forEach((age, person) => {
            const household = householdOf![person];
            hasAdult.set(household, (hasAdult.get(household) ?? false) || age >= ADULT_AGE);
        });
        expect([...hasAdult.values()].every(Boolean)).toBe(true);
        expect(population.households).toBe(hasAdult.size);
    });

    it("is the same for the same seed, and says how it's modelled", () => {
        expect(new Population({ people: 40_000, seed: 3 }).ages).toEqual(population.ages);
        const description = population.describe().join(" ");
        expect(description).toMatch(/census-ages-2024/);
        expect(description).toMatch(/madewell-2020/);
        expect(description).toMatch(/fu-2012/);
    });

    it("has the built-in profiles as static members, the US in 2024 by default", () => {
        expect(Population.US_2024).toBe(US_2024);
        expect(Population.profiles).toContain(Population.US_2024);
        expect(new Population({ people: 2000, seed: 1, profile: Population.US_2024 }).ages).toEqual(new Population({ people: 2000, seed: 1 }).ages);
    });

    it("can be built without ages or households", () => {
        const plain = new Population({ people: 1000, seed: 1, profile: { name: "plain", contacts: US_2024.contacts } });
        expect(plain.ages).toBeNull();
        expect(plain.network.householdOf).toBeUndefined();
        expect(() => new Population({ people: 0 })).toThrow(/people/);
    });
});

describe("your own population", () => {
    it("takes plain numbers in a profile, and reaches its contacts' coefficient of variation at any number of contacts", () => {
        const profile = {
            name: "Even village",
            households: { shares: [0.2, 0.3, 0.3, 0.2], transmission: 3 },
            contacts: { cv: 0.4, distantShare: 0.05 },
        };
        for (const contacts of [4, 12]) expect(contactCv(new Population({ people: 8000, contacts, seed: 2, profile }).network)).toBeCloseTo(0.4, 1);
        expect(contactCv(new Population({ people: 8000, contacts: 6, seed: 2 }).network)).toBeCloseTo(0.74, 1);
        const description = new Population({ people: 1000, seed: 2, profile }).describe().join(" ");
        expect(description).toMatch(/3× as readily within them \[your data\]/);
        expect(description).toMatch(/coefficient of variation of 0.4 \[your data\]/);
        expect(description).not.toMatch(/contact diaries/);
    });

    it("can be your own contacts and ages, and runs outbreaks like any other", () => {
        // A ring of 300 people, each knowing the next three, in households of three, all aged 40.
        const pairs: [number, number][] = [];
        for (let person = 0; person < 300; person++) for (let step = 1; step <= 3; step++) pairs.push([person, (person + step) % 300]);
        const households = Array.from({ length: 300 }, (_, person) => Math.floor(person / 3));
        const ring = Population.fromContacts({
            people: 300,
            contacts: pairs,
            households,
            householdTransmission: 2,
            ages: new Array(300).fill(40),
            name: "a ring",
        });
        expect(ring.people).toBe(300);
        expect(ring.contacts).toBe(6);
        expect(ring.households).toBe(100);
        expect(ring.profile).toBeNull();
        expect(ring.describe()[0]).toBe("300 people from a ring.");
        const outbreak = new Outbreak({ pathogen: Pathogen.CovidAncestral, population: ring, seed: 1, initialCases: 3 });
        expect(outbreak.params.ifr).toBeCloseTo(Pathogen.CovidAncestral.fatalityAt(40), 6);
        expect(outbreak.run().everInfected).toBeGreaterThan(3);
        expect(() => Population.fromContacts({ people: 3, contacts: [[0, 5]] })).toThrow(/outside/);
        expect(() => new Population({ network: ring.network, ages: [1, 2] })).toThrow(/ages/);
    });
});

describe("fatality and vaccination by age", () => {
    it("follow each person's age where the pathogen has age data", () => {
        const population = new Population({ people: 20_000, seed: 5, contacts: 6 });
        const covid = new Outbreak({ pathogen: Pathogen.CovidAncestral, population, seed: 5 });
        const ages = population.ages!;
        const mean = ages.reduce((sum, age) => sum + Pathogen.CovidAncestral.fatalityAt(age), 0) / ages.length;
        expect(covid.params.ifr).toBeCloseTo(mean, 6);
        // One rate for everyone when a group is chosen.
        expect(new Outbreak({ pathogen: Pathogen.CovidAncestral, population, group: Group.Elderly }).params.ifr).toBe(0.046);
    });

    it("kill the old far more often than the young", () => {
        const population = new Population({ people: 30_000, seed: 6 });
        const outbreak = new Outbreak({ pathogen: Pathogen.CovidAncestral, population, seed: 6, initialCases: 20 });
        outbreak.run();
        const { states } = outbreak.state;
        const died = outbreak.model.compartments.findIndex((compartment) => compartment.dead);
        const rate = (from: number, to: number) => {
            let infected = 0;
            let dead = 0;
            population.ages!.forEach((age, person) => {
                if (age < from || age > to || !outbreak.state.everInfected[person]) return;
                infected++;
                if (states[person] === died) dead++;
            });
            return dead / infected;
        };
        expect(rate(75, 100)).toBeGreaterThan(rate(0, 49) * 20);
    });

    it("vaccinate only the ages a vaccine's coverage was published for (RSV: 75 and over)", () => {
        const population = new Population({ people: 20_000, seed: 7 });
        const rsv = new Outbreak({ pathogen: Pathogen.Rsv, population, vaccination: true });
        const ages = rsv.vaccinated.map((person) => population.ages![person]);
        expect(Math.min(...ages)).toBeGreaterThanOrEqual(75);
        expect(rsv.vaccinated.length / population.countAged(75)).toBeCloseTo(0.397, 2);
    });
});
