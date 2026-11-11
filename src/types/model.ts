/**
 * Model option type for dropdowns and selection components.
 */
export interface ModelOption {
  value: string;
  label: string;
  description?: string;
  /** The provider reports that the model can think (Ollama) */
  supportsThinking?: boolean;
}
