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

This engine runs on "Ground Truth" data located in `src/data/listings.json`. You can use an LLM (ChatGPT, Gemini, Claude) to scrape/generate this data for you.

### Copy & Paste this Prompt into Gemini/ChatGPT:

> "I need a dataset of 20 recent sold or active townhouse listings in **Port Moody and Coquitlam, BC**. 
> 
> Please format the output strictly as a JSON array of objects with no other text. 
> 
> Each object must have these exact fields:
> - `address` (string)
> - `city` (string: "Port Moody" or "Coquitlam")
> - `sqft` (number: interior size)
> - `year` (number: year built)
> - `fee` (number: monthly strata fee)
> - `price` (number: list or sold price)
> - `rainscreen` (boolean: true if built after 2005, or if listing mentions 'rainscreened'. false otherwise)
> 
> Do not include any code blocks or explanations, just the raw JSON array."

### Steps:
1.  Run the prompt.
2.  Copy the JSON output.
3.  Paste it into `src/data/listings.json`.
4.  Run `yarn build`. 
5.  The site will automatically recalculate the Regression Model, Location Premiums, and Confidence Scores based on the new data.
