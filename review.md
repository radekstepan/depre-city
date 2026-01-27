# DepreCity Model Improvement Plan

> **Current Performance:** N = 221, R² = 92.5%
> **Target:** R² > 95% with improved feature significance

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Bugs](#critical-bugs)
3. [Unused Features in Current Data](#unused-features-in-current-data)
4. [New Attributes to Scrape](#new-attributes-to-scrape)
5. [Model Architecture Improvements](#model-architecture-improvements)
6. [Data Quality Issues](#data-quality-issues)
7. [Implementation Roadmap](#implementation-roadmap)
8. [Appendix: Code Changes](#appendix-code-changes)

---

## Executive Summary

The current model achieves 92.5% R², which is strong for a hedonic pricing model. However, several issues are limiting further improvement:

| Issue Type | Count | Estimated R² Impact |
|------------|-------|---------------------|
| Critical Bugs (features not in model) | 2 | +1-3% |
| Unused Scraped Features | 4 | +1-2% |
| Missing High-Value Attributes | 6 | +2-4% |
| Model Specification Issues | 3 | +0.5-1% |

**Total Potential Improvement: 4-10% R² gain**

---

## Critical Bugs

### BUG-001: School Data Not Entering Regression

**Severity:** High  
**Location:** `src/utils/analysis.ts` lines 85-110  
**Impact:** School data is scraped and stored but never used in the model

#### Current Behavior

Schools are extracted in `scripts/process.js` and saved to JSON:

```json
{
  "schools": [
    { "name": "Port Moody Secondary", "rating": 7.5, "distance": "1.3 km", "type": "9-12" },
    { "name": "Moody Elementary", "rating": 4.7, "distance": "0.2 km", "type": "0-5" }
  ]
}
```

But in `analysis.ts`, the X matrix construction **never references** `d.schools`:

```typescript
// Line 95-110 in analysis.ts
const X = validData.map(d => {
    // ... 
    return [
        1, 
        d.sqft, 
        age, 
        baths, 
        beds,
        feePerSqft, 
        condition, 
        isRainscreen, 
        hasAC, 
        isEnd, 
        isDouble, 
        isTandem, 
        ...areaDummies  // ← Schools NEVER appear here
    ];
});
```

#### Why This Matters

School quality is a significant predictor of home prices. Studies show 1-point school rating increase correlates with 2-5% price premium in suburban markets.

#### Why Schools May Still Have Low Impact

Even after fixing, school ratings may show low t-statistics because:

1. **Collinearity with Location Dummies:** "Port Moody - Heritage Mountain" already captures "Heritage Woods Secondary" catchment
2. **Missing Data:** Some listings have empty `schools: []` arrays
3. **Mixed Types:** Elementary vs Secondary ratings aren't comparable

#### Fix Required

See [Appendix A1](#a1-add-school-rating-to-model) for code changes.

---

### BUG-002: Assessment Value Hardcoded to Zero

**Severity:** High  
**Location:** `src/utils/analysis.ts` line 145  
**Impact:** Assessed value (BC Assessment) is scraped but forced to 0

#### Current Behavior

The model defines `coefAssessment` but sets it to 0:

```typescript
// Line 145
coefAssessment: 0, // Placeholder
```

Assessment values are successfully extracted in `process.js` (lines 245-280) from HouseSigma's assessment history table.

#### Why This Matters

BC Assessment values are **extremely predictive** because:
- Government-appraised value based on comparable sales
- Updated annually
- Already accounts for location, size, age, condition
- Available for ~70% of listings in current dataset

#### Caution

Adding assessment may cause **overfitting** since it's essentially another model's prediction. Consider:
- Using `log(assessment)` as a feature
- Using `price / assessment` ratio as the target instead (predicting discount/premium)

#### Fix Required

See [Appendix A2](#a2-add-assessment-to-model) for code changes.

---

## Unused Features in Current Data

These fields are already scraped and stored in JSON but not used in the regression.

### UNUSED-001: Outdoor Space Type

**Field:** `outdoorSpace: "balcony" | "yard" | "rooftop" | "none"`  
**Location:** Every JSON file in `data/json/`  
**Current Usage:** Displayed in UI only, not in model

#### Why It Matters

| Outdoor Type | Typical Buyer | Value Impact |
|--------------|---------------|--------------|
| `yard` | Families with kids/pets | +$30-60k |
| `rooftop` | Urban professionals | +$20-40k |
| `balcony` | Standard | Baseline |
| `none` | Rare for townhomes | -$10-20k |

#### Implementation

Add dummy variables:
```typescript
const hasYard = d.outdoorSpace === 'yard' ? 1 : 0;
const hasRooftop = d.outdoorSpace === 'rooftop' ? 1 : 0;
// balcony/none is baseline
```

---

### UNUSED-002: Number of Levels

**Field:** `levels: number` (1, 2, or 3)  
**Current Usage:** None

#### Why It Matters

- 3-level townhomes often have stairs concerns (seniors avoid)
- 2-level is optimal for most families
- Single-level (rare) commands premium for accessibility

#### Implementation

Add as ordinal or dummies:
```typescript
const is3Level = d.levels === 3 ? 1 : 0;
const is1Level = d.levels === 1 ? 1 : 0;
// 2-level is baseline
```

---

### UNUSED-003: Property Tax

**Field:** `propertyTax: number` (annual amount)  
**Current Usage:** None

#### Why It Matters

Property tax is derived from assessed value × mill rate. Since mill rates vary by municipality, this provides:
- Indirect assessment proxy
- Ongoing cost signal (higher tax = more expensive to own)

#### Implementation

```typescript
// Normalize by sqft to avoid collinearity with size
const taxPerSqft = d.sqft > 0 ? (d.propertyTax || 0) / d.sqft : 0;
```

---

### UNUSED-004: Parking Count

**Field:** `parking: number`  
**Current Usage:** Only parking TYPE is used (garage_double, tandem, etc.)

#### Why It Matters

3 parking spaces vs 2 is significant for families with teens or home businesses.

#### Implementation

```typescript
const extraParking = Math.max(0, (d.parking || 1) - 1);
// 1 space is baseline, each additional adds value
```

---

## New Attributes to Scrape

### HIGH PRIORITY (Expected R² Impact: +1-3%)

#### NEW-001: Walk Score / Transit Score

**What:** Walkability and transit accessibility ratings (0-100)  
**Why:** Extremely predictive in Metro Vancouver where car-optional lifestyle is valued  
**Where to Get:**
- Option A: walkscore.com API (paid, ~$0.01/lookup)
- Option B: Scrape from HouseSigma (sometimes displayed)
- Option C: Calculate proxy from distance to SkyTrain

**Implementation Location:** `scripts/process.js`

```javascript
// Option C: Proxy from description
const descLower = listing.description.toLowerCase();
const nearSkytrain = descLower.includes('skytrain') || 
                     descLower.includes('sky train') ||
                     descLower.includes('steps from') && descLower.includes('station');
listing.transitProximity = nearSkytrain ? 1 : 0;
```

**Better Option:** Add to scraper to capture HouseSigma's displayed scores:

```javascript
// In content.js or process.js DOM parsing
const walkScoreEl = document.querySelector('.pc-walk-transit-score .walk-score');
const transitScoreEl = document.querySelector('.pc-walk-transit-score .transit-score');
listing.walkScore = walkScoreEl ? parseInt(walkScoreEl.textContent) : null;
listing.transitScore = transitScoreEl ? parseInt(transitScoreEl.textContent) : null;
```

---

#### NEW-002: Days on Market (DOM)

**What:** Number of days listing was active before selling  
**Why:** 
- Indicates pricing accuracy (low DOM = well-priced)
- Stale listings often sell below model prediction
- Helps identify motivated sellers

**Where to Get:** HouseSigma price history section

**Implementation Location:** `scripts/process.js`

```javascript
// Look for listing history
const historyEl = document.querySelector('.pc-price-history');
const listDate = historyEl?.querySelector('.list-date')?.textContent;
const soldDate = historyEl?.querySelector('.sold-date')?.textContent;

if (listDate && soldDate) {
    const dom = Math.round((new Date(soldDate) - new Date(listDate)) / (1000 * 60 * 60 * 24));
    listing.daysOnMarket = dom;
}
```

---

#### NEW-003: Original List Price

**What:** Initial asking price before any reductions  
**Why:**
- Calculate `soldPrice / listPrice` ratio
- Identify market conditions (seller's vs buyer's market)
- Useful for predicting final sale price of active listings

**Where to Get:** HouseSigma price history

**Implementation:**

```javascript
const priceHistory = document.querySelectorAll('.pc-price-history .history-item');
let originalList = null;
priceHistory.forEach(item => {
    const type = item.querySelector('.type')?.textContent?.toLowerCase();
    if (type?.includes('list')) {
        const price = cleanNumber(item.querySelector('.price')?.textContent);
        if (!originalList || price > originalList) originalList = price;
    }
});
listing.originalListPrice = originalList;
listing.listToSoldRatio = originalList ? listing.price / originalList : null;
```

---

### MEDIUM PRIORITY (Expected R² Impact: +0.5-1%)

#### NEW-004: Exposure / Facing Direction

**What:** Primary unit exposure (North/South/East/West)  
**Why:** South-facing units get more natural light, command 2-5% premium  
**Where to Get:** 
- Often in description ("south-facing", "eastern exposure")
- Sometimes in HouseSigma features

**Implementation:**

```javascript
const descLower = listing.description.toLowerCase();
let exposure = 'unknown';
if (descLower.includes('south facing') || descLower.includes('south-facing') || descLower.includes('southern exposure')) {
    exposure = 'south';
} else if (descLower.includes('north facing') || descLower.includes('north-facing')) {
    exposure = 'north';
} else if (descLower.includes('east facing') || descLower.includes('west facing')) {
    exposure = descLower.includes('east') ? 'east' : 'west';
}
listing.exposure = exposure;
```

---

#### NEW-005: View Type

**What:** Primary view (Mountain, Water, City, Park, None)  
**Why:** Water/mountain views in Vancouver = significant premium  
**Where to Get:** Description parsing

**Implementation:**

```javascript
const descLower = listing.description.toLowerCase();
let viewType = 'none';
if (descLower.includes('ocean view') || descLower.includes('water view') || descLower.includes('inlet view')) {
    viewType = 'water';
} else if (descLower.includes('mountain view')) {
    viewType = 'mountain';
} else if (descLower.includes('city view') || descLower.includes('downtown view')) {
    viewType = 'city';
} else if (descLower.includes('park view') || descLower.includes('garden view')) {
    viewType = 'park';
}
listing.viewType = viewType;
```

---

#### NEW-006: Pet Restrictions

**What:** Whether pets are allowed and any size limits  
**Why:** No-pet buildings restrict buyer pool, typically 3-5% discount  
**Where to Get:** HouseSigma features list or description

**Implementation:**

```javascript
const descLower = listing.description.toLowerCase();
const petsAllowed = descLower.includes('pets allowed') || 
                    descLower.includes('pet friendly') ||
                    descLower.includes('cats and dogs') ||
                    descLower.includes('no pet restrictions');
const noPets = descLower.includes('no pets') || descLower.includes('pets not allowed');
listing.petsAllowed = noPets ? false : (petsAllowed ? true : null);
```

---

### LOWER PRIORITY (Nice to Have)

| Attribute | Description | Source |
|-----------|-------------|--------|
| `rentalAllowed` | Can unit be rented out | Description/features |
| `evCharging` | EV charging available | Description |
| `builderName` | Developer (Polygon, etc.) | Description |
| `floorLevel` | Which floor (for stacked townhomes) | Description |
| `unitPosition` | Corner vs middle | Already have `isEndUnit` |
| `recentReno` | Kitchen/bath renovated | LLM extraction |
| `storageLocker` | Included storage | Features |

---

## Model Architecture Improvements

### ARCH-001: Add Interaction Terms

**What:** Multiply features to capture combined effects  
**Why:** Larger homes benefit more from high condition; newer buildings benefit more from AC

**Implementation in `analysis.ts`:**

```typescript
// Add after line 90
const sqftCondition = (d.sqft / 1000) * condition;  // Bigger homes get more from renos
const ageAC = age * (hasAC ? 1 : 0);  // AC matters more in older buildings
const sqftYard = (d.sqft / 1000) * (d.outdoorSpace === 'yard' ? 1 : 0);  // Larger townhomes with yards
```

---

### ARCH-002: Polynomial Terms for Age

**What:** Add age² to capture diminishing depreciation  
**Why:** 
- New buildings (0-5 years) lose value quickly as they lose "GST-paid" status.
- Mid-age buildings (15-25 years) face "lumpy" maintenance costs (roof, windows).
- Very old buildings (50+ years) often stabilize or gain value due to "heritage" status or land value.
- A linear `coefAge` cannot capture this "U-shaped" curve.

**Implementation in `analysis.ts`:**
```typescript
const age = currentYear - d.year;
const age2 = Math.pow(age, 2); // Capture non-linear depreciation
```

---

### ARCH-003: Log-Log Specification for SQFT

**What:** Use `ln(sqft)` as a feature instead of raw `sqft`  
**Why:** 
- The marginal value of the 500th square foot is significantly higher than the 2500th.
- Log-transforming both Target (Price) and Predictor (SQFT) allows the coefficient to be interpreted as **elasticity**: "A 1% increase in size leads to a X% increase in price."

**Implementation:**
```typescript
const logSqft = Math.log(d.sqft);
```

---

### ARCH-004: Area-Specific Slopes (Interactions)

**What:** Interaction terms between `sqft` and `areaDummies`  
**Why:** 
- Currently, the model assumes +100 sqft adds the same $ amount in Mission as it does in Vancouver.
- In reality, "Price per SQFT" varies by neighborhood.

**Implementation:**
```typescript
const areaSqftInteraction = areaDummies.map(dummy => dummy * (d.sqft / 1000));
```

---

### ARCH-005: Nonlinear Strata Fee Impact

**What:** Add `fee²` or `fee/sqft` terms  
**Why:** 
- Low fees are expected. Extremely high fees (>$700/mo) significantly restrict the buyer pool and have a disproportionate negative impact on sale price.

---

## Data Quality Issues

### DQ-001: Missing Data Imputation (Assessment)

**Issue:** ~30% of listings are missing assessment data.
**Solution:**
1. **Mean Imputation:** Use the average `Price/Assessment` ratio for that municipality to estimate the missing value.
2. **Indicator Variable:** Add `hasAssessment` (0/1). When 0, set `assessment = 0`. This allows the model to learn the bias associated with listings that hide their assessment.

### DQ-002: Outlier Filtering

**Issue:** Distant outliers (e.g. price < $200k in Metro Van) are usually data entry errors.
**Solution:**
```typescript
const validData = data.filter(d => {
    const pricePerSqft = d.price / d.sqft;
    return pricePerSqft > 300 && pricePerSqft < 2500; // Filter non-market or luxury outliers
});
```

---

## Implementation Roadmap

| Phase | Description | Estimated Effort | Impact |
|-------|-------------|------------------|--------|
| **1: Quick Wins** | Fix School and Assessment bugs in `analysis.ts` | 1 hour | +2-4% R² |
| **2: Feature Eng** | Add `outdoorSpace`, `levels`, and interaction terms | 2 hours | +1-2% R² |
| **3: Scraper 2.0** | Update `process.js` to capture WalkScore and DOM | 4 hours | +2-3% R² |
| **4: Advanced** | Implement Log-Log and Polynomial age terms | 2 hours | +0.5% R² |

---

## Appendix: Code Changes

### A1: Add School Rating to Model

In `src/utils/analysis.ts`, update the X matrix mapping:

```typescript
const maxSchoolRating = d.schools && d.schools.length > 0 
    ? Math.max(...d.schools.map(s => s.rating)) 
    : 5.0; // Assume average for missing

// In return array:
return [
    1, 
    d.sqft, 
    // ...
    maxSchoolRating, 
    // ...
];
```

### A2: Add Assessment to Model

To safely add assessment without breaking listings where it is 0:

```typescript
// Use log(Assessment) but handle 0
const logAssessment = d.assessment && d.assessment > 0 ? Math.log(d.assessment) : 0;
const hasAssessment = d.assessment && d.assessment > 0 ? 1 : 0;

// Add both to X matrix to allow model to compensate for missing data
```
