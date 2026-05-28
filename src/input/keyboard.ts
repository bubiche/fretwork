import { moveBeat, moveString } from '../editor/selection'
import { seekToSelection } from '../editor/transport'

export function attachKeyboard(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (isTextInputTarget(e.target)) return
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
