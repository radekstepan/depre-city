export const CALCULATOR_DEFAULTS = {
    year: 2009,
    sqft: 1377,
    bathrooms: 3,
    bedrooms: 2.5,
    condition: 4,
    parkingType: "std" as const,
    parkingSpots: 1,
    isEndUnit: false,
    hasAC: false,
    isRainscreened: true,
    areaCoefVal: 0,
    listPrice: 889900,
    fee: 450,
    assessment: 0,       // 0 = not provided; enter BC assessed value to activate
    // MHCC inputs
    monthlyStrataFee: 450,
    polyBReplaced: false,
    // hvacAgeYears / appliancesAgeYears are intentionally omitted — they default to building age
};
