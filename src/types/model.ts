/**
 * Model option type for dropdowns and selection components.
 * Replaces @cloudscape-design/components SelectProps.Option
 */
export interface ModelOption {
  value: string;
  label: string;
  description?: string;
}
