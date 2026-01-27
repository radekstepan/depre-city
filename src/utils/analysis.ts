import * as ss from 'simple-statistics';
import { solveOLS } from './matrix';
import type { DeepData } from './llm';

export interface Listing extends Partial<DeepData> {
    address: string;
    city: string;
    sqft: number;
    year: number;
    fee: number;
    price: number;
    listPrice?: number; // Original asking price
    rainscreen: boolean;
    condition?: number; // 1-5
    description?: string;
    features?: string[];
    // Legacy fields
    bedrooms?: number;
    bathrooms?: number;
    parking?: number;
    assessment?: number; // New field
    propertyTax?: number; // Annual property tax
    schools?: { name: string, rating: number, type: string, distance: string }[];
}

export interface MarketModel {
    generatedAt: string;
    sampleSize: number;

    // Core Coefficients (Log-Linear: These represent % change, roughly)
    intercept: number;
    coefSqft: number;
    coefAge: number;
    coefBath: number;
    coefBedrooms: number;
    coefCondition: number;
    coefRainscreen: number;
    coefAssessment: number; // If available
    coefTax: number;
    coefHasTax: number;
    coefFeePerSqft: number; // Annual strata fee per sqft

    // Market Heat (Derived separately, not in regression)
    listPriceHeat: number; // Avg Sold/List Ratio

    // Feature Coefficients (Dummy Variables)
    coefAC: number;
    coefEndUnit: number;
    coefDoubleGarage: number;
    coefTandemGarage: number;
    coefExtraParking: number;
    coefHasAssessment: number;

    // Location Coefficients (Dynamic)
    areaCoefficients: Record<string, number>;
    areaReference: string;

    // Significance (T-Statistics)
    tStats: {
        intercept: number;
        coefSqft: number;
        coefAge: number;
        coefBath: number;
        coefBedrooms: number;
        coefCondition: number;
        coefRainscreen: number;
        coefAssessment: number;
        coefHasAssessment: number;
        coefTax: number;
        coefHasTax: number;
        coefFeePerSqft: number;
        coefAC: number;
        coefEndUnit: number;
        coefDoubleGarage: number;
        coefTandemGarage: number;
        coefExtraParking: number;
        areaCoefficients: Record<string, number>;
    };

    // Metrics
    modelConfidence: number; // R-squared
    stdError: number;        // Standard Error (in Log Scale)
    isLogLinear: boolean;    // Flag for UI
}

function normalizeLocation(city: string, subArea?: string): string {
    const c = city.trim();
    const s = subArea ? subArea.trim() : 'Other';
    return `${c} - ${s}`;
}

