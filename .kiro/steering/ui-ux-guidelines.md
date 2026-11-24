# UI and UX guidelines

Rules for UI work in local-llm-ui. They come from the UI/UX review and PRs #63 to #68. The plan, scores, decisions, and contrast tables are in `docs/UIUX-IMPROVEMENTS.md`. Read it before you change the chat UI.

## How to work

- **Plan in the doc first.** Add new items to `docs/UIUX-IMPROVEMENTS.md` with the problem, the evidence (`file:line`), and the fix. Put open choices in the Decisions table (D1, D2…) and wait for the user's answer before you write code.
- **Small PRs, grouped by surface.** One PR changes one area (numbers, type, work row, chrome, preferences). Stacked PRs are fine when you state the merge order. Merge commits, not squash, so a later PR shows only its own commits.
- **Mark progress as it lands.** Update the Progress table when a PR opens and when it merges. Bugs found on the way go under "Found during the work".
- **Measure, do not guess.** Compute contrast for all 8 theme variants. Measure characters per line in the browser. Check every model label of a real provider list, not two examples.
- **Test like the user.** Use headless Chromium with a real Bedrock reply (`AWS_PROFILE=001`). Take screenshots in light and dark mode and at 1440, 1024, and 390 px. Check that the page does not scroll sideways. Reload the page and check that saved chats look the same.
- **Test the worst case.** Use the longest model name, the context ring shown, a failed tool, an empty chat, and no provider.

## Principles

- **The answer comes first.** Controls step back. The theme tint is only on links, the open conversation, and the send button. The user's messages, the avatar, inline code, and code-block frames use neutral grey.
- **One concept, one place.** Thinking, searches, and tool calls show only in the work row above the answer. Put later features there too (coding steps, tool approvals) or in the context popover. Do not add new cards or modal dialogs to the chat column.
- **State in words.** Colour must not carry meaning alone: the web search chip says "Search", and a failed step is red and also says "failed".
- **What a reply shows must survive a reload.** Store it with the message in a compact form (see `src/utils/toolResults.ts`).
- **Every running state must end.** Each proxy sends `tool-error`. A tool with no result when the reply ends is marked failed. No spinner may run forever.
- **Numbers must be right, or hidden.** Context fill is the input of the last step of the last reply. Cost is the sum of all steps. Show cost only when the price is known. Use the real context window of each model.
- **Remove duplicates before you add.** If two controls do the same thing, keep one (Clear chat became New chat). Secondary actions go in the **+** menu.
- **Show the model once.** Short label on the chip (`Claude Haiku 5.5 · Global`, from `src/utils/modelLabel.ts`), full name in the tooltip, a "Switched to" line when the model changes, and the model in the usage tooltip.

## Type and layout

- Inter for text and JetBrains Mono for code, both bundled. Do not change to a system font stack.
- Reply text 15 px, line height 1.65 (1.55 in Compact). Paragraphs at most 70 characters wide. Bullets outside the text.
- Headings `text-wrap: balance`, paragraphs `text-wrap: pretty`. Bold is weight 600. Letter spacing 0.
- Code 0.875 em, ligatures off. Tabular figures for usage, cost, tables, and the context meter.
- The chat column and the chat input are both 768 px. The input toolbar must fit on one row.
- An empty chat shows the input in the middle under "What can I help with?". It moves to the bottom after the first message and keeps its text and attachments.

## Controls and settings

- Preferences save on change. Switches, selects, and the theme save at once. Typed values save 700 ms after typing stops, and on blur, Enter, or close. The footer shows "Saved".
- A validation error shows "Not saved" and never stores a broken setting.
- Check that a new label does not clash with an existing accessible name: the footer button is "Done" because the X button is already "Close".
- Text in the UI: short, sentence case, plain verbs ("Running…", "Search chats", "Done").

## Accessibility

- Icon buttons at least 16 px icons and 44 px touch targets, with a visible focus ring.
- Floating buttons must not cover text. Give them their own strip, as the scroll-to-bottom button has.
- Stop pulses and other loops when reduced motion is on.
- The `animate-in` classes do nothing in this build (no plugin). Do not use them for meaning.

## Do not

- Send or show `temperature` or `top_p`.
- Add back the styleguide app, removed UI primitives, the `motion` package, or beads.
- Use the theme tint on large surfaces.
