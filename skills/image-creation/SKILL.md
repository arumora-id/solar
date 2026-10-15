---
name: Image Generation and Editing
description: Create or edit raster images from prompts and source images. Superadmin only.
---

# Image Generation and Editing

This skill is available exclusively to Superadmin users and is disabled by default.
When enabled, call `create_or_edit_image` to generate a PNG or edit an uploaded image or
a generated image artifact. Describe the intended composition, style, aspect ratio,
typography, and all immutable details precisely.

- For editing use `source_attachment_id` from the current request, or
  `source_artifact_id` for a previously generated image you have access to.
- Never claim an image was created until the tool returns an artifact id.
- Preserve the original input: each edit produces a **new** task artifact.
- Be precise about changes and preserve important unchanged objects.
- Set provider model capabilities in Settings → Model AI: `image-generate` and/or `image-edit`.
  A single capability-marked image model may handle both API operations.
- SOLAR automatically calls the appropriate endpoint: `/v1/images/generations` or `/v1/images/edits`.
  The v1.0.5 separate routes remain supported for backward compatibility.
- If the skill is disabled, do not attempt to call image tools.
