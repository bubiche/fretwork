/**
 * Single source of truth for the editor key map — consumed by the UI legend (`KeyboardHelp`) so
 * it can never drift from what the user actually has. `keyboard.ts` is the imperative handler;
 * keep these labels in step with it when bindings change (they're edited together).
 *
 * `mod` renders as ⌘ on macOS, Ctrl elsewhere.
 */
export type Shortcut = { keys: string; action: string }
export type ShortcutGroup = { title: string; items: Shortcut[] }

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** The modifier symbol for the current platform (⌘ on macOS, Ctrl elsewhere). */
export const MOD = isMac ? '⌘' : 'Ctrl'

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Move around',
    items: [
      { keys: 'Click', action: 'Select a beat; click a note to also pick its string' },
      { keys: '← / →', action: 'Select previous / next beat' },
      { keys: '↑ / ↓', action: 'Select string (up / down)' },
      { keys: 'Enter', action: 'Play from the selected beat' },
    ],
  },
  {
    title: 'Edit notes',
    items: [
      { keys: '0–9', action: 'Set fret (type two digits fast for 10–24)' },
      { keys: 'Alt + ↑ / ↓', action: 'Move the note to the next string (keeps fret)' },
      { keys: 'Delete / Backspace', action: 'Delete the selected note' },
    ],
  },
  {
    title: 'Edit rhythm & beats',
    items: [
      { keys: '−', action: 'Shorten duration (whole → … → 32nd)' },
      { keys: '+ / =', action: 'Lengthen duration' },
      { keys: '.', action: 'Toggle dotted' },
      { keys: 'i', action: 'Insert an empty beat after the selection' },
      { keys: `${MOD} + Delete`, action: 'Delete the selected beat' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: `${MOD} + Z`, action: 'Undo' },
      { keys: `${MOD} + Shift + Z`, action: 'Redo' },
    ],
  },
]
