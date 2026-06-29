import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getAllTriggers, createGlobalTrigger, deleteGlobalTrigger, getProjectFiles } from '../lib/api.js';
import { timeAgo } from '../lib/utils.js';
import type { Trigger } from '../types.js';

function WebhookUrl({ triggerId }: { triggerId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/webhooks/trigger/${triggerId}`;

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1.5 rounded bg-muted px-2 py-1 font-mono text-[10px] text-faint-fg transition-colors hover:bg-muted/80 hover:text-muted-foreground"
    >
      <span className="max-w-[280px] truncate">{url}</span>
      {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
    </button>
  );
}

function TriggerCard({ t, onDelete }: { t: Trigger; onDelete: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-soft bg-card px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm">{t.schedule_cron ?? t.kind}</span>
          <span className={`text-[11px] ${t.enabled ? 'text-emerald-500' : 'text-faint-fg'}`}>
            {t.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={onDelete}>Delete</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-faint-fg">
        {t.last_run_at && <span>Last run {timeAgo(t.last_run_at)}</span>}
        {t.next_run_at && <span>Next run {timeAgo(t.next_run_at)}</span>}
        <WebhookUrl triggerId={t.id} />
      </div>
    </div>
  );
}

export default function TriggersSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: allTriggers = [] } = useQuery<Trigger[]>({ queryKey: ['triggers'], queryFn: getAllTriggers });
  const triggers = allTriggers.filter(t => t.project_id === projectId);
  const { data: playbooks = [] } = useQuery({ queryKey: ['files', projectId, 'workflow'], queryFn: () => getProjectFiles(projectId, { type: 'workflow' }) });
  const [cron, setCron] = useState('0 8 * * *');
  const [playbookId, setPlaybookId] = useState<string>('');

  const create = useMutation({
    mutationFn: () => createGlobalTrigger({ kind: 'schedule', schedule_cron: cron, playbook_id: playbookId || undefined, project_id: projectId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteGlobalTrigger(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers'] }),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="cron (UTC) e.g. 0 8 * * *" className="w-48" />
        <Select value={playbookId} onValueChange={setPlaybookId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Playbook document" /></SelectTrigger>
          <SelectContent>{playbooks.map(p => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>Add trigger</Button>
      </div>
      {triggers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No triggers. A trigger runs a workflow document on a schedule.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {triggers.map(t => (
            <TriggerCard key={t.id} t={t} onDelete={() => remove.mutate(t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
