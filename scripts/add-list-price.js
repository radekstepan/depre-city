import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const HTML_DIR = path.join(process.cwd(), 'data/html');
const JSON_DIR = path.join(process.cwd(), 'data/json');

// --- Helper: Clean Number String ---
const cleanNumber = (str) => {
    if (!str) return 0;
    const cleaned = str.replace(/[^0-9.]/g, '');
    return Number(cleaned);
};

// --- Helper: Extract List Price from HTML ---
function extractListPrice(htmlContent) {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    // Extract List Price
    const listedPriceEl = document.querySelector('.price-area .price .listed');
    if (listedPriceEl) {
        const lp = cleanNumber(listedPriceEl.textContent);
        if (lp > 0) return lp;
    }
    
    return 0;
}

// --- Main Execution ---
async function main() {
    if (!fs.existsSync(JSON_DIR)) {
        console.error(chalk.red(`Error: data/json directory not found at ${JSON_DIR}`));
        process.exit(1);
    }

    if (!fs.existsSync(HTML_DIR)) {
        console.error(chalk.red(`Error: data/html directory not found at ${HTML_DIR}`));
        process.exit(1);
    }

    const jsonFiles = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
        console.log(chalk.yellow("No JSON files found to update."));
        return;
    }

    console.log(chalk.cyan(`\n=== Updating JSON Files with List Price ===`));
    console.log(chalk.cyan(`Found ${jsonFiles.length} files to process\n`));

    const progressBar = new cliProgress.SingleBar({
        format: chalk.blue('{bar}') + ' {percentage}% | {value}/{total} Files | {status}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false
    });

    progressBar.start(jsonFiles.length, 0, { status: 'Initializing' });

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < jsonFiles.length; i++) {
        const jsonFile = jsonFiles[i];
        const htmlFile = jsonFile.replace('.json', '.html');
        
        progressBar.update(i, { status: `Processing ${jsonFile.substring(0, 30)}...` });

        try {
            // Read existing JSON
            const jsonPath = path.join(JSON_DIR, jsonFile);
            const listing = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

            // Skip if listPrice already exists and is not 0
            if (listing.listPrice && listing.listPrice > 0) {
                skippedCount++;
                progressBar.increment();
                continue;
            }

            // Read corresponding HTML
            const htmlPath = path.join(HTML_DIR, htmlFile);
            if (!fs.existsSync(htmlPath)) {
                console.log(chalk.yellow(`\nWarning: HTML file not found for ${jsonFile}`));
                skippedCount++;
                progressBar.increment();
                continue;
            }

            const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            const listPrice = extractListPrice(htmlContent);

            // Update listing with list price
            listing.listPrice = listPrice;

            // Save updated JSON
            fs.writeFileSync(jsonPath, JSON.stringify(listing, null, 2));
            updatedCount++;
        } catch (error) {
            errorCount++;
            progressBar.stop();
            console.log(chalk.red(`\nError processing ${jsonFile}: ${error.message}`));
            progressBar.start(jsonFiles.length, i + 1, { status: 'Resuming...' });
        }

        progressBar.increment();
    }

    progressBar.stop();

    console.log(chalk.green(`\n\u2714 Complete!`));
    console.log(chalk.gray(`  Updated: ${updatedCount} files`));
    console.log(chalk.gray(`  Skipped: ${skippedCount} files (already had listPrice or missing HTML)`));
    if (errorCount > 0) {
        console.log(chalk.red(`  Errors: ${errorCount} files`));
    }
}

main();
