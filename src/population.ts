/**
 * The people an outbreak spreads through, modelled explicitly from a `PopulationProfile` (by default the United
 * States in 2024, every input cited), or taken from your own data (`new Population({ network, ages })`,
 * `Population.fromContacts`):
 * - **Ages**: each person has an age in whole years, drawn from single-year counts. Every household has at least one
 *   adult (18 or over): one member of each is drawn from the adults, the rest from the ages that leaves, so the
 *   population as a whole still matches the counts.
 * - **Households**: of the given sizes, everyone in one linked to everyone else in it, and infection passes within
 *   them more readily (`households.transmission`).
 * - **Everyday contacts**: people are placed in an area and linked to their nearest neighbours, a share of contacts
 *   instead with anyone (`contacts.distantShare`). How many contacts people have varies at random, so that contacts
 *   per person have the given coefficient of variation (`contacts.cv`). With `superspreading`, they vary far more: a
 *   few people at gatherings meet very many.
 * Who meets whom doesn't depend on age beyond households: there are no schools or workplaces, and no contact matrix.
 */
import { type Network, buildNetwork, degreeOf, networkFromContacts } from "./network.js";
import type { CitationId } from "./pathogens/citations.js";
import type { Cited } from "./pathogens/types.js";
import { US_2024 } from "./populations/us-2024.js";
import { type Random, randomSeed, seededRandom } from "./random.js";

/** A figure in a profile: a plain number, or a cited one (`cited(3.5, "madewell-2020")`). */
export type Figure = number | Cited;

/** Where and how people live and meet: the data a `Population` is built from. */
export interface PopulationProfile {
    name: string;
    /** People by single year of age, from 0; the last count is that age and older. Without it, people have no age. */
    ages?: { counts: number[]; citation?: CitationId };
    /** The share of households with 1, 2, 3, … people (the last: that many or more), and how much more readily infection passes within one. */
    households?: { shares: number[]; citation?: CitationId; transmission: Figure };
    contacts: {
        /** How uneven contacts per person are: their coefficient of variation (standard deviation ÷ mean), households included. */
        cv: Figure;
        /** The share of contacts with anyone rather than neighbours (0–1). */
        distantShare: Figure;
    };
}

export { US_2024 };

/** A profile figure's number. */
export const figureValue = (figure: Figure) => (typeof figure === "number" ? figure : figure.value);
/** A profile figure's source, if it has one. */
export const figureSource = (figure: Figure | { citation?: CitationId }): CitationId | undefined => (typeof figure === "number" ? undefined : figure.citation);

/** Everyday contacts per person when not given: mid-range for the built-in pathogens (3 to 20). */
export const DEFAULT_CONTACTS = 8;
/** The area people are placed in when no `world` is given (16:9; it only affects positions and who neighbours whom). */
export const DEFAULT_WORLD = { width: 1600, height: 900 } as const;
/** The youngest adult age: every household has someone this age or older. */
export const ADULT_AGE = 18;
/**
 * Contact unevenness with superspreading: each person's share of the usual number of contacts is gamma-distributed
 * with this shape (coefficient of variation √10 ≈ 3.2), so a few have many times the usual. A modelling choice
 * reflecting that how many people others meet varies widely (Mossong et al. 2008), not a fitted value.
 */
export const GATHERING_VARIATION = 0.1;

/** Share of the area the spacing discs may cover; spacing shrinks on small areas to fit everyone. */
const PACKING = 0.38;
/** Spacing between people on roomy areas (world units). */
const MAX_NODE_SPACING = 30;
/** Longest contact link at full spacing and `BASE_CONTACTS` contacts each (more contacts reach further). */
const BASE_EDGE_LENGTH = 88;
const BASE_CONTACTS = 3;
/** Mixed into the seed for drawing ages, independent of the network's draw. */
const AGE_SALT = 0x27d4eb2f;
/** People in the small networks that find the random variation giving a profile's `cv` (see `contactShapeFor`). */
const PILOT_PEOPLE = 4000;
const PILOT_SEED = 0x51ed27;

