import { describe, it, expect, beforeEach } from 'vitest'
import { CommandStack, STACK_CAP, type Command } from '../../src/editor/CommandStack'
import type { model } from '@coderline/alphatab'

// CommandStack reads its Score through an injected accessor and runs apply/undo itself, so it
// needs no real Score, no store, and no alphaTab api. A sentinel object is enough.
const fakeScore = {} as model.Score

/** Records which command ran apply/undo, in order, into shared logs. */
class RecordingCommand implements Command {
  constructor(
    readonly id: number,
    private applied: number[],
    private undone: number[],
  ) {}
  apply(): void {
    this.applied.push(this.id)
  }
  undo(): void {
    this.undone.push(this.id)
  }
  describe(): string {
    return `cmd ${this.id}`
  }
}

describe('CommandStack', () => {
  let applied: number[]
  let undone: number[]
  let stack: CommandStack

  const cmd = (id: number) => new RecordingCommand(id, applied, undone)

  beforeEach(() => {
    applied = []
    undone = []
    stack = new CommandStack(() => fakeScore)
  })

  it('execute applies the command and grows the stack', () => {
    expect(stack.canUndo).toBe(false)
    stack.execute(cmd(1))
    expect(applied).toEqual([1])
    expect(stack.depth).toBe(1)
    expect(stack.canUndo).toBe(true)
    expect(stack.canRedo).toBe(false)
  })

  it('undo reverses the last command and enables redo', () => {
    stack.execute(cmd(1))
    stack.undo()
    expect(undone).toEqual([1])
    expect(stack.depth).toBe(0)
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(true)
  })

  it('redo re-applies the undone command', () => {
    stack.execute(cmd(1))
    stack.undo()
    applied.length = 0 // ignore the initial apply
    stack.redo()
    expect(applied).toEqual([1])
    expect(stack.depth).toBe(1)
    expect(stack.canRedo).toBe(false)
  })

  it('a fresh execute clears the redo buffer', () => {
    stack.execute(cmd(1))
    stack.undo()
    expect(stack.canRedo).toBe(true)
    stack.execute(cmd(2))
    expect(stack.canRedo).toBe(false)
    stack.redo() // no-op: redo buffer was cleared
    expect(stack.depth).toBe(1)
  })

  it('undo / redo on an empty stack are no-ops', () => {
    expect(() => stack.undo()).not.toThrow()
    expect(() => stack.redo()).not.toThrow()
    expect(stack.depth).toBe(0)
    expect(undone).toEqual([])
  })

  it('caps at STACK_CAP and drops the OLDEST entry on overflow', () => {
    // Push one past the cap. Ids 0..STACK_CAP (that's STACK_CAP+1 commands).
    for (let i = 0; i <= STACK_CAP; i++) stack.execute(cmd(i))
    expect(stack.depth).toBe(STACK_CAP)

    // Undo everything; the surviving ids should be 1..STACK_CAP — id 0 (the oldest) is gone.
    while (stack.canUndo) stack.undo()
    const survivors = [...undone].sort((a, b) => a - b)
    expect(survivors).toHaveLength(STACK_CAP)
    expect(survivors[0]).toBe(1)
    expect(survivors).not.toContain(0)
    expect(survivors[survivors.length - 1]).toBe(STACK_CAP)
  })

  it('clear empties both stacks', () => {
    stack.execute(cmd(1))
    stack.undo()
    stack.clear()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
    expect(stack.depth).toBe(0)
  })
})
