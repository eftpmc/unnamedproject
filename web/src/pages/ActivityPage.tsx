import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, CheckCircle2, Circle, AlertCircle, LoaderCircle } from 'lucide-react';
import { getAllCampaigns, getChats } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { timeAgo, cn } from '../lib/utils.js';
import { Badge } from '@/components/ui/badge';
import { CenteredEmptyState, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import type { Campaign, Session, WSCampaignUpdated, WSApprovalRequested, WSExecutionUpdate } from '../types.js';

type CampaignRow = Campaign & { project_name: string };

const STATUS_DOT: Record<Campaign['status'], string> = {
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
  error: 'bg-destructive',
  cancelled: 'bg-muted-foreground/30',
};

const STATUS_BADGE: Record<Campaign['status'], string> = {
  running: 'bg-blue-500/10 text-blue-700 border-blue-200/70 dark:text-blue-300 dark:border-blue-900',
  done: 'bg-green-500/10 text-green-700 border-green-200/70 dark:text-green-300 dark:border-green-900',
  error: 'bg-destructive/10 text-destructive border-destructive/20',
  cancelled: 'bg-muted text-muted-foreground border-transparent',
};

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

  // Pending approvals: executionId → { chatId?, action }
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
              <Section
                icon={<Bell size={13} className="text-amber-500" />}
                title="Awaiting approval"
                count={approvalList.length}
              >
                <div className="divide-y divide-border/40 rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                  {approvalList.map(([execId, { action }]) => {
                    const chat = chats.find(c =>
                      activeChats.some(ac => ac.id === c.id)
                    );
                    return (
                      <div key={execId} className="flex items-center justify-between px-4 py-3 gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Bell size={13} className="shrink-0 text-amber-500" />
                          <span className="text-sm truncate">{action}</span>
                        </div>
                        {chat && (
                          <button
                            onClick={() => navigate(`/c/${chat.id}`)}
                            className="shrink-0 text-xs font-medium text-amber-600 hover:text-amber-500 transition-colors"
                          >
                            Review →
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Running campaigns */}
            {running.length > 0 && (
              <Section
                icon={<LoaderCircle size={13} className="text-blue-500 animate-spin" />}
                title="Running"
                count={running.length}
              >
                <div className="flex flex-col gap-2">
                  {running.map(c => (
                    <CampaignRow key={c.id} campaign={c} status={statusOverrides[c.id] ?? c.status} />
                  ))}
                </div>
              </Section>
            )}

            {/* Recent campaigns */}
            {recent.length > 0 && (
              <Section
                icon={<Activity size={13} className="text-muted-foreground/60" />}
                title="Recent"
              >
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/40">
                  {recent.map(c => (
                    <CampaignRow key={c.id} campaign={c} status={statusOverrides[c.id] ?? c.status} compact />
                  ))}
                </div>
              </Section>
            )}

            {/* Recent chats */}
            {activeChats.length > 0 && (
              <Section
                icon={<Circle size={13} className="text-muted-foreground/40" />}
                title="Recent chats"
              >
                <div className="overflow-hidden rounded-xl border border-border/50 bg-background/60 divide-y divide-border/40">
                  {activeChats.map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => navigate(`/c/${chat.id}`)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-sm font-medium truncate">{chat.title ?? 'Untitled chat'}</span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-3">{timeAgo(chat.updated_at)}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}

          </div>
        </div>
      )}
    </PageShell>
  );
}

function Section({ icon, title, count, children }: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {count != null && (
          <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function CampaignRow({ campaign, status, compact = false }: {
  campaign: CampaignRow;
  status: Campaign['status'];
  compact?: boolean;
}) {
  const Icon = STATUS_ICON[status];
  const content = (
    <>
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon size={13} className={cn('shrink-0', STATUS_ICON_CLASS[status])} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{campaign.title}</div>
          {!compact && (
            <div className="text-xs text-muted-foreground mt-0.5">{campaign.project_name}</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2.5 shrink-0 ml-3">
        {compact && (
          <span className="text-xs text-muted-foreground">{campaign.project_name}</span>
        )}
        <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[status])}>
          {status}
        </Badge>
        <span className="text-xs text-muted-foreground">{timeAgo(campaign.created_at)}</span>
      </div>
    </>
  );

  const cls = cn(
    'flex items-center justify-between transition-colors hover:bg-muted/30',
    compact ? 'px-4 py-3' : 'rounded-xl border border-border/50 bg-background/60 px-4 py-3.5',
  );

  return (
    <Link
      to={`/projects/${campaign.project_id}/campaigns/${campaign.id}`}
      className={cls}
    >
      {content}
    </Link>
  );
}
