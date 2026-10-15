# SOLAR image generation/edit model capabilities (v1.0.6)

The Image Creation skill is **disabled by default** and restricted to **Superadmin**, regardless of provider.

## Configure one image model, two API operations

1. In **Settings → Model AI**, create/edit your existing OmniRoute provider.
   - Base URL: `https://router.mesthi.com/v1` (omit the endpoint suffix).
   - API key: provider credential, preferably `${OMNIROUTE_API_KEY}` in production `.env`.
   - Model ID: use the exact ID supported by your router.
2. Under **Supported API operations per model**, mark **Generate Image**, **Edit Image**, or both.
3. If that is the **only marked model for each operation**, the image skill selects it automatically.
   Otherwise use the optional **Preferred image model** selector (one model for both operations).
4. Enable the Image Creation skill from **Skills & Knowledge** as Superadmin.

A model selected as the preferred image model must declare at least one image capability; operations not declared on the selected model are rejected before calling the API. For multiple different models, keep the older `image-generation` / `image-edit` routes through the API if needed. Existing v1.0.5 routes are preserved on upgrade; selecting a single preferred model in the new UI explicitly replaces them. Reset removes those overrides and returns to capability-based automatic selection.

For image generation, SOLAR invokes the OpenAI-compatible `POST /v1/images/generations` endpoint. For editing, it invokes `POST /v1/images/edits` using a task attachment or accessible image artifact, preserving the original. You do not enter endpoint paths in the UI.

Image responses must contain base64 PNG in `data[0].b64_json`. Image URLs alone are not currently supported. The API router must implement both operations for a model marked with both capabilities; SOLAR does not establish this automatically.

The chat LLM route is never used as an image fallback. API credentials are masked in settings and no image endpoint is exercised in mocked CI tests. Live verification requires a Superadmin task with router credentials.

## Backwards compatibility

- v1.0.5 explicit `image-generation` and `image-edit` model routes remain active until changed in the UI; no data migration is required.
- An existing image model without capability flags can still run through the old routes for compatibility.
- If no image routes are configured and there is exactly one capability-marked model for an operation, that model is selected.
- If multiple different models are marked for an operation and no route is configured, the historic `openai/gpt-image-2` fallback remains. Configure the Preferred image model explicitly to avoid ambiguity.
- Existing provider/model config is retained in the `data/llm.json` bind mount.
