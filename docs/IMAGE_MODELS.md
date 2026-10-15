# SOLAR image generation/edit provider routing (v1.0.5)

The built-in Image Creation skill is **disabled by default** and available only to **Superadmin**.
It never grants image tool access to Solar Staff or Head of IT Solar.

## Configure OmniRoute (Superadmin)

1. Open **Settings → Model AI → Providers**; add or edit an enabled OmniRoute provider.
2. Set **Base URL** to `https://router.mesthi.com/v1`, **not** the full `/images/generations` or `/images/edits` endpoint.
3. Set its API key, ideally using a secure reference such as `${OMNIROUTE_API_KEY}` in the VPS production `.env`.
4. Add image model IDs supported by *your* router to the provider model list. IDs are determined by your gateway, not SOLAR.
5. In **Model AI → Image models**, set **Generate Image** to `omniroute/<generation-model>` and **Edit Image** to `omniroute/<edit-model>`. Either route may use the same model.
6. Enable **Image Generation and Editing** in **Settings → Skills & Knowledge** as Superadmin.
7. Create a new task requesting an image; for edits, upload a PNG/JPG/WEBP or reference an accessible previous image artifact.

SOLAR calls OpenAI-compatible `POST /v1/images/generations` for generation and `POST /v1/images/edits` for editing. It sends the selected model ID and expects a **base64 PNG** in `data[0].b64_json`. Gateway implementations returning only a remote URL are not supported, to avoid unsafe server-side URL fetching. Source images are not overwritten.

The named image routes are separate from `default` (the chat/agent LLM route). Routes can be configured individually without restarting the server. Providers can contain up to ten fallback entries per route (the UI edits the primary image model; the API supports full lists). If no image route is configured, SOLAR uses `openai/gpt-image-2` for that operation.

## Tests and access

The image tool verifies the requester's role and image ownership before executing, and checks image bytes before creating a task artifact. Each image request is counted as a provider request; model/provider-specific pricing is controlled by the gateway.

Live service/gateway connectivity must be tested from the VPS environment after deployment. CI tests use mocked providers and **never call the router or spend API credits**.

## Deploy / rollback

Build the production container from `~/ai-project/solar-source` with the existing two Compose files in `~/ai-project/solar`. The runtime mounts `~/ai-project/solar/.env` and `~/ai-project/solar/data` must not be overwritten. Use the packaged Docker deployment scripts rather than systemd scripts.
