import * as ss from 'simple-statistics';

export interface Listing {
    address: string;
    city: string;
    sqft: number;
    year: number;
    fee: number;
    price: number;
    rainscreen: boolean;
}

export interface MarketModel {
    generatedAt: string;
    sampleSize: number;
    baseRateCoq: number;     // $/sqft (Baseline)
    premiumPM: number;       // Multiplier (e.g. 1.15)
    feeIntercept: number;    // Regression 'b'
    feeSlope: number;        // Regression 'm' ($/sqft for fees)
    modelConfidence: number; // R-Squared value (0-1)
}

export function generateMarketModel(data: Listing[]): MarketModel {
    // 1. Segmentation
    const coqData = data.filter(d => d.city === 'Coquitlam');
    const pmData = data.filter(d => d.city === 'Port Moody');

    // 2. Base Rate Calculation (Coquitlam as Baseline)
    // We use Mean Price/Sqft for robustness, though Linear Regression Slope is also valid.
    // For "Price Per Sqft" benchmarks, Mean is often more intuitive for the end-user.
    const coqPsqft = coqData.map(d => d.price / d.sqft);
    const baseRateCoq = Math.round(ss.mean(coqPsqft));

    // 3. Premium Calculation
    const pmPsqft = pmData.map(d => d.price / d.sqft);
    const pmMean = ss.mean(pmPsqft);
    const premiumPM = parseFloat((pmMean / baseRateCoq).toFixed(3));

    // 4. Strata Fee Regression (Fee vs Sqft)
    // We want to know: What is the "Fair" fee for a unit of X size?
    // y = mx + b
    const feePoints = data.map(d => [d.sqft, d.fee]);
    const feeRegression = ss.linearRegression(feePoints);
    
    // 5. Model Confidence (R-Squared of Price vs Sqft)
    const pricePoints = data.map(d => [d.sqft, d.price]);
    const priceRegression = ss.linearRegression(pricePoints);
    const priceRegressionFunc = ss.linearRegressionLine(priceRegression);
    const rSquared = ss.rSquared(pricePoints, priceRegressionFunc);

    return {
        generatedAt: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
        sampleSize: data.length,
        baseRateCoq,
        premiumPM,
        feeIntercept: feeRegression.b,
        feeSlope: feeRegression.m,
        modelConfidence: parseFloat(rSquared.toFixed(2))
    };
}
