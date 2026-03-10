import type { MarketModel } from './analysis';
import { CALCULATOR_DEFAULTS } from '../config/calculator';

export interface CalculatorInputs {
    areaCoefVal: number;
    year: number;
    sqft: number;
    bathrooms: number;
    bedrooms: number;
    listPrice?: number;
    fee?: number;        // Monthly strata fee — improves model accuracy
    assessment?: number; // BC Assessed Value — significantly improves accuracy
    condition: number;
    parkingType: 'std' | 'tandem' | 'double';
    parkingSpots: number;
    isEndUnit: boolean;
    hasAC: boolean;
    isRainscreened: boolean;
}

export interface ModelCoefficients {
    intercept: number;
    coefSqft: number;
    coefAge: number;
    coefBath: number;
    coefBedrooms: number;
    coefCondition: number;
    coefRainscreen: number;
    coefFee: number;
    coefAssessment: number;
    coefAC: number;
    coefEndUnit: number;
    coefDoubleGarage: number;
    coefTandemGarage: number;
    coefExtraParking: number;
    isLogLinear: boolean;
    stdError: number;
    meanLogFee: number;        // Training-set mean — used as fallback
    meanLogAssessment: number; // Training-set mean — used as fallback
}

export interface PriceRange {
    lowerBound: number;
    upperBound: number;
}

export interface ComponentImpacts {
    valLoc: number;
    valAge: number;
    valCondition: number;
    valBath: number;
    valBeds: number;
    valParking: number;
    valFeatures: number;
}

/**
 * Calculate the predicted price using the model coefficients
 * This calculates "Fair Market Value" (Intrinsic) without List Price bias
 * @param inputs - Calculator form inputs
 * @param coefficients - Model coefficients
 * @returns Predicted price
 */
export function predictPrice(
    inputs: CalculatorInputs,
    coefficients: ModelCoefficients
): number {
    const currentYear = new Date().getFullYear();
    const age = currentYear - inputs.year;

    // Parking
    const extraParking = Math.max(0, inputs.parkingSpots - 1);
    let valParkingCoef = 0;
    if (inputs.parkingType === 'double') valParkingCoef = coefficients.coefDoubleGarage;
    if (inputs.parkingType === 'tandem') valParkingCoef = coefficients.coefTandemGarage;

    // Convert boolean to binary
    const isEnd = inputs.isEndUnit ? 1 : 0;
    const isAC = inputs.hasAC ? 1 : 0;
    const isRain = inputs.isRainscreened ? 1 : 0;

    if (coefficients.isLogLinear) {
        // ln(Price) = Intercept + Coefs...
        // fee and assessment: use user value when provided, otherwise fall back to training-set mean
        const logFee = (inputs.fee && inputs.fee > 0) ? Math.log(inputs.fee) : coefficients.meanLogFee;
        const logAssessment = (inputs.assessment && inputs.assessment > 0) ? Math.log(inputs.assessment) : coefficients.meanLogAssessment;

        const logPrice = coefficients.intercept +
            (inputs.sqft * coefficients.coefSqft) +
            (age * coefficients.coefAge) +
            (inputs.bathrooms * coefficients.coefBath) +
            (inputs.bedrooms * coefficients.coefBedrooms) +
            (inputs.condition * coefficients.coefCondition) +
            (isRain * coefficients.coefRainscreen) +
            (isEnd * coefficients.coefEndUnit) +
            (isAC * coefficients.coefAC) +
            valParkingCoef +
            (extraParking * coefficients.coefExtraParking) +
            (logFee * coefficients.coefFee) +
            (logAssessment * coefficients.coefAssessment) +
            inputs.areaCoefVal;

        return Math.exp(logPrice);
    } else {
        // Linear fallback (no fee/assessment term in linear mode)
        return coefficients.intercept +
            (inputs.sqft * coefficients.coefSqft) +
            (age * coefficients.coefAge) +
            (inputs.bathrooms * coefficients.coefBath) +
            (inputs.bedrooms * coefficients.coefBedrooms) +
            (inputs.condition * coefficients.coefCondition) +
            (isRain * coefficients.coefRainscreen) +
            (isEnd * coefficients.coefEndUnit) +
            (isAC * coefficients.coefAC) +
            valParkingCoef +
            (extraParking * coefficients.coefExtraParking) +
            inputs.areaCoefVal;
    }
}

/**
 * Get default calculator inputs
 */
