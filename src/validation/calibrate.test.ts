import { it } from "vitest";
import type { DiseaseId } from "../diseases/index.js";
import { measurePreset } from "./measure.js";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
// Slow: `CALIBRATE='{"covid-ancestral":5.0}' npx vitest run packages/epidemic-engine/src/validation/calibrate`.
const run = env.CALIBRATE ? it : it.skip;

/**
 * Finds each preset's infectiousness half-life that gives its published mean generation interval, keeping the
 * published latent and infectious periods (a shorter half-life concentrates infectiousness early).
 */
run(
    "calibrate infectiousness profiles to generation intervals",
    () => {
        const targets = JSON.parse(env.CALIBRATE!) as Record<DiseaseId, number>;
        for (const [id, target] of Object.entries(targets) as [DiseaseId, number][]) {
            const flat = measurePreset(id, { people: 10_000, runs: 5, infectiousnessHalfLife: Infinity }).generationInterval;
            if (flat <= target) {
                console.log(`${id}: flat already gives GI ${flat.toFixed(2)} ≤ target ${target}: keep flat`);
                continue;
            }
            let low = 0.3;
            let high = 30;
            let measured = flat;
            for (let iteration = 0; iteration < 9; iteration++) {
                const mid = Math.sqrt(low * high);
                measured = measurePreset(id, { people: 10_000, runs: 5, infectiousnessHalfLife: mid }).generationInterval;
                if (measured < target) low = mid;
                else high = mid;
            }
            console.log(`${id}: half-life ${Math.sqrt(low * high).toFixed(2)} days → GI ${measured.toFixed(2)} (target ${target}, flat ${flat.toFixed(2)})`);
        }
    },
    3_600_000,
);
