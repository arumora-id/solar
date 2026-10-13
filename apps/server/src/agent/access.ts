import { t, taskLang } from '../i18n.js';
import type { TaskRunContext } from '../tasks/taskManager.js';
import type { ToolOutput } from './types.js';

/**
 * Refuses a tool call naming an artifact the task's requester may not read (another user's task). The answer is the
 * same as for an unknown id, so the model - and through it the user - learns nothing about other users' work.
 */
export async function artifactAccess(ids: readonly string[], ctx: TaskRunContext): Promise<ToolOutput | null> {
  for (const id of ids) {
    if (!(await ctx.canReadArtifact(id))) {
      return { isError: true, content: `Artifact ${id} not found`, summary: t(taskLang(ctx), 'tool.notFound') };
    }
  }
  return null;
}
