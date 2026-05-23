import { useEffect, useState } from 'preact/hooks'
import { store, type StoreState } from '../../editor/store'

export function useStore<T>(selector: (s: StoreState) => T): T {
  const [value, setValue] = useState(() => selector(store.getState()))
  useEffect(() => store.subscribe(selector, setValue), [])
  return value
}
