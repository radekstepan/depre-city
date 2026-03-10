#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dir = path.join(__dirname, '..', 'data', 'json');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const listings = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

const valid = listings.filter(d => d.price > 100000 && d.sqft > 300 && d.year > 1900 && d.fee > 0);

console.log('Total listings:', listings.length, '/ with fee:', valid.length);

const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

function corr(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
    ys.reduce((s, y) => s + (y - my) ** 2, 0)
  );
  return den === 0 ? 0 : num / den;
}

// Simple 2-predictor OLS residualiser
function residualise(y, x1, x2) {
  const mx1 = mean(x1), mx2 = mean(x2), my = mean(y);
  const s11 = x1.reduce((s, v) => s + (v - mx1) ** 2, 0);
  const s22 = x2.reduce((s, v) => s + (v - mx2) ** 2, 0);
  const s12 = x1.reduce((s, v, i) => s + (v - mx1) * (x2[i] - mx2), 0);
  const sy1 = x1.reduce((s, v, i) => s + (v - mx1) * (y[i] - my), 0);
  const sy2 = x2.reduce((s, v, i) => s + (v - mx2) * (y[i] - my), 0);
  const det = s11 * s22 - s12 * s12;
  const b1 = (sy1 * s22 - sy2 * s12) / det;
  const b2 = (sy2 * s11 - sy1 * s12) / det;
  const a = my - b1 * mx1 - b2 * mx2;
  return y.map((v, i) => v - (a + b1 * x1[i] + b2 * x2[i]));
}

const prices = valid.map(d => d.price);
const fees = valid.map(d => d.fee);
const years = valid.map(d => d.year);
const sqfts = valid.map(d => d.sqft);
const feePerSqft = valid.map(d => d.fee / d.sqft);

console.log('\n--- Raw correlations with Sale Price ---');
console.log('fee vs price:        ', corr(fees, prices).toFixed(4));
console.log('fee/sqft vs price:   ', corr(feePerSqft, prices).toFixed(4));
console.log('year vs price:       ', corr(years, prices).toFixed(4));
console.log('sqft vs price:       ', corr(sqfts, prices).toFixed(4));

// Partial correlation — fee/sqft vs price AFTER controlling for sqft and age
const logPrice = valid.map(d => Math.log(d.price));
const logSqft = valid.map(d => Math.log(d.sqft));
const age = valid.map(d => 2026 - d.year);
const logFeePerSqft = valid.map(d => Math.log(d.fee / d.sqft));

const priceResid = residualise(logPrice, logSqft, age);
const feeResid = residualise(logFeePerSqft, logSqft, age);

console.log('\n--- Partial corr: log(fee/sqft) vs log(price), controlling for sqft+age ---');
console.log('Partial r:', corr(feeResid, priceResid).toFixed(4));

// R² improvement test (simple: add fee/sqft to a sqft+age model)
// R² of sqft+age model
function r2(y, yHat) {
  const my = mean(y);
  const ss_res = y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);
  const ss_tot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  return 1 - ss_res / ss_tot;
}

const r2_base = r2(logPrice, logPrice.map((v, i) => v - priceResid[i]));

// Now regress logPrice on logSqft + age + logFeePerSqft (3 predictors via successive residualisation)
const feeResid2 = residualise(logFeePerSqft, logSqft, age);
const b_fee = corr(feeResid2, logPrice) *
  Math.sqrt(logPrice.reduce((s,v)=>s+(v-mean(logPrice))**2,0) /
             feeResid2.reduce((s,v)=>s+(v-mean(feeResid2))**2,0));
// Full fitted values: base + b_fee * feeResid
const yHatFull = logPrice.map((v, i) => (v - priceResid[i]) + b_fee * feeResid2[i]);
const r2_full = r2(logPrice, yHatFull);

console.log('\n--- R² improvement from adding fee/sqft ---');
console.log('Base model  (sqft+age): R² =', r2_base.toFixed(4));
console.log('+ fee/sqft:             R² =', r2_full.toFixed(4));
console.log('Delta R²:               ', (r2_full - r2_base).toFixed(4));

// Fee quintile → price/sqft
const sorted = valid.map(d => ({ ...d, psqft: d.price / d.sqft })).sort((a, b) => a.fee - b.fee);
const q = Math.floor(sorted.length / 5);
console.log('\n--- Fee Quintile → Median $/sqft ---');
for (let i = 0; i < 5; i++) {
  const chunk = sorted.slice(i * q, (i + 1) * q);
  const feeRange = '$' + chunk[0].fee + '–$' + chunk[chunk.length - 1].fee;
  const psqfts = chunk.map(d => d.psqft).sort((a, b) => a - b);
  const med = psqfts[Math.floor(psqfts.length / 2)];
  const avgFee = mean(chunk.map(d => d.fee));
  console.log(`Q${i+1} fee ${feeRange} (avg $${Math.round(avgFee)}): median $${Math.round(med)}/sqft, n=${chunk.length}`);
}

// Where is fee MISSING?
const noFee = listings.filter(d => !d.fee || d.fee === 0);
console.log('\n--- Listings missing fee:', noFee.length, '/', listings.length, '---');
if (noFee.length > 0) {
  noFee.slice(0, 5).forEach(d => console.log(' ', d.address, '| fee:', d.fee));
}

// Fee distribution
fees.sort((a, b) => a - b);
console.log('\n--- Fee distribution ---');
console.log('Min:', fees[0], '| P25:', fees[Math.floor(fees.length*0.25)],
  '| Median:', fees[Math.floor(fees.length*0.5)],
  '| P75:', fees[Math.floor(fees.length*0.75)], '| Max:', fees[fees.length-1]);
console.log('Mean: $' + Math.round(mean(fees)));
