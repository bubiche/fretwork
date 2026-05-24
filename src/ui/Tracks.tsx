import { useStore } from './hooks/useStore'
import { setTrackRendered, setTrackMuted, setTrackSoloed } from '../editor/tracks'
import type { TrackUiState } from '../editor/store'

export function Tracks() {
  const tracks = useStore((s) => s.tracks)
  const currentFileId = useStore((s) => s.currentFileId)

  if (!currentFileId || tracks.length === 0) return null

  const renderedCount = tracks.filter((t) => t.rendered).length

  return (
    <section style={{ marginTop: '1rem' }}>
      <div style={{ fontSize: '0.85rem', marginBottom: '0.4rem' }}>
        <strong>Tracks</strong>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '0.4rem',
          fontSize: '0.65rem',
          color: '#888',
          padding: '0 0 0.25rem 0',
          borderBottom: '1px solid #eee',
        }}
      >
        <abbr style={headerAbbrStyle} title="Render — show this track in the score">R</abbr>
        <abbr style={headerAbbrStyle} title="Mute — silence this track during playback">M</abbr>
        <abbr
          style={headerAbbrStyle}
          title="Solo — silence every track except the ones soloed"
        >
          S
        </abbr>
        <span style={{ flex: 1 }}>Track</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {tracks.map((t) => (
          <TrackRow key={t.index} t={t} canUnrender={renderedCount > 1} />
        ))}
      </ul>
    </section>
  )
}

function TrackRow({ t, canUnrender }: { t: TrackUiState; canUnrender: boolean }) {
  return (
    <li
      style={{
        display: 'flex',
        gap: '0.4rem',
        alignItems: 'center',
        padding: '0.25rem 0',
        fontSize: '0.8rem',
      }}
    >
      <input
        type="checkbox"
        checked={t.rendered}
        disabled={t.rendered && !canUnrender}
        onChange={(e) =>
          setTrackRendered(t.index, (e.currentTarget as HTMLInputElement).checked)
        }
        style={{ width: 18, height: 18, margin: 0 }}
        title="Render this track in the score"
      />
      <input
        type="checkbox"
        checked={t.muted}
        onChange={(e) => setTrackMuted(t.index, (e.currentTarget as HTMLInputElement).checked)}
        style={{ width: 18, height: 18, margin: 0 }}
        title="Mute this track"
      />
      <input
        type="checkbox"
        checked={t.soloed}
        onChange={(e) => setTrackSoloed(t.index, (e.currentTarget as HTMLInputElement).checked)}
        style={{ width: 18, height: 18, margin: 0 }}
        title="Solo this track"
      />
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={t.name}
      >
        {t.name}
      </span>
    </li>
  )
}

const headerAbbrStyle = {
  width: 18,
  display: 'inline-block',
  textAlign: 'center' as const,
  cursor: 'help',
  textDecoration: 'underline dotted',
}
