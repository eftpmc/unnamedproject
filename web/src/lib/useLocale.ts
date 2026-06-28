import { useState } from 'react';

const LS_LANGUAGE = 'app:language';
const LS_TIMEZONE = 'app:timezone';

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
] as const;

export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'America/Sao_Paulo', label: 'Brasília (BRT)' },
  { value: 'America/Toronto', label: 'Toronto (ET)' },
  { value: 'America/Vancouver', label: 'Vancouver (PT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET)' },
  { value: 'Europe/Stockholm', label: 'Stockholm (CET)' },
  { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
  { value: 'Africa/Cairo', label: 'Cairo (EET)' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg (SAST)' },
  { value: 'Asia/Dubai', label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'India (IST)' },
  { value: 'Asia/Bangkok', label: 'Bangkok (ICT)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Asia/Shanghai', label: 'China (CST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Seoul', label: 'Seoul (KST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (AEST)' },
  { value: 'Pacific/Auckland', label: 'Auckland (NZST)' },
  { value: 'UTC', label: 'UTC' },
] as const;

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function useLanguage() {
  const [language, setLanguageState] = useState(() => localStorage.getItem(LS_LANGUAGE) ?? 'en');
  const setLanguage = (lang: string) => {
    setLanguageState(lang);
    localStorage.setItem(LS_LANGUAGE, lang);
  };
  return { language, setLanguage };
}

export function useTimezone() {
  const fallback = detectedTimezone();
  const [timezone, setTimezoneState] = useState(() => localStorage.getItem(LS_TIMEZONE) ?? fallback);
  const setTimezone = (tz: string) => {
    setTimezoneState(tz);
    localStorage.setItem(LS_TIMEZONE, tz);
  };
  return { timezone, setTimezone };
}
