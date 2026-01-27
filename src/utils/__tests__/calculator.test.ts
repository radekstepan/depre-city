import { describe, it, expect } from 'vitest';
import { predictPrice, getDefaultInputs, calculatePriceRange, calculateComponentImpacts, type ModelCoefficients, type CalculatorInputs } from '../calculator';

describe('Calculator Logic', () => {
    // Mock model coefficients (simplified for testing)
    const mockCoefficients: ModelCoefficients = {
        intercept: 13.5,
        coefSqft: 0.0003,
        coefAge: -0.01,
        coefBath: 0.05,
        coefBedrooms: 0.03,
        coefCondition: 0.02,
        coefRainscreen: 0.08,
        coefAC: 0.06,
        coefEndUnit: 0.04,
        coefDoubleGarage: 0.10,
        coefTandemGarage: 0.07,
        coefExtraParking: 0.03,
        coefAssessment: 0.5,
        coefHasAssessment: 0.02,
        coefTax: -0.002,
        coefHasTax: -0.01,
        coefFeePerSqft: -0.001,
        coefListPrice: 0,
        coefHasListPrice: 0,
        isLogLinear: true,
        stdError: 0.15,
    };

    describe('predictPrice', () => {
        it('should calculate baseline price with default inputs', () => {
            const inputs = getDefaultInputs();
            const price = predictPrice(inputs, mockCoefficients);
            
            expect(price).toBeGreaterThan(0);
            expect(typeof price).toBe('number');
            expect(isFinite(price)).toBe(true);
        });

        it('should increase price with larger square footage', () => {
            const inputs = getDefaultInputs();
            const basePrice = predictPrice(inputs, mockCoefficients);
            
            const largerInputs = { ...inputs, sqft: inputs.sqft + 500 };
            const largerPrice = predictPrice(largerInputs, mockCoefficients);
            
            expect(largerPrice).toBeGreaterThan(basePrice);
        });

        it('should decrease price with older year built', () => {
            const inputs = getDefaultInputs();
            const basePrice = predictPrice(inputs, mockCoefficients);
            
            const olderInputs = { ...inputs, year: inputs.year - 10 };
            const olderPrice = predictPrice(olderInputs, mockCoefficients);
            
            expect(olderPrice).toBeLessThan(basePrice);
        });

        it('should increase price with more bathrooms', () => {
            const inputs = getDefaultInputs();
            const basePrice = predictPrice(inputs, mockCoefficients);
            
            const moreBathInputs = { ...inputs, bathrooms: inputs.bathrooms + 1 };
            const moreBathPrice = predictPrice(moreBathInputs, mockCoefficients);
            
            expect(moreBathPrice).toBeGreaterThan(basePrice);
        });

        it('should increase price with double garage', () => {
            const inputs = getDefaultInputs();
            const stdPrice = predictPrice({ ...inputs, parkingType: 'std' }, mockCoefficients);
            const doublePrice = predictPrice({ ...inputs, parkingType: 'double' }, mockCoefficients);
            
            expect(doublePrice).toBeGreaterThan(stdPrice);
        });

        it('should increase price for end unit', () => {
            const inputs = getDefaultInputs();
            const noEndPrice = predictPrice({ ...inputs, isEndUnit: false }, mockCoefficients);
            const endPrice = predictPrice({ ...inputs, isEndUnit: true }, mockCoefficients);
            
            expect(endPrice).toBeGreaterThan(noEndPrice);
        });

        it('should increase price with AC', () => {
            const inputs = getDefaultInputs();
            const noACPrice = predictPrice({ ...inputs, hasAC: false }, mockCoefficients);
            const acPrice = predictPrice({ ...inputs, hasAC: true }, mockCoefficients);
            
            expect(acPrice).toBeGreaterThan(noACPrice);
        });

        it('should increase price with rainscreen', () => {
            const inputs = getDefaultInputs();
            const noRainPrice = predictPrice({ ...inputs, isRainscreened: false }, mockCoefficients);
            const rainPrice = predictPrice({ ...inputs, isRainscreened: true }, mockCoefficients);
            
            expect(rainPrice).toBeGreaterThan(noRainPrice);
        });

        it('should handle extra parking spots', () => {
            const inputs = getDefaultInputs();
            const basePrice = predictPrice({ ...inputs, parkingSpots: 1 }, mockCoefficients);
            const extraPrice = predictPrice({ ...inputs, parkingSpots: 2 }, mockCoefficients);
            
            expect(extraPrice).toBeGreaterThan(basePrice);
        });

        it('should apply assessment coefficient when assessment is provided', () => {
            const inputs = getDefaultInputs();
            const noAssessmentPrice = predictPrice({ ...inputs, assessment: 0 }, mockCoefficients);
            const withAssessmentPrice = predictPrice({ ...inputs, assessment: 900000 }, mockCoefficients);
            
            // With positive assessment coef, price should increase
            expect(withAssessmentPrice).toBeGreaterThan(noAssessmentPrice);
        });

        it('should decrease price with higher property tax', () => {
            const inputs = getDefaultInputs();
            const lowTaxPrice = predictPrice({ ...inputs, propertyTax: 2000 }, mockCoefficients);
            const highTaxPrice = predictPrice({ ...inputs, propertyTax: 5000 }, mockCoefficients);
            
            expect(highTaxPrice).toBeLessThan(lowTaxPrice);
        });

        it('should decrease price with higher strata fee', () => {
            const inputs = getDefaultInputs();
            const lowFeePrice = predictPrice({ ...inputs, strataFee: 200 }, mockCoefficients);
            const highFeePrice = predictPrice({ ...inputs, strataFee: 500 }, mockCoefficients);
            
            expect(highFeePrice).toBeLessThan(lowFeePrice);
        });

        it('should handle area coefficient value', () => {
            const inputs = getDefaultInputs();
            const basePrice = predictPrice({ ...inputs, areaCoefVal: 0 }, mockCoefficients);
            const premiumPrice = predictPrice({ ...inputs, areaCoefVal: 0.1 }, mockCoefficients);
            const discountPrice = predictPrice({ ...inputs, areaCoefVal: -0.1 }, mockCoefficients);
            
            expect(premiumPrice).toBeGreaterThan(basePrice);
            expect(discountPrice).toBeLessThan(basePrice);
        });

        it('should produce consistent results with same inputs', () => {
            const inputs = getDefaultInputs();
            const price1 = predictPrice(inputs, mockCoefficients);
            const price2 = predictPrice(inputs, mockCoefficients);
            
            expect(price1).toBe(price2);
        });

        it('should handle linear model (non-log)', () => {
            const linearCoefficients: ModelCoefficients = {
                ...mockCoefficients,
                intercept: 500000,
                coefSqft: 300,
                isLogLinear: false,
            };
            
            const inputs = getDefaultInputs();
            const price = predictPrice(inputs, linearCoefficients);
            
            expect(price).toBeGreaterThan(0);
            expect(typeof price).toBe('number');
        });

        it('should handle edge cases: zero square footage', () => {
            const inputs = { ...getDefaultInputs(), sqft: 0 };
            const price = predictPrice(inputs, mockCoefficients);
            
            expect(isFinite(price)).toBe(true);
        });

        it('should handle edge cases: very new property', () => {
            const inputs = { ...getDefaultInputs(), year: new Date().getFullYear() };
            const price = predictPrice(inputs, mockCoefficients);
            
            expect(price).toBeGreaterThan(0);
        });

        it('should handle edge cases: very old property', () => {
            const inputs = { ...getDefaultInputs(), year: 1950 };
            const price = predictPrice(inputs, mockCoefficients);
            
            expect(price).toBeGreaterThan(0);
        });
    });

    describe('getDefaultInputs', () => {
        it('should return valid default inputs', () => {
            const defaults = getDefaultInputs();
            
            expect(defaults.sqft).toBeGreaterThan(0);
            expect(defaults.year).toBeGreaterThan(1900);
            expect(defaults.bathrooms).toBeGreaterThan(0);
            expect(defaults.bedrooms).toBeGreaterThan(0);
            expect(defaults.condition).toBeGreaterThan(0);
            expect(defaults.parkingSpots).toBeGreaterThan(0);
            expect(['std', 'tandem', 'double']).toContain(defaults.parkingType);
        });
    });

    describe('calculatePriceRange', () => {
        it('should return valid price range for log-linear model', () => {
            const price = 1000000;
            const range = calculatePriceRange(price, mockCoefficients);
            
            expect(range.lowerBound).toBeLessThan(price);
            expect(range.upperBound).toBeGreaterThan(price);
            expect(range.lowerBound).toBeGreaterThan(0);
        });

        it('should return valid price range for linear model', () => {
            const linearCoefficients: ModelCoefficients = {
                ...mockCoefficients,
                intercept: 500000,
                coefSqft: 300,
                isLogLinear: false,
                stdError: 50000,
            };
            
            const price = 1000000;
            const range = calculatePriceRange(price, linearCoefficients);
            
            expect(range.lowerBound).toBeLessThan(price);
            expect(range.upperBound).toBeGreaterThan(price);
            expect(range.lowerBound).toBeGreaterThan(0);
        });

        it('should be symmetric around price for linear model', () => {
            const linearCoefficients: ModelCoefficients = {
                ...mockCoefficients,
                isLogLinear: false,
                stdError: 50000,
            };
            
            const price = 1000000;
            const range = calculatePriceRange(price, linearCoefficients);
            const lowerDiff = price - range.lowerBound;
            const upperDiff = range.upperBound - price;
            
            expect(Math.abs(lowerDiff - upperDiff)).toBeLessThan(1);
        });
    });

    describe('calculateComponentImpacts', () => {
        it('should calculate component impacts with default inputs', () => {
            const inputs = getDefaultInputs();
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(typeof impacts.valLoc).toBe('number');
            expect(typeof impacts.valAge).toBe('number');
            expect(typeof impacts.valCondition).toBe('number');
            expect(typeof impacts.valBath).toBe('number');
            expect(typeof impacts.valBeds).toBe('number');
            expect(typeof impacts.valParking).toBe('number');
            expect(typeof impacts.valFeatures).toBe('number');
            expect(typeof impacts.valAssessment).toBe('number');
            expect(typeof impacts.valTax).toBe('number');
            expect(typeof impacts.valFee).toBe('number');
        });

        it('should show positive value for premium location', () => {
            const inputs = { ...getDefaultInputs(), areaCoefVal: 0.1 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valLoc).toBeGreaterThan(0);
        });

        it('should show negative value for older property', () => {
            const inputs = { ...getDefaultInputs(), year: 1990 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valAge).toBeLessThan(0);
        });

        it('should show positive value for better condition', () => {
            const inputs = { ...getDefaultInputs(), condition: 5 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valCondition).toBeGreaterThan(0);
        });

        it('should show positive value for extra bathrooms', () => {
            const inputs = { ...getDefaultInputs(), bathrooms: 4 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valBath).toBeGreaterThan(0);
        });

        it('should show positive value for extra bedrooms', () => {
            const inputs = { ...getDefaultInputs(), bedrooms: 4 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valBeds).toBeGreaterThan(0);
        });

        it('should show positive value for double garage', () => {
            const inputs = { ...getDefaultInputs(), parkingType: 'double' as const };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valParking).toBeGreaterThan(0);
        });

        it('should show positive value for amenities (end unit + AC + rain)', () => {
            const inputs = { ...getDefaultInputs(), isEndUnit: true, hasAC: true, isRainscreened: true };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valFeatures).toBeGreaterThan(0);
        });

        it('should show negative value for higher property tax', () => {
            const inputs = { ...getDefaultInputs(), propertyTax: 5000 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valTax).toBeLessThan(0);
        });

        it('should show negative value for higher strata fee', () => {
            const inputs = { ...getDefaultInputs(), strataFee: 500 };
            const impacts = calculateComponentImpacts(inputs, mockCoefficients);
            
            expect(impacts.valFee).toBeLessThan(0);
        });
    });
});
