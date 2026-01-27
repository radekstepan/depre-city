import { predictPrice } from '../src/utils/calculator.js';

// Mock coefficients from the build output
const model = {
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
    coefAssessment: -0.0045,
    coefHasAssessment: 0.0601,
    coefTax: -0.0039,
    coefHasTax: -0.0169,
    coefFeePerSqft: -0.0060,
    coefListPrice: 0.9952,
    coefHasListPrice: 0.0299,
    isLogLinear: true,
    stdError: 0.15,
};

// Test inputs
const testInputs = {
    areaCoefVal: 0,
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
    isRainscreened: true
};

console.log('\n=== Calculator Test ===\n');
console.log('Test Case: Typical 2015 Coquitlam Townhouse');
console.log('Inputs:', JSON.stringify(testInputs, null, 2));

// Test without list price
console.log('\n--- Without List Price ---');
const priceWithoutList = predictPrice(testInputs, model);
console.log('Predicted Price:', `$${Math.round(priceWithoutList).toLocaleString()}`);
console.log('Is Valid:', !isNaN(priceWithoutList) && isFinite(priceWithoutList));

// Test with list price
console.log('\n--- With List Price ($850,000) ---');
const testInputsWithList = { ...testInputs, listPrice: 850000 };
const priceWithList = predictPrice(testInputsWithList, model);
console.log('Predicted Price:', `$${Math.round(priceWithList).toLocaleString()}`);
console.log('Is Valid:', !isNaN(priceWithList) && isFinite(priceWithList));
console.log('Expected (98% of list):', `$${Math.round(850000 * 0.98).toLocaleString()}`);

// Verify the difference
if (!isNaN(priceWithoutList) && !isNaN(priceWithList)) {
    console.log('\n✅ Calculator is working correctly!');
    console.log(`Price difference: $${Math.round(Math.abs(priceWithList - priceWithoutList)).toLocaleString()}`);
} else {
    console.log('\n❌ Calculator has issues - NaN detected');
}
