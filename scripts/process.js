import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import 'dotenv/config';

// --- Configuration ---
const RAW_DIR = path.join(process.cwd(), 'raw_data');
const OUT_DIR = path.join(process.cwd(), 'src/data');

// --- Helper: Env Resolution ---
const resolveEnv = (key) => process.env[key];

// --- Helper: LLM Extraction ---
async function extractDeepData(description, features = []) {
    const apiKey = resolveEnv('LLM_API_KEY');
    const baseURL = resolveEnv('LLM_API_URL');
    const modelName = resolveEnv('LLM_MODEL_NAME') || "gpt-3.5-turbo";

    if (!apiKey) {
        console.warn("⚠️ No LLM_API_KEY. Skipping deep enrichment.");
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
      "outdoorSpace": "balcony" | "yard" | "rooftop" | "none"
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
                messages: [{role: "user", content: prompt}],
                temperature: 0
            })
        });

        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        let content = data.choices[0].message.content;
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(content);
    } catch (e) {
        console.error("LLM Error:", e.message);
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
            if (labels.some(l => text.includes(l.toLowerCase()))) {
                const nextEl = td.nextElementSibling;
                if (nextEl) return nextEl.textContent.trim();
            }
        }
        return null;
    };

    const yearStr = getTableValue(['Year Built']);
    if (yearStr) listing.year = parseInt(yearStr.replace(/[^0-9]/g, ''), 10);
    else {
        const ageStr = getTableValue(['Age']);
        if (ageStr) {
            const match = ageStr.match(/\((\d{4})\)/);
            if (match) listing.year = parseInt(match[1], 10);
        }
    }

    const feeStr = getTableValue(['Maintenance Fee', 'Strata Fee']);
    if (feeStr) listing.fee = cleanNumber(feeStr);

    const taxStr = getTableValue(['Property Taxes', 'Gross Taxes']);
    if (taxStr) listing.propertyTax = cleanNumber(taxStr);

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

    // Basic Rainscreen Logic (Pre-LLM)
    const desc = (listing.description || "").toLowerCase();
    listing.rainscreen = (listing.year >= 2005) || desc.includes('rainscreen') || desc.includes('rain screen');

    return listing;
}


// --- Main Execution ---
async function main() {
    if (!fs.existsSync(RAW_DIR)) {
        console.error(`Error: raw_data directory not found at ${RAW_DIR}`);
        console.error("Please place your downloaded HTML files there.");
        process.exit(1);
    }
    
    // Ensure output dir exists
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.html'));
    console.log(`Found ${files.length} HTML files to process.`);

    for (const file of files) {
        const rawPath = path.join(RAW_DIR, file);
        const html = fs.readFileSync(rawPath, 'utf-8');
        
        console.log(`Processing ${file}...`);
        
        // 1. Basic Parse
        const listing = parseHtml(html, file);
        
        // 2. LLM Enrichment
        if (listing.description) {
            process.stdout.write("  -> Enriching with LLM... ");
            const deepData = await extractDeepData(listing.description, listing.features);
            if (deepData) {
                Object.assign(listing, deepData);
                console.log("Done.");
            } else {
                console.log("Skipped (API Error or Missing Key).");
            }
        }

        // 3. Save
        const outName = file.replace('.html', '.json');
        fs.writeFileSync(path.join(OUT_DIR, outName), JSON.stringify(listing, null, 2));
    }
    
    console.log(`\nSuccess! Processed data saved to ${OUT_DIR}`);
}

main();
