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
    // Scraper fields
    description?: string;
    features?: string[];
    // Legacy fields
    bedrooms?: number;
    bathrooms?: number;
    parking?: number;
}

export interface MarketModel {
    generatedAt: string;
    sampleSize: number;
    
    // Core Coefficients
    intercept: number;
    coefSqft: number;
    coefAge: number;
    coefBath: number;
    coefFee: number;
    coefCondition: number;
    coefRainscreen: number;
    
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
        coefFee: number;
        coefCondition: number;
        coefRainscreen: number;
        coefAC: number;
        coefEndUnit: number;
        coefDoubleGarage: number;
        coefTandemGarage: number;
        areaCoefficients: Record<string, number>;
    };
    
    // Metrics
    feeIntercept: number;
    feeSlope: number;
    modelConfidence: number; // R-squared
    stdError: number;        // Standard Error of the Estimate (for Range)
}

function normalizeLocation(city: string, subArea?: string): string {
    const c = city.trim();
    const s = subArea ? subArea.trim() : 'Other';
    // Clean up typical variations if LLM returns "Coquitlam West" as subArea but City is Coquitlam
    return `${c} - ${s}`;
}

export function generateMarketModel(data: Listing[]): MarketModel {
    // Filter invalid data
    const validData = data.filter(d => d.price > 100000 && d.sqft > 300 && d.year > 1900);

    // --- Identify Areas ---
    const allLocations = validData.map(d => normalizeLocation(d.city, d.subArea));
    
    // Count frequencies to pick a reference category (Most common)
    const counts: Record<string, number> = {};
    allLocations.forEach(loc => counts[loc] = (counts[loc] || 0) + 1);
    
    // Sort locations by frequency descending
    const sortedLocations = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const referenceLocation = sortedLocations[0][0]; // Most common area is the baseline
    const distinctAreas = sortedLocations.map(pair => pair[0]).filter(loc => loc !== referenceLocation);

    // --- Prepare Data for OLS ---
    
    // Y: Price
    const y = validData.map(d => d.price);
    const currentYear = new Date().getFullYear();

    // X: Features
    const X = validData.map(d => {
        const age = currentYear - d.year;
        const baths = d.bathrooms || 1;
        const fee = d.fee || 0;
        const condition = d.condition || 3;
        const isRainscreen = d.rainscreen ? 1 : 0;
        const isDouble = d.parkingType === 'garage_double' ? 1 : 0;
        const isTandem = d.parkingType === 'garage_tandem' ? 1 : 0;
        const isEnd = d.isEndUnit ? 1 : 0;
        const hasAC = d.hasAC ? 1 : 0;

        // Current listing location
        const loc = normalizeLocation(d.city, d.subArea);

        // Generate One-Hot Encoding for Areas
        const areaDummies = distinctAreas.map(area => (loc === area ? 1 : 0));

        // Feature Vector Order:
        // [0:Intercept, 1:Sqft, 2:Age, 3:Bath, 4:Fee, 5:Condition, 6:Rainscreen, 7:AC, 8:End, 9:DoubleG, 10:TandemG, ...Areas]
        return [
            1, 
            d.sqft, 
            age, 
            baths, 
            fee, 
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

    // Fallback if matrix singular or empty
    if (betas.every(b => b === 0) && validData.length > 0) {
        betas[0] = ss.mean(y);
    }

    // Map coefficients & t-stats
    const areaCoefMap: Record<string, number> = {};
    const areaTStatMap: Record<string, number> = {};
    
    // Base Case
    areaCoefMap[referenceLocation] = 0; 
    areaTStatMap[referenceLocation] = 0;

    // Other Areas
    distinctAreas.forEach((area, idx) => {
        // betas index offset is 11 (intercept + 10 features)
        areaCoefMap[area] = Math.round(betas[11 + idx]);
        areaTStatMap[area] = tStats[11 + idx];
    });

    // --- Calculate Model Accuracy ---
    let rss = 0;
    let tss = 0;
    const yMean = ss.mean(y);

    X.forEach((row, i) => {
        const predicted = row.reduce((sum, val, idx) => sum + val * betas[idx], 0);
        rss += Math.pow(y[i] - predicted, 2);
        tss += Math.pow(y[i] - yMean, 2);
    });

    const r2 = tss > 0 ? 1 - (rss / tss) : 0;
    const p = X[0].length - 1;
    const n = validData.length;
    const stdError = n > p + 1 ? Math.sqrt(rss / (n - p - 1)) : 0;

    // Fee Regression
    const feePoints = validData.filter(d => d.fee > 0).map(d => [d.sqft, d.fee]);
    const feeReg = feePoints.length > 2 ? ss.linearRegression(feePoints) : { m: 0, b: 0 };

    return {
        generatedAt: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
        sampleSize: validData.length,
        
        intercept: Math.round(betas[0]),
        coefSqft: Math.round(betas[1]),
        coefAge: Math.round(betas[2]),
        coefBath: Math.round(betas[3]),
        coefFee: Math.round(betas[4]),
        coefCondition: Math.round(betas[5]),
        coefRainscreen: Math.round(betas[6]),
        coefAC: Math.round(betas[7]),
        coefEndUnit: Math.round(betas[8]),
        coefDoubleGarage: Math.round(betas[9]),
        coefTandemGarage: Math.round(betas[10]),
        
        areaCoefficients: areaCoefMap,
        areaReference: referenceLocation,

        tStats: {
            intercept: tStats[0],
            coefSqft: tStats[1],
            coefAge: tStats[2],
            coefBath: tStats[3],
            coefFee: tStats[4],
            coefCondition: tStats[5],
            coefRainscreen: tStats[6],
            coefAC: tStats[7],
            coefEndUnit: tStats[8],
            coefDoubleGarage: tStats[9],
            coefTandemGarage: tStats[10],
            areaCoefficients: areaTStatMap
        },

        feeIntercept: feeReg.b,
        feeSlope: feeReg.m,
        modelConfidence: r2,
        stdError: Math.round(stdError)
    };
}
