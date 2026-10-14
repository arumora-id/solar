import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { AttachmentService } from '../tasks/attachmentService.js';
import type { ArtifactService } from '../tasks/artifactService.js';
import type { AgentTool, ToolOutput } from './types.js';
import { zodTool } from './zodTool.js';

const MAX_INPUT_BYTES = 20 * 1024 * 1024;

export function createImageTools(
  config: AppConfig,
  artifacts: ArtifactService,
  attachments: AttachmentService,
): AgentTool[] {
  return [zodTool({
    name: 'create_or_edit_image',
    displayName: { id: 'Buat atau edit gambar', en: 'Generating or editing image' },
    description: 'SUPERADMIN ONLY. Create a PNG from a detailed prompt; to edit, supply one source_attachment_id from the current task or one accessible source_artifact_id. Returns a new downloadable image artifact.',
    schema: z.object({
      prompt: z.string().trim().min(1).max(12000),
      title: z.string().trim().min(1).max(120),
      source_attachment_id: z.string().min(1).optional(),
      source_artifact_id: z.string().min(1).optional(),
      size: z.enum(['auto', '1024x1024', '1536x1024', '1024x1536', '1536x864', '864x1536']).default('auto').describe('Output size. Select a landscape or portrait size when the user specifies an aspect ratio.'),
    }).refine((v) => !(v.source_attachment_id && v.source_artifact_id), {
      message: 'Use only one source image at a time',
    }),
    async authorize(input, ctx): Promise<ToolOutput | null> {
      if (ctx.requester?.role !== 'superadmin') return { isError: true, content: 'Only Superadmin may generate or edit images.', summary: 'Access denied' };
      if (input.source_attachment_id && !ctx.attachments.some((a) => a.id === input.source_attachment_id)) {
        return { isError: true, content: 'Source attachment is not part of the current task.', summary: 'Access denied' };
      }
      if (input.source_artifact_id && !(await ctx.canReadArtifact(input.source_artifact_id))) {
        return { isError: true, content: 'Source artifact not accessible.', summary: 'Access denied' };
      }
      return null;
    },
    async execute(input, ctx) {
      if (ctx.requester?.role !== 'superadmin') throw new Error('Superadmin only');
      if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY is required for image generation');
      let source: { bytes: Buffer; mime: 'image/png' | 'image/jpeg' | 'image/webp'; name: string } | null = null;
      if (input.source_attachment_id) {
        const a = ctx.attachments.find((x) => x.id === input.source_attachment_id);
        if (!a || a.kind !== 'image') throw new Error('Source must be a PNG, JPG or WEBP image attached to this task');
        source = { bytes: await attachments.readOriginal(a), mime: a.mimeType as 'image/png' | 'image/jpeg' | 'image/webp', name: a.name };
      } else if (input.source_artifact_id) {
        if (!(await ctx.canReadArtifact(input.source_artifact_id))) throw new Error('Source artifact inaccessible');
        const a = await artifacts.get(input.source_artifact_id);
        if (!a || !['image/png', 'image/jpeg', 'image/webp'].includes(a.mimeType)) throw new Error('Source artifact must be a raster image');
        source = { bytes: await artifacts.read(a), mime: a.mimeType as 'image/png' | 'image/jpeg' | 'image/webp', name: a.name };
      }
      if (source && (source.bytes.length === 0 || source.bytes.length > MAX_INPUT_BYTES)) throw new Error('Source image must be between 1 byte and 20 MB');
      const client = new OpenAI({
        apiKey: config.openai.apiKey,
        ...(config.openai.baseUrl ? { baseURL: config.openai.baseUrl } : {}),
        timeout: 120_000,
        maxRetries: 1,
      });
      const output = source
        ? await client.images.edit({
            model: 'gpt-image-2',
            image: await toFile(source.bytes, source.name, { type: source.mime }),
            prompt: input.prompt,
            size: input.size,
            output_format: 'png',
          })
        : await client.images.generate({
            model: 'gpt-image-2',
            prompt: input.prompt,
            size: input.size,
            output_format: 'png',
          });
      if (ctx.signal.aborted) throw new Error('Task cancelled before image was saved');
      const encoded = output.data?.[0]?.b64_json;
      if (!encoded) throw new Error('Image provider returned no image data');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length < 16 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
        throw new Error('Image provider did not return a valid PNG');
      }
      const artifact = await ctx.createArtifact({
        name: source ? 'edited-image.png' : 'generated-image.png',
        title: input.title,
        kind: 'other',
        mimeType: 'image/png',
        bundle: 'images',
        description: source ? 'Edited image, original preserved' : 'Generated image',
        content: bytes,
      });
      return {
        content: JSON.stringify({ artifactId: artifact.id, file: artifact.name, mimeType: artifact.mimeType, size: artifact.size, note: 'Use the created image artifact in the response; never output a fabricated URL.' }),
        summary: (source ? 'Edited' : 'Generated') + ' image: ' + artifact.name,
      };
    },
  })];
}
