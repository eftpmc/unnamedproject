import { createCampaign, type DbCampaignTask } from '../db/index.js';

interface CreateCampaignInput {
  project_id: string;
  title: string;
  tasks: Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' }>;
  session_id?: string;
}

export function runCreateCampaign(
  input: CreateCampaignInput,
  userId: string
): string {
  const { campaign, tasks } = createCampaign(
    input.project_id,
    input.session_id ?? null,
    input.title,
    input.tasks
  );
  return JSON.stringify({
    campaign_id: campaign.id,
    project_id: campaign.project_id,
    tasks: tasks.map((t: DbCampaignTask) => ({ id: t.id, title: t.title, agent: t.agent })),
  });
}
