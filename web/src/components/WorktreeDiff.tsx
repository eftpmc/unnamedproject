export default function WorktreeDiff({ diff }: { diff: string }) {
  const files = diff.split(/^(?=diff --git )/m).filter(Boolean);
  return (
    <div className="divide-y divide-border-soft">
      {files.map((fileDiff, i) => {
        const header = fileDiff.split('\n')[0] ?? '';
        const filename = header.replace('diff --git a/', '').split(' b/')[0] ?? header;
        const lines = fileDiff.split('\n');
        return (
          <details key={i} open className="group">
            <summary className="flex cursor-pointer items-center gap-2 bg-muted/30 px-4 py-2.5 text-xs font-mono font-medium text-foreground hover:bg-muted/50 list-none">
              <span className="min-w-0 flex-1 truncate">{filename}</span>
            </summary>
            <div className="overflow-x-auto bg-[#0d1117] font-mono text-[12px] leading-relaxed">
              {lines.slice(4).map((line, j) => {
                let cls = 'block px-4 text-muted-foreground/60';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'block px-4 bg-success/10 text-success';
                else if (line.startsWith('-') && !line.startsWith('---')) cls = 'block px-4 bg-destructive/10 text-destructive';
                else if (line.startsWith('@@')) cls = 'block px-4 text-primary/60 bg-primary/5';
                return <span key={j} className={cls}>{line || ' '}</span>;
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
