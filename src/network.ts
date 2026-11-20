/**
 * Random geometric contact networks: people scattered with a minimum spacing, each linked to their nearest
 * neighbours (optionally a varying number, so a few people have many), with a share of contacts made with people
 * anywhere instead (a small world: Watts & Strogatz 1998). Purely local contacts make a lattice-like network where
 * a case's contacts are mostly each other's, so an outbreak can only creep outwards as a wave front; real contact
 * patterns mix household and neighbourhood contacts with distant ones. Positions are in world units (the view scales
 * them to the screen). Optionally, neighbours are grouped into households (all members linked to each other, and
 * household contacts can transmit more readily: `householdWeight`).
 *
 * Everything is stored in flat typed arrays (positions, an edge list, and each person's contacts as one compressed
 * array), so a network of a million people and millions of contacts builds in a couple of seconds and copies between
 * threads cheaply.
 */
import { type Random, gammaMeanOne } from "./random.js";
import { SpatialGrid } from "./spatial-grid.js";

/** What kind of contact an edge is (stored as a number in `Network.edgeKind`). */
export enum EdgeKind {
    /** A nearby neighbour. */
    Local = 0,
    /** Someone anywhere in the network. */
    Distant = 1,
    /** A member of the same household. */
    Household = 2,
}

export interface Network {
    width: number;
    height: number;
    /** How many people. */
    count: number;
    /** Each person's position, in world units. */
    x: Float64Array;
    y: Float64Array;
    /** Contacts in the order they were made: edge e links `edgeA[e]` < `edgeB[e]`, of kind `edgeKind[e]` (`EdgeKind`). */
    edgeA: Int32Array;
    edgeB: Int32Array;
    edgeKind: Uint8Array;
    /** Person i's contacts are `neighbours[offsets[i]]` to `neighbours[offsets[i + 1] - 1]`, in the order they were made. */
    offsets: Int32Array;
    neighbours: Int32Array;
    /** Each person's household (-1: none), so a contact is a household one when both share it. */
    householdOf?: Int32Array;
    /** How much more readily an infection passes between household members per day, as a multiple of infectiousness. */
    householdWeight?: number;
}

export interface NetworkOptions {
    width?: number;
    height?: number;
    count?: number;
    minDistance?: number;
    /** Each node links to this many nearest neighbours (links are undirected, so degree is usually higher). */
    neighbours?: number;
    maxEdgeLength?: number;
    /**
     * Vary how many contacts people have: each person's share of `neighbours` is drawn from a gamma distribution with
     * this shape (mean 1), and the more contacts they have, the further they reach. Small shapes give a few people
     * with many contacts. Omit for everyone linking to the same number of nearest neighbours.
     */
    contactVariation?: number;
    /** Share of each person's contacts made with someone anywhere in the network instead of a neighbour. */
    distantShare?: number;
    /** Households: the share of households of each size (1, 2, 3…; the last includes larger), and their weight. */
    households?: { sizes: number[]; weight: number };
}

/** Placement gives up after this many tries (at least), or this many per person, if the canvas is too crowded. */
const MIN_PLACEMENT_ATTEMPTS = 120000;
const PLACEMENT_ATTEMPTS_PER_NODE = 500;

/** People with many contacts reach further for them, but at most this many times the usual link length. */
const MAX_REACH_FACTOR = 6;
/** How far people keep from the edges of the world (world units): about 0.4 of their spacing, within these bounds. */
const MIN_MARGIN = 9;
const MAX_MARGIN = 12;

/** Person i's contacts (a view into the network's arrays: don't modify). */
export const neighboursOf = (network: Pick<Network, "offsets" | "neighbours">, i: number) =>
    network.neighbours.subarray(network.offsets[i], network.offsets[i + 1]);

export const degreeOf = (network: Pick<Network, "offsets">, i: number) => network.offsets[i + 1] - network.offsets[i];

/** A growable list of candidate edges (pairs and kinds), before duplicates are removed. */
class EdgeList {
    a = new Int32Array(1024);
    b = new Int32Array(1024);
    kind = new Uint8Array(1024);
    length = 0;

