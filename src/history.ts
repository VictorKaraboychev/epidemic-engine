/**
 * Day-by-day counts for a run, stored compactly: one growable typed array per compartment.
 * Appending returns a new `History` that shares the buffers (days past an older history's `length` are invisible
 * to it), so each day costs O(compartments), not O(days), and old snapshots stay valid.
 */
export interface History {
    readonly length: number;
    /** Per compartment, `length` days (read with `seriesOf`). */
    readonly buffers: Int32Array[];
    /** People carrying the infection, per day. */
    readonly infected: Int32Array;
}

const INITIAL_CAPACITY = 128;

export const startHistory = (counts: number[], infected: number): History => {
    const buffers = counts.map((count) => {
        const buffer = new Int32Array(INITIAL_CAPACITY);
        buffer[0] = count;
        return buffer;
    });
    const infectedBuffer = new Int32Array(INITIAL_CAPACITY);
    infectedBuffer[0] = infected;
    return { length: 1, buffers, infected: infectedBuffer };
};

const grow = (buffer: Int32Array, length: number) => {
    if (length < buffer.length) return buffer;
    const bigger = new Int32Array(buffer.length * 2);
    bigger.set(buffer);
    return bigger;
};

export const appendDay = (history: History, counts: number[], infected: number): History => {
    const day = history.length;
    const buffers = history.buffers.map((buffer, c) => {
        const target = grow(buffer, day);
        target[day] = counts[c];
        return target;
    });
    const infectedBuffer = grow(history.infected, day);
    infectedBuffer[day] = infected;
    return { length: day + 1, buffers, infected: infectedBuffer };
};

/** One compartment's counts for every day so far. */
export const seriesOf = (history: History, compartment: number) => history.buffers[compartment].subarray(0, history.length);

/** Counts on one day, per compartment. */
export const countsOn = (history: History, day: number) => history.buffers.map((buffer) => buffer[day]);

/** The day with the most people infected (the first such day on ties). */
export const peakInfections = (history: History) => {
    let peak = { count: 0, day: 0 };
    for (let day = 0; day < history.length; day++) if (history.infected[day] > peak.count) peak = { count: history.infected[day], day };
    return peak;
};
