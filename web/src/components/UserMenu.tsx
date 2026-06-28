import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LogOut, Moon, QrCode, Sun } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { getMe } from '../lib/api.js';
import { clearToken, getToken } from '../lib/auth.js';
import { useTheme } from '../lib/useTheme.js';
import { useLanguage, useTimezone, LANGUAGES, TIMEZONES } from '../lib/useLocale.js';
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

  const initial = me?.email?.[0]?.toUpperCase() ?? 'U';
  const label = me?.email?.split('@')[0] ?? '…';
  const isDark = theme === 'unnamed-dark';
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
            className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-tint text-[11px] font-semibold text-on-accent-soft">
              {initial}
            </div>
            <span className="max-w-28 truncate text-[13px] font-medium text-foreground">{label}</span>
            <ChevronDown size={13} className="shrink-0 text-faint-fg" />
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
            <DropdownMenuSubContent className="w-40">
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
