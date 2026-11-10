/** Shape cues for tells (colour-blind safe, GDD section 4) and door icons. */
import type { StrikeKind } from '../data/enemies';
import type { NodeType } from '../core/tower';

export const TELL_SHAPE: Record<StrikeKind, string> = {
  // Quick: single line
  quick: '<rect x="47" y="30" width="6" height="40" rx="2"/>',
  // Heavy: circle
  heavy: '<circle cx="50" cy="50" r="13" fill="none" stroke-width="6"/>',
  // Unblockable: diamond
  unblockable: '<path d="M50 32 L66 50 L50 68 L34 50 Z"/>',
  // Projectile: dash
  projectile: '<rect x="30" y="46" width="40" height="8" rx="4"/>',
};

export const TELL_NAME: Record<StrikeKind, string> = {
  quick: 'Quick',
  heavy: 'Heavy',
  unblockable: 'Unblockable',
  projectile: 'Projectile',
};

export const TELL_COLOR_CSS: Record<StrikeKind, string> = {
  quick: 'var(--quick)',
  heavy: 'var(--heavy)',
  unblockable: 'var(--unblockable)',
  projectile: 'var(--projectile)',
};

export const TELL_COUNTER: Record<StrikeKind, string> = {
  quick: 'Parry by swiping toward it, dodge away, or block.',
  heavy: 'Dodge it. A parry only staggers briefly; a block costs 60% Guard.',
  unblockable: 'Dodge only, away from the strike.',
  projectile: 'Any swipe parries it back at the shooter.',
};

const g = (body: string) => `<g fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">${body}</g>`;

export const DOOR_ICON: Record<NodeType, { color: string; svg: string }> = {
  duel: { color: '#cfe7ff', svg: g('<path d="M22 78 L70 30 M70 30 L74 22 L66 26 M30 60 L40 70"/><path d="M78 78 L30 30 M30 30 L26 22 L34 26 M70 60 L60 70"/>') },
  elite: { color: '#ffa020', svg: g('<path d="M30 30 L50 18 L70 30 L66 66 L50 80 L34 66 Z"/><path d="M42 44 L50 56 L58 44"/>') },
  vault: { color: '#ffc548', svg: g('<rect x="20" y="40" width="60" height="36" rx="3"/><path d="M20 52 H80 M20 40 C20 22 80 22 80 40"/><rect x="45" y="48" width="10" height="12"/>') },
  shrine: { color: '#7fe08a', svg: g('<path d="M50 16 C62 32 66 42 50 58 C34 42 38 32 50 16 Z"/><path d="M30 84 H70 M36 84 V66 H64 V84"/>') },
  merchant: { color: '#ffc548', svg: g('<circle cx="40" cy="58" r="14"/><circle cx="62" cy="44" r="14"/><path d="M40 52 V64 M62 38 V50"/>') },
  secret: { color: '#b57cff', svg: g('<path d="M28 84 V40 C28 22 72 22 72 40 V84 Z"/><circle cx="50" cy="52" r="4"/><path d="M50 56 V66"/>') },
  warden: { color: '#ff2a2a', svg: g('<path d="M30 40 C30 24 70 24 70 40 V62 L50 78 L30 62 Z"/><path d="M30 34 L16 16 M70 34 L84 16 M40 48 H60"/>') },
};
