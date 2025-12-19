# Implementation Plan: Optimize Prompt Feature

## Overview

Add an "Optimize Prompt" feature that helps users improve their prompts when using Claude 4.5 models with Amazon Bedrock. The feature sends the user's prompt along with best-practices documentation to Claude Opus 4.5 for optimization.

## Prerequisites

1. Create feature branch: `feature/claude45-prompt-optimizer`
2. No new dependencies required (uses existing Cloudscape components and Bedrock service)

## Implementation Phases

### Phase 1: Create Prompt Optimizer Service

**File:** `src/services/promptOptimizer.ts` (new)

Create a dedicated service for prompt optimization:

- Load best practices document from `docs/claude-4-5-prompting-best-practices.md`
- Load template from `prompts/claude-4-5-optimizer-template.md`
- Build optimization request with user prompt wrapped in `<prompt>` tags
- Call Bedrock API with hardcoded Claude Opus 4.5 model (`global.anthropic.claude-opus-4-5-20251101-v1:0`)
- Handle streaming response and return optimized prompt
- Include 30-second timeout handling

```typescript
interface OptimizePromptResult {
  success: boolean;
  optimizedPrompt?: string;
  error?: string;
}
```

### Phase 2: Create Optimize Prompt Hook

**File:** `src/hooks/usePromptOptimizer.ts` (new)

Custom hook to manage optimization state:

- `isOptimizing: boolean` - loading state
- `optimizePrompt(prompt: string): Promise<OptimizePromptResult>` - trigger optimization
- `cancelOptimization(): void` - abort in-progress request
- Internal AbortController for timeout/cancellation

### Phase 3: Create Confirmation Modal Component

**File:** `src/components/chat/OptimizePromptModal.tsx` (new)

Cloudscape Modal component with:

- Clear explanation of the optimization process
- Warning that prompt will be sent to Claude Opus 4.5
- Cancel and Confirm buttons
- Follows existing Modal patterns in `FloatingChatInput.tsx`

```typescript
interface OptimizePromptModalProps {
  visible: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
  isOptimizing: boolean;
}
```

### Phase 4: Modify FloatingChatInput Component

**File:** `src/components/chat/FloatingChatInput.tsx` (modify)

Changes required:

1. Add new props:

   ```typescript
   onOptimizePrompt?: () => void;
   isOptimizing?: boolean;
   showOptimizeButton?: boolean;
   ```

2. Add "Optimize Prompt" button in `secondaryActions`:
   - Conditional render based on `showOptimizeButton`
   - Disabled when `inputValue` is empty or `isOptimizing` is true
   - Use Cloudscape Button with `iconName="gen-ai"` or similar

3. Add loading indicator during optimization (Spinner or StatusIndicator)

### Phase 5: Modify ChatContainer Component

**File:** `src/components/chat/ChatContainer.tsx` (modify)

Changes required:

1. Import and use `usePromptOptimizer` hook
2. Add state for modal visibility: `showOptimizeModal: boolean`
3. Add state for previous prompt (for undo): `previousPrompt: string | null`
4. Implement visibility logic:

   ```typescript
   const showOptimizeButton = useMemo(() => {
     const isBedrockProvider = selectedModel?.description?.toLowerCase().includes('bedrock');
     const modelId = selectedModel?.value?.toLowerCase() ?? '';
     const isClaude45 = modelId.includes('sonnet-4-5') ||
                        modelId.includes('haiku-4-5') ||
                        modelId.includes('opus-4-5');
     return isBedrockProvider && isClaude45;
   }, [selectedModel]);
   ```

5. Implement optimization flow:
   - `handleOptimizeClick()` - show confirmation modal
   - `handleOptimizeConfirm()` - call optimizer, replace input on success
   - `handleOptimizeCancel()` - close modal
   - `handleUndoOptimization()` - restore previous prompt

6. Add error Alert for optimization failures

7. Pass new props to FloatingChatInput

### Phase 6: Update Exports

**File:** `src/components/chat/index.ts` (modify)

Export new modal component if needed externally.

**File:** `src/services/index.ts` (modify)

Export promptOptimizer service.

**File:** `src/hooks/index.ts` (create if not exists)

Export usePromptOptimizer hook.

## Component Hierarchy

```text
ChatContainer
├── OptimizePromptModal (new)
├── Alert (error display)
├── MessageList
└── FloatingChatInput
    └── Button (Optimize Prompt - conditional)
```

## State Management