    push(i: number, j: number, kind: number) {
        if (i === j) return;
        if (this.length === this.a.length) {
            const grow = <T extends Int32Array | Uint8Array>(array: T) => {
                const bigger = new (array.constructor as new (length: number) => T)(array.length * 2);
                bigger.set(array);
                return bigger;
            };
            this.a = grow(this.a);
            this.b = grow(this.b);
            this.kind = grow(this.kind);
        }
        this.a[this.length] = Math.min(i, j);
        this.b[this.length] = Math.max(i, j);
        this.kind[this.length] = kind;
        this.length++;
    }
}

export const buildNetwork = (random: Random, options: NetworkOptions = {}): Network => {
    const {
        width = 1200,
        height = 180,
        count: wantedCount = 120,
        minDistance = 30,
        neighbours = 3,
        maxEdgeLength = 88,
        contactVariation,
        distantShare = 0,
        households,
    } = options;
    // People keep clear of the edges by about half their spacing.
    const margin = Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, 0.4 * minDistance));

    const { x, y, count } = placePeople(random, { width, height, margin, count: wantedCount, minDistance });

    // Candidate contacts, in the order they're made; a pair made twice keeps its first kind (see `compress`).
    const candidates = new EdgeList();

    // Households first: each unassigned person (in random order) gathers their nearest unassigned neighbours into a
    // household of a size drawn from the distribution, everyone linked to everyone. Households are linked in the
    // order of their first member.
    const householdOf = households ? groupHouseholds(x, y, count, households.sizes, minDistance, random) : undefined;
    if (householdOf) {
        // Each household's members in index order (a counting sort by household).
        const total = maxOf(householdOf) + 1;
        const start = new Int32Array(total + 1);
        for (let person = 0; person < count; person++) if (householdOf[person] >= 0) start[householdOf[person] + 1]++;
        for (let h = 0; h < total; h++) start[h + 1] += start[h];
        const fill = start.slice(0, -1);
        const members = new Int32Array(count);
        for (let person = 0; person < count; person++) if (householdOf[person] >= 0) members[fill[householdOf[person]]++] = person;
        for (let person = 0; person < count; person++) {
            const household = householdOf[person];
            if (household < 0 || members[start[household]] !== person) continue;
            for (let p = start[household]; p < start[household + 1]; p++)
                for (let q = p + 1; q < start[household + 1]; q++) candidates.push(members[p], members[q], EdgeKind.Household);
        }
    }

    // Each person links to their nearest `neighbours` within reach, found through a grid. With contact variation,
    // each person's number (and reach) varies around that: a few people end up with many contacts.
    const contacts = new Float64Array(count);
    for (let i = 0; i < count; i++) contacts[i] = contactVariation ? gammaMeanOne(random, contactVariation) : 1;
    // First, in index order, everything random: how many contacts each person seeks, which are distant (someone
    // picked at random from everyone, each with chance `distantShare`) and who those are.
    const wanted = new Int32Array(count);
    const distantStart = new Int32Array(count + 1);
    let distantTargets = new Int32Array(Math.max(16, Math.ceil(count * neighbours * distantShare * 1.5)));
    for (let i = 0; i < count; i++) {
        const all = contactVariation ? Math.max(1, Math.round(neighbours * contacts[i])) : neighbours;
        let distant = 0;
        if (distantShare > 0) for (let contact = 0; contact < all; contact++) if (random() < distantShare) distant++;
        if (distantStart[i] + distant > distantTargets.length) {
            const bigger = new Int32Array(Math.max(distantTargets.length * 2, distantStart[i] + distant));
            bigger.set(distantTargets);
            distantTargets = bigger;
        }
        for (let contact = 0; contact < distant; contact++) distantTargets[distantStart[i] + contact] = Math.floor(random() * count);
        distantStart[i + 1] = distantStart[i] + distant;
        wanted[i] = all - distant;
    }

    // Then each person's nearest `wanted` within reach (ties to the lower index). Nothing here is random, so people
    // are visited in map order (the grid's), each search next to the last, which keeps a million-person map in the
    // CPU's cache; the result is the same as in index order.
    const nearestStart = new Int32Array(count + 1);
    for (let i = 0; i < count; i++) nearestStart[i + 1] = nearestStart[i] + wanted[i];
    const nearest = new Int32Array(nearestStart[count]);
    const nearestCount = new Int32Array(count);
    let nearestD = new Float64Array(64);
    let nearestJ = new Int32Array(64);
    // Searched ring by ring outwards on a grid of about one person per cell, stopping once nobody unseen could be
    // closer than the `want`-th found (or within reach): a handful of distance checks per person, not everyone in reach.
    const fine = new SpatialGrid(x, y, Math.max(1e-6, Math.sqrt((width * height) / Math.max(1, count))), count);
    const fineCell = fine.cellSize;
    for (let ordered = 0; ordered < count; ordered++) {
        const i = fine.items[ordered];
        const want = wanted[i];
        if (want <= 0) continue;
        const reach = maxEdgeLength * Math.min(MAX_REACH_FACTOR, Math.sqrt(Math.max(1, want / neighbours)));
        // Kept in order as the grid is scanned: an insertion into a short sorted list, instead of collecting and
        // sorting everyone in reach.
        if (want > nearestD.length) {
            nearestD = new Float64Array(want * 2);
            nearestJ = new Int32Array(want * 2);
        }
        let found = 0;
        const px = fine.itemX[ordered];
        const py = fine.itemY[ordered];
        const column = fine.column(px);
        const row = fine.row(py);
        const visit = (cellIndex: number) => {
            for (let k = fine.start[cellIndex]; k < fine.start[cellIndex + 1]; k++) {
                const j = fine.items[k];
                if (j === i) continue;
                const dx = fine.itemX[k] - px;
                const dy = fine.itemY[k] - py;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d > reach) continue;
                if (found === want && (d > nearestD[found - 1] || (d === nearestD[found - 1] && j > nearestJ[found - 1]))) continue;
                let at = found < want ? found++ : found - 1;
                while (at > 0 && (nearestD[at - 1] > d || (nearestD[at - 1] === d && nearestJ[at - 1] > j))) {
                    nearestD[at] = nearestD[at - 1];
                    nearestJ[at] = nearestJ[at - 1];
                    at--;
                }
                nearestD[at] = d;
                nearestJ[at] = j;
            }
        };
        for (let ring = 0; ; ring++) {
            const top = row - ring;
            const bottom = row + ring;
            const left = column - ring;
            const right = column + ring;
            for (let cy = Math.max(0, top); cy <= Math.min(fine.rows - 1, bottom); cy++) {
                if (cy === top || cy === bottom) {
                    for (let cx = Math.max(0, left); cx <= Math.min(fine.columns - 1, right); cx++) visit(cy * fine.columns + cx);
                } else {
                    if (left >= 0) visit(cy * fine.columns + left);
                    if (right < fine.columns && right !== left) visit(cy * fine.columns + right);
                }
            }
            // The closest anyone not yet seen could be: past this ring on a side the grid continues on.
            const outside = Math.min(
                left > 0 ? px - left * fineCell : Infinity,
                right < fine.columns - 1 ? (right + 1) * fineCell - px : Infinity,
                top > 0 ? py - top * fineCell : Infinity,
                bottom < fine.rows - 1 ? (bottom + 1) * fineCell - py : Infinity,
            );
            if (outside === Infinity || outside > reach || (found === want && nearestD[found - 1] < outside)) break;
        }
        nearest.set(nearestJ.subarray(0, found), nearestStart[i]);
        nearestCount[i] = found;
    }

    // Finally the contacts, in index order: each person's distant ones, then their nearest.
    for (let i = 0; i < count; i++) {
        for (let k = distantStart[i]; k < distantStart[i + 1]; k++) candidates.push(i, distantTargets[k], EdgeKind.Distant);
        for (let k = 0; k < nearestCount[i]; k++) candidates.push(i, nearest[nearestStart[i] + k], EdgeKind.Local);
    }

    return {
        width,
        height,
        count,
        x,
        y,
        ...compress(candidates, count),
        ...(householdOf ? { householdOf, householdWeight: households!.weight } : {}),
    };
};

