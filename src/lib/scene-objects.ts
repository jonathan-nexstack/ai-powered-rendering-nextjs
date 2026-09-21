import type { SceneObjectKind } from './types'

export const objectPresets: Record<SceneObjectKind, { label: string; width: number; depth: number; height: number; color: number }> = {
  door: { label: 'Door', width: 0.9, depth: 0.08, height: 2.1, color: 0x8b5e3c },
  window: { label: 'Window', width: 1.5, depth: 0.06, height: 1.2, color: 0x8fd3e8 },
  sofa: { label: 'Sofa', width: 2.2, depth: 0.9, height: 0.85, color: 0xb59b82 },
  bed: { label: 'Bed', width: 1.8, depth: 2.0, height: 0.55, color: 0xd7cec3 },
  table: { label: 'Dining table', width: 1.6, depth: 0.9, height: 0.75, color: 0x8d6b4d },
  cabinet: { label: 'Cabinet', width: 1.8, depth: 0.45, height: 2.2, color: 0xc2aa8f },
}
