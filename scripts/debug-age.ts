import fs from 'node:fs';
import path from 'node:path';
import { generateMarketModel } from '../src/utils/analysis.js';

const dataDir = path.join(process.cwd(), 'data/json');
let listings = [];

if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    listings = files.map(file => {
        const filePath = path.join(dataDir, file);
        try {
            const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return Array.isArray(json) ? json : [json];
        } catch (e) { return []; }
    }).flat();
}

// Map listings to remove assessment
const listingsNoAssmt = listings.map(l => ({ ...l, assessment: 0 }));

const model = generateMarketModel(listings);
console.log('--- Full Model (With Assessment) ---');
console.log(`Age Coefficient: ${model.coefAge.toFixed(6)} (t-stat: ${model.tStats.coefAge.toFixed(2)})`);
console.log(`Sqft Coefficient: ${model.coefSqft.toFixed(6)} (t-stat: ${model.tStats.coefSqft.toFixed(2)})`);

const modelNoAssmt = generateMarketModel(listingsNoAssmt);
console.log('\n--- Model WITHOUT Assessment ---');
console.log(`Age Coefficient: ${modelNoAssmt.coefAge.toFixed(6)} (t-stat: ${modelNoAssmt.tStats.coefAge.toFixed(2)})`);
console.log(`Sqft Coefficient: ${modelNoAssmt.coefSqft.toFixed(6)} (t-stat: ${modelNoAssmt.tStats.coefSqft.toFixed(2)})`);

// Let's also test without tax, since tax is based on assessment
const listingsNoAssmtNoTax = listings.map(l => ({ ...l, assessment: 0, propertyTax: 0 }));
const modelNoAssmtNoTax = generateMarketModel(listingsNoAssmtNoTax);
console.log('\n--- Model WITHOUT Assessment and Tax ---');
console.log(`Age Coefficient: ${modelNoAssmtNoTax.coefAge.toFixed(6)} (t-stat: ${modelNoAssmtNoTax.tStats.coefAge.toFixed(2)})`);
console.log(`Sqft Coefficient: ${modelNoAssmtNoTax.coefSqft.toFixed(6)} (t-stat: ${modelNoAssmtNoTax.tStats.coefSqft.toFixed(2)})`);

