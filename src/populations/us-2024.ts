import { cited } from "../pathogens/types.js";
import type { PopulationProfile } from "../population.js";

/**
 * The United States in 2024: who lives there (ages), how they live (households), and how they meet (contacts).
 */
export const US_2024: PopulationProfile = {
    name: "United States, 2024",
    ages: {
        // Resident population by single year of age, 0 to 99 and 100 or older, on 1 July 2024 (340,110,988 people).
        counts: [
            3_615_598, 3_701_824, 3_768_012, 3_690_129, 3_823_751, 3_880_536, 3_965_148, 4_039_527, 4_139_497, 4_172_964, 4_157_482, 4_140_092, 4_144_127,
            4_187_019, 4_272_434, 4_363_695, 4_532_690, 4_538_195, 4_484_083, 4_457_162, 4_485_953, 4_448_786, 4_433_302, 4_521_959, 4_531_936, 4_466_652,
            4_458_803, 4_467_098, 4_496_349, 4_570_974, 4_660_190, 4_727_791, 4_825_625, 4_888_155, 4_892_227, 4_747_023, 4_654_566, 4_594_689, 4_593_655,
            4_580_139, 4_477_041, 4_530_695, 4_512_020, 4_438_616, 4_410_780, 4_224_803, 4_124_267, 4_066_171, 3_922_082, 3_956_726, 3_874_966, 3_919_253,
            4_099_042, 4_333_802, 4_259_244, 4_095_002, 4_001_246, 4_006_737, 4_055_499, 4_201_444, 4_291_837, 4_283_092, 4_285_877, 4_265_138, 4_175_853,
            4_084_252, 4_036_168, 3_949_096, 3_760_814, 3_659_141, 3_513_149, 3_348_806, 3_201_975, 3_027_929, 2_863_632, 2_761_456, 2_672_363, 2_783_899,
            1_941_012, 1_834_596, 1_751_366, 1_731_062, 1_445_143, 1_260_479, 1_118_437, 1_002_394, 901_591, 770_963, 679_744, 594_759, 484_508, 423_135,
            357_605, 297_609, 243_030, 187_862, 147_501, 110_737, 78_674, 56_997, 98_034,
        ],
        citation: "census-ages-2024",
    },
    households: {
        // The share of households with 1, 2, 3, 4, 5, 6 and 7 or more people (mean 2.5).
        shares: [0.291, 0.346, 0.151, 0.124, 0.056, 0.021, 0.012],
        citation: "census-households-2024",
        // Household contacts transmit about 3.5 times as readily as other close contacts: secondary attack rates of 16.6%
        // vs 4.8% for SARS-CoV-2, as an intensity multiplier on each day's chance.
        transmission: cited(3.5, "madewell-2020"),
    },
    contacts: {
        // How uneven contact numbers are: a coefficient of variation of ≈ 0.74 (mean 12.5 contacts a day, SD 9.3) in a
        // representative contact-diary study; POLYMOD finds similar unevenness across Europe.
        cv: cited(0.74, "fu-2012", { setting: "Taiwan (representative contact diaries)", also: ["mossong-2008"] }),
        // 18% of contacts are with people over 10 km from home: the rest are neighbours.
        distantShare: cited(0.18, "fu-2012"),
    },
};
