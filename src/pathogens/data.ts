/**
 * The built-in pathogens' data, in display order: one file each, every published value cited (`Cited`), citations
 * from the shared library (`citations.ts`). Add one by writing its file, listing it here, adding its id to
 * `PathogenId` and its instance to `Pathogen`.
 */
import { COVID_ANCESTRAL } from "./covid-ancestral.js";
import { COVID_OMICRON } from "./covid-omicron.js";
import { EBOLA } from "./ebola.js";
import { INFLUENZA_A } from "./influenza-a.js";
import { INFLUENZA_B } from "./influenza-b.js";
import { MEASLES } from "./measles.js";
import { MERS } from "./mers.js";
import { MPOX } from "./mpox.js";
import { PERTUSSIS } from "./pertussis.js";
import { RSV } from "./rsv.js";
import { SARS } from "./sars.js";
import type { PathogenId, PathogenProfile } from "./types.js";

export const PATHOGEN_DATA: PathogenProfile<PathogenId>[] = [
    COVID_ANCESTRAL,
    COVID_OMICRON,
    INFLUENZA_A,
    INFLUENZA_B,
    RSV,
    MEASLES,
    PERTUSSIS,
    MPOX,
    SARS,
    MERS,
    EBOLA,
];
