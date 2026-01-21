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
    
    // Multivariate Coefficients
    intercept: number;
    coefSqft: number;
    coefYear: number;
    coefParking: number; // Value of a "better" parking spot (0-4 scale)
    coefBathroom: number;
    coefEndUnit: number;
    coefAC: number;
    coefCityPM: number; // Port Moody premium (dummy var)
    
    // Legacy support for charts
    baseRateCoq: number;
    premiumPM: number;
    feeIntercept: number;
    feeSlope: number;
    modelConfidence: number;
}

export function generateMarketModel(data: Listing[]): MarketModel {
    // Filter invalid data
    const validData = data.filter(d => d.price > 100000 && d.sqft > 300 && d.year > 1900);

    // --- Prepare Data for OLS ---
    
    // Y: Price
    const y = validData.map(d => d.price);

    // X: Features [Intercept=1, Sqft, Year, ParkingScore, Baths, EndUnit, HasAC, IsPortMoody]
    const X = validData.map(d => {
        // Encode Parking: Street=0, Other=1, Underground=2, Carport=3, Tandem=4, Double=6
        let parkingScore = 1;
        if (d.parkingType === 'street') parkingScore = 0;
        if (d.parkingType === 'underground') parkingScore = 2;
        if (d.parkingType === 'carport') parkingScore = 3;
        if (d.parkingType === 'garage_tandem') parkingScore = 4;
        if (d.parkingType === 'garage_double') parkingScore = 6;
        if (!d.parkingType && d.parking) parkingScore = d.parking; // Fallback to raw count

        const isPM = d.city.toLowerCase().includes('port moody') ? 1 : 0;
        const isEnd = d.isEndUnit ? 1 : 0;
        const hasAC = d.hasAC ? 1 : 0;
        const baths = d.bathrooms || 1;

        return [1, d.sqft, d.year, parkingScore, baths, isEnd, hasAC, isPM];
    });

    // Run Regression
    // Betas: [Intercept, Sqft, Year, Parking, Bath, End, AC, CityPM]
    const betas = solveOLS(X, y);

    // Fallback if regression fails (all zeros)
    if (betas.every(b => b === 0) && validData.length > 0) {
        // Fallback to simple averages
        const avgPrice = ss.mean(y);
        betas[0] = avgPrice;
    }

    // --- Legacy / Visualization Metrics ---
    const coqData = validData.filter(d => d.city.toLowerCase().includes('coquitlam') && !d.city.toLowerCase().includes('port coquitlam'));
    const pmData = validData.filter(d => d.city.toLowerCase().includes('port moody'));
    
    // Base Rate (Raw average for Coquitlam)
    const baseRateCoq = coqData.length > 0 
        ? Math.round(ss.mean(coqData.map(d => d.price / d.sqft)))
        : 0;
        
    // Fee Regression
    const feePoints = validData.filter(d => d.fee > 0).map(d => [d.sqft, d.fee]);
    const feeReg = feePoints.length > 2 ? ss.linearRegression(feePoints) : { m: 0, b: 0 };

    return {
        generatedAt: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
        sampleSize: validData.length,
        
        // Regression Coefficients
        intercept: Math.round(betas[0]),
        coefSqft: Math.round(betas[1]),
        coefYear: Math.round(betas[2]),
        coefParking: Math.round(betas[3]),
        coefBathroom: Math.round(betas[4]),
        coefEndUnit: Math.round(betas[5]),
        coefAC: Math.round(betas[6]),
        coefCityPM: Math.round(betas[7]),

        // Legacy / Visuals
        baseRateCoq,
        premiumPM: 1.10, // Hardcoded for visual chart line only, calculator uses betas
        feeIntercept: feeReg.b,
        feeSlope: feeReg.m,
        modelConfidence: 0.85 // Placeholder for R2 of multivariate
    };
}