const maxOf = (values: Int32Array) => {
    let max = -1;
    for (const value of values) if (value > max) max = value;
    return max;
};

/** Empty cell in the placement grid. */
const EMPTY = 65535;

/**
 * Rejection sampling: a candidate is kept if no one is within `minDistance`. The grid's cells are small enough
 * (a diagonal of `minDistance`) to hold one person each. Each cell keeps its person's position as two 16-bit offsets
 * within the cell, a quarter of the memory of full coordinates, so a million-person map's checks mostly stay in the CPU's
 * cache; only a candidate within rounding of the limit (a few hundred in a million) is checked against the exact
 * coordinates, so every decision is the same as with exact coordinates throughout.
 */
const placePeople = (
    random: Random,
    { width, height, margin, count, minDistance }: { width: number; height: number; margin: number; count: number; minDistance: number },
) => {
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    const cell = minDistance > 0 ? minDistance / Math.SQRT2 : 1;
    const columns = Math.floor(width / cell) + 1;
    const rows = Math.floor(height / cell) + 1;
    const spaced = minDistance > 0;
    const grid = spaced ? new Uint16Array(2 * columns * rows).fill(EMPTY) : null;
    const exact = spaced ? new Float64Array(2 * columns * rows) : null;
    const span = Math.ceil(minDistance / cell);
    const minSquared = minDistance * minDistance;
    // Offsets are in steps of `unit`; rounding moves a point by under a unit, which changes a squared distance near the
    // limit by under 2 · minDistance · 2 units: closer than that to the limit, the exact coordinates decide.
    const unit = cell / (EMPTY - 1);
    const slack = 4 * minDistance * unit;
    const surelyCrowded = minSquared - slack;
    const surelyClear = minSquared + slack;
    const maxAttempts = Math.max(MIN_PLACEMENT_ATTEMPTS, count * PLACEMENT_ATTEMPTS_PER_NODE);
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < maxAttempts; attempt++) {
        const px = margin + random() * (width - 2 * margin);
        const py = margin + random() * (height - 2 * margin);
        const column = Math.floor(px / cell);
        const row = Math.floor(py / cell);
        const own = 2 * (row * columns + column);
        if (grid) {
            // Someone in the same cell is always too close; else check the cells around.
            if (grid[own] !== EMPTY) continue;
            let crowded = false;
            const left = Math.max(0, column - span);
            const right = Math.min(columns - 1, column + span);
            for (let cy = Math.max(0, row - span); cy <= Math.min(rows - 1, row + span) && !crowded; cy++) {
                for (let cx = left, at = 2 * (cy * columns + left); cx <= right; cx++, at += 2) {
                    const offsetX = grid[at];
                    if (offsetX === EMPTY) continue;
                    const dx = cx * cell + offsetX * unit - px;
                    const dy = cy * cell + grid[at + 1] * unit - py;
                    const squared = dx * dx + dy * dy;
                    if (squared > surelyClear) continue;
                    if (squared < surelyCrowded || (exact![at] - px) ** 2 + (exact![at + 1] - py) ** 2 <= minSquared) {
                        crowded = true;
                        break;
                    }
                }
            }
            if (crowded) continue;
            grid[own] = Math.round((px - column * cell) / unit);
            grid[own + 1] = Math.round((py - row * cell) / unit);
            exact![own] = px;
            exact![own + 1] = py;
        }
        x[placed] = px;
        y[placed] = py;
        placed++;
    }
    return { x: x.slice(0, placed), y: y.slice(0, placed), count: placed };
};

