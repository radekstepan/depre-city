import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import 'dotenv/config';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Configuration ---
const HTML_DIR = path.join(process.cwd(), 'data/html');
const JSON_DIR = path.join(process.cwd(), 'data/json');

// --- Helper: Env Resolution ---
const resolveEnv = (key) => {
    const value = process.env[key];
    if (!value) return undefined;
    
    // If the value points to another env var, use that
    if (process.env[value]) {
        return process.env[value];
    }
    
    // Otherwise use the value as-is
    return value;
};

// --- Helper: CLI Flags ---
const shouldSkipDedup = process.argv.includes('--no-dedup');

// --- Helper: Fast Metadata Extraction ---
function getMetadataFast(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const bufferSize = 8192;
    const buffer = Buffer.alloc(bufferSize);
    let content = '';
    let bytesRead;
    
    while ((bytesRead = fs.readSync(fd, buffer, 0, bufferSize, null)) > 0) {
        content += buffer.toString('utf-8', 0, bytesRead);
        
        const sourceUrl = content.match(/<meta name="x-deprecity-source-url" content="([^"]+)">/)?.[1];
        const scrapedAt = content.match(/<meta name="x-deprecity-scraped-at" content="([^"]+)">/)?.[1];
        
        if (sourceUrl !== undefined || scrapedAt !== undefined) {
            fs.closeSync(fd);
            return { 
                sourceUrl: sourceUrl || "", 
                scrapedAt: scrapedAt || "",
                content: null
            };
        }
        
        content = content.slice(-1000);
    }
    
    fs.closeSync(fd);
    return { sourceUrl: "", scrapedAt: "", content: null };
}

// --- Helper: Address Extraction ---
function extractAddress(htmlContent) {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
        try {
            const json = JSON.parse(script.textContent);
            const entity = json.mainEntity || json;
            if (entity.address?.streetAddress) {
                return entity.address.streetAddress;
            }
        } catch (e) {}
    }
    
    const h1 = document.querySelector('h1');
    if (h1) {
        return h1.textContent.split(',')[0].trim();
    }
    
    return null;
}

// --- Helper: URL Normalization ---
function normalizeUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        return u.origin + u.pathname.replace(/\/$/, '').toLowerCase();
    } catch {
        return url.toLowerCase().replace(/\/$/, '');
    }
}