export interface PopulationBuildOptions {
    /** People in the network. */
    people: number;
    /** Average everyday contacts per person (households included). Default `DEFAULT_CONTACTS`. */
    contacts?: number;
    /** Same seed, same people. Default: random. */
    seed?: number;
    /** Where and how people live and meet. Default `Population.US_2024`. */
    profile?: PopulationProfile;
    /** The area people are placed in, in world units (a view scales it to the screen). Default `DEFAULT_WORLD`. */
    world?: { width: number; height: number };
    /** Superspreading's gatherings: contact numbers vary far more, so a few people meet very many. Default false. */
    superspreading?: boolean;
}

/** Your own people: who meets whom (`networkFromContacts` makes one from pairs), and their ages if you have them. */
export interface PopulationData {
    network: Network;
    /** Each person's age in whole years (0–255). */
    ages?: ArrayLike<number> | null;
    /** What to call it in `describe()`. */
    name?: string;
    /** Seeds the outbreaks run on it. Default: random. */
    seed?: number;
}

export type PopulationOptions = PopulationBuildOptions | PopulationData;

/** Equal keys build equal networks (for one profile). */
export const networkKey = ({ seed, world = DEFAULT_WORLD, people, contacts = DEFAULT_CONTACTS, superspreading = false }: PopulationBuildOptions) =>
    `${seed}:${world.width}x${world.height}:${people}:${contacts}:${superspreading ? 1 : 0}`;

/** Spacing that fits everyone into the area. */
const nodeSpacing = (width: number, height: number, people: number) =>
    Math.min(MAX_NODE_SPACING, Math.sqrt((PACKING * 4 * width * height) / (Math.PI * people)));

/** Draws an index from cumulative weights (the last is the total). */
const drawFrom = (cumulative: Float64Array, random: Random) => {
    const target = random() * cumulative[cumulative.length - 1];
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (cumulative[middle] > target) high = middle;
        else low = middle + 1;
    }
    return low;
};

const cumulativeOf = (weights: number[]) => {
    let total = 0;
    return Float64Array.from(weights, (weight) => (total += weight));
};

/**
 * Each person's age: one member of every household (the first in index order; people outside households count as
 * their own) from the adult ages, everyone else from what that leaves of the distribution, so the whole population
 * matches it.
 */
export const drawAges = (people: number, householdOf: ArrayLike<number> | undefined, counts: number[], seed: number): Uint8Array => {
    const random = seededRandom(seed ^ AGE_SALT);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const adults = counts.reduce((sum, count, age) => sum + (age >= ADULT_AGE ? count : 0), 0);
    const heads = new Uint8Array(people);
    let headCount = 0;
    const seen = new Uint8Array(people);
    for (let person = 0; person < people; person++) {
        const household = householdOf ? householdOf[person] : -1;
        if (household >= 0 && seen[household]) continue;
        if (household >= 0) seen[household] = 1;
        heads[person] = 1;
        headCount++;
    }
    const headShare = headCount / Math.max(1, people);
    // Adults left for the other members: what heads haven't taken, in proportion (heads are under the adult share).
    const adultsLeft = Math.max(0, 1 - (headShare * total) / Math.max(1, adults));
    const headAges = cumulativeOf(counts.map((count, age) => (age >= ADULT_AGE ? count : 0)));
    const otherAges = cumulativeOf(counts.map((count, age) => (age >= ADULT_AGE ? count * adultsLeft : count)));
    const ages = new Uint8Array(people);
    for (let person = 0; person < people; person++) ages[person] = drawFrom(heads[person] ? headAges : otherAges, random);
    return ages;
};

/** The coefficient of variation of contacts per person (degree) on a network. */
export const contactCv = (network: Pick<Network, "count" | "offsets">) => {
    let sum = 0;
    let squares = 0;
    for (let person = 0; person < network.count; person++) {
        const degree = degreeOf(network, person);
        sum += degree;
        squares += degree * degree;
    }
    const mean = sum / network.count;
    return Math.sqrt(Math.max(0, squares / network.count - mean * mean)) / mean;
};

interface Built {
    network: Network;
    ages: Uint8Array | null;
}

