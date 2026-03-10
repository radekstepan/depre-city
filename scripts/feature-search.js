#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dir = path.join(__dirname, '..', 'data', 'json');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const listings = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

const CURRENT_YEAR = 2026;

// Filter: need at minimum price + sqft + year. fee and assessment get separate pools.
const base = listings.filter(d => d.price > 100000 && d.sqft > 300 && d.year > 1900);
const withFee = base.filter(d => d.fee > 0);
const withAll = base.filter(d => d.fee > 0 && d.assessment > 0);

console.log(`Base: ${base.length} | +fee: ${withFee.length} | +fee+assessment: ${withAll.length}\n`);

const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

// Full OLS via normal equations (arbitrary number of predictors)
function ols(Y, X) {
    const n = Y.length;
    const p = X[0].length;
    // XtX and XtY
    const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
    const XtY = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < p; j++) {
            XtY[j] += X[i][j] * Y[i];
            for (let k = 0; k < p; k++) {
                XtX[j][k] += X[i][j] * X[i][k];
            }
        }
    }
    // Gaussian elimination
    const A = XtX.map((row, i) => [...row, XtY[i]]);
    for (let col = 0; col < p; col++) {
        let maxRow = col;
        for (let row = col + 1; row < p; row++) {
            if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
        }
        [A[col], A[maxRow]] = [A[maxRow], A[col]];
        for (let row = col + 1; row < p; row++) {
            const factor = A[row][col] / A[col][col];
            for (let k = col; k <= p; k++) A[row][k] -= factor * A[col][k];
        }
    }
    const betas = new Array(p).fill(0);
    for (let i = p - 1; i >= 0; i--) {
        betas[i] = A[i][p];
        for (let j = i + 1; j < p; j++) betas[i] -= A[i][j] * betas[j];
        betas[i] /= A[i][i];
    }
    // R² and RMSE
    const yHat = X.map(row => row.reduce((s, v, j) => s + v * betas[j], 0));
    const myY = mean(Y);
    const ss_res = Y.reduce((s, v, i) => s + (v - yHat[i]) ** 2, 0);
    const ss_tot = Y.reduce((s, v) => s + (v - myY) ** 2, 0);
    const r2 = 1 - ss_res / ss_tot;
    // Adjusted R²
    const r2adj = 1 - (1 - r2) * (n - 1) / (n - p);
    // RMSE in % of mean price (back-transform from log scale)
    const rmse = Math.sqrt(ss_res / (n - p));
    return { betas, r2, r2adj, rmse };
}

function evaluate(data, featureFns, label) {
    const Y = data.map(d => Math.log(d.price));
    const X = data.map(d => [1, ...featureFns.map(fn => fn(d))]);
    try {
        const { r2, r2adj, rmse } = ols(Y, X);
        return { label, n: data.length, r2, r2adj, rmse };
    } catch (e) {
        return { label, n: data.length, r2: -99, r2adj: -99, rmse: 99 };
    }
}

const age = d => CURRENT_YEAR - d.year;
const logSqft = d => Math.log(d.sqft);
const logFee = d => Math.log(d.fee);
const logFeePerSqft = d => Math.log(d.fee / d.sqft);
const logAssessment = d => Math.log(d.assessment);
const logAssessPerSqft = d => Math.log(d.assessment / d.sqft);
// Derived
const ageSq = d => age(d) ** 2;
const logAge = d => Math.log(Math.max(1, age(d)));
const feeXage = d => (d.fee / d.sqft) * age(d);
const logFeeAge = d => Math.log(d.fee / d.sqft) * Math.log(Math.max(1, age(d)));
const assessRatio = d => d.assessment / d.price; // won't use in model (leakage) but for info
const logAssessToFee = d => Math.log(d.assessment / d.fee);
const yearBin = d => {
    const y = d.year;
    if (y < 1980) return 0;
    if (y < 1995) return 1;
    if (y < 2005) return 2;
    if (y < 2015) return 3;
    return 4;
};
const isLeakyCondo = d => (d.year >= 1980 && d.year <= 2003 && !d.rainscreen) ? 1 : 0;
const isNewish = d => d.year >= 2015 ? 1 : 0;

