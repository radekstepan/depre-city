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
    
    // Location Coefficients
    coefBurkeMtn: number;     
    coefCityPM: number;
    
    // Metrics
    feeIntercept: number;
    feeSlope: number;
    modelConfidence: number; // R-squared
    stdError: number;        // Standard Error of the Estimate (for Range)
}

export function generateMarketModel(data: Listing[]): MarketModel {
    // Filter invalid data
    const validData = data.filter(d => d.price > 100000 && d.sqft > 300 && d.year > 1900);

    // --- Prepare Data for OLS ---
    
    // Y: Price
    const y = validData.map(d => d.price);

    const currentYear = new Date().getFullYear();

    // X: Features
    const X = validData.map(d => {
        const age = currentYear - d.year;
        
        // 1. Core Drivers
        const baths = d.bathrooms || 1;
        const fee = d.fee || 0;
        const condition = d.condition || 3; // Default to 'Average' if missing
        const isRainscreen = d.rainscreen ? 1 : 0;

        // 2. Parking Dummies (0/1 flags)
        const isDouble = d.parkingType === 'garage_double' ? 1 : 0;
        const isTandem = d.parkingType === 'garage_tandem' ? 1 : 0;

        // 3. Location Logic
        const fullText = (d.address + " " + d.city + " " + (d.description || "")).toLowerCase();
        
        // Detect Premium Sub-areas
        const isBurke = fullText.includes('burke') || 
                        fullText.includes('smiling creek') || 
                        fullText.includes('partington') || 
                        fullText.includes('gislason') || 
                        fullText.includes('mitchell') || 
                        fullText.includes('princeton') ? 1 : 0;

        const isPM = d.city.toLowerCase().includes('port moody') ? 1 : 0;
        
        const isEnd = d.isEndUnit ? 1 : 0;
        const hasAC = d.hasAC ? 1 : 0;

        // Feature Vector Order:
        // [0:Intercept, 1:Sqft, 2:Age, 3:Bath, 4:Fee, 5:Condition, 6:Rainscreen, 7:AC, 8:End, 9:DoubleG, 10:TandemG, 11:Burke, 12:PM]
        return [1, d.sqft, age, baths, fee, condition, isRainscreen, hasAC, isEnd, isDouble, isTandem, isBurke, isPM];
    });

    // Run Regression
    const betas = solveOLS(X, y);

    // Fallback if matrix singular or empty
    if (betas.every(b => b === 0) && validData.length > 0) {
        betas[0] = ss.mean(y);
    }

    // --- Calculate Model Accuracy (R-squared & Std Error) ---
    let rss = 0; // Residual Sum of Squares
    let tss = 0; // Total Sum of Squares
    const yMean = ss.mean(y);

    X.forEach((row, i) => {
        const predicted = row.reduce((sum, val, idx) => sum + val * betas[idx], 0);
        const actual = y[i];
        rss += Math.pow(actual - predicted, 2);
        tss += Math.pow(actual - yMean, 2);
    });

    const r2 = tss > 0 ? 1 - (rss / tss) : 0;
    
    // Standard Error of the Estimate (SEE)
    // Degrees of freedom = n - p - 1 (where p is predictors excluding intercept)
    const p = X[0].length - 1;
    const n = validData.length;
    const stdError = n > p + 1 ? Math.sqrt(rss / (n - p - 1)) : 0;

    // Fee Regression (Linear) - for calculating "Expected Fee"
    const feePoints = validData.filter(d => d.fee > 0).map(d => [d.sqft, d.fee]);
    const feeReg = feePoints.length > 2 ? ss.linearRegression(feePoints) : { m: 0, b: 0 };

    return {
        generatedAt: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
        sampleSize: validData.length,
        
        // Coefficients
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
        coefBurkeMtn: Math.round(betas[11]),
        coefCityPM: Math.round(betas[12]),

        // Metrics
        feeIntercept: feeReg.b,
        feeSlope: feeReg.m,
        modelConfidence: r2,
        stdError: Math.round(stdError)
    };
}