/** Builds the network with this random variation of contact numbers, and draws ages for its households. */
const build = ({ seed, world, people, contacts, profile }: Required<Omit<PopulationBuildOptions, "superspreading">>, variation: number): Built => {
    const spacing = nodeSpacing(world.width, world.height, people);
    const network = buildNetwork(seededRandom(seed), {
        width: world.width,
        height: world.height,
        count: people,
        minDistance: spacing,
        neighbours: contacts,
        // Denser networks need a longer reach so every node can find its nearest contacts.
        maxEdgeLength: BASE_EDGE_LENGTH * (spacing / MAX_NODE_SPACING) * Math.sqrt(Math.max(1, contacts / BASE_CONTACTS)),
        contactVariation: variation,
        distantShare: figureValue(profile.contacts.distantShare),
        ...(profile.households ? { households: { sizes: profile.households.shares, weight: figureValue(profile.households.transmission) } } : {}),
    });
    return { network, ages: profile.ages ? drawAges(people, network.householdOf, profile.ages.counts, seed) : null };
};

const shapes = new Map<string, number>();
/** Gamma shapes searched for a profile's `cv`, from very uneven to nearly even. */
const SHAPE_RANGE = [0.02, 200] as const;

/**
 * The random variation (gamma shape of each person's share of the usual contacts) that gives a profile's `cv` with
 * this many contacts each, found by building small pilot networks (households included) and searching; cached. A
 * `cv` below what households alone give gets nearly even contacts otherwise.
 */
export const contactShapeFor = (profile: PopulationProfile, contacts: number): number => {
    const target = figureValue(profile.contacts.cv);
    const key = JSON.stringify([target, contacts, profile.contacts.distantShare, profile.households]);
    const cached = shapes.get(key);
    if (cached !== undefined) return cached;
    const pilot = (shape: number) => contactCv(build({ seed: PILOT_SEED, world: DEFAULT_WORLD, people: PILOT_PEOPLE, contacts, profile }, shape).network);
    let [low, high] = SHAPE_RANGE.map(Math.log);
    let shape: number;
    if (pilot(Math.exp(high)) >= target) shape = Math.exp(high);
    else if (pilot(Math.exp(low)) <= target) shape = Math.exp(low);
    else {
        for (let step = 0; step < 16; step++) {
            const middle = (low + high) / 2;
            if (pilot(Math.exp(middle)) > target) low = middle;
            else high = middle;
        }
        shape = Math.exp((low + high) / 2);
    }
    shapes.set(key, shape);
    return shape;
};

/** The contact network for these options (see the module comment); the same options always draw the same one. */
export const buildPopulationNetwork = (options: PopulationBuildOptions): Network => buildPeople(options).network;

const buildPeople = ({
    seed = randomSeed(),
    world = DEFAULT_WORLD,
    people,
    contacts = DEFAULT_CONTACTS,
    superspreading = false,
    profile = US_2024,
}: PopulationBuildOptions): Built =>
    build({ seed, world, people, contacts, profile }, superspreading ? GATHERING_VARIATION : contactShapeFor(profile, contacts));

/** A population: its people, their ages and the network of who meets whom. See the module comment for the model. */
export class Population {
    /** The United States in 2024 (the default profile): census ages and households, cited contact patterns. */
    static readonly US_2024: PopulationProfile = US_2024;
    /** Every built-in profile. */
    static readonly profiles: readonly PopulationProfile[] = [US_2024];

    /**
     * Your own people from a list of who meets whom: pairs `[a, b]` of people numbered from 0, optionally each person's
     * household (-1: none) and how much more readily infection passes within one, and their ages.
     */
    static fromContacts({
        people,
        contacts,
        households,
        householdTransmission,
        ...rest
    }: {
        people: number;
        contacts: Iterable<readonly [number, number]>;
        households?: ArrayLike<number>;
        householdTransmission?: number;
    } & Omit<PopulationData, "network">): Population {
        return new Population({ ...rest, network: networkFromContacts(people, contacts, { householdOf: households, householdWeight: householdTransmission }) });
    }