| State | Location | Purpose |
|-------|----------|---------|
| `showOptimizeModal` | ChatContainer | Modal visibility |
| `isOptimizing` | usePromptOptimizer | Loading state |
| `previousPrompt` | ChatContainer | Undo support |
| `optimizeError` | ChatContainer | Error display |

## API Integration

The optimization uses the existing Bedrock service pattern:

1. Build request with best practices document as context
2. Use non-streaming call for simplicity (or streaming with concatenation)
3. Hardcode model: `us.anthropic.claude-opus-4-5-20250514`
4. Set 30-second timeout via AbortController

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| API error | Show Alert, preserve original prompt |
| Timeout (>30s) | Cancel request, show timeout error |
| Empty response | Show error, preserve original prompt |
| Network failure | Show connection error Alert |
| User cancels | Abort request, close modal |
| Prompt modified during optimization | Cancel optimization (AbortController) |

## Cloudscape Components Used

- `Button` - Optimize Prompt trigger
- `Modal` - Confirmation dialog
- `Alert` - Error messages
- `SpaceBetween` - Layout
- `Box` - Text content
- `Spinner` or `StatusIndicator` - Loading state

## Testing Considerations

### Unit Tests

- `promptOptimizer.ts`: Mock fetch, test request building, timeout handling
- `usePromptOptimizer.ts`: Test state transitions, cancellation
- `OptimizePromptModal.tsx`: Render tests, button interactions

### Integration Tests

- Button visibility based on provider/model selection
- Full optimization flow with mocked API
- Error state handling
- Undo functionality

### Edge Cases to Test

- Empty prompt (button disabled)
- Very long prompts (>10,000 chars)
- Special characters and code blocks in prompts
- Rapid model switching during optimization
- Multiple rapid clicks on optimize button
- Network disconnection during optimization

## Acceptance Criteria Validation

| Criterion | Implementation |
|-----------|----------------|
| Button hidden when not Bedrock | `showOptimizeButton` computed property |
| Button hidden when not Claude 4.5 | Model ID check in computed property |
| Button appears on valid switch | React reactivity via useMemo |
| Button disabled when empty | `disabled={!inputValue.trim()}` |
| Modal on click | `showOptimizeModal` state |
| Modal explains process | Static content in OptimizePromptModal |
| Cancel/Confirm actions | Modal footer buttons |
| Escape/outside click cancels | Cloudscape Modal default behavior |
| Request includes prompt tags | Template in promptOptimizer service |
| Request includes best practices | Loaded from docs file |
| Uses Opus 4.5 hardcoded | Constant in promptOptimizer service |
| Loading indicator | `isOptimizing` state + Spinner |
| Button disabled during optimization | `disabled={isOptimizing}` |
| Success replaces prompt | `setInputValue(optimizedPrompt)` |
| Undo support | `previousPrompt` state + Ctrl+Z or button |
| Error shows Alert | Cloudscape Alert component |
| Original preserved on error | Only update on success |
| Timeout handling | AbortController with 30s timeout |
| Empty response handling | Check response before replacing |
| Long prompts | No special handling needed (API handles) |
| Special characters | Pass through unchanged |
| Modification during optimization | Track input changes, cancel if modified |

## Gaps and Clarifications Needed

1. **Undo mechanism**: Should this be a dedicated "Undo" button or rely on browser Ctrl+Z? Recommendation: Add a temporary "Undo" button that appears after successful optimization.

2. **Prompt modification during optimization**: Should we cancel the optimization or queue the new prompt? Recommendation: Cancel and show a message.

3. **Best practices file loading**: Should this be bundled at build time or fetched at runtime? Recommendation: Fetch at runtime for easier updates.

4. **Rate limiting**: Should we prevent rapid successive optimization requests? Recommendation: Yes, disable button during optimization.

5. **Optimization history**: Should we keep a history of optimizations? Not in acceptance criteria, so skip for MVP.

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `prompts/claude-4-5-optimizer-template.md` | Create | Prompt template |
| `src/services/promptOptimizer.ts` | Create | Optimization service |
| `src/hooks/usePromptOptimizer.ts` | Create | State management hook |
| `src/components/chat/OptimizePromptModal.tsx` | Create | Confirmation modal |
| `src/components/chat/FloatingChatInput.tsx` | Modify | Add optimize button |
| `src/components/chat/ChatContainer.tsx` | Modify | Orchestrate feature |
| `src/components/chat/index.ts` | Modify | Export new component |
| `src/services/index.ts` | Modify | Export new service |
