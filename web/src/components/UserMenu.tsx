import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, LogOut, Moon, Plus, QrCode, Sun } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { getMe } from '../lib/api.js';
import { clearToken, getToken } from '../lib/auth.js';
import { useTheme } from '../lib/useTheme.js';
import { useAccent } from '../lib/useAccent.js';
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../lib/accent.js';
import { useLanguage, useTimezone, LANGUAGES, TIMEZONES } from '../lib/useLocale.js';
import { cn } from '../lib/utils.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function UserMenu() {
  const navigate = useNavigate();
  const [qrOpen, setQrOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage } = useLanguage();
  const { timezone, setTimezone } = useTimezone();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: Infinity });

  const { accent, setAccent } = useAccent();
  const initial = me?.email?.[0]?.toUpperCase() ?? 'U';
  const label = me?.email?.split('@')[0] ?? '…';
  const isDark = theme === 'unnamed-dark';
  const isCustomAccent = !ACCENT_PRESETS.some(p => p.h === accent.h && p.c === accent.c);
  const currentLanguage = LANGUAGES.find(l => l.value === language)?.label ?? language;
  const currentTimezone = TIMEZONES.find(tz => tz.value === timezone)?.label ?? timezone;
  const qrValue = JSON.stringify({
    url: window.location.origin.replace(/:\d+$/, ':3000'),
    token: getToken() ?? '',
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Account menu"
            className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-auto sm:w-auto sm:gap-2 sm:px-2 sm:py-1.5"
          >
            <div className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-tint text-[11px] font-semibold text-on-accent-soft">
              {initial}
            </div>
            <span className="hidden max-w-28 truncate text-[13px] font-medium text-foreground sm:inline">
              {label}
            </span>
            <ChevronDown size={13} className="hidden shrink-0 text-faint-fg sm:block" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="end" className="w-56">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {isDark
                ? <Moon size={14} className="text-faint-fg" />
                : <Sun size={14} className="text-faint-fg" />}
              <span>Appearance</span>
              <span className="ml-auto max-w-20 truncate text-xs text-muted-foreground">
                {isDark ? 'Dark' : 'Light'}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-56">
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={value => {
                  if (value !== theme) toggleTheme();
                }}
              >
                <DropdownMenuRadioItem value="unnamed-light">
                  <Sun size={14} className="mr-1.5 text-faint-fg" />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unnamed-dark">
                  <Moon size={14} className="mr-1.5 text-faint-fg" />
                  Dark
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5">
                <div className="mb-2 text-[11px] font-medium text-muted-foreground">Accent</div>
                <div className="flex flex-wrap gap-1.5">
                  {ACCENT_PRESETS.map(preset => {
                    const active = !isCustomAccent && accent.h === preset.h && accent.c === preset.c;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        title={preset.name}
                        onClick={() => setAccent({ h: preset.h, c: preset.c })}
                        className={cn(
                          'size-6 shrink-0 rounded-full ring-offset-1 ring-offset-popover transition-all',
                          active ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-border',
                        )}
                        style={{ backgroundColor: `oklch(0.6 ${preset.c} ${preset.h})` }}
                      >
                        {active && <Check size={10} className="mx-auto text-white drop-shadow" strokeWidth={3} />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    title="Custom hue"
                    onClick={() => { if (!isCustomAccent) setAccent({ h: accent.h, c: DEFAULT_ACCENT.c }); }}
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                      isCustomAccent ? 'border-foreground' : 'border-dashed border-border hover:border-muted-foreground',
                    )}
                    style={isCustomAccent ? { backgroundColor: `oklch(0.6 ${accent.c} ${accent.h})` } : undefined}
                  >
                    {!isCustomAccent && <Plus size={10} className="text-muted-foreground" />}
                  </button>
                </div>
                {isCustomAccent && (
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={accent.h}
                    onChange={e => setAccent({ h: Number(e.target.value), c: accent.c })}
                    className="mt-2 w-full"
                  />
                )}
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span>Language</span>
              <span className="ml-auto max-w-20 truncate text-xs text-muted-foreground">
                {currentLanguage}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuRadioGroup value={language} onValueChange={setLanguage}>
                {LANGUAGES.map(l => (
                  <DropdownMenuRadioItem key={l.value} value={l.value}>
                    {l.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span>Timezone</span>
              <span className="ml-auto max-w-20 truncate text-xs text-muted-foreground">
                {currentTimezone}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuRadioGroup value={timezone} onValueChange={setTimezone}>
                {TIMEZONES.map(tz => (
                  <DropdownMenuRadioItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => setQrOpen(true)}
            className="text-muted-foreground"
          >
            <QrCode size={14} className="mr-2" />
            Connect mobile
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => { clearToken(); navigate('/login', { replace: true }); }}
            className="text-muted-foreground"
          >
            <LogOut size={14} className="mr-2" />
            Sign out
          </DropdownMenuItem>

        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect mobile</DialogTitle>
            <DialogDescription>Scan this from the Unnamed mobile app.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border-soft bg-white p-6">
            <QRCodeSVG value={qrValue} size={200} />
            <p className="text-center text-xs text-muted-foreground">
              Open the mobile app and tap "Scan QR code".
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
