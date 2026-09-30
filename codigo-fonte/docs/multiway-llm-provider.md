# Optional Multiway text provider

`src/multiway-llm-provider.js` exports `runtimeConfig`, `publicState`, `chat`, and a dependency-injected `createProvider` for tests. Existing coach/Ollama configuration is unchanged. No request is made by reading status, and no model is downloaded or selected as a fallback after an error.

## Server configuration

Omitting `THEIBS_MULTIWAY_LLM_PROVIDER` reuses the saved local Ollama choice. Set it to `none` to disable optional interpretation, or `cloudflare` for the explicitly configured remote provider.

Cloudflare requires all of these server environment values:

- `THEIBS_MULTIWAY_LLM_PROVIDER=cloudflare`
- `THEIBS_MULTIWAY_LLM_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast` (default), or `@cf/meta/llama-3.1-8b-instruct`
- `THEIBS_MULTIWAY_LLM_FREE_PLAN_CONFIRMED=true`
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
- Optional `THEIBS_MULTIWAY_LLM_TIMEOUT_MS`, at most 8,000; default 6,000

The Free plan flag records an operator declaration. It does **not** query or verify the account subscription, enforce an account-wide billing cap, or upgrade a plan. Confirm the account's Free plan in the provider dashboard before setting it. Cloudflare documents a daily free allocation, with requests beyond it failing on the Free plan. The adapter never upgrades, purchases credits, configures a paid gateway, or retries using a different provider. [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## Call contract and privacy

`chat(config, messages, {format: objectSchema, owner, remoteTextConsent: true, signal, maxTokens})` returns `{text, inference}`. Remote calls require consent and a server-derived authenticated owner on every invocation. `This device only` is not remote-text consent. Only minimal text belongs in messages; never pass audio, the complete player library, secrets, or hidden cards.

Account and token are read from server environment only. Neither is returned by `runtimeConfig` or `publicState`. Public errors contain neither provider response bodies nor exception causes. Status reports text-only processing and does not claim audio recognition or speech synthesis.

The fixed endpoint is `https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{allowlisted-model}`. Redirects are rejected. Requests set `stream:false` and native `response_format:{type:'json_schema',json_schema:format}`. The provider may return `result.response` as an object or a JSON string; both normalize into one complete JSON object string. Output/schema/domain validation by the assistant remains required: JSON mode can fail and is not a game-rule validator. [REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)

## Bounds and activation

The production singleton allows one in-flight request. Cloudflare limits are six attempts per owner per rolling minute, 40 per owner per rolling 24 hours, and 200 across owners per rolling 24 hours. Started failures, cancellations, and timeouts count. These counters are in process memory, reset on restart, and do not cover other replicas or account usage. They are a local abuse control, **not a durable spend guarantee**. Local Ollama keeps its concurrency guard and is not subject to the remote free-allocation request quotas.

Requests are capped at 16 KB, provider responses at 24 KB, final answers at 6 KB, and output at 192 tokens. Oversized output is rejected whole. Cancellation and timeout discard the response; they do not promise that the provider stopped its internal computation immediately.

Actual model validation and enabling individual uses belong to `multiway-assistant`, keyed by `provider:model`. Passing adapter fixture tests does not establish real-model accuracy, latency, or production availability. Runtime activation is a separate, explicit server configuration step after the real-model gate.
