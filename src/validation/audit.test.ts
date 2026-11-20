import { it } from "vitest";
import { Pathogen } from "../pathogens/index.js";
import { measurePreset } from "./measure.js";

// Slow (many large runs): `AUDIT=1 npx vitest run src/validation`.
const run = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AUDIT ? it : it.skip;

run(
    "audit presets",
    () => {
        for (const [id, superspreading] of (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ONLY
            ? (JSON.parse((globalThis as { process?: { env: Record<string, string | undefined> } }).process!.env.ONLY!) as [string, boolean][] as never)
            : ([
                  [Pathogen.CovidAncestral, false],
                  [Pathogen.CovidAncestral, true],
                  [Pathogen.CovidOmicron, false],
                  [Pathogen.InfluenzaA, false],
                  [Pathogen.Measles, false],
                  [Pathogen.Measles, true],
                  [Pathogen.Pertussis, false],
                  [Pathogen.Mpox, false],
                  [Pathogen.Sars, true],
                  [Pathogen.Mers, false],
                  [Pathogen.Ebola, false],
              ] as const)) {
            const m = measurePreset(id, {
                superspreading,
                contactsOnly: Boolean((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CONTACTS_ONLY),
            });
            console.log(
                `${id}${superspreading ? "+SS" : ""}`.padEnd(20),
                `β ${m.beta.toFixed(2)}  R ${m.earlyR.toFixed(2)}  k ${m.dispersion.toFixed(2)}  top20 ${(m.top20 * 100).toFixed(0)}%  GI ${m.generationInterval.toFixed(1)}  doubling ${m.doublingDays.toFixed(1)}`,
            );
        }
    },
    900_000,
);
