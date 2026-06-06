import type { AlphaTabApi } from '@coderline/alphatab'
import { store } from './store'
import {
  resolveSoundFontBytes,
  saveSoundFontPref,
  SOUND_FONTS,
  type SoundFontId,
} from '../alphatab/soundfonts'

/** What the synth currently has loaded, so re-syncs (e.g. every midiLoaded) are no-ops. */
let applied: { api: AlphaTabApi; id: SoundFontId } | null = null
/** Monotonic token: a newer sync supersedes any older one still awaiting its fetch. */
let generation = 0

export function setSoundFont(id: SoundFontId): void {
  store.setState({ soundFont: id })
  saveSoundFontPref(id)
  void syncSoundFont()
}

/**
 * Make the synth match `store.soundFont`. Safe to call any time: it no-ops while alphaTab has no
 * player yet (the player is only created once the first score loads — `api.loadSoundFont` before
 * that is a silent `false`), so ScoreView re-invokes it on every `midiLoaded`.
 */
export async function syncSoundFont(): Promise<void> {
  const { api, soundFont } = store.getState()
  if (!api?.player) return
  if (applied && applied.api === api && applied.id === soundFont) return
  const gen = ++generation
  let fonts: Uint8Array[]
  try {
    fonts = await resolveSoundFontBytes(soundFont)
  } catch {
    if (gen === generation) {
      const label = SOUND_FONTS.find((f) => f.id === soundFont)?.label ?? soundFont
      store.setState({ warning: `Couldn't download the ${label} soundfont. Playback may be silent.` })
    }
    return
  }
  // A newer sync started, or the api/choice changed while we were fetching — let that one win.
  if (gen !== generation) return
  const now = store.getState()
  if (now.api !== api || now.soundFont !== soundFont) return
  let ok = true
  fonts.forEach((bytes, i) => {
    // First font replaces everything loaded; the rest layer on top (last import wins).
    ok = api.loadSoundFont(bytes, i > 0) && ok
  })
  applied = ok ? { api, id: soundFont } : null
}
