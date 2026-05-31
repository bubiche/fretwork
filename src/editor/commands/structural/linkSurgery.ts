import { model } from '@coderline/alphatab'

/** Undo handle: call to restore exactly the link pointers a {@link severLinks} pass cleared. */
export type RevertSever = () => void

/**
 * Sever any linked-note pointer that crosses OUT of a group of notes that must stay self-consistent —
 * the single source of truth for alphaTab's link taxonomy (tie / slur / hammer-on-pull-off / slide,
 * each a directed origin↔destination pair). A pointer to a partner the renderer/serializer can't reach
 * is the paste/delete worker-crash hazard: alphaTab serializes the whole score to its render worker,
 * which re-links BY ID (`Note.chain`); a pointer to a note absent from the payload makes
 * `noteIdLookup.get(id)` `undefined` → `undefined.tieDestination = this` throws.
 *
 * `shouldSever(partner)` decides per pointer. The two call sites are mirror images:
 *   - **paste** (`prepareClonedBeats`): walk the PASTED notes, sever pointers to partners NOT in the
 *     pasted set (the partner was left behind in the clone).
 *   - **delete/cut** (`DeleteRangeCommand`): walk the SURVIVING partners of the deleted notes, sever
 *     pointers INTO the deleted set (the partner is being removed).
 *
 * Paired *flags* (`isTieDestination`/`isSlurDestination`/`isHammerPullOrigin`) are settable booleans the
 * serializer reads, so they're cleared alongside their pointer. The complementary getters
 * (`isTieOrigin`/`isSlurOrigin`/`isHammerPullDestination`) read off the pointer and clear themselves. A
 * severed slide degrades to a plain note, so its `slideInType`/`slideOutType` reset to `None`.
 *
 * Returns a {@link RevertSever} that restores every field this pass changed, in reverse — so a delete
 * can be a clean undo (the deleted beat comes back AND its tie to a survivor is re-established).
 */
export function severLinks(
  notes: Iterable<model.Note>,
  shouldSever: (partner: model.Note) => boolean,
): RevertSever {
  const reverts: RevertSever[] = []

  for (const note of notes) {
    if (note.tieOrigin && shouldSever(note.tieOrigin)) {
      const origin = note.tieOrigin
      const wasDest = note.isTieDestination
      note.tieOrigin = null
      note.isTieDestination = false
      reverts.push(() => {
        note.tieOrigin = origin
        note.isTieDestination = wasDest
      })
    }
    if (note.tieDestination && shouldSever(note.tieDestination)) {
      const dest = note.tieDestination
      note.tieDestination = null
      reverts.push(() => {
        note.tieDestination = dest
      })
    }
    if (note.slurOrigin && shouldSever(note.slurOrigin)) {
      const origin = note.slurOrigin
      const wasDest = note.isSlurDestination
      note.slurOrigin = null
      note.isSlurDestination = false
      reverts.push(() => {
        note.slurOrigin = origin
        note.isSlurDestination = wasDest
      })
    }
    if (note.slurDestination && shouldSever(note.slurDestination)) {
      const dest = note.slurDestination
      note.slurDestination = null
      reverts.push(() => {
        note.slurDestination = dest
      })
    }
    if (note.hammerPullOrigin && shouldSever(note.hammerPullOrigin)) {
      const origin = note.hammerPullOrigin
      note.hammerPullOrigin = null
      reverts.push(() => {
        note.hammerPullOrigin = origin
      })
    }
    if (note.hammerPullDestination && shouldSever(note.hammerPullDestination)) {
      const dest = note.hammerPullDestination
      const wasOrigin = note.isHammerPullOrigin
      note.hammerPullDestination = null
      note.isHammerPullOrigin = false
      reverts.push(() => {
        note.hammerPullDestination = dest
        note.isHammerPullOrigin = wasOrigin
      })
    }
    if (note.slideOrigin && shouldSever(note.slideOrigin)) {
      const origin = note.slideOrigin
      const inType = note.slideInType
      note.slideOrigin = null
      note.slideInType = model.SlideInType.None
      reverts.push(() => {
        note.slideOrigin = origin
        note.slideInType = inType
      })
    }
    if (note.slideTarget && shouldSever(note.slideTarget)) {
      const target = note.slideTarget
      const outType = note.slideOutType
      note.slideTarget = null
      note.slideOutType = model.SlideOutType.None
      reverts.push(() => {
        note.slideTarget = target
        note.slideOutType = outType
      })
    }
  }

  return () => {
    for (let i = reverts.length - 1; i >= 0; i--) reverts[i]()
  }
}

/**
 * Every note that links TO a note in `deleted` from OUTSIDE it — the survivors whose back-pointers a
 * range deletion would leave dangling. Collected from the deleted notes' OWN partner pointers, then
 * filtered to those not themselves being deleted.
 *
 * ⚠ Relies on links being SYMMETRIC: it can only reach a survivor `S` if the deleted note `D` points
 * back at `S`. That holds because `score.finish()` populates both ends of every link (verified: a slide
 * set only `source.slideTarget` gains `target.slideOrigin` after finish), and the command path always
 * runs on a finished score (every mutation re-finishes via `afterMutation`). A one-sided link in an
 * UN-finished score would be missed here — if that invariant ever changes, sever over the beats
 * flanking the deleted block instead (links only ever join adjacent beats).
 */
export function survivingLinkPartners(
  deleted: Iterable<model.Note>,
  isDeleted: (n: model.Note) => boolean,
): model.Note[] {
  const out = new Set<model.Note>()
  for (const n of deleted) {
    const partners = [
      n.tieOrigin,
      n.tieDestination,
      n.slurOrigin,
      n.slurDestination,
      n.hammerPullOrigin,
      n.hammerPullDestination,
      n.slideOrigin,
      n.slideTarget,
    ]
    for (const p of partners) if (p && !isDeleted(p)) out.add(p)
  }
  return [...out]
}
