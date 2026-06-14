import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, GitBranch } from 'lucide-react';
import { approveExecution, getAllCampaigns, rejectExecution } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { timeAgo } from '../lib/utils.js';
import {
  CenteredEmptyState,
  ContentColumn,
  PageBody,
  PageHeader,
  PageLoading,
  PageSection,
  PageShell,
} from '@/components/ui/app-layout';
import { StatusPill, type PillStatus } from '@/components/ui/status-pill';
import type {
  Campaign,
  WSApprovalRequested,
  WSCampaignUpdated,
  WSExecutionUpdate,
} from '../types.js';

type CampaignRow = Campaign & { project_name: string };

/** Tile shared by every activity row — neutral square holding a glyph. */
function IconTile({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warning' }) {
  return (
    <div
      className={
        'grid size-8 shrink-0 place-items-center rounded-md bg-muted ' +
        (tone === 'warning' ? 'text-warning' : 'text-muted-foreground')
      }
    >
      {children}
    </div>
  );
}

export default function ActivityPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['all-campaigns'],
    queryFn: getAllCampaigns,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const [statusOverrides, setStatusOverrides] = useState<Record<string, Campaign['status']>>({});
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, { action: string }>>(new Map());

  useEffect(() => {
    return subscribe(event => {
      if (event.type === 'campaign_updated') {
        const e = event as unknown as WSCampaignUpdated;
        setStatusOverrides(prev => ({ ...prev, [e.campaignId]: e.status }));
        queryClient.invalidateQueries({ queryKey: ['all-campaigns'] });
      }
      if (event.type === 'approval_requested') {
        const e = event as unknown as WSApprovalRequested;
        setPendingApprovals(prev => new Map(prev).set(e.executionId, { action: e.action }));
      }
      if (event.type === 'execution_update') {
        const e = event as unknown as WSExecutionUpdate;
        if (e.status === 'running' || e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => {
            const n = new Map(prev);
            n.delete(e.executionId);
            return n;
          });
        }
      }
    });
  }, [queryClient]);

  async function resolveApproval(executionId: string, decision: 'approved' | 'rejected') {
    if (decision === 'approved') {
      await approveExecution(executionId);
    } else {
      await rejectExecution(executionId);
    }
    setPendingApprovals(prev => {
      const n = new Map(prev);
      n.delete(executionId);
      return n;
    });
  }

  const campaigns = (data?.campaigns ?? []) as CampaignRow[];
  const approvalList = [...pendingApprovals.entries()];

  // Single "Recent" feed — running first, then most-recent, matching the design.
  const rows = campaigns
    .map(c => ({ ...c, status: statusOverrides[c.id] ?? c.status }))
    .sort((a, b) => {
      const ar = a.status === 'running' ? 0 : 1;
      const br = b.status === 'running' ? 0 : 1;
      if (ar !== br) return ar - br;
      return b.created_at - a.created_at;
    })
    .slice(0, 20);

  const isEmpty = campaigns.length === 0 && approvalList.length === 0;

  return (
    <PageShell>
      <PageHeader title="Activity" description="Live tool runs and approvals across all projects" />

      {isLoading ? (
        <PageLoading rows={4} />
      ) : isEmpty ? (
        <CenteredEmptyState
          title="No activity yet"
          description="Running campaigns, pending approvals, and recent completions will appear here."
        />
      ) : (
        <PageBody>
          <ContentColumn className="space-y-7">
            {/* Needs your attention */}
            {approvalList.length > 0 && (
              <PageSection title="Needs your attention">
                <div className="flex flex-col gap-2.5">
                  {approvalList.map(([execId, { action }]) => (
                    <div
                      key={execId}
                      className="flex items-center gap-3.5 rounded-lg border border-warning/40 bg-warning/[0.07] p-4"
                    >
                      <IconTile tone="warning">
                        <Bell size={16} />
                      </IconTile>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{action}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">Awaiting your approval</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void resolveApproval(execId, 'rejected')}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          Deny
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveApproval(execId, 'approved')}
                          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105"
                        >
                          <Check size={12} strokeWidth={2.5} />
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </PageSection>
            )}

            {/* Recent */}
            {rows.length > 0 && (
              <PageSection title="Recent">
                <div className="flex flex-col gap-2.5">
                  {rows.map(c => (
                    <ActivityRow key={c.id} campaign={c} />
                  ))}
                </div>
              </PageSection>
            )}
          </ContentColumn>
        </PageBody>
      )}
    </PageShell>
  );
}

function ActivityRow({ campaign }: { campaign: CampaignRow }) {
  const status = campaign.status as PillStatus;
  return (
    <Link
      to={`/projects/${campaign.project_id}/campaigns/${campaign.id}`}
      className="flex items-center gap-3.5 rounded-lg border border-border-soft bg-card p-4 transition-colors hover:border-border"
    >
      <IconTile>
        <GitBranch size={16} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{campaign.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{campaign.project_name}</div>
      </div>
      <StatusPill status={status} />
      <span className="shrink-0 text-[11px] text-faint-fg">{timeAgo(campaign.created_at)}</span>
    </Link>
  );
}
