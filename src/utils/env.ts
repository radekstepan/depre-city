/**
 * Resolves an environment variable value.
 * If the value matches a key in process.env (e.g., 'OPENAI_API_KEY'), 
 * it returns the actual value of that environment variable.
 * Otherwise, it returns the value as-is.
 */
export function resolveEnvValue(value: string | undefined): string {
    if (!value) return '';
    // If running in Node (script or build)
    if (typeof process !== 'undefined' && process.env) {
      if (process.env[value] !== undefined) {
        return process.env[value]!;
      }
    }
    // If running in Client (Vite/Astro), handled by define:vars or ignore
    return value;
  }
