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

const model = generateMarketModel(listings);
console.log('\n--- Model Analysis ---');
console.log(`Strata Fee Coefficient: ${model.coefFeePerSqft.toFixed(6)}`);
console.log(`Strata Fee t-stat: ${model.tStats.coefFeePerSqft.toFixed(4)}`);
console.log(`Model R^2: ${model.modelConfidence.toFixed(4)}`);



