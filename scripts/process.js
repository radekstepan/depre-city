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
    if (process.env[value]) {
        return process.env[value];
    }
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

// --- Helper: Address Extraction (HouseSigma Focused) ---
function extractAddress(htmlContent) {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    
    // Attempt 1: HouseSigma Specific H1
    const h1Address = document.querySelector('.address-community .address');
    if (h1Address) {
        // Remove any spans usually used for SEO or separators
        const clone = h1Address.cloneNode(true);
        const spans = clone.querySelectorAll('span');
        spans.forEach(s => s.remove());
        return clone.textContent.trim();
    }

    // Attempt 2: JSON-LD
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
        return null;
    }

    if (!baseURL) {
        throw new Error('LLM_API_KEY found but LLM_API_URL is missing in .env');
    }

    const prompt = `
    Analyze this Real Estate listing description and features list to extract technical details.
    
    Text: "${description}"
    Features: ${features.join(', ')}

    Return STRICT JSON (no markdown blocks) with this schema:
    {
      "parkingType": "underground" | "carport" | "garage_double" | "garage_tandem" | "street" | "other",
      "levels": number (default 1),
      "isEndUnit": boolean,
      "hasAC": boolean,
      "isRainscreened": boolean (true if mentioned or built > 2005),
      "outdoorSpace": "balcony" | "yard" | "rooftop" | "none",
      "condition": number (1-5 score: 1=Needs Work, 2=Original/Dated, 3=Average/Maintained, 4=Updated, 5=Brand New/Fully Reno),
      "subArea": string (Specific neighborhood name if found, otherwise 'Other'),
      "assessment": number (Assessed Value if present, otherwise null)
    }
    `;

    const payload = {
        model: modelName,
        messages: [{role: "user", content: prompt}]
    };

    const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errorBody = await res.text();
        let formattedError;
        try {
            const errorJson = JSON.parse(errorBody);
            formattedError = JSON.stringify(errorJson, null, 2);
        } catch (e) {
            formattedError = errorBody;
        }
        throw new Error(`${res.status} ${res.statusText}:\n${formattedError}`);
    }

    const data = await res.json();
    let content = data.choices[0].message.content;
    content = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(content);
}

// --- Helper: Clean Number String ---
const cleanNumber = (str) => {
    if (!str) return 0;
    const cleaned = str.replace(/[^0-9.]/g, '');
    return Number(cleaned);
};

