import { moveBeat, moveString, extendSelection, clearAnchor } from '../editor/selection'
import { seekToSelection } from '../editor/transport'
import { undo, redo } from '../editor/HistoryRouter'
import {
  changeSelectedFret,
  moveSelectedNote,
  deleteSelectedNote,
  stepSelectedDuration,
  toggleSelectedDot,
  insertBeatAfterSelection,
  deleteSelectedBeat,
  copySelection,
  cutSelection,
  pasteClipboard,
} from '../editor/commands'

export function attachKeyboard(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (isTextInputTarget(e.target)) return

    const mod = e.metaKey || e.ctrlKey

    // Undo / redo. Cmd/Ctrl-Z, Cmd/Ctrl-Shift-Z (note: Shift makes e.key uppercase 'Z' on
    // macOS, so compare case-insensitively), plus Ctrl-Y as a Windows redo alias.
    if (mod && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) redo()
      else undo()
      e.preventDefault()
      return
    }
    if (mod && e.key.toLowerCase() === 'y') {
      redo()
      e.preventDefault()
      return
    }

    // Clipboard. preventDefault is REQUIRED — otherwise the browser's native copy/paste
    // fires on any DOM/canvas selection and races the editor's. ⌘C copy, ⌘X cut, ⌘V paste.
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      if (k === 'c') {
        copySelection()
        e.preventDefault()
        return
      }
      if (k === 'x') {
        cutSelection()
        e.preventDefault()
        return
      }
      if (k === 'v') {
        pasteClipboard()
        e.preventDefault()
        return
      }
    }

    switch (e.key) {
      case 'ArrowLeft':
        // Shift+← extends the range by one beat; plain ← collapses any range and moves the focus.
        if (e.shiftKey) extendSelection(-1)
        else {
          clearAnchor()
          moveBeat(-1)
        }
        e.preventDefault()
        return
      case 'ArrowRight':
        if (e.shiftKey) extendSelection(1)
        else {
          clearAnchor()
          moveBeat(1)
        }
        e.preventDefault()
        return
      case 'ArrowUp':
        // Alt+↑ moves the selected NOTE up a string; plain ↑ moves the selection. Either way it's
        // not a range extension, so drop any active range.
        clearAnchor()
        if (e.altKey) moveSelectedNote(-1)
        else moveString(-1)
        e.preventDefault()
        return
      case 'ArrowDown':
        clearAnchor()
        if (e.altKey) moveSelectedNote(1)
        else moveString(1)
        e.preventDefault()
        return
      case 'Enter':
        seekToSelection()
        e.preventDefault()
        return
      case 'Delete':
      case 'Backspace':
        // Cmd/Ctrl+Del deletes the whole beat; plain Del/Backspace deletes the selected note.
        if (mod) deleteSelectedBeat()
        else deleteSelectedNote()
        e.preventDefault()
        return
    }

    // Duration keys (plain, no modifier). `+` only arrives as e.key==='+' with Shift held, so also
    // accept `=` (same physical key). `-` shortens, `+`/`=` lengthens, `.` toggles the dot.
    if (!mod) {
      if (e.key === '-') {
        stepSelectedDuration(-1)
        e.preventDefault()
        return
      }
      if (e.key === '+' || e.key === '=') {
        stepSelectedDuration(1)
        e.preventDefault()
        return
      }
      if (e.key === '.') {
        toggleSelectedDot()
        e.preventDefault()
        return
      }
      // Insert an empty beat after the selection (no Insert key on a Mac).
      if (e.key.toLowerCase() === 'i') {
        insertBeatAfterSelection()
        e.preventDefault()
        return
      }
    }

    // Fret entry — plain digits 0–9 only (no modifier, so Cmd-1 / Ctrl-2 tab switching is safe).
    // The dispatcher owns the multi-digit amend window (type `1` then `2` → fret 12).
    if (!mod && e.key.length === 1 && e.key >= '0' && e.key <= '9') {
      changeSelectedFret(Number(e.key))
      e.preventDefault()
      return
    }
  }
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}
