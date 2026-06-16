import { Text, TextInput, StyleSheet } from 'react-native';

/**
 * Hanken Grotesk has separate files per weight, each registered as its own
 * family. RN doesn't inherit fonts and NativeWind emits `fontWeight` (not
 * `fontFamily`), so we patch Text/TextInput once to map the resolved weight to
 * the matching Hanken family (and clear fontWeight to avoid faux-bolding).
 */
const FAMILY_BY_WEIGHT: Record<string, string> = {
  '100': 'HankenGrotesk_400Regular',
  '200': 'HankenGrotesk_400Regular',
  '300': 'HankenGrotesk_400Regular',
  '400': 'HankenGrotesk_400Regular',
  normal: 'HankenGrotesk_400Regular',
  '500': 'HankenGrotesk_500Medium',
  '600': 'HankenGrotesk_600SemiBold',
  '700': 'HankenGrotesk_700Bold',
  '800': 'HankenGrotesk_700Bold',
  '900': 'HankenGrotesk_700Bold',
  bold: 'HankenGrotesk_700Bold',
};

let patched = false;

export function patchTextFont() {
  if (patched) return;
  patched = true;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const Comp of [Text, TextInput] as any[]) {
    const orig = Comp.render;
    if (!orig) continue;
    Comp.render = function (props: any, ref: any) {
      const flat = (StyleSheet.flatten(props?.style) || {}) as { fontFamily?: string; fontWeight?: string | number };
      const family = flat.fontFamily ?? FAMILY_BY_WEIGHT[String(flat.fontWeight ?? 'normal')] ?? 'HankenGrotesk_400Regular';
      const style = [props?.style, { fontFamily: family, fontWeight: undefined }];
      return orig.call(this, { ...props, style }, ref);
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
