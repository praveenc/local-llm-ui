# Claude prices in the app

The app calculates the cost of a reply from its token usage. This page records the Claude prices that `src/utils/pricing.ts` uses, and how the app applies them.

- **Source:** [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- **Copied on:** 2026-11-24 (`CLAUDE_PRICES_DATE` in `src/utils/pricing.ts`)
- When you change a price, change `CLAUDE_PRICES` and `CLAUDE_PRICES_DATE` in the same commit, and update this page.

## Prices

USD per million tokens (MTok). The cache write price is for the 5-minute cache.

| Model | Input | Cache write | Cache read | Output |
| --- | --- | --- | --- | --- |
| Claude Fable 5.2, Claude Mythos 5.2 | $8 | $10 | $0.20 | $40 |
| Claude Fable 5.1, Claude Mythos 5.1 | $10 | $12.50 | $0.25 | $50 |
| Claude Fable 5, Claude Mythos 5 | $10 | $12.50 | $1 | $50 |
| Claude Opus 5.5 | $4 | $5 | $0.20 | $20 |
| Claude Opus 5, 4.8, 4.7, 4.6, 4.5 | $5 | $6.25 | $0.50 | $25 |
| Claude Opus 4.1, 4 | $15 | $18.75 | $1.50 | $75 |
| Claude Sonnet 5.5 | $2 | $2.50 | $0.10 | $10 |
| Claude Sonnet 5 | $2 | $2.50 | $0.20 | $10 |
| Claude Sonnet 4.6, 4.5, 4 | $3 | $3.75 | $0.30 | $15 |
| Claude Haiku 5.5, prompt of 100,000 tokens or less | $0.10 | $0.125 | $0.01 | $0.50 |
| Claude Haiku 5.5, prompt over 100,000 tokens | $0.50 | $0.625 | $0.05 | $2.50 |
| Claude Haiku 4.5 | $1 | $1.25 | $0.10 | $5 |

The table also keeps Claude Sonnet 3.7, Haiku 3.5, Opus 3, and Haiku 3 at their last published prices. The pricing page no longer lists them.

## How the app applies the prices

- **Each model call is priced on its own.** With tools on, one reply can have several model calls. The server sends the usage of each call (`server/usage.ts`). This matters for Claude Haiku 5.5: a call with a prompt over 100,000 tokens pays the higher prices, and the other calls do not.
- **Cache tokens.** The input tokens include the tokens read from and written to the prompt cache. The app bills those tokens at the cache prices and the rest at the input price.
- **Amazon Bedrock.** A global inference profile (`global.anthropic.…`) uses the prices above. A regional profile (for example `us.anthropic.…`) or a model ID without a profile costs 10% more for Claude 4.5 and later. The app treats the Bedrock price as equal to the Claude API price. For the official Bedrock prices, see [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing/).
- **OpenRouter.** Claude models on OpenRouter use the prices above. OpenRouter can add its own fees.
- **Other cloud models** use the price from the tokenlens catalog, when it has one. Cache tokens are then billed at the input price.
- **Local models** (Ollama and LM Studio) cost nothing. The app shows "Free".
- **No price.** A model that has no price shows "No price data", not $0.00.

## What the app does not include

- Batch API discounts, fast mode, and the `inference_geo` data residency price on the Claude API.
- The 1-hour cache. The app uses the 5-minute cache write price for all cache writes.
- Server-side tool fees, for example the Claude API web search fee. The app's own web search (Brave Search, Exa, Tavily) is billed by those providers, not by the model.
- Replies saved before this change have no per-call usage. The app prices them as one model call.