    readonly people: number;
    /** Contacts per person on average. */
    readonly contacts: number;
    readonly seed: number;
    /** The profile it was built from, or null for your own data. */
    readonly profile: PopulationProfile | null;
    readonly superspreading: boolean;
    readonly world: { width: number; height: number };
    /** Who meets whom (positions, contacts, households). */
    readonly network: Network;
    /** Each person's age in years (the profile's last age means that age or older); null without ages. */
    readonly ages: Uint8Array | null;
    /** What it's called in `describe()`. */
    readonly name: string;

    constructor(options: PopulationOptions) {
        if ("network" in options) {
            const { network, ages, name = "your data", seed = randomSeed() } = options;
            if (ages && ages.length !== network.count) throw new RangeError(`ages has ${ages.length} people, the network ${network.count}`);
            this.people = network.count;
            this.contacts = network.offsets[network.count] / Math.max(1, network.count);
            this.seed = seed;
            this.profile = null;
            this.superspreading = false;
            this.world = { width: network.width, height: network.height };
            this.network = network;
            this.ages = ages ? Uint8Array.from(ages) : null;
            this.name = name;
            return;
        }
        const { people, contacts = DEFAULT_CONTACTS, seed = randomSeed(), profile = US_2024, superspreading = false, world = DEFAULT_WORLD } = options;
        if (!(people >= 1 && Number.isInteger(people))) throw new RangeError(`people must be a whole number of at least 1, not ${people}`);
        if (!(contacts >= 1)) throw new RangeError(`contacts must be at least 1, not ${contacts}`);
        this.people = people;
        this.contacts = Math.round(contacts);
        this.seed = seed;
        this.profile = profile;
        this.superspreading = superspreading;
        this.world = world;
        const built = buildPeople({ people, contacts: this.contacts, seed, profile, superspreading, world });
        this.network = built.network;
        this.ages = built.ages;
        this.name = profile.name;
    }

    /** A person's age (null without ages). */
    ageOf(person: number): number | null {
        return this.ages ? this.ages[person] : null;
    }

    /** How many people are aged `from` to `to` (inclusive). */
    countAged(from: number, to = Infinity): number {
        if (!this.ages) return 0;
        let count = 0;
        for (const age of this.ages) if (age >= from && age <= to) count++;
        return count;
    }

    /** How many households there are (0 without households). */
    get households(): number {
        const households = this.network.householdOf;
        if (!households) return 0;
        let most = -1;
        for (const household of households) if (household > most) most = household;
        return most + 1;
    }

    /** How the population is modelled, in plain words, with each input's source ("your data" where it has none). */
    describe(): string[] {
        const source = (figure: Figure | { citation?: CitationId }) => `[${figureSource(figure) ?? "your data"}]`;
        const people = this.people.toLocaleString("en");
        const profile = this.profile;
        if (!profile)
            return [
                `${people} people from ${this.name}.`,
                `Contacts: ${this.contacts.toFixed(1)} each on average (coefficient of variation ${contactCv(this.network).toFixed(2)}).`,
                this.ages ? "Ages: given for each person." : "Ages: none.",
                this.network.householdOf ? `Households: ${this.households.toLocaleString("en")}, given.` : "Households: none.",
            ];
        const lines = [`${people} people, modelled on ${profile.name}.`];
        if (profile.ages) lines.push(`Ages: drawn from single-year counts ${source(profile.ages)}, every household with an adult.`);
        if (profile.households)
            lines.push(
                `Households: ${this.households.toLocaleString("en")}, of the sizes given ${source(profile.households)}; ` +
                    `infection passes ${figureValue(profile.households.transmission)}× as readily within them ${source(profile.households.transmission)}.`,
            );
        const { cv, distantShare } = profile.contacts;
        lines.push(
            `Contacts: ${this.contacts} each on average, mostly neighbours, ${Math.round(figureValue(distantShare) * 100)}% with anyone ${source(distantShare)}; ` +
                (this.superspreading
                    ? "far more uneven than everyday life, with gatherings (superspreading)."
                    : `as uneven as a coefficient of variation of ${figureValue(cv)} ${source(cv)}.`),
        );
        return lines;
    }
}
