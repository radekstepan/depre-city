# Testing the Pricing Calculator

This document explains how to verify that the pricing calculator correctly uses the model and how to validate the accuracy chart.

## Running Tests

We use [Vitest](https://vitest.dev/) for testing. Tests are located in `src/utils/__tests__/`.

### Quick Start

```bash
# Run all tests
yarn test:run

# Run tests in watch mode (auto-rerun on changes)
yarn test

# Run tests with UI
yarn test:ui
```

## Test Coverage

### 1. Calculator Logic Tests (`calculator.test.ts`)

These tests verify that the `predictPrice()` function correctly applies model coefficients:

- ✅ **Baseline calculation**: Ensures default inputs produce a valid price
- ✅ **Square footage**: Verifies larger sqft increases price
- ✅ **Age impact**: Confirms older properties have lower values
- ✅ **Bathrooms/Bedrooms**: Tests that additional rooms increase value
- ✅ **Parking types**: Validates double garage > tandem > standard
- ✅ **Amenities**: Checks end unit, AC, and rainscreen premiums
- ✅ **Assessment alignment**: Verifies BC Assessment coefficient application
- ✅ **Property tax**: Confirms higher taxes decrease value
- ✅ **Strata fees**: Validates higher fees decrease value
- ✅ **Area coefficients**: Tests neighborhood premiums/discounts
- ✅ **Edge cases**: Handles extreme values (zero sqft, very old/new properties)

### 2. Form Integration Tests (`calculator-integration.test.ts`)

These tests verify the data flow from form inputs to model calculations:

- ✅ **Number inputs**: Validates parsing of year, sqft, bathrooms, etc.
- ✅ **Select dropdowns**: Tests parking type selection
- ✅ **Checkboxes**: Verifies end unit, AC, rainscreen toggles
- ✅ **Invalid inputs**: Confirms fallback to defaults for empty/invalid values
- ✅ **Decimal values**: Handles 2.5 bedrooms (den), 2.5 bathrooms
- ✅ **Area premiums**: Tests neighborhood coefficient application
- ✅ **Multiple changes**: Validates recalculation when multiple fields update
- ✅ **Coefficient direction**: Ensures positive/negative coefs work correctly
- ✅ **Accuracy data**: Verifies predicted vs actual calculation for charts

## Manual Verification

### Verifying the Calculator Form

1. **Open the app**: Run `yarn dev` and navigate to the calculator
2. **Check default values**: Form should populate with values from `CALCULATOR_DEFAULTS`
3. **Test incremental changes**:
   - Increase sqft → Price should go up
   - Make property older → Price should go down
   - Add bathrooms → Price should go up
   - Change parking to "Double" → Price should increase
   - Toggle "End Unit" on → Price should increase
   - Toggle "AC" on → Price should increase

4. **Verify value breakdowns**: The right panel shows component values:
   - Area Premium (based on neighborhood selection)
   - Age Impact (negative for older properties)
   - Bathrooms/Bedrooms contributions
   - Parking Value
   - Amenities (AC/End)
   - Assessment Alignment
   - Tax Adjustment (negative)
   - Strata Fee Impact (negative)

### Verifying the Accuracy Chart

The accuracy chart is located in the "Accuracy: Pred vs Actual" section under Market Analysis.

**What it shows:**
- **X-axis**: Actual sale prices from the data
- **Y-axis**: Predicted prices from the model
- **Diagonal line**: Perfect prediction (predicted = actual)
- **Point colors**: 
  - 🟢 Green: < 5% error (good prediction)
  - 🟡 Yellow: 5-15% error (moderate)
  - 🔴 Red: > 15% error (poor prediction)

**How to verify:**
1. Points should cluster around the diagonal line
2. Most points should be green or yellow
3. Hover over points to see:
   - Address
   - Actual price
   - Predicted price
4. Click a point to open the listing URL

**Implementation details:**

The chart is generated in [src/components/Charts.astro](src/components/Charts.astro):

```typescript
// For each listing, calculate predicted price using the model
const accuracyPoints = listings.map(l => {
    // Apply the same formula as the calculator
    const predictedLog = model.intercept +
        (l.sqft * model.coefSqft) +
        (age * model.coefAge) +
        // ... all other coefficients
        
    const predicted = Math.exp(predictedLog);
    
    return {
        actual: l.price,
        predicted: Math.round(predicted),
        address: l.address,
        url: l._sourceUrl
    };
});
```

## Model Consistency Check

To verify the calculator uses the same formula as the accuracy chart:

1. **Run the tests**: `yarn test:run` - All should pass
2. **Check the coefficients**: Both use the same model from `generateMarketModel()`
3. **Compare implementations**:
   - Calculator: `src/utils/calculator.ts` → `predictPrice()`
   - Charts: `src/components/Charts.astro` → inline calculation

The test suite includes a specific test that simulates listing data and verifies the prediction formula matches.

## Understanding the Model

### Log-Linear Regression

The model uses a **log-linear** approach:

```
ln(Price) = β₀ + β₁·sqft + β₂·age + β₃·baths + ... + βₙ·features
Price = e^(ln(Price))
```

**Key points:**
- Coefficients represent **percentage impacts** (approximately)
- Example: `coefAC = 0.06` means AC adds ~6% to price
- For continuous vars (age, sqft), the coefficient is per unit
- For dummy vars (AC, end unit), it's the total impact

### Coefficient Application

The formula in the calculator:

```typescript
const logPrice = intercept +
    (sqft * coefSqft) +
    (age * coefAge) +
    (bathrooms * coefBath) +
    (bedrooms * coefBedrooms) +
    (condition * coefCondition) +
    (isRainscreened * coefRainscreen) +  // 0 or 1
    (isEndUnit * coefEndUnit) +          // 0 or 1
    (isAC * coefAC) +                    // 0 or 1
    parkingCoef +                        // Double/Tandem/Std
    (extraParking * coefExtraParking) +  // Additional spots
    (logAssessment * coefAssessment) +   // Log of BC Assessment
    (hasAssessment * coefHasAssessment) +// 0 or 1
    (taxPerSqft * coefTax) +            // Tax per sqft
    (hasTax * coefHasTax) +             // 0 or 1
    (feePerSqft * coefFeePerSqft) +     // Monthly fee × 12 / sqft
    areaCoefVal;                         // Neighborhood premium

return Math.exp(logPrice);
```

## Troubleshooting

### Tests fail with "Expected X to be greater than Y"

This means a coefficient may have the wrong sign or the formula is incorrect. Check:
1. The coefficient in `generateMarketModel()` (src/utils/analysis.ts)
2. The formula in `predictPrice()` (src/utils/calculator.ts)
3. The feature vector order matches between model generation and prediction

### Calculator shows different price than expected

1. Check the model was regenerated: `yarn process`
2. Verify all form inputs are being read correctly
3. Check browser console for errors
4. Compare with a test case in the test suite

### Accuracy chart shows poor fit

1. Check R² value (should be > 0.7 for good fit)
2. Verify data quality in `data/json/`
3. Review outliers (red points) - may be legitimate or data issues
4. Consider if model needs additional features

## Adding New Tests

When adding new features to the calculator:

1. **Add unit tests** in `calculator.test.ts`:
```typescript
it('should handle new feature correctly', () => {
    const inputs = getDefaultInputs();
    const withFeature = { ...inputs, newFeature: value };
    const price = predictPrice(withFeature, mockCoefficients);
    expect(price).toBeGreaterThan(basePrice);
});
```

2. **Add integration tests** in `calculator-integration.test.ts`:
```typescript
it('should wire new form input to model', () => {
    const formData = { inputNewFeature: 'value' };
    const inputs = { 
        ...mockFormInputs, 
        newFeature: parseFormValue(formData.inputNewFeature) 
    };
    // Assert prediction works
});
```

3. **Update Calculator.astro** to read the new input
4. **Update the model** in `analysis.ts` to generate the coefficient
5. **Run tests**: `yarn test:run`

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Model Implementation](src/utils/analysis.ts)
- [Calculator Logic](src/utils/calculator.ts)
- [Calculator Component](src/components/Calculator.astro)
- [Charts Component](src/components/Charts.astro)
