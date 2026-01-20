// This script runs inside the web page context

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Simple ping to check if script is alive
  if (request.action === "PING") {
    sendResponse({ status: "OK" });
    return true;
  }

  if (request.action === "SCRAPE_LISTING") {
    try {
      const data = parseListing();
      sendResponse({ success: true, data: data });
    } catch (error) {
      console.error("DepreCity Scrape Error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }
  return true; // Keep channel open for async response
});

/**
 * Parses Zealty.ca and similar real estate pages
 */
function parseListing() {
  let listing = {
    address: "Unknown Address",
    city: "Unknown City",
    sqft: 0,
    year: 0,
    fee: 0,
    price: 0,
    rainscreen: false,
    _sourceUrl: window.location.href,
    _scrapedAt: new Date().toISOString()
  };

  // 1. Try to get high-fidelity data from JSON-LD (Schema.org)
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  let jsonLd = null;

  for (const script of jsonLdScripts) {
    try {
      const json = JSON.parse(script.textContent);
      // Look for RealEstateListing or valid schema context
      if (json['@type'] === 'RealEstateListing' || 
          (json['@context'] === 'https://schema.org' && json['@type'] === 'Product') ||
          json['@type'] === 'House') {
        jsonLd = json;
        // If it's a Product, sometimes nested offers
        break;
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  // 2. Populate from JSON-LD if available
  if (jsonLd) {
    // Handle flattened 'House' type vs nested 'mainEntity'
    const entity = jsonLd.mainEntity || jsonLd;

    // Address
    if (entity.address) {
      listing.address = entity.address.streetAddress || listing.address;
      listing.city = entity.address.addressLocality || listing.city;
    }
    
    // Sqft
    if (entity.floorSize) {
      // floorSize can be object {value: '1565'} or just string/number
      const val = typeof entity.floorSize === 'object' ? entity.floorSize.value : entity.floorSize;
      listing.sqft = Number(val);
    }
    
    // Price
    let offers = jsonLd.offers || entity.offers;
    if (offers) {
      // Sometimes offers is an array
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (offer && offer.price) {
        listing.price = Number(offer.price);
      }
    }
  }

  // 3. DOM Scrape Fallbacks (Table Data) for specific fields often missing in JSON-LD
  
  const getTableValue = (labels) => {
    // Select all table cells
    const tds = Array.from(document.querySelectorAll('td'));
    for (const td of tds) {
      const text = td.textContent.trim().toLowerCase();
      // Check if this TD matches one of our target labels
      if (labels.some(l => text.includes(l.toLowerCase()))) {
        // The value is in the NEXT sibling TD
        const nextTd = td.nextElementSibling;
        if (nextTd) return nextTd.textContent.trim();
      }
    }
    return null;
  };

  // 3a. Year Built
  // Often labeled "Year Built" or inside "Age" like "4 years (2021)"
  let yearStr = getTableValue(['Year Built']);
  if (yearStr) {
    listing.year = parseInt(yearStr.replace(/[^0-9]/g, ''), 10);
  } else {
    const ageStr = getTableValue(['Age']);
    if (ageStr) {
      // Matches "(2021)" inside string
      const match = ageStr.match(/\((\d{4})\)/); 
      if (match) listing.year = parseInt(match[1], 10);
    }
  }

  // 3b. Maintenance Fee
  const feeStr = getTableValue(['Maintenance Fee', 'Strata Fee', 'Maint. Fee']);
  if (feeStr) {
    // Remove '$' and ','
    listing.fee = Number(feeStr.replace(/[^0-9.]/g, ''));
  }

  // 3c. Backup Price (if JSON-LD failed)
  if (!listing.price) {
    const priceStr = getTableValue(['Sold Price', 'Price', 'Asking Price']);
    if (priceStr) {
      const cleanPrice = priceStr.split('\n')[0].replace(/[^0-9]/g, '');
      listing.price = Number(cleanPrice);
    }
  }

  // 3d. Backup Address/City (if JSON-LD failed)
  if (listing.address === "Unknown Address") {
    const h1 = document.querySelector('h1');
    if (h1) {
      // Common Format: "2834 HOPE STREET, Port Moody, BC, V3H 0L6"
      const parts = h1.textContent.split(',');
      if (parts.length > 0) listing.address = parts[0].trim();
      if (parts.length > 1) listing.city = parts[1].trim();
    }
  }

  // 4. Rainscreen Logic
  // Check description text
  const description = (jsonLd?.description || document.querySelector('.prose')?.textContent || "").toLowerCase();
  const hasRainscreenText = description.includes('rainscreen') || description.includes('rain screen');
  
  // Heuristic: If Year >= 2005 (post-crisis code) OR text found
  listing.rainscreen = (listing.year >= 2005) || hasRainscreenText;

  // Final sanity check for nulls to avoid NaN in calculator
  listing.sqft = listing.sqft || 0;
  listing.year = listing.year || 0;
  listing.fee = listing.fee || 0;
  listing.price = listing.price || 0;

  return listing;
}