// ── Baseline (fee-only data pool, same features as current model minus areas) ──
const results = [];

// Baseline: sqft + age
results.push(evaluate(withFee, [logSqft, age], 'BASELINE: logSqft + age'));

// One-at-a-time additions
results.push(evaluate(withFee, [logSqft, age, logFee], '+ logFee'));
results.push(evaluate(withFee, [logSqft, age, logFeePerSqft], '+ logFee/sqft'));
results.push(evaluate(withFee, [logSqft, age, ageSq], '+ age²'));
results.push(evaluate(withFee, [logSqft, age, logAge], '+ logAge'));
results.push(evaluate(withFee, [logSqft, age, isLeakyCondo], '+ isLeakyCondo'));
results.push(evaluate(withFee, [logSqft, age, isNewish], '+ isNewish'));
results.push(evaluate(withFee, [logSqft, age, yearBin], '+ yearBin(5 bands)'));

// Two-at-a-time
results.push(evaluate(withFee, [logSqft, age, ageSq, logFee], '+ age² + logFee'));
results.push(evaluate(withFee, [logSqft, age, logAge, logFee], '+ logAge + logFee'));
results.push(evaluate(withFee, [logSqft, age, logFeePerSqft, ageSq], '+ logFee/sqft + age²'));
results.push(evaluate(withFee, [logSqft, age, logFeePerSqft, ageSq, feeXage], '+ logFee/sqft + age² + fee×age'));
results.push(evaluate(withFee, [logSqft, age, logFeePerSqft, logAge], '+ logFee/sqft + logAge'));
results.push(evaluate(withFee, [logSqft, age, logFeePerSqft, logFeeAge], '+ logFee/sqft + log(fee/sqft)×logAge'));
results.push(evaluate(withFee, [logSqft, ageSq, logFeePerSqft], 'ageSq instead of age + logFee/sqft'));
results.push(evaluate(withFee, [logSqft, age, ageSq, logFeePerSqft, isLeakyCondo], '+ age² + logFee/sqft + leaky'));

// Assessment-based (smaller n)
results.push(evaluate(withAll, [logSqft, age], 'ASSESSMENT POOL baseline'));
results.push(evaluate(withAll, [logSqft, age, logFee], 'ASSESS POOL + logFee'));
results.push(evaluate(withAll, [logAssessment], 'logAssessment alone'));
results.push(evaluate(withAll, [logSqft, age, logAssessment], '+ logAssessment'));
results.push(evaluate(withAll, [logSqft, age, logAssessPerSqft], '+ logAssess/sqft'));
results.push(evaluate(withAll, [logSqft, age, logAssessment, logFee], '+ logAssessment + logFee'));
results.push(evaluate(withAll, [logSqft, age, logAssessPerSqft, logFeePerSqft], '+ logAssess/sqft + logFee/sqft'));
results.push(evaluate(withAll, [logSqft, age, logAssessToFee], '+ log(assessment/fee)'));
results.push(evaluate(withAll, [logSqft, age, logAssessment, ageSq], '+ logAssessment + age²'));
results.push(evaluate(withAll, [logAssessment, logFee], 'logAssess + logFee (no sqft/age)'));
results.push(evaluate(withAll, [logAssessPerSqft, logFeePerSqft, age], 'logAssess/sqft + logFee/sqft + age'));

// Sort by adjusted R²
results.sort((a, b) => b.r2adj - a.r2adj);

console.log('Rank | Adj.R²  | R²     | RMSE(log) | n    | Features');
console.log('-----|---------|--------|-----------|------|' + '-'.repeat(60));
results.forEach((r, i) => {
    const rank = String(i + 1).padStart(4);
    const r2a = r.r2adj.toFixed(4).padStart(7);
    const r2 = r.r2.toFixed(4).padStart(6);
    const rmse = r.rmse.toFixed(4).padStart(9);
    const n = String(r.n).padStart(4);
    console.log(`${rank} | ${r2a} | ${r2} | ${rmse} | ${n} | ${r.label}`);
});