/**
 * The final edge list and each person's contacts from the candidates: a pair made twice keeps its first making
 * (each person's contacts in the order they were made), found per lower endpoint with a stamp per person.
 */
const compress = (candidates: EdgeList, count: number) => {
    const { a, b, kind, length } = candidates;
    // Candidates grouped by lower endpoint, in order.
    const byA = new Int32Array(count + 1);
    for (let e = 0; e < length; e++) byA[a[e] + 1]++;
    for (let i = 0; i < count; i++) byA[i + 1] += byA[i];
    const fill = byA.slice(0, -1);
    const order = new Int32Array(length);
    for (let e = 0; e < length; e++) order[fill[a[e]]++] = e;
    const duplicate = new Uint8Array(length);
    const stamp = new Int32Array(count).fill(-1);
    let edges = 0;
    for (let i = 0; i < count; i++) {
        for (let k = byA[i]; k < byA[i + 1]; k++) {
            const e = order[k];
            if (stamp[b[e]] === i) duplicate[e] = 1;
            else {
                stamp[b[e]] = i;
                edges++;
            }
        }
    }
    const edgeA = new Int32Array(edges);
    const edgeB = new Int32Array(edges);
    const edgeKind = new Uint8Array(edges);
    const offsets = new Int32Array(count + 1);
    let next = 0;
    for (let e = 0; e < length; e++) {
        if (duplicate[e]) continue;
        edgeA[next] = a[e];
        edgeB[next] = b[e];
        edgeKind[next] = kind[e];
        offsets[a[e] + 1]++;
        offsets[b[e] + 1]++;
        next++;
    }
    for (let i = 0; i < count; i++) offsets[i + 1] += offsets[i];
    const position = offsets.slice(0, -1);
    const neighbours = new Int32Array(2 * edges);
    for (let e = 0; e < edges; e++) {
        neighbours[position[edgeA[e]]++] = edgeB[e];
        neighbours[position[edgeB[e]]++] = edgeA[e];
    }
    return { edgeA, edgeB, edgeKind, offsets, neighbours };
};