export function generateMarketModel(data: Listing[]): MarketModel {
    // Filter invalid data - townhouses should all have strata fees
    const validData = data.filter(d => {
        const isValid = d.price > 100000 && d.sqft > 300 && d.year > 1900 && d.fee > 0;
        if (!isValid && d.price > 100000 && d.sqft > 300 && d.year > 1900 && (!d.fee || d.fee === 0)) {
            console.warn(`⚠️  Excluding listing without strata fee: ${d.address}`);
        }
        return isValid;
    });

    // --- Calculate Market Heat (Sold / List Ratio) ---
    // We calculate this separately so it doesn't absorb feature variance in the OLS
    const validListings = validData.filter(d => d.listPrice && d.listPrice > 0);
    const listPriceHeat = validListings.length > 0
        ? validListings.reduce((sum, d) => sum + (d.price / d.listPrice!), 0) / validListings.length
        : 1.0;

    // --- Identify Areas ---
    const allLocations = validData.map(d => normalizeLocation(d.city, d.subArea));
    const counts: Record<string, number> = {};
    allLocations.forEach(loc => counts[loc] = (counts[loc] || 0) + 1);
    const sortedLocations = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const referenceLocation = sortedLocations[0][0];
    const distinctAreas = sortedLocations.map(pair => pair[0]).filter(loc => loc !== referenceLocation);

    // --- Prepare Data for Log-Linear OLS ---
    // Model: ln(Price) = Beta0 + Beta1*Sqft + Beta2*Age ...
    
    const currentYear = new Date().getFullYear();

    // Y: Natural Log of Price
    const y = validData.map(d => Math.log(d.price));

    // X: Features
    const X = validData.map(d => {
        const age = currentYear - d.year;
        const baths = d.bathrooms || 1;
        const beds = d.bedrooms || 2;
        // Strata fee per sqft (normalized like property tax)
        const feePerSqft = d.fee > 0 ? (d.fee * 12) / d.sqft : 0; // Monthly fee * 12 / sqft = annual fee per sqft
        const condition = d.condition || 3;
        const isRainscreen = d.rainscreen ? 1 : 0;
        const isDouble = d.parkingType === 'garage_double' ? 1 : 0;
        const isTandem = d.parkingType === 'garage_tandem' ? 1 : 0;
        const extraParking = Math.max(0, (d.parking || 1) - 1);
        const isEnd = d.isEndUnit ? 1 : 0;
        const hasAC = d.hasAC ? 1 : 0;

        // Assessment: Log-transform and indicator for missing data
        const hasAssessment = (d.assessment && d.assessment > 0) ? 1 : 0;
        const logAssessment = hasAssessment ? Math.log(d.assessment) : 0;

        // Property Tax: Per sqft normalization and indicator for missing data
        const hasTax = (d.propertyTax && d.propertyTax > 0) ? 1 : 0;
        const taxPerSqft = hasTax ? d.propertyTax / d.sqft : 0;

        const loc = normalizeLocation(d.city, d.subArea);
        const areaDummies = distinctAreas.map(area => (loc === area ? 1 : 0));

        // Feature Vector Order:
        // [0:Intercept, 1:Sqft, 2:Age, 3:Bath, 4:Bedrooms, 5:Condition, 6:Rainscreen, 7:AC, 8:End, 9:DoubleG, 10:TandemG, 11:ExtraParking, 12:LogAssessment, 13:HasAssessment, 14:TaxPerSqft, 15:HasTax, 16:FeePerSqft, ...Areas]
        return [
            1,
            d.sqft,
            age,
            baths,
            beds,
            condition,
            isRainscreen,
            hasAC,
            isEnd,
            isDouble,
            isTandem,
            extraParking,
            logAssessment,
            hasAssessment,
            taxPerSqft,
            hasTax,
            feePerSqft,
            ...areaDummies
        ];
    });

    // Run Regression
    const { betas, tStats } = solveOLS(X, y);

    if (betas.every(b => b === 0) && validData.length > 0) {
        betas[0] = ss.mean(y);
    }

    // --- Metrics ---
    
    // Map coefficients
    const areaCoefMap: Record<string, number> = {};
    const areaTStatMap: Record<string, number> = {};
    areaCoefMap[referenceLocation] = 0;
    areaTStatMap[referenceLocation] = 0;

    distinctAreas.forEach((area, idx) => {
        // betas index offset is 17 (intercept + 16 features)
        areaCoefMap[area] = betas[17 + idx];
        areaTStatMap[area] = tStats[17 + idx];
    });

    // R2 Calculation (Log Scale)
    let finalRSS = 0;
    let finalTSS = 0;
    const yMean = ss.mean(y);

    X.forEach((row, i) => {
        const predictedLog = row.reduce((sum, val, idx) => sum + val * betas[idx], 0);
        finalRSS += Math.pow(y[i] - predictedLog, 2);
        finalTSS += Math.pow(y[i] - yMean, 2);
    });

    const r2 = finalTSS > 0 ? 1 - (finalRSS / finalTSS) : 0;
    const p = X[0].length;
    const n = validData.length;
    const stdError = n > p ? Math.sqrt(finalRSS / (n - p)) : 0;
    
    console.log('Model R²:', r2.toFixed(4));
    console.log('Market Heat (Sold/List):', (listPriceHeat * 100).toFixed(2) + '%');
    console.log('Extra Parking Coef:', betas[11].toFixed(4), 't-stat:', tStats[11].toFixed(4));
    console.log('Assessment Coef:', betas[12].toFixed(4), 't-stat:', tStats[12].toFixed(4));

    return {
        generatedAt: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
        sampleSize: validData.length,

        // Coefficients (floats now)
        intercept: betas[0],
        coefSqft: betas[1],
        coefAge: betas[2],
        coefBath: betas[3],
        coefBedrooms: betas[4],
        coefCondition: betas[5],
        coefRainscreen: betas[6],
        coefAC: betas[7],
        coefEndUnit: betas[8],
        coefDoubleGarage: betas[9],
        coefTandemGarage: betas[10],
        coefExtraParking: betas[11],
        coefAssessment: betas[12],
        coefHasAssessment: betas[13],
        coefTax: betas[14],
        coefHasTax: betas[15],
        coefFeePerSqft: betas[16],
        
        listPriceHeat: listPriceHeat,

        areaCoefficients: areaCoefMap,
        areaReference: referenceLocation,

        tStats: {
            intercept: tStats[0],
            coefSqft: tStats[1],
            coefAge: tStats[2],
            coefBath: tStats[3],
            coefBedrooms: tStats[4],
            coefCondition: tStats[5],
            coefRainscreen: tStats[6],
            coefAC: tStats[7],
            coefEndUnit: tStats[8],
            coefDoubleGarage: tStats[9],
            coefTandemGarage: tStats[10],
            coefExtraParking: tStats[11],
            coefAssessment: tStats[12],
            coefHasAssessment: tStats[13],
            coefTax: tStats[14],
            coefHasTax: tStats[15],
            coefFeePerSqft: tStats[16],
            areaCoefficients: areaTStatMap
        },

        modelConfidence: r2,
        stdError: stdError,
        isLogLinear: true
    };
}
