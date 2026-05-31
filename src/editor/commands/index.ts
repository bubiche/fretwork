export {
  ChangeFretCommand,
  changeSelectedFret,
  setSelectedFret,
  resetFretAmend,
  MAX_FRET,
} from './ChangeFret'
export { AddNoteCommand, type FretAmendable } from './AddNote'
export { ChangeStringCommand, moveSelectedNote } from './ChangeString'
export {
  DeleteNoteCommand,
  BeatToRestCommand,
  deleteSelectedNote,
  beatToRest,
} from './DeleteNote'
export {
  ChangeDurationCommand,
  stepSelectedDuration,
  setSelectedDuration,
  toggleSelectedDot,
  DURATION_LADDER,
} from './ChangeDuration'
export { InsertBeatCommand, insertBeatAfterSelection } from './InsertBeat'
export { DeleteBeatCommand, deleteSelectedBeat } from './DeleteBeat'
// ── Phase 4a effects ──────────────────────────────────────────────────────────────────────────
export { SetNoteEffectCommand, SetBeatEffectCommand } from './effects/SetEffect'
export {
  toggleSelectedPalmMute,
  toggleSelectedGhost,
  toggleSelectedDead,
  cycleSelectedVibrato,
  stepSelectedDynamics,
  VIBRATO_CYCLE,
  DYNAMICS_LADDER,
} from './effects/articulation'
export {
  TieCommand,
  toggleSelectedLetRing,
  toggleSelectedHammerPull,
  tieSelectedNote,
  setSelectedSlideOut,
  setSelectedSlideIn,
} from './effects/linked'
// ── Phase 4b effects: curves (bend + whammy presets) ────────────────────────────────────────────
export {
  SetBendCommand,
  BEND_PRESETS,
  type BendPreset,
  setSelectedBend,
  clearSelectedBend,
} from './effects/Bend'
export {
  SetWhammyCommand,
  WHAMMY_PRESETS,
  type WhammyPreset,
  setSelectedWhammy,
  clearSelectedWhammy,
} from './effects/Whammy'
// ── Phase 4b-2 effects: tremolo, tap, harmonics, grace ──────────────────────────────────────────
export {
  toggleSelectedTap,
  setSelectedHarmonic,
  HARMONIC_OPTIONS,
} from './effects/advanced'
export {
  SetTremoloCommand,
  TREMOLO_PRESETS,
  type TremoloPreset,
  setSelectedTremolo,
  clearSelectedTremolo,
} from './effects/Tremolo'
export {
  InsertGraceBeatCommand,
  GRACE_OPTIONS,
  setSelectedGrace,
} from './effects/Grace'
// ── Phase 4b-3 effects: chord diagrams ──────────────────────────────────────────────────────────
export {
  SetChordCommand,
  CHORD_LIBRARY,
  CHORD_TUNING_LENGTH,
  type ChordDef,
  buildChord,
  chordPickerEnabled,
  setSelectedChord,
  clearSelectedChord,
} from './effects/Chord'
// ── Phase 5a structural edits: bar & measure family ─────────────────────────────────────────────
export { SetTimeSignatureCommand, setSelectedTimeSignature } from './structural/SetTimeSignature'
export { SetKeySignatureCommand, setSelectedKeySignature } from './structural/SetKeySignature'
export { SetTempoCommand, setSelectedTempo } from './structural/SetTempo'
export { InsertMeasureCommand, insertMeasureAfterSelection } from './structural/InsertMeasure'
export { DeleteMeasureCommand, deleteSelectedMeasure } from './structural/DeleteMeasure'
export { KEY_SIGNATURE_OPTIONS, type KeySignatureOption } from './structural/keys'
// ── Phase 5b structural edits: copy / cut / paste ───────────────────────────────────────────────
export { CompositeCommand } from './Composite'
export { PasteCommand } from './structural/Paste'
export { DeleteRangeCommand } from './structural/DeleteRange'
export {
  copySelection,
  cutSelection,
  pasteClipboard,
  hasClipboard,
  clearClipboard,
  prepareClonedBeats,
} from './structural/clipboard'
