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

// --- Helper: Extract Sold Date from HTML ---
function extractSoldDate(htmlContent) {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    // Find the history table rows
    // The selector targets the table inside elements with class 'pc-listing-history'
    const tableRows = document.querySelectorAll('.pc-listing-history .table tbody tr');
    
    for (const row of tableRows) {
        const cells = row.querySelectorAll('td');
        // cell map based on observation:
        // 0: Date Start
        // 1: Date End (Sold Date)
        // 2: Price
        // 3: Event
        // 4: Listing ID
        
        if (cells.length >= 4) {
            const eventType = cells[3].textContent.trim();
            // Check for "Sold" event
            if (eventType.toLowerCase() === 'sold') {
                const soldDate = cells[1].textContent.trim();
                // Basic validation strictly YYYY-MM-DD to ensure it's a date
                if (/^\d{4}-\d{2}-\d{2}$/.test(soldDate)) {
                     return soldDate;
                }
            }
        }
    }
    
    return null;
}

// --- Main Execution ---
async function main() {
    console.log(chalk.cyan('Starting Sold Date extraction process...'));

    if (!fs.existsSync(JSON_DIR)) {
        console.error(chalk.red(`Error: data/json directory not found at ${JSON_DIR}`));
        process.exit(1);
    }

    if (!fs.existsSync(HTML_DIR)) {
        console.error(chalk.red(`Error: data/html directory not found at ${HTML_DIR}`));
        process.exit(1);
    }

    const jsonFiles = fs.readdirSync(JSON_DIR).filter(f => f.endsWith('.json'));
    console.log(chalk.blue(`Found ${jsonFiles.length} JSON files to process.`));

    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(jsonFiles.length, 0);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    let noHtmlCount = 0;
    let missingDateCount = 0;

    for (const jsonFile of jsonFiles) {
        const jsonPath = path.join(JSON_DIR, jsonFile);
        
        try {
            // Read JSON
            const jsonContent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
            
            // Derive HTML filename from JSON filename (they share the same basename)
            const baseName = path.basename(jsonFile, '.json');
            const htmlPath = path.join(HTML_DIR, `${baseName}.html`);

            if (!fs.existsSync(htmlPath)) {
                noHtmlCount++;
                progressBar.increment();
                continue; // Skip if no HTML file
            }

            // Read HTML
            const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            
            // Extract Sold Date
            const soldDate = extractSoldDate(htmlContent);

            if (soldDate) {
                // Update JSON
                jsonContent.soldDate = soldDate;
                fs.writeFileSync(jsonPath, JSON.stringify(jsonContent, null, 2));
                updatedCount++;
            } else {
                missingDateCount++;
                // Optional: log if we expected a date but didn't find one
                // console.log(chalk.yellow(`\nNo sold date found for ${baseName}`));
            }

        } catch (err) {
            console.error(chalk.red(`\nError processing ${jsonFile}: ${err.message}`));
            errorCount++;
        }
        
        progressBar.increment();
    }

    progressBar.stop();

    console.log(chalk.green('\n--- Processing Complete ---'));
    console.log(`Total Files: ${jsonFiles.length}`);
    console.log(chalk.green(`Updated: ${updatedCount}`));
    console.log(chalk.yellow(`Missing Date in HTML: ${missingDateCount}`));
    console.log(chalk.gray(`Skipped (No HTML): ${noHtmlCount}`));
    console.log(chalk.red(`Errors: ${errorCount}`));
}

main().catch(console.error);
