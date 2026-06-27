import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTriggers, createTrigger, deleteTrigger, getDocuments } from '../lib/api.js';
import type { Trigger } from '../types.js';

export default function TriggersSection({ spaceId }: { spaceId: string }) {
  const qc = useQueryClient();
  const { data: triggers = [] } = useQuery<Trigger[]>({ queryKey: ['triggers', spaceId], queryFn: () => getTriggers(spaceId) });
  const { data: playbooks = [] } = useQuery({ queryKey: ['documents', spaceId, 'workflow'], queryFn: () => getDocuments(spaceId, { type: 'workflow' }) });
  const [cron, setCron] = useState('0 8 * * *');
  const [playbookId, setPlaybookId] = useState<string>('');

  const create = useMutation({
    mutationFn: () => createTrigger(spaceId, { kind: 'schedule', schedule_cron: cron, playbook_id: playbookId || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers', spaceId] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTrigger(spaceId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers', spaceId] }),
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
            <div key={t.id} className="flex items-center justify-between rounded-lg border border-border-soft bg-card px-4 py-3">
              <div className="text-sm">
                <span className="font-mono">{t.schedule_cron ?? t.kind}</span>
                <span className="ml-2 text-xs text-faint-fg">{t.enabled ? 'enabled' : 'disabled'}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(t.id)}>Delete</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
