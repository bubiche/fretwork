import { exposePresetAtPrograms } from './sf2'

/**
 * The available playback soundfonts. "sonivox" is the GM bank alphaTab recommends; the classical
 * guitar font (FreePats, CC0) only contains one instrument, so it is layered ON TOP of sonivox:
 * the synth resolves presets last-import-wins (`_getPresetIndex` searches in reverse), so the
 * classical font must be loaded AFTER sonivox — guitar programs then hit the classical font while
 * everything else (bass, drums, metronome) falls back to sonivox.
 */
export type SoundFontId = 'sonivox' | 'classical-guitar'

export const SOUND_FONTS: ReadonlyArray<{ id: SoundFontId; label: string }> = [
  { id: 'sonivox', label: 'Sonivox GM' },
  { id: 'classical-guitar', label: 'Classical Guitar' },
]

export const DEFAULT_SOUND_FONT: SoundFontId = 'sonivox'

const STORAGE_KEY = 'fretwork:soundFont'

export function loadSoundFontPref(): SoundFontId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (SOUND_FONTS.some((f) => f.id === v)) return v as SoundFontId
  } catch {
    // no localStorage (tests) or access denied — fall through to default
  }
  return DEFAULT_SOUND_FONT
}

export function saveSoundFontPref(id: SoundFontId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // best-effort; the in-memory choice still applies for this session
  }
}

/** GM programs 24–31: nylon, steel, jazz, clean, muted, overdrive, distortion, harmonics. */
const GUITAR_PROGRAMS = [24, 25, 26, 27, 28, 29, 30, 31]

const base = import.meta.env.BASE_URL
const SONIVOX_URL = `${base}soundfont/sonivox.sf3`
const CLASSICAL_URL = `${base}soundfont/classical_guitar.sf2`

const byteCache = new Map<string, Promise<Uint8Array>>()

function fetchBytes(url: string): Promise<Uint8Array> {
  let cached = byteCache.get(url)
  if (!cached) {
    cached = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    })
    // Don't cache failures, or one offline moment bricks the toggle for the session.
    cached.catch(() => byteCache.delete(url))
    byteCache.set(url, cached)
  }
  return cached
}

let classicalPatched: Promise<Uint8Array> | null = null

function classicalGuitarBytes(): Promise<Uint8Array> {
  if (!classicalPatched) {
    // The shipped file has its one preset at program 0 (untouched, as distributed by FreePats);
    // clone it onto the GM guitar programs in memory so guitar tracks actually hit it.
    classicalPatched = fetchBytes(CLASSICAL_URL).then((raw) => exposePresetAtPrograms(raw, GUITAR_PROGRAMS))
    classicalPatched.catch(() => {
      classicalPatched = null
    })
  }
  return classicalPatched
}

/**
 * The soundfont byte sets to load for `id`, in order: the first replaces all loaded fonts
 * (`loadSoundFont(..., false)`), the rest append. Results are cached; the first call per font
 * pays the network fetch (the classical font is ~19 MB, fetched lazily only when selected).
 */
export async function resolveSoundFontBytes(id: SoundFontId): Promise<Uint8Array[]> {
  if (id === 'classical-guitar') {
    // Order matters: the synth resolves presets last-import-wins, so the classical font goes last.
    return Promise.all([fetchBytes(SONIVOX_URL), classicalGuitarBytes()])
  }
  return Promise.all([fetchBytes(SONIVOX_URL)])
}