/** Draws a household size from the share of households of each size (1, 2, 3…). */
const drawSize = (sizes: number[], random: Random) => {
    let draw = random();
    for (let size = 0; size < sizes.length; size++) {
        draw -= sizes[size];
        if (draw < 0) return size + 1;
    }
    return sizes.length;
};

/**
 * Groups people into households of neighbours: in random order, each unassigned person draws a size and takes the
 * nearest unassigned people within a few spacings (smaller if too few are left nearby). Returns each person's
 * household. Sizes are drawn per household, so the share of households of each size follows `sizes`.
 */
const groupHouseholds = (x: Float64Array, y: Float64Array, count: number, sizes: number[], spacing: number, random: Random) => {
    const householdOf = new Int32Array(count).fill(-1);
    const grid = new SpatialGrid(x, y, Math.max(1, spacing * 2), count);
    const { columns, start, items, itemX, itemY } = grid;
    const order = new Int32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    const largest = sizes.length;
    const nearD = new Float64Array(largest);
    const nearJ = new Int32Array(largest);
    let next = 0;
    for (const person of order) {
        if (householdOf[person] >= 0) continue;
        const size = drawSize(sizes, random);
        const household = next++;
        householdOf[person] = household;
        if (size === 1) continue;
        // The `size − 1` nearest unassigned (by squared distance, ties to the lower index) in the cells around.
        const wanted = size - 1;
        let found = 0;
        const px = x[person];
        const py = y[person];
        const reach = spacing * 4;
        const left = grid.column(px - reach);
        const right = grid.column(px + reach);
        const top = grid.row(py - reach);
        const bottom = grid.row(py + reach);
        for (let row = top; row <= bottom; row++) {
            const to = start[row * columns + right + 1];
            for (let k = start[row * columns + left]; k < to; k++) {
                const j = items[k];
                if (householdOf[j] >= 0) continue;
                const dx = itemX[k] - px;
                const dy = itemY[k] - py;
                const d = dx * dx + dy * dy;
                if (found === wanted && (d > nearD[found - 1] || (d === nearD[found - 1] && j > nearJ[found - 1]))) continue;
                let at = found < wanted ? found++ : found - 1;
                while (at > 0 && (nearD[at - 1] > d || (nearD[at - 1] === d && nearJ[at - 1] > j))) {
                    nearD[at] = nearD[at - 1];
                    nearJ[at] = nearJ[at - 1];
                    at--;
                }
                nearD[at] = d;
                nearJ[at] = j;
            }
        }
        for (let k = 0; k < found; k++) householdOf[nearJ[k]] = household;
    }
    return householdOf;
};

/** Index of the person closest to a point (checks everyone; for repeated lookups use a `SpatialGrid`). */
export const nearestNode = (network: Pick<Network, "x" | "y" | "count">, px: number, py: number) => {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < network.count; i++) {
        const distance = Math.hypot(network.x[i] - px, network.y[i] - py);
        if (distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    }
    return best;
};

/** Mean excess degree ⟨k²⟩/⟨k⟩ − 1: how many onward contacts a newly infected node has, on average. */
export const excessDegree = (network: Pick<Network, "offsets" | "count">) => {
    let sum = 0;
    let squares = 0;
    for (let i = 0; i < network.count; i++) {
        const k = degreeOf(network, i);
        sum += k;
        squares += k * k;
    }
    return sum > 0 ? squares / sum - 1 : 0;
};
