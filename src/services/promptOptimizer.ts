/**
 * Prompt Optimizer Service
 * Sends user prompts to Claude Opus 4.5 for optimization using best practices
 */

const BEDROCK_BASE_URL = '/api/bedrock';
const CLAUDE_OPUS_45_MODEL = 'global.anthropic.claude-opus-4-5-20251101-v1:0';
const OPTIMIZATION_TIMEOUT_MS = 30000;

export interface OptimizePromptResult {
  success: boolean;
  optimizedPrompt?: string;
  error?: string;
}

interface OptimizePromptOptions {
  signal?: AbortSignal;
}

/**
 * Fetches the best practices document for prompt optimization
 */
async function fetchBestPractices(): Promise<string> {
  const response = await fetch('/claude-4-5-prompting-best-practices.md');
  if (!response.ok) {
    throw new Error('Failed to load best practices document');
  }
  return response.text();
}

/**
 * Fetches the optimizer prompt template
 */
async function fetchOptimizerTemplate(): Promise<string> {
  const response = await fetch('/claude-4-5-optimizer-template.md');
  if (!response.ok) {
    throw new Error('Failed to load optimizer template');
  }
  return response.text();
}

/**
 * Builds the optimization request message
 */
function buildOptimizationPrompt(
  userPrompt: string,
  template: string,
  bestPractices: string
): string {
  const promptWithUserInput = template.replace('{{USER_PROMPT}}', userPrompt);
  return `${promptWithUserInput}\n\n---\n\n# Best Practices Reference\n\n${bestPractices}`;
}

/**
 * Optimizes a user prompt using Claude Opus 4.5
 */
export async function optimizePrompt(
  userPrompt: string,
  options: OptimizePromptOptions = {}
): Promise<OptimizePromptResult> {
  const { signal } = options;

  // Create timeout abort controller
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), OPTIMIZATION_TIMEOUT_MS);

  // Combine signals if external signal provided
  const combinedSignal = signal
    ? createCombinedSignal(signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    // Load required documents
    const [template, bestPractices] = await Promise.all([
      fetchOptimizerTemplate(),
      fetchBestPractices(),
    ]);

    const optimizationPrompt = buildOptimizationPrompt(userPrompt, template, bestPractices);

    const response = await fetch(`${BEDROCK_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_OPUS_45_MODEL,
        messages: [
          {
            role: 'user',
            content: optimizationPrompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    // Process streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let optimizedPrompt = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              optimizedPrompt += parsed.content;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

    // Validate response
    if (!optimizedPrompt.trim()) {
      return {
        success: false,
        error: 'Received empty response from optimization service',
      };
    }

    // Remove code fences if present (e.g., ```markdown ... ```)
    let cleanedPrompt = optimizedPrompt.trim();
    const codeFenceRegex = /^```(?:markdown|md|text)?\s*\n?([\s\S]*?)\n?```$/;
    const match = cleanedPrompt.match(codeFenceRegex);
    if (match) {
      cleanedPrompt = match[1].trim();
    }

    return {
      success: true,
      optimizedPrompt: cleanedPrompt,
    };
  } catch (error) {
    const err = error as Error;

    if (err.name === 'AbortError') {
      // Check if it was a timeout or user cancellation
      if (timeoutController.signal.aborted && !signal?.aborted) {
        return {
          success: false,
          error: 'Optimization request timed out after 30 seconds',
        };
      }
      return {
        success: false,
        error: 'Optimization was cancelled',
      };
    }

    return {
      success: false,
      error: err.message || 'Failed to optimize prompt',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Creates a combined abort signal from multiple signals
 */
function createCombinedSignal(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return controller.signal;
}

export const promptOptimizerService = {
  optimizePrompt,
};
