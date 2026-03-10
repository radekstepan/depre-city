/**
 * Monthly Hidden Carrying Cost (MHCC) Calculator
 *
 * Calculates the true cost of ownership for a BC strata property by modelling:
 *   A. Strata Savings Gap      — shortfall between collected reserves and what the building age demands
 *   B. Interior Sinking Fund   — amortised replacement cost of HVAC and appliances
 *   C. Immediate CapEx Risks   — Poly-B plumbing and leaky-condo era flags
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const MHCC_CONSTANTS = {
    CURRENT_YEAR: 2026,
    /** Average BC strata operating cost: landscaping, insurance, management, trash */
    BASE_OPERATING_COST_PER_SQFT: 0.30,
    /** Target reserve contribution ($/mo) by property age bracket */
    RESERVE_TARGET_NEW: 75,        // ≤ 5 years old
    RESERVE_TARGET_MID: 166,       // 6–20 years  (~$2,000/yr)
    RESERVE_TARGET_OLD: 250,       // > 20 years  (~$3,000/yr)
    /** HVAC (heat pump / furnace) */
    HVAC_LIFESPAN_YEARS: 15,
    HVAC_REPLACEMENT_COST: 9_500,
    /** Appliances */
    APPLIANCE_LIFESPAN_YEARS: 12,
    APPLIANCE_REPLACEMENT_COST: 8_000,
    /** CapEx risk vintage windows */
    POLY_B_YEAR_START: 1970,
    POLY_B_YEAR_END: 1999,
    POLY_B_COST: 15_000,
    LEAKY_CONDO_YEAR_START: 1980,
    LEAKY_CONDO_YEAR_END: 2003,
    LEAKY_CONDO_COST: 50_000,
} as const;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface MHCCInputs {
    yearBuilt: number;
    squareFootage: number;
    monthlyStrataFee: number;
    /** If omitted, defaults to (CURRENT_YEAR − yearBuilt) */
    hvacAgeYears?: number;
    /** If omitted, defaults to (CURRENT_YEAR − yearBuilt) */
    appliancesAgeYears?: number;
    /** Already collected from the existing rainscreen checkbox */
    isRainscreened: boolean;
    /** Whether Poly-B plumbing has been replaced */
    polyBReplaced: boolean;
}

export interface CapExWarning {
    issue: string;
    estimatedUpfrontCost: number;
    note: string;
}

export interface MHCCResult {
    strataFee: number;
    /** Shortfall between what the strata collects and the age-appropriate reserve target */
    strataSavingsGap: number;
    /** Monthly amortised HVAC + appliance replacement budget */
    interiorSinkingFund: number;
    /** strataSavingsGap + interiorSinkingFund */
    calculatedMHCC: number;
    /** strataFee + calculatedMHCC — the true monthly maintenance obligation */
    trueMonthlyCost: number;
    immediateCapExRisks: CapExWarning[];
}

// ─── Core Function ────────────────────────────────────────────────────────────

export function calculateMHCC(inputs: MHCCInputs): MHCCResult {
    const {
        yearBuilt,
        squareFootage,
        monthlyStrataFee,
        isRainscreened,
        polyBReplaced,
    } = inputs;

    const propertyAge = MHCC_CONSTANTS.CURRENT_YEAR - yearBuilt;
    const hvacAgeYears = inputs.hvacAgeYears ?? propertyAge;
    const appliancesAgeYears = inputs.appliancesAgeYears ?? propertyAge;

    // ── Step A: Strata Savings Gap ─────────────────────────────────────────────

    const estimatedOperatingCost = squareFootage * MHCC_CONSTANTS.BASE_OPERATING_COST_PER_SQFT;
    const builtInSavings = monthlyStrataFee - estimatedOperatingCost;

    let targetReserveMonthly: number;
    if (propertyAge <= 5) {
        targetReserveMonthly = MHCC_CONSTANTS.RESERVE_TARGET_NEW;
    } else if (propertyAge <= 20) {
        targetReserveMonthly = MHCC_CONSTANTS.RESERVE_TARGET_MID;
    } else {
        targetReserveMonthly = MHCC_CONSTANTS.RESERVE_TARGET_OLD;
    }

    const strataSavingsGap = Math.max(0, targetReserveMonthly - builtInSavings);

    // ── Step B: Interior Sinking Fund ─────────────────────────────────────────

    // HVAC — 15-year lifespan, $9,500 replacement cost
    const hvacRemainingMonths = Math.max(
        1,
        MHCC_CONSTANTS.HVAC_LIFESPAN_YEARS * 12 - hvacAgeYears * 12
    );
    const hvacMonthlyCost = MHCC_CONSTANTS.HVAC_REPLACEMENT_COST / hvacRemainingMonths;

    // Appliances — 12-year lifespan, $8,000 replacement cost
    const applianceRemainingMonths = Math.max(
        1,
        MHCC_CONSTANTS.APPLIANCE_LIFESPAN_YEARS * 12 - appliancesAgeYears * 12
    );
    const applianceMonthlyCost = MHCC_CONSTANTS.APPLIANCE_REPLACEMENT_COST / applianceRemainingMonths;

    const interiorSinkingFund = hvacMonthlyCost + applianceMonthlyCost;

    // ── Step C: Immediate CapEx Risks ─────────────────────────────────────────

    const immediateCapExRisks: CapExWarning[] = [];

    if (
        yearBuilt >= MHCC_CONSTANTS.POLY_B_YEAR_START &&
        yearBuilt <= MHCC_CONSTANTS.POLY_B_YEAR_END &&
        !polyBReplaced
    ) {
        immediateCapExRisks.push({
            issue: 'Potential Poly-B Plumbing',
            estimatedUpfrontCost: MHCC_CONSTANTS.POLY_B_COST,
            note: 'A full repipe in Metro Vancouver typically costs between $10,000 and $20,000.',
        });
    }

    if (
        yearBuilt >= MHCC_CONSTANTS.LEAKY_CONDO_YEAR_START &&
        yearBuilt <= MHCC_CONSTANTS.LEAKY_CONDO_YEAR_END &&
        !isRainscreened
    ) {
        immediateCapExRisks.push({
            issue: 'Potential Leaky Condo Envelope Risk',
            estimatedUpfrontCost: MHCC_CONSTANTS.LEAKY_CONDO_COST,
            note: 'Buildings from this era without a verified rainscreen are at high risk for catastrophic building envelope failure.',
        });
    }

    // ── Step D: Aggregation ───────────────────────────────────────────────────

    const calculatedMHCC = strataSavingsGap + interiorSinkingFund;
    const trueMonthlyCost = monthlyStrataFee + calculatedMHCC;

    return {
        strataFee: monthlyStrataFee,
        strataSavingsGap: round2(strataSavingsGap),
        interiorSinkingFund: round2(interiorSinkingFund),
        calculatedMHCC: round2(calculatedMHCC),
        trueMonthlyCost: round2(trueMonthlyCost),
        immediateCapExRisks,
    };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
