import { describe, it, expect, beforeEach } from 'vitest';
import { predictPrice, type ModelCoefficients, type CalculatorInputs } from '../calculator';

describe('Calculator Form Integration', () => {
    // Mock model coefficients
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
        isLogLinear: true,
        stdError: 0.15,
    };

    let mockFormInputs: CalculatorInputs;

    beforeEach(() => {
        mockFormInputs = {
            areaCoefVal: 0,
            year: 2015,
            sqft: 1500,
            bathrooms: 2,
            bedrooms: 3,
            assessment: 850000,
            propertyTax: 3000,
            strataFee: 300,
            condition: 4,
            parkingType: 'std',
            parkingSpots: 1,
            isEndUnit: false,
            hasAC: false,
            isRainscreened: true,
        };
    });

    describe('Form to Model Data Flow', () => {
        it('should correctly wire number inputs to prediction', () => {
            // Simulate form inputs being read
            const formData = {
                inputYear: '2015',
                inputArea: '1500',
                inputBath: '2',
                inputBeds: '3',
                inputAssessment: '850000',
                inputPropertyTax: '3000',
                inputStrataFee: '300',
                inputCondition: '4',
                inputParkingSpots: '1',
            };

            // Parse form data (simulating what Calculator.astro does)
            const inputs: CalculatorInputs = {
                ...mockFormInputs,
                year: parseFloat(formData.inputYear),
                sqft: parseFloat(formData.inputArea),
                bathrooms: parseFloat(formData.inputBath),
                bedrooms: parseFloat(formData.inputBeds),
                assessment: parseFloat(formData.inputAssessment),
                propertyTax: parseFloat(formData.inputPropertyTax),
                strataFee: parseFloat(formData.inputStrataFee),
                condition: parseInt(formData.inputCondition),
                parkingSpots: parseFloat(formData.inputParkingSpots),
            };

            const price = predictPrice(inputs, mockCoefficients);
            expect(price).toBeGreaterThan(0);
            expect(isFinite(price)).toBe(true);
        });

        it('should correctly wire select dropdown to prediction', () => {
            // Test parking type selection
            const testCases: Array<{ parkingType: 'std' | 'tandem' | 'double'; label: string }> = [
                { parkingType: 'std', label: 'Standard' },
                { parkingType: 'tandem', label: 'Tandem' },
                { parkingType: 'double', label: 'Double' },
            ];

            const prices = testCases.map(tc => {
                const inputs = { ...mockFormInputs, parkingType: tc.parkingType };
                return { type: tc.label, price: predictPrice(inputs, mockCoefficients) };
            });

            // Verify prices are in expected order (double > tandem > std)
            expect(prices[2].price).toBeGreaterThan(prices[1].price); // double > tandem
            expect(prices[1].price).toBeGreaterThan(prices[0].price); // tandem > std
        });

        it('should correctly wire checkbox inputs to prediction', () => {
            // Test checkbox states
            const baseInputs = mockFormInputs;
            const basePrice = predictPrice(baseInputs, mockCoefficients);

            // Test end unit checkbox
            const endUnitPrice = predictPrice(
                { ...baseInputs, isEndUnit: true },
                mockCoefficients
            );
            expect(endUnitPrice).toBeGreaterThan(basePrice);

            // Test AC checkbox
            const acPrice = predictPrice(
                { ...baseInputs, hasAC: true },
                mockCoefficients
            );
            expect(acPrice).toBeGreaterThan(basePrice);

            // Test rainscreen checkbox
            const noRainPrice = predictPrice(
                { ...baseInputs, isRainscreened: false },
                mockCoefficients
            );
            expect(noRainPrice).toBeLessThan(basePrice);
        });

        it('should recalculate when multiple inputs change', () => {
            // Simulate form update scenario
            const initialInputs = mockFormInputs;
            const initialPrice = predictPrice(initialInputs, mockCoefficients);

            // User changes multiple fields
            const updatedInputs: CalculatorInputs = {
                ...initialInputs,
                sqft: 1800, // +300 sqft
                year: 2018, // 3 years newer
                bathrooms: 3, // +1 bath
                parkingType: 'double', // upgrade to double garage
            };

            const updatedPrice = predictPrice(updatedInputs, mockCoefficients);

            // All changes should increase price
            expect(updatedPrice).toBeGreaterThan(initialPrice);
        });
    });

    describe('Model Coefficient Application', () => {
        it('should verify coefficients affect price in expected direction', () => {
            // Positive coefficients should increase price
            const positiveFeatures = [
                { ...mockFormInputs, sqft: mockFormInputs.sqft + 100 },
                { ...mockFormInputs, bathrooms: mockFormInputs.bathrooms + 1 },
                { ...mockFormInputs, isEndUnit: true },
                { ...mockFormInputs, hasAC: true },
            ];

            const basePrice = predictPrice(mockFormInputs, mockCoefficients);

            positiveFeatures.forEach(inputs => {
                const price = predictPrice(inputs, mockCoefficients);
                expect(price).toBeGreaterThan(basePrice);
            });

            // Negative coefficients should decrease price
            const negativeFeatures = [
                { ...mockFormInputs, year: mockFormInputs.year - 10 }, // older = negative age coef
                { ...mockFormInputs, propertyTax: 6000 }, // higher tax
                { ...mockFormInputs, strataFee: 600 }, // higher fee
                { ...mockFormInputs, isRainscreened: false }, // no rainscreen
            ];

            negativeFeatures.forEach(inputs => {
                const price = predictPrice(inputs, mockCoefficients);
                expect(price).toBeLessThan(basePrice);
            });
        });
    });
});
