import type { CompartmentModel, ModelParams } from "./model.js";
import type { Network } from "./network.js";

/** Shared fixtures for the epidemic tests. */
export { seirdParams } from "./seird.js";

export const DESKTOP = { width: 1080, height: 176, count: 250, minDistance: 19, neighbours: 4, maxEdgeLength: 64 };

/** A hand-built network for exact checks: a star (hub 0 linked to 1–4) plus an isolated node 5. */
export const star = (): Network => ({
    width: 100,
    height: 100,
    count: 6,
    x: Float64Array.from({ length: 6 }, (_, i) => i * 10),
    y: new Float64Array(6),
    edgeA: Int32Array.of(0, 0, 0, 0),
    edgeB: Int32Array.of(1, 2, 3, 4),
    edgeKind: new Uint8Array(4),
    // Contacts: 0 → 1, 2, 3, 4; 1–4 → 0; 5 → none.
    offsets: Int32Array.of(0, 4, 5, 6, 7, 8, 8),
    neighbours: Int32Array.of(1, 2, 3, 4, 0, 0, 0, 0),
});

export interface SeirsParams extends ModelParams {
    latentDays: number;
    infectiousDays: number;
    immunityDays: number;
    vaccinationDays: number;
    efficacy: number;
}

/**
 * Not used by the site yet: a model with a latent period, waning immunity and vaccination, to check the engine
 * handles more than SIRD. S → E → I → R → S, and S → V (vaccinated, partly protected) → S as protection wanes.
 */
export const SEIRS_V_MODEL: CompartmentModel<SeirsParams> = {
    id: "seirs-v",
    compartments: [
        { key: "s", name: "susceptible", susceptibility: () => 1, exits: [{ to: "v", days: (p) => p.vaccinationDays }] },
        { key: "e", name: "exposed", infected: true, exits: [{ to: "i", days: (p) => p.latentDays }] },
        { key: "i", name: "infected", infected: true, infectious: true, exits: [{ to: "r", days: (p) => p.infectiousDays }] },
        { key: "r", name: "recovered", exits: [{ to: "s", days: (p) => p.immunityDays }] },
        { key: "v", name: "vaccinated", susceptibility: (p) => 1 - p.efficacy, exits: [{ to: "s", days: (p) => p.immunityDays }] },
    ],
    infectionEntry: "e",
    indexEntry: "i",
};

/** A wide, short world (as a banner-shaped view would show) and a small population. */
export const WIDE_LAYOUT = { width: 1152, height: 176 };
export const FIGURE_POPULATION = 250;
