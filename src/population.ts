/**
 * The population the simulator's outbreaks spread through: a seeded contact network with households of census sizes,
 * uneven contact numbers as in contact diaries and a share of distant contacts (each value cited below), and the
 * seeded orders that pick index cases and the vaccinated, so a seed and a run number replay an outbreak exactly.
 */
import { type Network, buildNetwork } from "./network.js";
import { seededRandom, seededOrder } from "./random.js";

/** Share of the canvas the node spacing discs may cover; spacing shrinks on small canvases to fit everyone. */
const PACKING = 0.38;
/** Node spacing on roomy canvases (world units). */
const MAX_NODE_SPACING = 30;
/** Longest contact link at full spacing and `BASE_CONTACTS` contacts each (more contacts reach further). */
const BASE_EDGE_LENGTH = 88;
const BASE_CONTACTS = 3;
/**
 * How much contact numbers vary with superspreading: each person's share of the usual number is gamma-distributed with
 * this shape (mean 1, coefficient of variation √2), so a few people have several times the usual contacts. A modelling
 * choice reflecting that how many people others meet varies widely (Mossong et al. 2008), not a fitted value.
 */
const CONTACT_VARIATION = 0.1;
/**
 * How uneven people's contact numbers are: the gamma shape of how many contacts each person seeks, set so the
 * network's degrees (sought plus received, households included) have a coefficient of variation of ≈ 0.74, as in a
 * representative contact-diary study (mean 12.5 contacts a day, SD 9.3; Fu et al. 2012). POLYMOD finds similar
 * overdispersion across Europe (Mossong et al. 2008). A few people have many contacts: superspreading's opportunity.
 */
const EVERYDAY_CONTACT_VARIATION = 0.32;
/**
 * Household sizes: the share of US households with 1, 2, 3, 4, 5, 6 and 7+ people in 2024 (US Census Bureau, table
 * HH-4; mean 2.5).
 */
export const HOUSEHOLD_SIZES = [0.291, 0.346, 0.151, 0.124, 0.056, 0.021, 0.012];
/**
 * Household contacts transmit about 3.5 times as readily as other close contacts: secondary attack rates of 16.6%
 * vs 4.8% for SARS-CoV-2 (Madewell et al. 2020), as an intensity multiplier on each day's chance.
 */
export const HOUSEHOLD_WEIGHT = 3.5;
/**
 * Share of contacts that are distant (anyone in the network) rather than neighbours: 18% of contacts are with people
 * over 10 km from home (Fu et al. 2012). Enough to break up the lattice-like clustering of purely local contacts, so
 * early growth is exponential as observed, while most contacts stay local and outbreaks spread through neighbourhoods.
 */
export const DISTANT_SHARE = 0.18;
/** Mixed into the seed for the index-case draw, so it is independent of the network layout draw. */
const INDEX_CASE_SALT = 0x9e3779b9;
/** Mixed into the seed (with the run number) for each run's transmission and recovery luck. */
const LUCK_SALT = 0x85ebca6b;
/** Mixed into the seed for the order people are vaccinated in. */
const VACCINATION_SALT = 0xc2b2ae35;

/** The area people are placed in when no `world` is given (16:9; it only affects positions and who neighbours whom). */
export const DEFAULT_WORLD = { width: 1600, height: 900 } as const;

export interface PopulationNetworkOptions {
    /** People in the network. */
    people: number;
    /** Average everyday contacts per person (households included). */
    contacts: number;
    /** Same seed, same network. */
    seed: number;
    /** The area people are placed in, in world units (a view scales it to the screen). Default `DEFAULT_WORLD`. */
    world?: { width: number; height: number };
    /**
     * Superspreading's gatherings: contact numbers vary much more, so a few people have very many contacts (default
     * false: they vary as in contact diaries).
     */
    superspreading?: boolean;
}

/** Equal keys build equal networks. */
export const networkKey = ({ seed, world = DEFAULT_WORLD, people, contacts, superspreading = false }: PopulationNetworkOptions) =>
    `${seed}:${world.width}x${world.height}:${people}:${contacts}:${superspreading ? 1 : 0}`;

/** Node spacing that fits the whole population into the canvas. */
const nodeSpacing = (width: number, height: number, population: number) =>
    Math.min(MAX_NODE_SPACING, Math.sqrt((PACKING * 4 * width * height) / (Math.PI * population)));

/**
 * A seeded population: households of census sizes, everyday contacts with neighbours and a share of distant people,
 * and with superspreading, gatherings. The same options always draw the same people and contacts.
 */
export const buildPopulationNetwork = ({ seed, world = DEFAULT_WORLD, people, contacts, superspreading = false }: PopulationNetworkOptions): Network => {
    const spacing = nodeSpacing(world.width, world.height, people);
    return buildNetwork(seededRandom(seed), {
        width: world.width,
        height: world.height,
        count: people,
        minDistance: spacing,
        neighbours: contacts,
        // Denser networks need a longer reach so every node can find its nearest contacts.
        maxEdgeLength: BASE_EDGE_LENGTH * (spacing / MAX_NODE_SPACING) * Math.sqrt(Math.max(1, contacts / BASE_CONTACTS)),
        // Everyone's contact numbers vary as in contact diaries; superspreading adds people with very many contacts
        // (gatherings), so the most infectious can infect many more than an everyday contact list.
        contactVariation: superspreading ? CONTACT_VARIATION : EVERYDAY_CONTACT_VARIATION,
        distantShare: DISTANT_SHARE,
        households: { sizes: HOUSEHOLD_SIZES, weight: HOUSEHOLD_WEIGHT },
    });
};

/**
 * Seeded order in which people become index cases: k initial cases are always the first k connected people in this
 * order, so changing k adds and removes the same people instead of re-drawing them.
 */
export const indexCaseOrder = (seed: number, population: number) => seededOrder(population, seededRandom(seed ^ INDEX_CASE_SALT));

/** Who gets vaccinated first, from the seed (its own order, so the vaccinated aren't the first index cases). */
export const vaccinationOrder = (seed: number, population: number) => seededOrder(population, seededRandom(seed ^ VACCINATION_SALT));

/** How many people a coverage vaccinates. */
export const vaccinatedCount = (coverage: number, population: number) => Math.round(Math.min(1, Math.max(0, coverage)) * population);

/** The vaccinated: the first `count` people in `order` who aren't index cases (they start infected instead). */
export const seededVaccinated = (order: number[], indexCases: number[], count: number) => {
    const cases = new Set(indexCases);
    const vaccinated: number[] = [];
    for (let k = 0; k < order.length && vaccinated.length < count; k++) if (!cases.has(order[k])) vaccinated.push(order[k]);
    return vaccinated;
};

/** The first `count` people in `order` who have at least one contact on `network`. */
export const seededIndexCases = (order: number[], network: Pick<Network, "offsets" | "count">, count: number) => {
    const cases: number[] = [];
    for (let k = 0; k < order.length && cases.length < count; k++) {
        const node = order[k];
        if (node < network.count && network.offsets[node + 1] > network.offsets[node]) cases.push(node);
    }
    return cases;
};

/** The seed for a run's luck: the same setup seed and run number replay the same outbreak exactly. */
export const luckSeed = (seed: number, run: number) => (Math.imul(seed ^ LUCK_SALT, 0x27d4eb2d) + Math.imul(run + 1, 0x165667b1)) | 0;
