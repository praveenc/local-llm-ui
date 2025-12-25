# Feature: Contextual Provider Settings

## Overview

Refactor the User Preferences modal to show provider-specific configuration fields only when the corresponding provider is selected. This reduces visual clutter and makes the UI more intuitive as we add more providers.

## Current State

The preferences modal shows ALL configuration sections at once:
- Model Provider (radio group with 6 options)
- Bedrock Mantle Settings (API key + region) - always visible
- AI Provider API Keys (Groq + Cerebras) - always visible
- Display Settings (avatar, visual mode, density)

## Target State

Show configuration fields contextually based on selected provider:

| Provider Selected | Fields Shown |
|-------------------|--------------|
| Amazon Bedrock | None (uses AWS credentials) |
| Bedrock Mantle | API Key + Region |
| LM Studio | None (local server) |
| Ollama | None (local server) |
| Groq | Groq API Key |
| Cerebras | Cerebras API Key |

Display Settings remain always visible.

## Implementation Steps

### Step 1: Create Provider Settings Component

Extract provider-specific settings into a conditional render block that shows/hides based on `customValue.preferredProvider`.

```tsx
{/* Provider-specific settings - shown contextually */}
{customValue.preferredProvider === 'bedrock-mantle' && (
  <Box>
    {/* Bedrock Mantle API Key + Region */}
  </Box>
)}

{customValue.preferredProvider === 'groq' && (
  <Box>
    {/* Groq API Key */}
  </Box>
)}

{customValue.preferredProvider === 'cerebras' && (
  <Box>
    {/* Cerebras API Key */}
  </Box>
)}
```

### Step 2: Update Section Headers

- Remove "Bedrock Mantle Settings" and "AI Provider API Keys" as separate sections
- Add a single "Provider Settings" section that appears only when needed
- Keep "Display Settings" as-is

### Step 3: Add Helper Text

For providers that don't need configuration (Bedrock, LM Studio, Ollama), show a brief info message:
- Bedrock: "Uses your AWS credentials from environment"
- LM Studio: "Connects to local server on port 1234"
- Ollama: "Connects to local server on port 11434"

### Step 4: Clean Up Dividers

Only show dividers between sections that are actually rendered.

## File Changes

| File | Changes |
|------|---------|
| `src/layout/ModelSettingsPanel.tsx` | Refactor customPreference render function |

## Testing Checklist

- [ ] Select Bedrock → No extra fields shown, info message displayed
- [ ] Select Bedrock Mantle → API Key + Region fields shown
- [ ] Select LM Studio → No extra fields, info message displayed
- [ ] Select Ollama → No extra fields, info message displayed
- [ ] Select Groq → Groq API Key field shown
- [ ] Select Cerebras → Cerebras API Key field shown
- [ ] Existing API keys are preserved when switching providers
- [ ] Save/Cancel works correctly
- [ ] No console errors

## Progress

- [x] Create feature branch
- [x] Write implementation plan
- [ ] Implement contextual rendering
- [ ] Test all provider combinations
- [ ] Verify no dev server errors
- [ ] Commit changes
