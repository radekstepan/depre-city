import { resolveEnvValue } from './env';

export interface DeepData {
  parkingType: 'underground' | 'carport' | 'garage_double' | 'garage_tandem' | 'street' | 'other';
  levels: number;
  isEndUnit: boolean;
  hasAC: boolean;
  isRainscreened: boolean;
  outdoorSpace: 'balcony' | 'yard' | 'rooftop' | 'none';
  condition: number; // 1 (Poor) to 5 (New/Reno)
  subArea?: string; // Optional because we prefer DOM extraction
}

/**
 * Calls the configured LLM to extract deep features from raw listing text.
 */
export async function extractDeepData(
  description: string, 
  features: string[] = []
): Promise<DeepData> {

  // Load Config
  const apiKey = resolveEnvValue(process.env.LLM_API_KEY);
  const baseURL = resolveEnvValue(process.env.LLM_API_URL);
  const modelName = resolveEnvValue(process.env.LLM_MODEL_NAME) || "gpt-3.5-turbo";

  if (!apiKey || !baseURL) {
    console.warn("LLM Config missing (LLM_API_KEY/LLM_API_URL). Returning default deep data.");
    return getDefaultDeepData();
  }

  const prompt = `
    Analyze the following Real Estate listing text and extract the specific technical details.
    
    Text:
    "${description}"
    
    Features List:
    ${features.join(', ')}

    Return strictly a JSON object with this schema:
    {
      "parkingType": "underground" | "carport" | "garage_double" | "garage_tandem" | "street" | "other",
      "levels": number (default to 1 if apartment, 2 or 3 if townhouse/house not specified),
      "isEndUnit": boolean,
      "hasAC": boolean (look for air conditioning, heat pump, A/C),
      "isRainscreened": boolean (true if "rainscreened", "rain screen", or built > 2005),
      "outdoorSpace": "balcony" | "yard" | "rooftop" | "none",
      "condition": number (1-5 score: 1=Needs Work, 2=Original/Dated, 3=Average/Maintained, 4=Updated, 5=Brand New/Fully Reno),
      "subArea": string (The specific neighborhood/sub-area name if explicit in text. Use "Other" if unclear.)
    }
  `;

  try {
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "You are a real estate data extraction engine. Output JSON only." },
          { role: "user", content: prompt }
        ],
        temperature: 0
      })
    });

    if (!response.ok) {
      throw new Error(`LLM API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || "{}";
    
    // Clean code blocks if present
    const cleanJson = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson) as DeepData;

  } catch (error) {
    console.error("LLM Extraction Failed:", error);
    return getDefaultDeepData();
  }
}

function getDefaultDeepData(): DeepData {
  return {
    parkingType: 'other',
    levels: 1,
    isEndUnit: false,
    hasAC: false,
    isRainscreened: false,
    outdoorSpace: 'none',
    condition: 3,
    subArea: 'Other'
  };
}
