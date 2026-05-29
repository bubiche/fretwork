import { useState } from 'preact/hooks'
import { SHORTCUT_GROUPS } from '../input/shortcuts'

/**
 * A collapsible legend of every editor keyboard shortcut, rendered from the single `SHORTCUT_GROUPS`
 * source so it stays in step with the actual key map. Lives at the bottom of the Sidebar.
 */
export function KeyboardHelp() {
  const [open, setOpen] = useState(false)

  return (
    <section style={{ marginTop: '1rem' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontSize: '0.85rem',
        }}
        aria-expanded={open}
      >
        <span style={{ color: '#888', fontSize: '0.7rem', width: '0.7rem' }}>{open ? '▾' : '▸'}</span>
        <strong>Keyboard shortcuts</strong>
      </button>

      {open && (
        <div style={{ marginTop: '0.5rem' }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} style={{ marginBottom: '0.6rem' }}>
              <div
                style={{
                  fontSize: '0.65rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: '#999',
                  marginBottom: '0.25rem',
                }}
              >
                {group.title}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {group.items.map((s) => (
                  <li
                    key={s.keys}
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'baseline',
                      padding: '0.15rem 0',
                    }}
                  >
                    <kbd
                      style={{
                        flexShrink: 0,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: '0.7rem',
                        background: '#f3f4f6',
                        border: '1px solid #ddd',
                        borderRadius: 3,
                        padding: '1px 5px',
                        whiteSpace: 'nowrap',
                        color: '#333',
                      }}
                    >
                      {s.keys}
                    </kbd>
                    <span style={{ fontSize: '0.72rem', color: '#555', lineHeight: 1.3 }}>
                      {s.action}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
