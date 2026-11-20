/**
 * The people an outbreak spreads through, modelled explicitly from a `PopulationProfile` (by default the United
 * States in 2024, every input cited):
 * - **Ages**: each person has an age in whole years, drawn from the census's single-year counts. Every household has
 *   at least one adult (18 or over): one member of each is drawn from the adults, the rest from the ages that leaves,
 *   so the population as a whole still matches the census.
 * - **Households**: of census sizes, everyone in one linked to everyone else in it, and infection passes within them
 *   more readily (`households.transmission`).
 * - **Everyday contacts**: people are placed in an area and linked to their nearest neighbours, a share of contacts
 *   instead with anyone (`contacts.distantShare`), and how many contacts people have varies as in contact diaries
 *   (`contacts.variation`). With `superspreading`, it varies far more: a few people at gatherings meet very many.
 */
import { type Network, buildNetwork } from "./network.js";
import type { CitationId } from "./pathogens/citations.js";
import type { Cited } from "./pathogens/types.js";
import { US_2024 } from "./populations/us-2024.js";
import { type Random, randomSeed, seededRandom } from "./random.js";

/** Where and how people live and meet: the data a `Population` is built from. */
export interface PopulationProfile {
    name: string;
    /** People by single year of age, from 0; the last count is that age and older. Without it, people have no age. */
    ages?: { counts: number[]; citation?: CitationId };
    /** The share of households with 1, 2, 3, … people (the last: that many or more), and how much more readily infection passes within one. */
    households?: { shares: number[]; citation?: CitationId; transmission: Cited };
    contacts: {
        /** Gamma shape of how many contacts each person seeks, relative to the mean (smaller: more uneven). */
        variation: Cited;
        /** The share of contacts with anyone rather than neighbours. */
        distantShare: Cited;
    };
}

export { US_2024 };

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

export interface PopulationNetworkOptions {
    /** People in the network. */
    people: number;
    /** Average everyday contacts per person (households included). Default `DEFAULT_CONTACTS`. */
    contacts?: number;
    /** Same seed, same network. Default: random. */
    seed?: number;
    /** Where and how people live and meet. Default `US_2024`. */
    profile?: PopulationProfile;
    /** The area people are placed in, in world units (a view scales it to the screen). Default `DEFAULT_WORLD`. */
    world?: { width: number; height: number };
    /** Superspreading's gatherings: contact numbers vary far more, so a few people meet very many. Default false. */
    superspreading?: boolean;
}

export type PopulationOptions = PopulationNetworkOptions;

/** Equal keys build equal networks (for one profile). */
export const networkKey = ({ seed, world = DEFAULT_WORLD, people, contacts = DEFAULT_CONTACTS, superspreading = false }: PopulationNetworkOptions) =>
    `${seed}:${world.width}x${world.height}:${people}:${contacts}:${superspreading ? 1 : 0}`;

/** Spacing that fits everyone into the area. */
const nodeSpacing = (width: number, height: number, people: number) =>
    Math.min(MAX_NODE_SPACING, Math.sqrt((PACKING * 4 * width * height) / (Math.PI * people)));

/** The contact network for these options (see the module comment); the same options always draw the same one. */
export const buildPopulationNetwork = ({
    seed = randomSeed(),
    world = DEFAULT_WORLD,
    people,
    contacts = DEFAULT_CONTACTS,
    superspreading = false,
    profile = US_2024,
}: PopulationNetworkOptions): Network => {
    const spacing = nodeSpacing(world.width, world.height, people);
    return buildNetwork(seededRandom(seed), {
        width: world.width,
        height: world.height,
        count: people,
        minDistance: spacing,
        neighbours: contacts,
        // Denser networks need a longer reach so every node can find its nearest contacts.
        maxEdgeLength: BASE_EDGE_LENGTH * (spacing / MAX_NODE_SPACING) * Math.sqrt(Math.max(1, contacts / BASE_CONTACTS)),
        contactVariation: superspreading ? GATHERING_VARIATION : profile.contacts.variation.value,
        distantShare: profile.contacts.distantShare.value,
        ...(profile.households ? { households: { sizes: profile.households.shares, weight: profile.households.transmission.value } } : {}),
    });
};

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
 * their own) from the adult ages, everyone else from what that leaves of the census distribution, so the whole
 * population matches it.
 */
export const drawAges = (network: Pick<Network, "count" | "householdOf">, counts: number[], seed: number): Uint8Array => {
    const random = seededRandom(seed ^ AGE_SALT);
    const people = network.count;
    const total = counts.reduce((sum, count) => sum + count, 0);
    const adults = counts.reduce((sum, count, age) => sum + (age >= ADULT_AGE ? count : 0), 0);
    const heads = new Uint8Array(people);
    let headCount = 0;
    const households = network.householdOf;
    const seen = new Uint8Array(people);
    for (let person = 0; person < people; person++) {
        const household = households ? households[person] : -1;
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

/** A population: its people, their ages and the network of who meets whom. See the module comment for the model. */
export class Population {
    /** The United States in 2024 (the default profile): census ages and households, cited contact patterns. */
    static readonly US_2024: PopulationProfile = US_2024;
    /** Every built-in profile. */
    static readonly profiles: readonly PopulationProfile[] = [US_2024];

    readonly people: number;
    readonly contacts: number;
    readonly seed: number;
    readonly profile: PopulationProfile;
    readonly superspreading: boolean;
    readonly world: { width: number; height: number };
    /** Who meets whom (positions, contacts, households). */
    readonly network: Network;
    /** Each person's age in years (the profile's last age means that age or older); null if the profile has no ages. */
    readonly ages: Uint8Array | null;

    constructor({
        people,
        contacts = DEFAULT_CONTACTS,
        seed = randomSeed(),
        profile = US_2024,
        superspreading = false,
        world = DEFAULT_WORLD,
    }: PopulationOptions) {
        if (!(people >= 1 && Number.isInteger(people))) throw new RangeError(`people must be a whole number of at least 1, not ${people}`);
        if (!(contacts >= 1)) throw new RangeError(`contacts must be at least 1, not ${contacts}`);
        this.people = people;
        this.contacts = Math.round(contacts);
        this.seed = seed;
        this.profile = profile;
        this.superspreading = superspreading;
        this.world = world;
        this.network = buildPopulationNetwork({ people, contacts: this.contacts, seed, profile, superspreading, world });
        this.ages = profile.ages ? drawAges(this.network, profile.ages.counts, seed) : null;
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

    /** How the population is modelled, in plain words, with each input's source. */
    describe(): string[] {
        const { profile } = this;
        const lines = [`${this.people.toLocaleString("en")} people, modelled on ${profile.name}.`];
        if (profile.ages) lines.push(`Ages: drawn from single-year counts [${profile.ages.citation ?? "your data"}], every household with an adult.`);
        if (profile.households)
            lines.push(
                `Households: ${this.households.toLocaleString("en")}, of the sizes given [${profile.households.citation ?? "your data"}]; ` +
                    `infection passes ${profile.households.transmission.value}× as readily within them [${profile.households.transmission.citation ?? "your data"}].`,
            );
        lines.push(
            `Contacts: ${this.contacts} each on average, mostly neighbours, ${Math.round(profile.contacts.distantShare.value * 100)}% with anyone ` +
                `[${profile.contacts.distantShare.citation ?? "your data"}], uneven as in contact diaries [${profile.contacts.variation.citation ?? "your data"}]` +
                (this.superspreading ? `, far more so with gatherings (superspreading).` : `.`),
        );
        return lines;
    }
}