// --- Helper: Address Normalization ---
function normalizeAddress(addr) {
    if (!addr) return '';
    return addr.toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/^(unit|suite|apt|#)\s*\d+\s*[-,]?\s*/i, '')
        .trim();
}

// --- Helper: Find Duplicates ---
function findDuplicates(htmlFiles) {
    const urlGroups = new Map();
    const addrGroups = new Map();
    
    for (const file of htmlFiles) {
        const metadata = getMetadataFast(path.join(HTML_DIR, file));
        const entry = { file, ...metadata };
        
        const normUrl = normalizeUrl(metadata.sourceUrl);
        if (normUrl) {
            if (!urlGroups.has(normUrl)) urlGroups.set(normUrl, []);
            urlGroups.get(normUrl).push(entry);
        }
        
        if (!normUrl && metadata.content === null) {
            const htmlPath = path.join(HTML_DIR, file);
            const fd = fs.openSync(htmlPath, 'r');
            const bufferSize = 32768;
            const buffer = Buffer.alloc(bufferSize);
            let content = '';
            let bytesRead;
            
            while ((bytesRead = fs.readSync(fd, buffer, 0, bufferSize, null)) > 0) {
                content += buffer.toString('utf-8', 0, bytesRead);
                
                const address = extractAddress(content);
                if (address) {
                    const normAddr = normalizeAddress(address);
                    entry.address = address;
                    if (!addrGroups.has(normAddr)) addrGroups.set(normAddr, []);
                    addrGroups.get(normAddr).push(entry);
                    break;
                }
                
                if (content.length > 50000) break;
            }
            
            fs.closeSync(fd);
        }
    }
    
    const urlDupes = [...urlGroups.values()].filter(g => g.length > 1);
    const addrDupes = [...addrGroups.values()].filter(g => g.length > 1);
    
    return { urlDupes, addrDupes };
}

// --- Helper: Automatic Cleanup ---
function autoCleanupCopyFiles(htmlFiles) {
    const copyPattern = / copy\.html$| \(\d+\)\.html$| - Copy\.html$/i;
    const filesToDelete = htmlFiles.filter(f => copyPattern.test(f));
    
    if (filesToDelete.length === 0) return [];
    
    console.log(chalk.yellow(`\nAuto-cleaning ${filesToDelete.length} copy files...`));
    
    const deletedFiles = [];
    for (const file of filesToDelete) {
        const filePath = path.join(HTML_DIR, file);
        try {
            fs.unlinkSync(filePath);
            deletedFiles.push(file);
            console.log(chalk.gray(`  Deleted: ${file}`));
        } catch (e) {
            console.log(chalk.red(`  Failed to delete: ${file}`));
        }
    }
    
    return deletedFiles;
}

// --- Helper: Interactive Prompt for Duplicates ---
function promptForDuplicates(duplicates, applyToAll = null) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const results = {
            toDelete: [],
            toSkip: [],
            toKeep: []
        };

        let currentIndex = 0;
        
        const askNext = () => {
            if (currentIndex >= duplicates.length) {
                rl.close();
                resolve(results);
                return;
            }

            const group = duplicates[currentIndex];
            const identifier = group[0].sourceUrl || group[0].address || 'Unknown';
            
            console.log(chalk.cyan(`\nDuplicate Group ${currentIndex + 1}/${duplicates.length}`));
            console.log(chalk.yellow(`Listing: ${identifier}`));
            console.log(chalk.gray('─'.repeat(60)));
            
            group.forEach((entry, i) => {
                const timestamp = entry.scrapedAt ? new Date(entry.scrapedAt).toLocaleString() : 'Unknown';
                const type = entry.sourceUrl ? 'URL' : 'Address';
                console.log(`  ${i + 1}. ${chalk.white(entry.file)}`);
                console.log(`     ${type} match | Scraped: ${timestamp}`);
            });
            
            console.log(chalk.gray('─'.repeat(60)));
            console.log('Options:');
            console.log('  1. Delete duplicates (keep newest)');
            console.log('  2. Skip duplicates (keep on disk, don\'t process)');
            console.log('  3. Keep all (process normally)');
            if (applyToAll === null) {
                console.log('  4. Apply choice to all remaining duplicates');
            }
            
            const question = applyToAll !== null 
                ? `Choice (default: ${applyToAll}): `
                : '\nYour choice (1-4): ';
            
            rl.question(question, (answer) => {
                let choice;
                
                if (applyToAll !== null && answer.trim() === '') {
                    choice = applyToAll;
                } else {
                    choice = answer.trim();
                }

                if (choice === '4' && applyToAll === null) {
                    rl.question('Apply which choice to all remaining? (1-3): ', (applyChoice) => {
                        applyToAll = applyChoice.trim();
                        processChoice(applyToAll);
                    });
                    return;
                }
                
                processChoice(choice);
            });
        };
        
        const processChoice = (choice) => {
            const group = duplicates[currentIndex];
            
            if (choice === '1') {
                const sorted = [...group].sort((a, b) => {
                    const dateA = a.scrapedAt ? new Date(a.scrapedAt) : new Date(0);
                    const dateB = b.scrapedAt ? new Date(b.scrapedAt) : new Date(0);
                    return dateB - dateA;
                });
                const toKeep = sorted[0];
                const toDelete = sorted.slice(1);
                
                results.toDelete.push(...toDelete.map(e => e.file));
                results.toKeep.push(toKeep.file);
                console.log(chalk.gray(`  Keeping: ${toKeep.file} (newest)`));
            } else if (choice === '2') {
                const sorted = [...group].sort((a, b) => {
                    const dateA = a.scrapedAt ? new Date(a.scrapedAt) : new Date(0);
                    const dateB = b.scrapedAt ? new Date(b.scrapedAt) : new Date(0);
                    return dateB - dateA;
                });
                const toKeep = sorted[0];
                const toSkip = sorted.slice(1);
                
                results.toSkip.push(...toSkip.map(e => e.file));
                results.toKeep.push(toKeep.file);
                console.log(chalk.gray(`  Processing: ${toKeep.file} (newest)`));
                console.log(chalk.gray(`  Skipping: ${toSkip.map(e => e.file).join(', ')}`));
            } else {
                results.toKeep.push(...group.map(e => e.file));
                console.log(chalk.gray(`  Keeping all: ${group.map(e => e.file).join(', ')}`));
            }
            
            currentIndex++;
            askNext();
        };
        
        askNext();
    });
}

