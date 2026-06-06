import { AlphaTabApi, type json } from '@coderline/alphatab'

const base = import.meta.env.BASE_URL

export function createAlphaTab(container: HTMLElement, scrollElement: HTMLElement): AlphaTabApi {
  return new AlphaTabApi(container, {
    core: {
      fontDirectory: `${base}font/`,
      // Populate BeatBounds.notes so the selection overlay can anchor to the exact note head
      // (a beat's visualBounds spans both notation + tab staves, so deriving string rows from
      // its height misplaces the highlight).
      includeNoteBounds: true,
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableUserInteraction: false,
      // No `soundFont` here on purpose: the user-selectable soundfont (possibly two layered
      // files) is loaded via syncSoundFont() once the player exists — see editor/soundfont.ts.
      scrollElement,
    },
  } as json.SettingsJson)
}
