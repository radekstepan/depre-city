# DepreCity

**The True Cost of Ownership.**

DepreCity is a specialized valuation tool for townhouses in Coquitlam and Port Moody, BC. Unlike standard real estate calculators that focus on simple price-per-square-foot, DepreCity uses a **Linear Regression Model** to generate a "Discount Function" that accounts for the non-linear "S-curve" of value, specific risk eras (like the Leaky Condo Crisis), and land value floors.

## Features

*   **Live Market Analysis:** The system ingests raw listing data at build time to calculate the current "Port Moody Premium" and "Base Market Rate" using linear regression.
*   **Valuation Calculator:** Inputs for unit size, year built, and specific risks (strata fees, levies, rainscreen status) are weighed against the generated market model.
*   **Depreciation Visualizer:** A chart demonstrating the non-linear depreciation curve specific to the Tri-Cities market.
*   **Educational Report:** A comprehensive breakdown of construction eras ("Geologic Layers") and the physics of depreciation.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
yarn install
```

### 2. Run Locally
Start the development server with hot-reloading:
```bash
yarn dev
```
Open your browser to `http://localhost:4321`.

### 3. Build for Production
Generates the static files in the `dist/` directory:
```bash
yarn build
```

## 🌐 Deployment (Netlify)

This project is optimized for Netlify.

1.  Push this code to a GitHub repository.
2.  Log in to [Netlify](https://www.netlify.com/).
3.  Click **"Add new site"** > **"Import from an existing project"**.
4.  Select your GitHub repo.
5.  Netlify will automatically detect the **Astro** settings:
    *   **Build command:** `yarn build`
    *   **Publish directory:** `dist`
6.  Click **Deploy**.

*(The included `netlify.toml` will strictly enforce these settings).*

---

## 🤖 How to Update Market Data (AI Workflow)

This engine runs on "Ground Truth" data located in `src/data/listings.json`. You can use Google Deep Research, ChatGPT Pro, or Gemini Advanced to scrape/research real-time data for you.

### Copy & Paste this Prompt into Google Deep Research / Gemini:

```text
**Role:** Act as a Senior Real Estate Data Analyst.

**Task:** Conduct deep research to compile a dataset of 25-30 **real, recent (past 3-6 months)** townhouse listings (Sold or Active) in **Port Moody** and **Coquitlam, BC**.

**Sources:** Verify data using REW.ca, Zolo.ca, Redfin, or BC Assessment.

**Data Requirements:**
1.  **Diversity:** Ensure a mix of older wood-frame units (1980-2000) and newer concrete/composite builds (2010-2024).
2.  **Rainscreen Logic:** If the Year Built is >= 2005, set `rainscreen` to `true`. If older, only set to `true` if the listing explicitly states "fully rainscreened".
3.  **Output Format:** Provide the result **strictly** as a raw JSON array of objects (no markdown code blocks, no intro text).

**Required JSON Schema per Object:**
{
  "address": "String (e.g. '123 Newport Dr')",
  "city": "String (Exactly 'Port Moody' or 'Coquitlam')",
  "sqft": Number (Interior size),
  "year": Number (Year built),
  "fee": Number (Monthly strata fee in CAD),
  "price": Number (Sold price preferred, or List price),
  "rainscreen": Boolean
}
```

### Steps:
1.  Run the prompt above in your AI research tool.
2.  Copy the raw JSON output.
3.  Paste it strictly into `src/data/listings.json` (replacing the entire file content).
4.  Run `yarn build`. 
5.  The site will automatically recalculate the Regression Model, Location Premiums, and Confidence Scores based on the new real-world data.
