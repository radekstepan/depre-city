import type { MarketModel } from './analysis';
import { CALCULATOR_DEFAULTS } from '../config/calculator';

export interface CalculatorInputs {
    areaCoefVal: number;
    year: number;
    sqft: number;
    bathrooms: number;
    bedrooms: number;
    assessment: number;
    propertyTax: number;
    strataFee: number;
    listPrice?: number;
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
    coefAC: number;
    coefEndUnit: number;
    coefDoubleGarage: number;
    coefTandemGarage: number;
    coefExtraParking: number;
    coefAssessment: number;
    coefHasAssessment: number;
    coefTax: number;
    coefHasTax: number;
    coefFeePerSqft: number;
    coefListPrice: number;
    coefHasListPrice: number;
    isLogLinear: boolean;
    stdError: number;
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
    valAssessment: number;
    valTax: number;
    valFee: number;
}

/**
 * Calculate the predicted price using the model coefficients
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
    
    // Assessment
    const hasAssessment = inputs.assessment > 0 ? 1 : 0;
    const logAssessment = hasAssessment ? Math.log(inputs.assessment) : 0;

    // Property Tax
    const hasTax = inputs.propertyTax > 0 ? 1 : 0;
    const taxPerSqft = (hasTax && inputs.sqft > 0) ? inputs.propertyTax / inputs.sqft : 0;

    // Strata Fee (annual fee per sqft)
    const feePerSqft = (inputs.strataFee > 0 && inputs.sqft > 0) 
        ? (inputs.strataFee * 12) / inputs.sqft 
        : 0;

    // List Price
    const hasListPrice = (inputs.listPrice && inputs.listPrice > 0) ? 1 : 0;
    const logListPrice = hasListPrice ? Math.log(inputs.listPrice) : 0;

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
            (logAssessment * coefficients.coefAssessment) +
            (hasAssessment * coefficients.coefHasAssessment) +
            (taxPerSqft * coefficients.coefTax) +
            (hasTax * coefficients.coefHasTax) +
            (feePerSqft * coefficients.coefFeePerSqft) +
            (logListPrice * coefficients.coefListPrice) +
            (hasListPrice * coefficients.coefHasListPrice) +
            inputs.areaCoefVal;

        return Math.exp(logPrice);
    } else {
        // Linear fallback
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
            (logAssessment * coefficients.coefAssessment) +
            (hasAssessment * coefficients.coefHasAssessment) +
            (taxPerSqft * coefficients.coefTax) +
            (hasTax * coefficients.coefHasTax) +
            (logListPrice * coefficients.coefListPrice) +
            (hasListPrice * coefficients.coefHasListPrice) +
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
        assessment: CALCULATOR_DEFAULTS.assessment,
        propertyTax: CALCULATOR_DEFAULTS.propertyTax,
        strataFee: CALCULATOR_DEFAULTS.fee,
        listPrice: CALCULATOR_DEFAULTS.listPrice,
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
    const { isLogLinear, coefAge, coefCondition, coefBath, coefBedrooms, coefRainscreen, coefAC, coefEndUnit, coefDoubleGarage, coefTandemGarage, coefExtraParking, coefAssessment, coefHasAssessment, coefTax, coefHasTax, coefFeePerSqft } = coefficients;

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

    const hasAssessment = inputs.assessment > 0 ? 1 : 0;
    const logAssessment = hasAssessment ? Math.log(inputs.assessment) : 0;
    const assessmentCoef = (logAssessment * coefAssessment) + (hasAssessment * coefHasAssessment);

    const hasTax = inputs.propertyTax > 0 ? 1 : 0;
    const taxPerSqft = (hasTax && inputs.sqft > 0) ? inputs.propertyTax / inputs.sqft : 0;
    const taxCoef = (taxPerSqft * coefTax) + (hasTax * coefHasTax);

    const feePerSqft = (inputs.strataFee > 0 && inputs.sqft > 0) ? (inputs.strataFee * 12) / inputs.sqft : 0;
    const feeCoef = feePerSqft * coefFeePerSqft;

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

    const pBaselineAssessment = isLogLinear ? finalPrice / Math.exp(assessmentCoef) : finalPrice - assessmentCoef;
    const valAssessment = finalPrice - pBaselineAssessment;

    const pNoTax = isLogLinear ? finalPrice / Math.exp(taxCoef) : finalPrice - taxCoef;
    const valTax = finalPrice - pNoTax;

    const pNoFee = isLogLinear ? finalPrice / Math.exp(feeCoef) : finalPrice - feeCoef;
    const valFee = finalPrice - pNoFee;

    return {
        valLoc,
        valAge,
        valCondition,
        valBath,
        valBeds,
        valParking,
        valFeatures,
        valAssessment,
        valTax,
        valFee
    };
}