// --- Main Parsing Logic (HouseSigma Optimized) ---
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
        listPrice: 0,
        fee: 0,
        bedrooms: 0,
        bathrooms: 0,
        parking: 0,
        propertyTax: 0,
        assessment: 0, // NEW: Defaults to 0
        description: "",
        features: [],
        schools: [],
        subArea: null,
        soldDate: null,
        // Deep Data Placeholders
        parkingType: 'other',
        levels: 1,
        isEndUnit: false,
        hasAC: false,
        rainscreen: false, 
        outdoorSpace: 'balcony',
        condition: 3,
        _sourceUrl: sourceUrl,
        _scrapedAt: scrapedAt,
        _rawFile: filename
    };

    // --- 1. JSON-LD Extraction ---
    const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
        try {
            const json = JSON.parse(script.textContent);
            const types = Array.isArray(json['@type']) ? json['@type'] : [json['@type']];
            
            if (types.some(t => ['RealEstateListing', 'SingleFamilyResidence', 'Place', 'Residence'].includes(t))) {
                if (json.address?.streetAddress && listing.address === "Unknown Address") {
                    listing.address = json.address.streetAddress;
                }
                if (json.address?.addressLocality && listing.city === "Unknown City") {
                    listing.city = json.address.addressLocality;
                }
                if (json.numberOfBedrooms && !listing.bedrooms) listing.bedrooms = Number(json.numberOfBedrooms);
                if (json.numberOfBathroomsTotal && !listing.bathrooms) listing.bathrooms = Number(json.numberOfBathroomsTotal);
                if (json.floorSize?.value && !listing.sqft) listing.sqft = Number(json.floorSize.value);
                if (json.description && !listing.description) listing.description = json.description;
            }
            if (types.includes('Product')) {
                if (json.offers?.price && !listing.price) {
                    listing.price = Number(json.offers.price);
                }
            }
        } catch (e) {}
    }

    // --- 2. DOM Address & City ---
    const h1El = document.querySelector('.address-community .address');
    if (h1El && listing.address === "Unknown Address") {
        const h1Clone = h1El.cloneNode(true);
        h1Clone.querySelectorAll('span').forEach(s => s.remove());
        listing.address = h1Clone.textContent.trim();
    }
    const communityEl = document.querySelector('.address-community .community');
    if (communityEl) {
        const locationParts = communityEl.textContent.split('-').map(s => s.trim());
        if (locationParts.length > 0 && listing.city === "Unknown City") {
            listing.city = locationParts[0];
        }
        if (locationParts.length > 1) {
            listing.subArea = locationParts[1];
        }
    }

    // --- 3. Sold Price & List Price ---
    const soldPriceEl = document.querySelector('.price-area .price .sold');
    if (soldPriceEl) {
        const p = cleanNumber(soldPriceEl.textContent);
        if (p > 0) listing.price = p;
    } else {
        const priceSelectors = ['.listing-price .price', '.price-section .price', '.listing-status .price'];
        for (const selector of priceSelectors) {
            const priceEl = document.querySelector(selector);
            if (priceEl) {
                const p = cleanNumber(priceEl.textContent);
                if (p > 0) {
                    listing.price = p;
                    break;
                }
            }
        }
    }
    
    // Extract List Price
    const listedPriceEl = document.querySelector('.price-area .price .listed');
    if (listedPriceEl) {
        const lp = cleanNumber(listedPriceEl.textContent);
        if (lp > 0) listing.listPrice = lp;
    }

    // --- 3.1 Sold Date ---
    const tableRows = document.querySelectorAll('.pc-listing-history .table tbody tr');
    for (const row of tableRows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
            const eventType = cells[3].textContent.trim();
            if (eventType.toLowerCase() === 'sold') {
                const sDate = cells[1].textContent.trim();
                // Basic validation YYYY-MM-DD
                if (/^\d{4}-\d{2}-\d{2}$/.test(sDate)) {
                    listing.soldDate = sDate;
                    break; 
                }
            }
        }
    }

    // --- 4. Description ---
    if (!listing.description) {
        const descSelectors = ['.listing-description p', '.description-content', '.pc-description p'];
        for (const selector of descSelectors) {
            const descEl = document.querySelector(selector);
            if (descEl) {
                listing.description = descEl.textContent.trim();
                break;
            }
        }
    }

    // --- 5. Key Facts & Deep Data ---
    const dtElements = document.querySelectorAll('dt, .label');
    for (const dt of dtElements) {
        const label = dt.textContent.toLowerCase().trim();
        let dd = dt.nextElementSibling;
        if (!dd && dt.classList.contains('label')) {
            dd = dt.parentElement.querySelector('.value');
        }

        if (!dd) continue;
        const value = dd.textContent.trim();
        const valLower = value.toLowerCase();
        
        if (label.includes('year built') || label.includes('approximate age')) {
            const yearMatch = value.match(/\d{4}/);
            if (yearMatch && !listing.year) listing.year = parseInt(yearMatch[0]);
        }
        if ((label.includes('size') || label.includes('floor area')) && !listing.sqft) {
            listing.sqft = cleanNumber(value);
        }
        if ((label.includes('maintenance') || label.includes('strata fee')) && !listing.fee) {
            listing.fee = cleanNumber(value);
        }
        if ((label.includes('tax') || label.includes('property tax')) && !listing.propertyTax) {
            const taxPart = value.split('/')[0];
            listing.propertyTax = cleanNumber(taxPart);
        }
        if (label.includes('parking') && !listing.parking) {
            const parkMatch = value.match(/(\d+)/);
            if (parkMatch) listing.parking = parseInt(parkMatch[1]);
        }
        if (label.includes('parking features') || label.includes('parking type')) {
            if (valLower.includes('underground')) listing.parkingType = 'underground';
            else if (valLower.includes('carport')) listing.parkingType = 'carport';
            else if (valLower.includes('double')) listing.parkingType = 'garage_double';
            else if (valLower.includes('tandem')) listing.parkingType = 'garage_tandem';
            else if (valLower.includes('street')) listing.parkingType = 'street';
        }
        if (label.includes('property type') || label.includes('style')) {
            const lvlMatch = value.match(/(\d+)\s*storey/i);
            if (lvlMatch) listing.levels = parseInt(lvlMatch[1]);
        }
        if (label.includes('cooling') || label.includes('amenities')) {
            if (valLower.includes('air conditioning') || valLower.includes('central air') || valLower.includes('heat pump')) {
                listing.hasAC = true;
            }
        }
    }

    // --- 6. Robust Assessment Extraction (High Precision Table Scan) ---
    const assessmentMatches = [];

    // Strategy A: Explicit HouseSigma Assessment Table
    // Structure: .pc-assessment-history table tbody tr
    // Columns: Year | Taxes | Land | Building | Total
    const historyTableRows = document.querySelectorAll('.pc-assessment-history table tbody tr');
    historyTableRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        // We look for 5 columns. The Year is col 0, Total is col 4 (last)
        if (cells.length >= 5) {
            const yearTxt = cells[0].textContent.trim();
            const totalTxt = cells[4].textContent.trim(); // 5th column
            
            const year = parseInt(yearTxt);
            const amount = cleanNumber(totalTxt);
            
            if (year > 2000 && amount > 10000) {
                assessmentMatches.push({ year, amount, source: 'table' });
            }
        }
    });

    // Strategy B: Scan Script Tags (Fallback)
    if (assessmentMatches.length === 0) {
        const scripts = document.querySelectorAll('script');
        scripts.forEach(s => {
            const txt = s.textContent;
            // {"year": "2026", ... "total": "1213000"}
            const pattern = /["']year["']\s*:\s*["'](202[0-9])["'].{0,200}["']total["']\s*:\s*["']?(\d+)["']?/g;
            let m;
            while ((m = pattern.exec(txt)) !== null) {
                assessmentMatches.push({ year: parseInt(m[1]), amount: parseInt(m[2]), source: 'script' });
            }
            
            // { "total": 1213000, ... "year": 2026 }
            const patternB = /["']total["']\s*:\s*["']?(\d+)["']?.{0,200}["']year["']\s*:\s*["'](202[0-9])["']/g;
            while ((m = patternB.exec(txt)) !== null) {
                assessmentMatches.push({ year: parseInt(m[2]), amount: parseInt(m[1]), source: 'script' });
            }
        });
    }

    if (assessmentMatches.length > 0) {
        // Sort by Year Descending, then Amount Descending
        assessmentMatches.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year; 
            return b.amount - a.amount;
        });
        listing.assessment = assessmentMatches[0].amount;
    }

    // --- 7. Spec Icons Fallback ---
    if (!listing.bedrooms || !listing.bathrooms || !listing.parking) {
        const specItems = document.querySelectorAll('.spec-item, .config-item');
        for (const item of specItems) {
            const text = item.textContent.toLowerCase();
            const numMatch = item.textContent.match(/(\d+)/);
            if (!numMatch) continue;
            const num = parseInt(numMatch[1]);
            if (text.includes('bed') && !listing.bedrooms) listing.bedrooms = num;
            if (text.includes('bath') && !listing.bathrooms) listing.bathrooms = num;
            if ((text.includes('garage') || text.includes('parking')) && !listing.parking) listing.parking = num;
        }
    }

    // --- 8. Description Analysis ---
    const descLower = (listing.description || "").toLowerCase();
    if (descLower.includes('corner unit') || descLower.includes('end unit')) listing.isEndUnit = true;
    
    // Improved Outdoor Space Detection
    if (descLower.includes('rooftop')) {
        listing.outdoorSpace = 'rooftop';
    } else if (descLower.includes('yard') || descLower.includes('garden')) {
        listing.outdoorSpace = 'yard';
    } else if (descLower.includes('balcony') || descLower.includes('patio') || descLower.includes('deck') || descLower.includes('terrace') || descLower.includes('solarium') || descLower.includes('sundeck')) {
        listing.outdoorSpace = 'balcony';
    }
    
    listing.rainscreen = (listing.year >= 2005) || descLower.includes('rainscreen') || descLower.includes('rain screen');
    if (!listing.hasAC && (descLower.includes('air conditioning') || descLower.includes('a/c') || descLower.includes('heat pump'))) {
        if (!descLower.includes('rough-in')) listing.hasAC = true;
    }

    // --- 9. School Extraction ---
    const schoolElements = document.querySelectorAll('.pc-school-nearby .pc-school');
    const addedSchools = new Set(); 
    schoolElements.forEach(schoolEl => {
        const ratingEl = schoolEl.querySelector('.school-rating p em');
        const nameEl = schoolEl.querySelector('.main-text em');
        const distanceEl = schoolEl.querySelector('.main-text span');
        let type = "Unknown";
        const tags = schoolEl.querySelectorAll('.status-tag');
        tags.forEach(tag => {
            const t = tag.textContent.trim();
            if (/[A-Z0-9]+-[A-Z0-9]+/i.test(t)) type = t; 
        });
        if (nameEl && ratingEl) {
            const name = nameEl.textContent.trim();
            if (addedSchools.has(name)) return;
            const rating = parseFloat(ratingEl.textContent.trim());
            if (rating > 0) {
                addedSchools.add(name);
                listing.schools.push({
                    name: name,
                    rating: rating,
                    distance: distanceEl ? distanceEl.textContent.trim() : "",
                    type
                });
            }
        }
    });

    return listing;
}


