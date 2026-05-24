import { AlphaTabApi, type json } from '@coderline/alphatab'

const base = import.meta.env.BASE_URL

export function createAlphaTab(container: HTMLElement, scrollElement: HTMLElement): AlphaTabApi {
  return new AlphaTabApi(container, {
    core: {
      fontDirectory: `${base}font/`,
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableUserInteraction: true,
      soundFont: `${base}soundfont/sonivox.sf3`,
      scrollElement,
    },
  } as json.SettingsJson)
}