export function getDefaultInputs(): CalculatorInputs {
    return {
        areaCoefVal: CALCULATOR_DEFAULTS.areaCoefVal,
        year: CALCULATOR_DEFAULTS.year,
        sqft: CALCULATOR_DEFAULTS.sqft,
        bathrooms: CALCULATOR_DEFAULTS.bathrooms,
        bedrooms: CALCULATOR_DEFAULTS.bedrooms,
        listPrice: CALCULATOR_DEFAULTS.listPrice,
        fee: CALCULATOR_DEFAULTS.fee,
        assessment: CALCULATOR_DEFAULTS.assessment,
        condition: CALCULATOR_DEFAULTS.condition,
        parkingType: CALCULATOR_DEFAULTS.parkingType as 'std' | 'tandem' | 'double',
        parkingSpots: CALCULATOR_DEFAULTS.parkingSpots,
        isEndUnit: CALCULATOR_DEFAULTS.isEndUnit,
        hasAC: CALCULATOR_DEFAULTS.hasAC,
        isRainscreened: CALCULATOR_DEFAULTS.isRainscreened,
    };
}

/**
 * Calculate the price range (80% confidence interval)
 * @param price - Predicted price
 * @param coefficients - Model coefficients (must include stdError)
 * @returns Price range with lower and upper bounds
 */
export function calculatePriceRange(
    price: number,
    coefficients: Pick<ModelCoefficients, 'isLogLinear' | 'stdError'>
): PriceRange {
    const { isLogLinear, stdError } = coefficients;
    const z = 1.28; // 80% CI

    let lowerBound: number;
    let upperBound: number;

    if (isLogLinear) {
        const margin = Math.exp(z * stdError);
        lowerBound = price / margin;
        upperBound = price * margin;
    } else {
        lowerBound = price - (z * stdError);
        upperBound = price + (z * stdError);
    }

    return { lowerBound, upperBound };
}

/**
 * Calculate the component impacts (value breakdown) for a given prediction
 * @param inputs - Calculator form inputs
 * @param coefficients - Model coefficients
 * @returns Component impact values
 */
export function calculateComponentImpacts(
    inputs: CalculatorInputs,
    coefficients: ModelCoefficients
): ComponentImpacts {
    const finalPrice = predictPrice(inputs, coefficients);
    const { isLogLinear, coefAge, coefCondition, coefBath, coefBedrooms, coefRainscreen, coefAC, coefEndUnit, coefDoubleGarage, coefTandemGarage, coefExtraParking } = coefficients;

    const currentYear = new Date().getFullYear();
    const age = currentYear - inputs.year;

    const condition = inputs.condition;
    const baths = inputs.bathrooms;
    const beds = inputs.bedrooms;

    const extraParking = Math.max(0, inputs.parkingSpots - 1);
    let parkCoef = 0;
    if (inputs.parkingType === 'double') parkCoef = coefDoubleGarage;
    if (inputs.parkingType === 'tandem') parkCoef = coefTandemGarage;
    const totalParkingCoef = parkCoef + (extraParking * coefExtraParking);

    const isEnd = inputs.isEndUnit ? 1 : 0;
    const isAC = inputs.hasAC ? 1 : 0;
    const isRain = inputs.isRainscreened ? 1 : 0;
    const amenitiesCoef = (isEnd * coefEndUnit) + (isAC * coefAC) + (isRain * coefRainscreen);

    // Calculate impacts
    const valLoc = finalPrice - (isLogLinear ? finalPrice / Math.exp(inputs.areaCoefVal) : 0);

    const pNoAge = isLogLinear ? finalPrice / Math.exp(age * coefAge) : finalPrice - (age * coefAge);
    const valAge = finalPrice - pNoAge;

    const pCond1 = isLogLinear ? finalPrice / Math.exp((condition - 1) * coefCondition) : finalPrice - ((condition - 1) * coefCondition);
    const valCondition = finalPrice - pCond1;

    const p1Bath = isLogLinear ? finalPrice / Math.exp((baths - 1) * coefBath) : finalPrice - ((baths - 1) * coefBath);
    const valBath = finalPrice - p1Bath;

    const p2Beds = isLogLinear ? finalPrice / Math.exp((beds - 2) * coefBedrooms) : finalPrice - ((beds - 2) * coefBedrooms);
    const valBeds = finalPrice - p2Beds;

    const pNoParking = isLogLinear ? finalPrice / Math.exp(totalParkingCoef) : finalPrice - totalParkingCoef;
    const valParking = finalPrice - pNoParking;

    const pNoAmenities = isLogLinear ? finalPrice / Math.exp(amenitiesCoef) : finalPrice - amenitiesCoef;
    const valFeatures = finalPrice - pNoAmenities;

    return {
        valLoc,
        valAge,
        valCondition,
        valBath,
        valBeds,
        valParking,
        valFeatures
    };
}
