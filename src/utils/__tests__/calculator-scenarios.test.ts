import { describe, it, expect } from 'vitest';
import { predictPrice, type CalculatorInputs, type ModelCoefficients } from '../calculator';
import { CALCULATOR_DEFAULTS } from '../../config/calculator';

/**
 * This test file demonstrates how to test with real model coefficients
 * In production, you would import the actual model from your data
 */

describe('Calculator with Real-World Scenarios', () => {
    // These are example coefficients similar to what the real model produces
    // In production, you could import: import { generateMarketModel } from '../analysis'
    const realisticCoefficients: ModelCoefficients = {
        intercept: 13.5,          // Log-linear intercept
        coefSqft: 0.00025,        // Small positive impact per sqft
        coefAge: -0.008,          // Depreciation per year
        coefBath: 0.04,           // 4% per bathroom
        coefBedrooms: 0.025,      // 2.5% per bedroom
        coefCondition: 0.015,     // 1.5% per condition point
        coefRainscreen: 0.08,     // 8% premium
        coefAC: 0.055,            // 5.5% premium
        coefEndUnit: 0.04,        // 4% premium
        coefDoubleGarage: 0.095,  // 9.5% premium
        coefTandemGarage: 0.065,  // 6.5% premium
        coefExtraParking: 0.025,  // 2.5% per extra spot
        coefAssessment: 0.45,     // Log of assessment
        coefHasAssessment: 0.015, // Having assessment data
        coefTax: -0.0015,         // Negative per $ of tax/sqft
        coefHasTax: -0.008,       // Having tax impacts negatively
        coefFeePerSqft: -0.0012,  // Negative per $ of fee/sqft
        isLogLinear: true,
    };

    describe('Realistic Property Scenarios', () => {
        it('should value a typical Coquitlam townhouse correctly', () => {
            const typicalTownhouse: CalculatorInputs = {
                areaCoefVal: 0,        // Baseline area
                year: 2015,
                sqft: 1500,
                bathrooms: 2.5,
                bedrooms: 3,
                assessment: 875000,
                propertyTax: 3200,
                strataFee: 310,
                condition: 4,
                parkingType: 'double',
                parkingSpots: 2,
                isEndUnit: false,
                hasAC: false,
                isRainscreened: true,
            };

            const price = predictPrice(typicalTownhouse, realisticCoefficients);

            // Should produce a positive, finite price
            // Note: Actual range depends on real model coefficients
            // This test verifies the calculation works, not the exact value
            expect(price).toBeGreaterThan(0);
            expect(isFinite(price)).toBe(true);
        });

        it('should value a premium end unit higher', () => {
            const standardUnit: CalculatorInputs = {
                ...CALCULATOR_DEFAULTS,
                areaCoefVal: 0,
                sqft: 1500,
                year: 2015,
                parkingType: 'double',
                isEndUnit: false,
            };

            const endUnit: CalculatorInputs = {
                ...standardUnit,
                isEndUnit: true,
            };

            const standardPrice = predictPrice(standardUnit, realisticCoefficients);
            const endPrice = predictPrice(endUnit, realisticCoefficients);

            // End unit should be ~4% more (coef = 0.04)
            const premiumPercent = (endPrice - standardPrice) / standardPrice;
            expect(premiumPercent).toBeGreaterThan(0.03);
            expect(premiumPercent).toBeLessThan(0.05);
        });

        it('should show double garage adds significant value', () => {
            const baseInputs: CalculatorInputs = {
                ...CALCULATOR_DEFAULTS,
                areaCoefVal: 0,
                sqft: 1500,
                year: 2015,
            };

            const stdParking = predictPrice(
                { ...baseInputs, parkingType: 'std' },
                realisticCoefficients
            );
            const tandemParking = predictPrice(
                { ...baseInputs, parkingType: 'tandem' },
                realisticCoefficients
            );
            const doubleParking = predictPrice(
                { ...baseInputs, parkingType: 'double' },
                realisticCoefficients
            );

            // Should be ordered: double > tandem > std
            expect(doubleParking).toBeGreaterThan(tandemParking);
            expect(tandemParking).toBeGreaterThan(stdParking);

            // Double garage premium should be ~9.5%
            const doublePremium = (doubleParking - stdParking) / stdParking;
            expect(doublePremium).toBeGreaterThan(0.08);
            expect(doublePremium).toBeLessThan(0.11);
        });

        it('should show age depreciation impact', () => {
            const newProperty: CalculatorInputs = {
                ...CALCULATOR_DEFAULTS,
                areaCoefVal: 0,
                year: 2020, // 6 years old in 2026
                sqft: 1500,
            };

            const oldProperty: CalculatorInputs = {
                ...newProperty,
                year: 2010, // 16 years old in 2026
            };

            const newPrice = predictPrice(newProperty, realisticCoefficients);
            const oldPrice = predictPrice(oldProperty, realisticCoefficients);

            // 10 years older should be worth less
            expect(oldPrice).toBeLessThan(newPrice);

            // Each year depreciates by ~0.8% (coef = -0.008)
            // 10 years = ~8% less
            const depreciationPercent = (newPrice - oldPrice) / newPrice;
            expect(depreciationPercent).toBeGreaterThan(0.06);
            expect(depreciationPercent).toBeLessThan(0.10);
        });

        it('should calculate combined feature impacts correctly', () => {
            const basicProperty: CalculatorInputs = {
                areaCoefVal: 0,
                year: 2015,
                sqft: 1500,
                bathrooms: 2,
                bedrooms: 3,
                assessment: 850000,
                propertyTax: 3000,
                strataFee: 300,
                condition: 3,
                parkingType: 'std',
                parkingSpots: 1,
                isEndUnit: false,
                hasAC: false,
                isRainscreened: false,
            };

            const premiumProperty: CalculatorInputs = {
                ...basicProperty,
                parkingType: 'double',      // +9.5%
                isEndUnit: true,            // +4%
                hasAC: true,                // +5.5%
                isRainscreened: true,       // +8%
                condition: 5,               // +3% (2 points × 1.5%)
            };

            const basicPrice = predictPrice(basicProperty, realisticCoefficients);
            const premiumPrice = predictPrice(premiumProperty, realisticCoefficients);

            // Combined premium should be significant (roughly 30%+)
            const totalPremium = (premiumPrice - basicPrice) / basicPrice;
            expect(totalPremium).toBeGreaterThan(0.25);
            expect(totalPremium).toBeLessThan(0.40);
        });

        it('should handle property tax impact correctly', () => {
            const lowTaxProperty: CalculatorInputs = {
                ...CALCULATOR_DEFAULTS,
                areaCoefVal: 0,
                sqft: 1500,
                propertyTax: 2500,  // Low tax
            };

            const highTaxProperty: CalculatorInputs = {
                ...lowTaxProperty,
                propertyTax: 4500,  // High tax
            };

            const lowTaxPrice = predictPrice(lowTaxProperty, realisticCoefficients);
            const highTaxPrice = predictPrice(highTaxProperty, realisticCoefficients);

            // Higher tax should reduce value
            expect(highTaxPrice).toBeLessThan(lowTaxPrice);
        });

        it('should handle strata fee impact correctly', () => {
            const lowFeeProperty: CalculatorInputs = {
                ...CALCULATOR_DEFAULTS,
                areaCoefVal: 0,
                sqft: 1500,
                strataFee: 250,  // Low fee
            };

            const highFeeProperty: CalculatorInputs = {
                ...lowFeeProperty,
                strataFee: 450,  // High fee
            };

            const lowFeePrice = predictPrice(lowFeeProperty, realisticCoefficients);
            const highFeePrice = predictPrice(highFeeProperty, realisticCoefficients);

            // Higher fee should reduce value
            expect(highFeePrice).toBeLessThan(lowFeePrice);
        });
    });

    describe('Neighborhood Premium Scenarios', () => {
        it('should apply neighborhood premium correctly', () => {
            const baseProperty: CalculatorInputs = {
                ...CALCULATOR_DEFAULTS,
                areaCoefVal: 0,  // Baseline neighborhood
                sqft: 1500,
                year: 2015,
            };

            const premiumNeighborhood: CalculatorInputs = {
                ...baseProperty,
                areaCoefVal: 0.15,  // 15% premium neighborhood (e.g., Burke Mountain)
            };

            const discountNeighborhood: CalculatorInputs = {
                ...baseProperty,
                areaCoefVal: -0.10,  // 10% discount neighborhood
            };

            const basePrice = predictPrice(baseProperty, realisticCoefficients);
            const premiumPrice = predictPrice(premiumNeighborhood, realisticCoefficients);
            const discountPrice = predictPrice(discountNeighborhood, realisticCoefficients);

            // Premium neighborhood should be ~16% more (e^0.15 - 1)
            const premiumPercent = (premiumPrice - basePrice) / basePrice;
            expect(premiumPercent).toBeGreaterThan(0.14);
            expect(premiumPercent).toBeLessThan(0.18);

            // Discount neighborhood should be ~10% less (1 - e^-0.10)
            const discountPercent = (basePrice - discountPrice) / basePrice;
            expect(discountPercent).toBeGreaterThan(0.08);
            expect(discountPercent).toBeLessThan(0.12);
        });
    });
});