// --- Helper: Execute Duplicate Actions ---
function executeDuplicateActions(actions) {
    console.log(chalk.cyan('\nExecuting duplicate actions...'));
    
    if (actions.toDelete.length > 0) {
        console.log(chalk.gray(`Deleting ${actions.toDelete.length} files...`));
        let deletedCount = 0;
        for (const file of actions.toDelete) {
            const filePath = path.join(HTML_DIR, file);
            try {
                fs.unlinkSync(filePath);
                deletedCount++;
            } catch (e) {
                console.log(chalk.red(`  Failed to delete: ${file}`));
            }
        }
        console.log(chalk.green(`  Deleted ${deletedCount} files`));
    }
    
    if (actions.toSkip.length > 0) {
        console.log(chalk.yellow(`  Skipping ${actions.toSkip.length} files from processing`));
    }
}

// --- Helper: LLM Extraction ---
async function extractDeepData(description, features = []) {
    const apiKey = resolveEnv('LLM_API_KEY');
    const baseURL = resolveEnv('LLM_API_URL');
    const modelName = resolveEnv('LLM_MODEL_NAME');

    if (!apiKey) {
        // Silent return for progress bar cleanliness
        return null;
    }

    const prompt = `
    Analyze this Real Estate listing.
    Text: "${description}"
    Features: ${features.join(', ')}

    Return STRICT JSON (no markdown):
    {
      "parkingType": "underground" | "carport" | "garage_double" | "garage_tandem" | "street" | "other",
      "levels": number (default 1),
      "isEndUnit": boolean,
      "hasAC": boolean,
      "isRainscreened": boolean,
      "outdoorSpace": "balcony" | "yard" | "rooftop" | "none",
      "condition": number (1-5 score: 1=Needs Work, 2=Original/Dated, 3=Average/Maintained, 4=Updated, 5=Brand New/Fully Reno),
      "subArea": string (The specific neighborhood name if mentioned. e.g. "Burke Mountain", "Maillardville". Use "Other" if unknown.)
    }
    `;

    try {
        const res = await fetch(`${baseURL}/chat/completions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: [{role: "user", content: prompt}]
            })
        });

        if (!res.ok) {
            const errorBody = await res.text();
            throw new Error(`${res.status} ${res.statusText}: ${errorBody}`);
        }
        const data = await res.json();
        let content = data.choices[0].message.content;
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(content);
    } catch (e) {
        // Return null on failure but don't log to console to avoid breaking progress bar
        return null;
    }
}

// --- Helper: DOM Parsing (Ported from Extension) ---
function parseHtml(htmlContent, filename) {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    // Retrieve Metadata injected by extension
    const sourceUrl = document.querySelector('meta[name="x-deprecity-source-url"]')?.content || "";
    const scrapedAt = document.querySelector('meta[name="x-deprecity-scraped-at"]')?.content || new Date().toISOString();

    let listing = {
        address: "Unknown Address",
        city: "Unknown City",
        sqft: 0,
        year: 0,
        price: 0,
        fee: 0,
        bedrooms: 0,
        bathrooms: 0,
        parking: 0,
        propertyTax: 0,
        // Deep Data Placeholders
        description: "",
        features: [],
        subArea: null, // Initialize as null to track extraction success
        _sourceUrl: sourceUrl,
        _scrapedAt: scrapedAt,
        _rawFile: filename
    };

    // 1. JSON-LD Extraction
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    let jsonLd = null;

    for (const script of jsonLdScripts) {
        try {
            const json = JSON.parse(script.textContent);
            if (json['@type'] === 'RealEstateListing' || 
                (json['@context'] === 'https://schema.org' && json['@type'] === 'Product') ||
                json['@type'] === 'House') {
                jsonLd = json;
                break;
            }
        } catch (e) {}
    }

    if (jsonLd) {
        const entity = jsonLd.mainEntity || jsonLd;
        if (entity.address) {
            listing.address = entity.address.streetAddress || listing.address;
            listing.city = entity.address.addressLocality || listing.city;
        }
        if (entity.floorSize) {
            const val = typeof entity.floorSize === 'object' ? entity.floorSize.value : entity.floorSize;
            listing.sqft = Number(val);
        }
        if (entity.numberOfBedrooms) listing.bedrooms = Number(entity.numberOfBedrooms);
        if (entity.numberOfBathroomsTotal) listing.bathrooms = Number(entity.numberOfBathroomsTotal);
        let offers = jsonLd.offers || entity.offers;
        if (offers) {
            const offer = Array.isArray(offers) ? offers[0] : offers;
            if (offer && offer.price) listing.price = Number(offer.price);
        }
        if (entity.description) listing.description = entity.description;
    }

    // 2. DOM Extraction
    if (!listing.description) {
        const descEl = document.querySelector('.prose, .description, [itemprop="description"], #listing-description');
        if (descEl) listing.description = descEl.textContent.trim();
    }

    const featureEls = document.querySelectorAll('ul.features li, .amenities li, .property-features li');
    if (featureEls.length > 0) {
        listing.features = Array.from(featureEls).map(el => el.textContent.trim());
    }

    const cleanNumber = (str) => str ? Number(str.replace(/[^0-9.]/g, '')) : 0;
    
    const getTableValue = (labels) => {
        const tds = Array.from(document.querySelectorAll('td, dt'));
        for (const td of tds) {
            const text = td.textContent.trim().toLowerCase();
            // Check if any label is in the text
            if (labels.some(l => text.includes(l.toLowerCase()))) {
                const nextEl = td.nextElementSibling;
                if (nextEl) return nextEl.textContent.trim();
            }
        }
        return null;
    };

    // Try multiple sources for year
    let yearStr = getTableValue(['Year Built']);
    if (yearStr) {
        listing.year = parseInt(yearStr.replace(/[^0-9]/g, ''), 10);
    } else {
        const scriptMatches = htmlContent.match(/yearBuilt\\?["']?:(\d{4})/);
        if (scriptMatches) {
            listing.year = parseInt(scriptMatches[1], 10);
        } else {
            const ageStr = getTableValue(['Age']);
            if (ageStr) {
                const match = ageStr.match(/\((\d{4})\)/);
                if (match) listing.year = parseInt(match[1], 10);
            }
        }
    }

    const feeStr = getTableValue(['Maintenance Fee', 'Strata Fee']);
    if (feeStr) listing.fee = cleanNumber(feeStr);

    const taxStr = getTableValue(['Property Taxes', 'Gross Taxes']);
    if (taxStr) listing.propertyTax = cleanNumber(taxStr);

    // Extraction of Neighbourhood/Sub-Area
    let subArea = getTableValue(['Neighbourhood', 'Community', 'Sub-Area']);
    
    // Fallback to Breadcrumbs if table extraction failed
    if (!subArea) {
        const breadcrumbScript = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .find(s => s.textContent.includes('BreadcrumbList'));
        if (breadcrumbScript) {
            try {
                const bcData = JSON.parse(breadcrumbScript.textContent);
                const items = bcData.itemListElement || [];
                // Zealty pattern: Home(1) > Region(2) > City(3) > Area(4) > Postal(5)
                const areaItem = items.find(i => i.position === 4);
                if (areaItem && areaItem.name) subArea = areaItem.name;
            } catch (e) {}
        }
    }

    if (subArea) listing.subArea = subArea;

    const parkingStr = getTableValue(['Parking', 'Total Parking']);
    if (parkingStr) {
        const match = parkingStr.match(/Total spaces:\s*(\d+)/i) || parkingStr.match(/(\d+)/);
        if (match) listing.parking = parseInt(match[1]);
    }

    // Fallbacks
    if (listing.address === "Unknown Address") {
        const h1 = document.querySelector('h1');
        if (h1) {
            const parts = h1.textContent.split(',');
            if (parts.length > 0) listing.address = parts[0].trim();
            if (parts.length > 1) listing.city = parts[1].trim();
        }
    }
    
    if (!listing.price) {
        const priceStr = getTableValue(['Sold Price', 'Price', 'Asking Price']);
        if (priceStr) listing.price = cleanNumber(priceStr.split('\n')[0]);
    }

    // Basic Rainscreen Logic (Pre-LLM fallback)
    const desc = (listing.description || "").toLowerCase();
    listing.rainscreen = (listing.year >= 2005) || desc.includes('rainscreen') || desc.includes('rain screen');
    listing.condition = 3; // Default average

    return listing;
}


// --- Main Execution ---
async function main() {
    if (!fs.existsSync(HTML_DIR)) {
        console.error(chalk.red(`Error: data/html directory not found at ${HTML_DIR}`));
        console.error("Please place your downloaded HTML files there.");
        process.exit(1);
    }
    
    if (!fs.existsSync(JSON_DIR)) {
        fs.mkdirSync(JSON_DIR, { recursive: true });
    }

    let htmlFiles = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
    
    let skippedFiles = new Set();
    
    if (!shouldSkipDedup && htmlFiles.length > 0) {
        console.log(chalk.cyan('\n=== Deduplication Phase ==='));
        
        const deletedCopyFiles = autoCleanupCopyFiles(htmlFiles);
        htmlFiles = htmlFiles.filter(f => !deletedCopyFiles.includes(f));
        
        if (htmlFiles.length > 1) {
            console.log(chalk.gray('Scanning for duplicates...'));
            const { urlDupes, addrDupes } = findDuplicates(htmlFiles);
            
            const seenFiles = new Set();
            const allDupes = [];
            
            for (const group of urlDupes) {
                const groupFiles = new Set(group.map(g => g.file));
                const key = [...groupFiles].sort().join('|');
                if (!seenFiles.has(key)) {
                    seenFiles.add(key);
                    allDupes.push(group);
                }
            }
            
            for (const group of addrDupes) {
                const groupFiles = new Set(group.map(g => g.file));
                const key = [...groupFiles].sort().join('|');
                if (!seenFiles.has(key)) {
                    seenFiles.add(key);
                    allDupes.push(group);
                }
            }
            
            if (allDupes.length > 0) {
                const totalFiles = allDupes.reduce((acc, g) => acc + g.length, 0);
                console.log(chalk.yellow(`\nFound ${allDupes.length} duplicate groups (${totalFiles} files)`));
                const actions = await promptForDuplicates(allDupes);
                executeDuplicateActions(actions);
                
                skippedFiles = new Set(actions.toSkip);
                htmlFiles = htmlFiles.filter(f => !actions.toDelete.includes(f));
            } else {
                console.log(chalk.green('No duplicates found.\n'));
            }
        }
    }
    
    const filesToProcess = htmlFiles.filter(file => {
        if (skippedFiles.has(file)) return false;
        const jsonFileName = file.replace('.html', '.json');
        const jsonPath = path.join(JSON_DIR, jsonFileName);
        return !fs.existsSync(jsonPath);
    });

    if (filesToProcess.length === 0) {
        console.log(chalk.green("All HTML files have already been processed. No new files to process."));
        return;
    }

    console.log(chalk.cyan(`\n=== Processing Phase ===`));
    console.log(chalk.cyan(`Found ${filesToProcess.length} files to process\n`));

    // Initialize Progress Bar
    const b1 = new cliProgress.SingleBar({
        format: chalk.blue('{bar}') + ' {percentage}% | {value}/{total} Files | ' + chalk.yellow('{status}') + ' | {file}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false
    });

    b1.start(filesToProcess.length, 0, { status: 'Initializing', file: '...' });

    let llmSuccessCount = 0;
    let llmFailCount = 0;

    for (const file of filesToProcess) {
        const shortName = file.length > 25 ? file.substring(0, 22) + '...' : file;
        
        // 1. Basic Parse
        b1.update(null, { status: 'Parsing HTML', file: shortName });
        const htmlPath = path.join(HTML_DIR, file);
        const html = fs.readFileSync(htmlPath, 'utf-8');
        const listing = parseHtml(html, file);
        
        // 2. LLM Enrichment
        if (listing.description) {
            b1.update(null, { status: 'Enriching (LLM)', file: shortName });
            
            const deepData = await extractDeepData(listing.description, listing.features);
            if (deepData) {
                // Determine Priority for subArea
                // If DOM gave us a specific subArea (not null), we ignore LLM's guess to prevent it overwriting with "Other"
                if (listing.subArea && listing.subArea !== "Other") {
                    delete deepData.subArea;
                }

                // Map specific deep data fields
                Object.assign(listing, deepData);
                
                // Map boolean isRainscreened to listing.rainscreen if present
                if (typeof deepData.isRainscreened === 'boolean') {
                    listing.rainscreen = deepData.isRainscreened;
                }
                
                llmSuccessCount++;
            } else {
                llmFailCount++;
            }
        }

        // Final Default if subArea is still missing
        if (!listing.subArea) {
            listing.subArea = "Other";
        }

        // 3. Save
        b1.update(null, { status: 'Saving JSON', file: shortName });
        const outName = file.replace('.html', '.json');
        fs.writeFileSync(path.join(JSON_DIR, outName), JSON.stringify(listing, null, 2));
        
        b1.increment();
    }
    
    b1.stop();
    
    console.log(chalk.green(`\n\u2714 Success! Processed ${filesToProcess.length} files.`));
    if (resolveEnv('LLM_API_KEY')) {
        console.log(chalk.gray(`  LLM Stats: ${llmSuccessCount} enriched, ${llmFailCount} skipped/failed.`));
    } else {
        console.log(chalk.yellow(`  LLM Skipped: No API Key provided.`));
    }
    console.log(`  Data saved to ${chalk.underline(JSON_DIR)}`);
}

main();
