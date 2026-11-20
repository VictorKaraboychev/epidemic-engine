/**
 * A uniform grid over points, for "what is near here?" queries in O(nearby points) instead of O(all points). Built
 * once from coordinate arrays into two flat arrays (each cell's points, by cell, in index order), so a million points
 * take a few milliseconds and no per-cell objects. Used to build large networks and to find the person under the
 * pointer.
 */
export class SpatialGrid {
    readonly columns: number;
    readonly rows: number;
    /** Points in cell c are `items[start[c]]` to `items[start[c + 1] - 1]`, in index order. */
    readonly start: Int32Array;
    readonly items: Int32Array;
    /** Each item's coordinates, in the same order: scans read memory in order instead of jumping around by index. */
    readonly itemX: Float64Array;
    readonly itemY: Float64Array;

    /** `cellSize` should be about the query radius you use most. Points are expected at x, y ≥ 0. */
    constructor(
        readonly xs: ArrayLike<number>,
        readonly ys: ArrayLike<number>,
        readonly cellSize: number,
        count = xs.length,
    ) {
        let maxX = 0;
        let maxY = 0;
        for (let i = 0; i < count; i++) {
            if (xs[i] > maxX) maxX = xs[i];
            if (ys[i] > maxY) maxY = ys[i];
        }
        this.columns = Math.floor(maxX / cellSize) + 1;
        this.rows = Math.floor(maxY / cellSize) + 1;
        const cells = new Int32Array(count);
        this.start = new Int32Array(this.columns * this.rows + 1);
        for (let i = 0; i < count; i++) {
            cells[i] = this.cellOf(xs[i], ys[i]);
            this.start[cells[i] + 1]++;
        }
        for (let c = 0; c < this.columns * this.rows; c++) this.start[c + 1] += this.start[c];
        const fill = this.start.slice(0, -1);
        this.items = new Int32Array(count);
        this.itemX = new Float64Array(count);
        this.itemY = new Float64Array(count);
        for (let i = 0; i < count; i++) {
            const at = fill[cells[i]]++;
            this.items[at] = i;
            this.itemX[at] = xs[i];
            this.itemY[at] = ys[i];
        }
    }

    /** Column (or row) of a coordinate, clamped to the grid. */
    column(x: number) {
        return Math.min(this.columns - 1, Math.max(0, Math.floor(x / this.cellSize)));
    }

    row(y: number) {
        return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    }

    private cellOf(x: number, y: number) {
        return this.row(y) * this.columns + this.column(x);
    }

    /** Calls `visit` for every point in the cells overlapping the square of half-width `radius` around (x, y). */
    forEachNear(x: number, y: number, radius: number, visit: (index: number) => void) {
        const [left, right, top, bottom] = [this.column(x - radius), this.column(x + radius), this.row(y - radius), this.row(y + radius)];
        for (let row = top; row <= bottom; row++) {
            const from = this.start[row * this.columns + left];
            const to = this.start[row * this.columns + right + 1];
            for (let k = from; k < to; k++) visit(this.items[k]);
        }
    }

    /** The point nearest to (x, y) within `radius` (the last of equals in index order), or -1. */
    nearestWithin(x: number, y: number, radius: number) {
        let best = -1;
        let bestDistance = radius * radius;
        this.forEachNear(x, y, radius, (index) => {
            const distance = (this.xs[index] - x) ** 2 + (this.ys[index] - y) ** 2;
            if (distance <= bestDistance) {
                best = index;
                bestDistance = distance;
            }
        });
        return best;
    }
}
