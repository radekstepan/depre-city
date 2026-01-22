/**
 * A lightweight Matrix math library for Ordinary Least Squares (OLS) regression.
 * Solves: beta = (X^T * X)^-1 * X^T * y
 */

export class Matrix {
    data: number[][];
    rows: number;
    cols: number;

    constructor(data: number[][]) {
        this.data = data;
        this.rows = data.length;
        this.cols = data[0].length;
    }

    // Transpose the matrix
    transpose(): Matrix {
        const newData: number[][] = [];
        for (let j = 0; j < this.cols; j++) {
            newData[j] = [];
            for (let i = 0; i < this.rows; i++) {
                newData[j][i] = this.data[i][j];
            }
        }
        return new Matrix(newData);
    }

    // Multiply this * B
    multiply(other: Matrix): Matrix {
        if (this.cols !== other.rows) throw new Error("Matrix dimension mismatch");
        const result: number[][] = [];
        for (let i = 0; i < this.rows; i++) {
            result[i] = [];
            for (let j = 0; j < other.cols; j++) {
                let sum = 0;
                for (let k = 0; k < this.cols; k++) {
                    sum += this.data[i][k] * other.data[k][j];
                }
                result[i][j] = sum;
            }
        }
        return new Matrix(result);
    }

    // Gaussian Elimination to find inverse
    // Note: Only works for square matrices
    inverse(): Matrix {
        if (this.rows !== this.cols) throw new Error("Cannot invert non-square matrix");
        
        const n = this.rows;
        // Create augmented matrix [A | I]
        const aug: number[][] = this.data.map(row => [...row]);
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                aug[i].push(i === j ? 1 : 0);
            }
        }

        // Gaussian elimination
        for (let i = 0; i < n; i++) {
            let pivot = aug[i][i];
            // Simple pivot check (no row swapping implemented for brevity, assume well-behaved data)
            if (Math.abs(pivot) < 1e-10) pivot = 1e-10; // regularization

            for (let j = 0; j < 2 * n; j++) {
                aug[i][j] /= pivot;
            }

            for (let k = 0; k < n; k++) {
                if (k !== i) {
                    const factor = aug[k][i];
                    for (let j = 0; j < 2 * n; j++) {
                        aug[k][j] -= factor * aug[i][j];
                    }
                }
            }
        }

        // Extract right half
        const inv: number[][] = [];
        for (let i = 0; i < n; i++) {
            inv[i] = aug[i].slice(n, 2 * n);
        }

        return new Matrix(inv);
    }
}

export interface OLSResult {
    betas: number[];
    stdErrors: number[];
    tStats: number[];
}

/**
 * Solves y = X * beta using Normal Equation: beta = (X'X)^-1 X'y
 * Also calculates Standard Errors and T-Statistics for the coefficients.
 * @param X - Design matrix (n samples x m features) - Should include column of 1s for intercept
 * @param y - Target vector (n samples x 1)
 * @returns Object containing betas, standard errors, and t-stats
 */
export function solveOLS(X_data: number[][], y_data: number[]): OLSResult {
    try {
        const X = new Matrix(X_data);
        const y = new Matrix(y_data.map(val => [val]));
        const Xt = X.transpose();
        
        // (X^T * X)
        const XtX = Xt.multiply(X);
        
        // (X^T * X)^-1
        // Add small ridge regularization to diagonal to prevent singular matrix
        for(let i=0; i<XtX.rows; i++) {
            XtX.data[i][i] += 0.0001;
        }
        
        const XtX_inv = XtX.inverse();
        
        // (X^T * X)^-1 * X^T
        const term = XtX_inv.multiply(Xt);
        
        // Final result: term * y
        const betaMatrix = term.multiply(y);
        const betas = betaMatrix.data.map(row => row[0]);

        // --- Statistics Calculation ---
        const n = X_data.length;
        const p = X_data[0].length;
        
        // Calculate Residuals (y - y_hat)
        let rss = 0;
        for (let i = 0; i < n; i++) {
            let y_hat = 0;
            for (let j = 0; j < p; j++) {
                y_hat += X_data[i][j] * betas[j];
            }
            rss += Math.pow(y_data[i] - y_hat, 2);
        }

        // Variance of the error term (Sigma squared)
        // unbiased estimator: RSS / (n - p)
        // If n <= p, we return 0 for stats to avoid divide by zero
        const sigma2 = n > p ? rss / (n - p) : 0;

        const stdErrors: number[] = [];
        const tStats: number[] = [];

        for (let j = 0; j < p; j++) {
            // Variance of beta_j = sigma^2 * (XtX_inv)_jj
            const varBeta = sigma2 * XtX_inv.data[j][j];
            const se = Math.sqrt(Math.max(0, varBeta));
            
            stdErrors.push(se);
            // t = beta / se
            tStats.push(se > 1e-10 ? betas[j] / se : 0);
        }

        return { betas, stdErrors, tStats };

    } catch (e) {
        console.error("OLS Solver Error:", e);
        const zeros = new Array(X_data[0].length).fill(0);
        return { betas: zeros, stdErrors: zeros, tStats: zeros };
    }
}
