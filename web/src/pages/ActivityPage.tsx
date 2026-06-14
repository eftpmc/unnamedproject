import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, Check, CheckCircle2, Circle, AlertCircle, LoaderCircle } from 'lucide-react';
import { getAllCampaigns, getChats } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { timeAgo, cn } from '../lib/utils.js';
import { CenteredEmptyState, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Campaign, Session, WSCampaignUpdated, WSApprovalRequested, WSExecutionUpdate } from '../types.js';

type CampaignRow = Campaign & { project_name: string };

const STATUS_ICON: Record<Campaign['status'], typeof Circle> = {
  running: LoaderCircle,
  done: CheckCircle2,
  error: AlertCircle,
  cancelled: Circle,
};

const STATUS_ICON_CLASS: Record<Campaign['status'], string> = {
  running: 'text-blue-500 animate-spin',
  done: 'text-green-500',
  error: 'text-destructive',
  cancelled: 'text-muted-foreground/30',
};

const STATUS_BADGE: Record<Campaign['status'], string> = {
  running: 'bg-blue-500/10 text-blue-600 border-blue-200/70 dark:text-blue-300 dark:border-blue-900',
  done: 'bg-green-500/10 text-green-700 border-green-200/70 dark:text-green-300 dark:border-green-900',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelled: 'bg-muted text-muted-foreground border-transparent',
};

export default function ActivityPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['all-campaigns'],
    queryFn: getAllCampaigns,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  // Live campaign status overrides
  const [statusOverrides, setStatusOverrides] = useState<Record<string, Campaign['status']>>({});

  // Pending approvals: executionId → { action }
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
        if (e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => { const n = new Map(prev); n.delete(e.executionId); return n; });
        }
      }
    });
  }, [queryClient]);

  function handleApprove(executionId: string) {
    setPendingApprovals(prev => { const n = new Map(prev); n.delete(executionId); return n; });
  }

  function handleReject(executionId: string) {
    setPendingApprovals(prev => { const n = new Map(prev); n.delete(executionId); return n; });
  }

  const campaigns = data?.campaigns ?? [];
  const running = campaigns.filter(c => (statusOverrides[c.id] ?? c.status) === 'running');
  const recent = campaigns.filter(c => (statusOverrides[c.id] ?? c.status) !== 'running').slice(0, 15);

  const approvalList = [...pendingApprovals.entries()];

  // Find chats that have activity (updated recently)
  const activeChats = [...chats]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 5);

  const isEmpty = campaigns.length === 0 && approvalList.length === 0;

  return (
    <PageShell>
      <PageHeader title="Activity" />

      {isLoading ? (
        <PageLoading rows={4} />
      ) : isEmpty ? (
        <CenteredEmptyState
          title="No activity yet"
          description="Running campaigns, pending approvals, and recent completions will appear here."
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 flex flex-col gap-6">

            {/* Pending approvals */}
            {approvalList.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Needs your attention
                </h2>
                <div className="flex flex-col gap-2">
                  {approvalList.map(([execId, { action }]) => (
                    <div key={execId} className="flex items-center gap-3 rounded-xl border border-warning/35 bg-warning/5 p-4">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning">
                        <Bell size={16} />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">{action}</span>
                        <span className="text-xs text-muted-foreground">Awaiting your approval</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReject(execId)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          Deny
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(execId)}
                          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-[filter] hover:brightness-105"
                        >
                          <Check size={12} strokeWidth={2.5} />
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Running campaigns */}
            {running.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Running
                </h2>
                <div className="flex flex-col gap-2">
                  {running.map(c => (
                    <CampaignRow key={c.id} campaign={c} status={statusOverrides[c.id] ?? c.status} />
                  ))}
                </div>
              </section>
            )}

            {/* Recent campaigns */}
            {recent.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent
                </h2>
                <div className="flex flex-col gap-2">
                  {recent.map(c => (
                    <CampaignRow key={c.id} campaign={c} status={statusOverrides[c.id] ?? c.status} />
                  ))}
                </div>
              </section>
            )}

            {/* Recent chats */}
            {activeChats.length > 0 && (
              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent chats
                </h2>
                <div className="flex flex-col gap-2">
                  {activeChats.map(chat => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => navigate(`/c/${chat.id}`)}
                      className="flex w-full items-center justify-between rounded-xl border border-border-soft bg-card p-4 text-left transition-colors hover:bg-muted/30"
                    >
                      <span className="text-sm font-medium truncate">{chat.title ?? 'Untitled chat'}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">{timeAgo(chat.updated_at)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

          </div>
        </div>
      )}
    </PageShell>
  );
}

function CampaignRow({ campaign, status }: {
  campaign: CampaignRow;
  status: Campaign['status'];
}) {
  const StatusIcon = STATUS_ICON[status];
  return (
    <Link
      to={`/projects/${campaign.project_id}/campaigns/${campaign.id}`}
      className="flex items-center gap-3 rounded-xl border border-border-soft bg-card p-4 transition-colors hover:bg-muted/30"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <StatusIcon size={16} className={STATUS_ICON_CLASS[status]} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{campaign.project_name} · {campaign.title}</span>
        <span className={cn('inline-flex w-fit rounded-full px-1.5 py-0.5 text-[11px] font-medium capitalize border', STATUS_BADGE[status])}>
          {status}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{timeAgo(campaign.created_at)}</span>
      </div>
    </Link>
  );
}
