# DepreCity

**The Predictive Valuation Engine.**

DepreCity is a specialized valuation tool for townhouses in Coquitlam and Port Moody, BC. It uses a "Data Lake" approach where raw listing HTML is captured first, then processed and enriched with AI to extract deep features (Garage types, End Units, etc.) for a Multivariate Regression analysis.

## Features

*   **Multivariate Analysis:** Prices features like Double Garages, End Units, and AC.
*   **Deep Data:** Uses LLMs to parse unstructured description text.
*   **Offline Processing:** Separates data collection (HTML) from extraction (JSON).

## 🚀 Workflow

### 1. Setup
```bash
yarn install
# Copy .env.example to .env and add your LLM API Key (OpenAI/OpenRouter)
cp .env.example .env
```

### 2. Collect Data (Chrome Extension)
1.  Load the `extension/` folder in `chrome://extensions` (Developer Mode).
2.  Navigate to a listing on Zealty.ca or REW.ca.
3.  Click the DepreCity icon.
4.  **Result:** It downloads a `.html` file containing the raw source code + metadata.
5.  Move these files into the `raw_data/` folder in this project root.

### 3. Process & Enrich
Run the processing script. This reads the HTML files from `raw_data/`, extracts the basic stats using JSDOM, and calls your configured LLM to extract "Deep Data" (Parking type, Rainscreen status, etc.).

```bash
yarn process
```
*Output: Enriched JSON files are saved to `src/data/`.*

### 4. Run App
The application builds the regression model from the JSON files in `src/data/`.

```bash
yarn dev
```

## 🌐 Deployment
*   **Build:** `yarn build`
*   **Output:** `dist/`

## 🤖 Manual Data
You can also manually place JSON files in `src/data/` if you prefer to skip the HTML processing step.
