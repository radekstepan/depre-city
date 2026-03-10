import { describe, it, expect } from 'vitest';
import { calculateMHCC, MHCC_CONSTANTS, type MHCCInputs } from '../mhcc';

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseInputs(overrides: Partial<MHCCInputs> = {}): MHCCInputs {
    return {
        yearBuilt: 2010,
        squareFootage: 1200,
        monthlyStrataFee: 550,
        isRainscreened: true,
        polyBReplaced: false,
        ...overrides,
    };
}

// ── Step A: Strata Savings Gap ────────────────────────────────────────────────

describe('Strata Savings Gap', () => {
    it('returns zero gap when strata fee fully funds reserves', () => {
        // Building age 16 → target = $166/mo
        // sqft 1000 → operating = $300
        // strataFee = $600 → builtInSavings = $300 → gap = max(0, 166-300) = 0
        const result = calculateMHCC(baseInputs({
            yearBuilt: 2010,
            squareFootage: 1000,
            monthlyStrataFee: 600,
        }));
        expect(result.strataSavingsGap).toBe(0);
    });

    it('returns positive gap when strata fee under-funds reserves', () => {
        // Building age 22 → target = $250/mo
        // sqft 1000 → operating = $300
        // strataFee = $300 → builtInSavings = $0 → gap = 250
        const result = calculateMHCC(baseInputs({
            yearBuilt: 2004,
            squareFootage: 1000,
            monthlyStrataFee: 300,
        }));
        expect(result.strataSavingsGap).toBe(250);
    });

    it('applies NEW target ($75/mo) for properties ≤ 5 years old', () => {
        // Building age 2 → target = $75
        // sqft 1000 → operating = $300
        // strataFee = $310 → builtInSavings = $10 → gap = max(0, 75-10) = 65
        const result = calculateMHCC(baseInputs({
            yearBuilt: 2024,
            squareFootage: 1000,
            monthlyStrataFee: 310,
        }));
        expect(result.strataSavingsGap).toBe(65);
    });

    it('applies MID target ($166/mo) for properties 6–20 years old', () => {
        // Building age 10 → target = $166
        // sqft 1000 → operating = $300
        // strataFee = $350 → builtInSavings = $50 → gap = max(0, 166-50) = 116
        const result = calculateMHCC(baseInputs({
            yearBuilt: 2016,
            squareFootage: 1000,
            monthlyStrataFee: 350,
        }));
        expect(result.strataSavingsGap).toBe(116);
    });

    it('applies OLD target ($250/mo) for properties > 20 years old', () => {
        // Building age 30 → target = $250
        // sqft 1000 → operating = $300
        // strataFee = $400 → builtInSavings = $100 → gap = max(0, 250-100) = 150
        const result = calculateMHCC(baseInputs({
            yearBuilt: 1996,
            squareFootage: 1000,
            monthlyStrataFee: 400,
        }));
        expect(result.strataSavingsGap).toBe(150);
    });
});

// ── Step B: Interior Sinking Fund ─────────────────────────────────────────────

describe('Interior Sinking Fund', () => {
    it('defaults HVAC and appliances age to building age when not provided', () => {
        // yearBuilt 2006 → age = 20 years
        const resultDefault = calculateMHCC(baseInputs({ yearBuilt: 2006 }));
        const resultExplicit = calculateMHCC(baseInputs({ yearBuilt: 2006, hvacAgeYears: 20, appliancesAgeYears: 20 }));
        expect(resultDefault.interiorSinkingFund).toBeCloseTo(resultExplicit.interiorSinkingFund, 2);
    });

    it('calculates higher monthly cost for older HVAC (less remaining life)', () => {
        const youngHvac = calculateMHCC(baseInputs({ hvacAgeYears: 1, appliancesAgeYears: 1 }));
        const oldHvac = calculateMHCC(baseInputs({ hvacAgeYears: 14, appliancesAgeYears: 11 }));
        expect(oldHvac.interiorSinkingFund).toBeGreaterThan(youngHvac.interiorSinkingFund);
    });

    it('clamps remaining months to 1 when system is past its lifespan', () => {
        // HVAC 20 years old, lifespan 15 → remaining = max(1, -60) = 1 month
        // monthly = 9500/1 = $9,500
        const result = calculateMHCC(baseInputs({ hvacAgeYears: 20, appliancesAgeYears: 1 }));
        const hvacMonthly = MHCC_CONSTANTS.HVAC_REPLACEMENT_COST / 1;
        const applianceMonthly = MHCC_CONSTANTS.APPLIANCE_REPLACEMENT_COST / ((MHCC_CONSTANTS.APPLIANCE_LIFESPAN_YEARS - 1) * 12);
        expect(result.interiorSinkingFund).toBeCloseTo(hvacMonthly + applianceMonthly, 1);
    });

    it('calculates correct sinking fund for brand-new systems', () => {
        // HVAC age 0 → remaining = 180 months → monthly = 9500/180 ≈ 52.78
        // Appliance age 0 → remaining = 144 months → monthly = 8000/144 ≈ 55.56
        const result = calculateMHCC(baseInputs({ hvacAgeYears: 0, appliancesAgeYears: 0 }));
        const expectedHvac = 9500 / (15 * 12);
        const expectedAppliance = 8000 / (12 * 12);
        expect(result.interiorSinkingFund).toBeCloseTo(expectedHvac + expectedAppliance, 2);
    });
});