// --- Main Execution ---
async function main() {
    if (!fs.existsSync(HTML_DIR)) {
        console.error(chalk.red(`Error: data/html directory not found at ${HTML_DIR}`));
        console.error("Please place your HouseSigma HTML files there.");
        process.exit(1);
    }
    
    if (!fs.existsSync(JSON_DIR)) {
        fs.mkdirSync(JSON_DIR, { recursive: true });
    }

    let htmlFiles = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
    let skippedFiles = new Set();
    const existingJsonSkips = [];
    
    // Deduplication Logic
    if (!shouldSkipDedup && htmlFiles.length > 0) {
        console.log(chalk.cyan('\n=== Deduplication Phase ==='));
        const deletedCopyFiles = autoCleanupCopyFiles(htmlFiles);
        htmlFiles = htmlFiles.filter(f => !deletedCopyFiles.includes(f));
        
        if (htmlFiles.length > 1) {
            console.log(chalk.gray('Scanning for duplicates...'));
            const { urlDupes, addrDupes } = findDuplicates(htmlFiles);
            const seenFiles = new Set();
            const allDupes = [];
            
            [...urlDupes, ...addrDupes].forEach(group => {
                const groupFiles = new Set(group.map(g => g.file));
                const key = [...groupFiles].sort().join('|');
                if (!seenFiles.has(key)) {
                    seenFiles.add(key);
                    allDupes.push(group);
                }
            });
            
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
        const jsonPath = path.join(JSON_DIR, file.replace(/\.html$/i, '.json'));
        if (fs.existsSync(jsonPath)) {
            existingJsonSkips.push(file);
            return false;
        }
        return true;
    });

    if (existingJsonSkips.length > 0) {
        console.log(chalk.gray(`Skipping ${existingJsonSkips.length} files with existing JSON outputs.`));
    }

    if (filesToProcess.length === 0) {
        console.log(chalk.green("All HTML files processed. No new files."));
        return;
    }

    console.log(chalk.cyan(`\n=== Processing Phase ===`));
    console.log(chalk.cyan(`Found ${filesToProcess.length} files to process\n`));

    const b1 = new cliProgress.SingleBar({
        format: chalk.blue('{bar}') + ' {percentage}% | {value}/{total} Files | ' + chalk.yellow('{status}') + ' | {file}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false
    });

    b1.start(filesToProcess.length, 0, { status: 'Initializing', file: '...' });

    let llmSuccessCount = 0;
    
    for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        const shortName = file.length > 25 ? file.substring(0, 22) + '...' : file;
        
        // 1. Basic Parse
        b1.update(i, { status: 'Parsing HTML', file: shortName });
        const htmlPath = path.join(HTML_DIR, file);
        const html = fs.readFileSync(htmlPath, 'utf-8');
        const listing = parseHtml(html, file);
        
        // 2. LLM Enrichment
        if (listing.description && resolveEnv('LLM_API_KEY')) {
            b1.update(i, { status: 'Enriching (LLM)', file: shortName });
            
            try {
                const deepData = await extractDeepData(listing.description, listing.features);
                
                if (deepData) {
                    if (listing.subArea && listing.subArea !== "Other") {
                        delete deepData.subArea;
                    }
                    if (listing.parkingType === 'other' && deepData.parkingType) listing.parkingType = deepData.parkingType;
                    if (!listing.isEndUnit && deepData.isEndUnit) listing.isEndUnit = deepData.isEndUnit;
                    if (!listing.hasAC && deepData.hasAC) listing.hasAC = deepData.hasAC;
                    if (!listing.assessment && deepData.assessment) listing.assessment = deepData.assessment;
                    
                    if (deepData.outdoorSpace && deepData.outdoorSpace !== 'none') {
                        if (deepData.outdoorSpace === 'rooftop') listing.outdoorSpace = 'rooftop';
                        else if (deepData.outdoorSpace === 'yard' && listing.outdoorSpace !== 'rooftop') listing.outdoorSpace = 'yard';
                        else if (listing.outdoorSpace === 'none') listing.outdoorSpace = 'balcony';
                    }
                    
                    listing.condition = deepData.condition;
                    if (typeof deepData.isRainscreened === 'boolean') {
                        listing.rainscreen = listing.rainscreen || deepData.isRainscreened;
                    }
                    
                    llmSuccessCount++;
                }
            } catch (error) {
                b1.stop();
                console.log('\n'); 
                console.error(chalk.bgRed.white.bold(' LLM ENRICHMENT FAILED '));
                console.error(chalk.red(`File: ${file}`));
                console.error(chalk.yellow(error.message));
                process.exit(1);
            }
        }

        if (!listing.subArea) listing.subArea = "Other";

        // 3. Save
        b1.update(i, { status: 'Saving JSON', file: shortName });
        const outName = file.replace('.html', '.json');
        fs.writeFileSync(path.join(JSON_DIR, outName), JSON.stringify(listing, null, 2));
        b1.increment();
    }
    
    b1.stop();
    
    console.log(chalk.green(`\n\u2714 Success! Processed ${filesToProcess.length} files.`));
    if (resolveEnv('LLM_API_KEY')) {
        console.log(chalk.gray(`  LLM Stats: ${llmSuccessCount} enriched.`));
    }
    console.log(`  Data saved to ${chalk.underline(JSON_DIR)}`);
}

main();
