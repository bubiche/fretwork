import { moveBeat, moveString } from '../editor/selection'
import { seekToSelection } from '../editor/transport'
import { undo, redo } from '../editor/HistoryRouter'
import { touchSelectedFret } from '../editor/commands'

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

    switch (e.key) {
      case 'ArrowLeft':
        moveBeat(-1)
        e.preventDefault()
        return
      case 'ArrowRight':
        moveBeat(1)
        e.preventDefault()
        return
      case 'ArrowUp':
        moveString(-1)
        e.preventDefault()
        return
      case 'ArrowDown':
        moveString(1)
        e.preventDefault()
        return
      case 'Enter':
        seekToSelection()
        e.preventDefault()
        return
    }

    // Touch hotkey — plain `t` only, so we don't hijack Cmd/Ctrl-T (new tab).
    if (!mod && e.key.toLowerCase() === 't') {
      touchSelectedFret()
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