// ── Step C: Immediate CapEx Risks ─────────────────────────────────────────────

describe('Immediate CapEx Risks', () => {
    describe('Poly-B plumbing', () => {
        it('flags Poly-B for 1970–1999 builds when not replaced', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1985, polyBReplaced: false }));
            const polyB = result.immediateCapExRisks.find(r => r.issue === 'Potential Poly-B Plumbing');
            expect(polyB).toBeDefined();
            expect(polyB?.estimatedUpfrontCost).toBe(15_000);
        });

        it('does NOT flag Poly-B when plumbing has been replaced', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1985, polyBReplaced: true }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Poly-B Plumbing')).toBeUndefined();
        });

        it('does NOT flag Poly-B for 2000+ builds', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 2000, polyBReplaced: false }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Poly-B Plumbing')).toBeUndefined();
        });

        it('flags Poly-B at exact boundary year 1970', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1970, polyBReplaced: false }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Poly-B Plumbing')).toBeDefined();
        });

        it('flags Poly-B at exact boundary year 1999', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1999, polyBReplaced: false }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Poly-B Plumbing')).toBeDefined();
        });
    });

    describe('Leaky Condo risk', () => {
        it('flags leaky condo for 1980–2003 builds without rainscreen', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1992, isRainscreened: false }));
            const leaky = result.immediateCapExRisks.find(r => r.issue === 'Potential Leaky Condo Envelope Risk');
            expect(leaky).toBeDefined();
            expect(leaky?.estimatedUpfrontCost).toBe(50_000);
        });

        it('does NOT flag leaky condo when rainscreened', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1992, isRainscreened: true }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Leaky Condo Envelope Risk')).toBeUndefined();
        });

        it('does NOT flag leaky condo for 2004+ builds', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 2004, isRainscreened: false }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Leaky Condo Envelope Risk')).toBeUndefined();
        });

        it('does NOT flag leaky condo for pre-1980 builds', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 1979, isRainscreened: false }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Leaky Condo Envelope Risk')).toBeUndefined();
        });

        it('flags leaky condo at exact boundary year 2003', () => {
            const result = calculateMHCC(baseInputs({ yearBuilt: 2003, isRainscreened: false }));
            expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Leaky Condo Envelope Risk')).toBeDefined();
        });
    });

    it('can flag BOTH risks simultaneously for a mid-90s non-rainscreened build', () => {
        const result = calculateMHCC(baseInputs({ yearBuilt: 1993, isRainscreened: false, polyBReplaced: false }));
        expect(result.immediateCapExRisks.length).toBe(2);
    });

    it('returns no CapEx risks for a clean 2010 rainscreened build', () => {
        const result = calculateMHCC(baseInputs({ yearBuilt: 2010, isRainscreened: true, polyBReplaced: false }));
        expect(result.immediateCapExRisks.length).toBe(0);
    });
});

// ── Step D: Aggregation ───────────────────────────────────────────────────────

describe('MHCC aggregation', () => {
    it('calculatedMHCC equals strataSavingsGap + interiorSinkingFund', () => {
        const result = calculateMHCC(baseInputs());
        expect(result.calculatedMHCC).toBeCloseTo(result.strataSavingsGap + result.interiorSinkingFund, 2);
    });

    it('trueMonthlyCost equals strataFee + calculatedMHCC', () => {
        const result = calculateMHCC(baseInputs());
        expect(result.trueMonthlyCost).toBeCloseTo(result.strataFee + result.calculatedMHCC, 2);
    });

    it('trueMonthlyCost is always >= strataFee', () => {
        const result = calculateMHCC(baseInputs({ monthlyStrataFee: 200 }));
        expect(result.trueMonthlyCost).toBeGreaterThanOrEqual(result.strataFee);
    });

    it('matches the framework example: older townhouse with low strata fee', () => {
        // yearBuilt 1998 → age 28 → target $250/mo
        // sqft 1500 → operating = $450
        // strataFee $450 → builtInSavings = $0 → gap = $250
        // HVAC/appliances age 28 (past lifespan) → clamped to 1 month each
        // MHCC = 250 + 9500 + 8000 = $17,750 — clearly a large hidden cost
        // Risk window: Poly-B (1970–1999 ✓), Leaky Condo (1980–2003 ✓)
        const result = calculateMHCC({
            yearBuilt: 1998,
            squareFootage: 1500,
            monthlyStrataFee: 450,
            isRainscreened: false,
            polyBReplaced: false,
        });
        expect(result.strataSavingsGap).toBe(250);
        expect(result.calculatedMHCC).toBeGreaterThan(250);
        expect(result.trueMonthlyCost).toBeGreaterThan(result.strataFee);
        // Both CapEx flags should appear
        expect(result.immediateCapExRisks.find(r => r.issue === 'Potential Leaky Condo Envelope Risk')).toBeDefined();
    });
});
