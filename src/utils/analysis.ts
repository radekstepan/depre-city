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
    rainscreen: boolean;
    condition?: number; // 1-5
    description?: string;
    features?: string[];
    // Legacy fields
    bedrooms?: number;
    bathrooms?: number;
    parking?: number;
    assessment?: number; // New field
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
    coefFee: number;
    coefCondition: number;
    coefRainscreen: number;
    coefAssessment: number; // If available
    
    // Feature Coefficients (Dummy Variables)
    coefAC: number;
    coefEndUnit: number;
    coefDoubleGarage: number; 
    coefTandemGarage: number;
    
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
        coefFee: number;
        coefCondition: number;
        coefRainscreen: number;
        coefAssessment: number;
        coefAC: number;
        coefEndUnit: number;
        coefDoubleGarage: number;
        coefTandemGarage: number;
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
    // Filter invalid data
    const validData = data.filter(d => d.price > 100000 && d.sqft > 300 && d.year > 1900);

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
        // Use Fee per Sqft to avoid colinearity with size
        const feePerSqft = d.sqft > 0 ? (d.fee || 0) / d.sqft : 0;
        const condition = d.condition || 3;
        const isRainscreen = d.rainscreen ? 1 : 0;
        const isDouble = d.parkingType === 'garage_double' ? 1 : 0;
        const isTandem = d.parkingType === 'garage_tandem' ? 1 : 0;
        const isEnd = d.isEndUnit ? 1 : 0;
        const hasAC = d.hasAC ? 1 : 0;
        
        // Log(Assessment) if available, otherwise 0 (and we rely on other factors)
        // Note: In a real prod model, you'd impute missing assessments or run two models.
        // For now, we will exclude assessment from X if > 50% data missing, or just use 0.
        // To keep it simple for this step, we'll omit assessment from the regression X matrix 
        // unless we strictly filter for it. Let's stick to physical attributes for the "Universal" model.
        
        const loc = normalizeLocation(d.city, d.subArea);
        const areaDummies = distinctAreas.map(area => (loc === area ? 1 : 0));

        // Feature Vector Order:
        // [0:Intercept, 1:Sqft, 2:Age, 3:Bath, 4:Bedrooms, 5:FeePerSqft, 6:Condition, 7:Rainscreen, 8:AC, 9:End, 10:DoubleG, 11:TandemG, ...Areas]
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
        // betas index offset is 12 (intercept + 11 features)
        areaCoefMap[area] = betas[12 + idx];
        areaTStatMap[area] = tStats[12 + idx];
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

    return {
        generatedAt: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
        sampleSize: validData.length,
        
        // Coefficients (floats now)
        intercept: betas[0],
        coefSqft: betas[1],
        coefAge: betas[2],
        coefBath: betas[3],
        coefBedrooms: betas[4],
        coefFee: betas[5],
        coefCondition: betas[6],
        coefRainscreen: betas[7],
        coefAC: betas[8],
        coefEndUnit: betas[9],
        coefDoubleGarage: betas[10],
        coefTandemGarage: betas[11],
        coefAssessment: 0, // Placeholder
        
        areaCoefficients: areaCoefMap,
        areaReference: referenceLocation,

        tStats: {
            intercept: tStats[0],
            coefSqft: tStats[1],
            coefAge: tStats[2],
            coefBath: tStats[3],
            coefBedrooms: tStats[4],
            coefFee: tStats[5],
            coefCondition: tStats[6],
            coefRainscreen: tStats[7],
            coefAC: tStats[8],
            coefEndUnit: tStats[9],
            coefDoubleGarage: tStats[10],
            coefTandemGarage: tStats[11],
            coefAssessment: 0,
            areaCoefficients: areaTStatMap
        },

        modelConfidence: r2,
        stdError: stdError,
        isLogLinear: true
    };
}
