/**
 * Zajednički vizuelni jezik VFM-a: grafitna podloga + lime primarni akcent.
 * Vrijednosti odgovaraju CSS tokenima u apps/web/src/styles/globals.css.
 */
export const colors = {
  primary: '#C6F75A',
  primarySoft: '#2A3A1B',
  primaryFg: '#11170C',
  ink: '#F0F4EF',
  muted: '#A5B1A5',
  border: '#2B382D',
  surface: '#121814',
  surfaceMuted: '#1A221B',
  background: '#0B0F0C',
  danger: '#FB7185',
  dangerSoft: '#35191E',
  warning: '#FBBF24',
  warningSoft: '#332A14',
  success: '#4ADE80',
  successSoft: '#142D1E',
  info: '#60A5FA',
  infoSoft: '#17283B',
  neutral: '#A5B1A5',
  neutralSoft: '#252E27',
  shadow: '#000000',
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
} as const;

export const type = {
  xs: { fontSize: 12, lineHeight: 16 },
  sm: { fontSize: 13, lineHeight: 20 },
  base: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 28 },
  xl: { fontSize: 20, lineHeight: 28 },
  xxl: { fontSize: 24, lineHeight: 32 },
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const controlMinHeight = 48;
export const stickyCtaHeight = 56;
