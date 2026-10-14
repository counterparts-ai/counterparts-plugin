/**
 * The plugin's own build's hooks module: the sidebar (`register.tsx`) and the
 * speak-first (`speak-first.tsx`) in one, since a plugin loads one hooks
 * module (`hooks.json` "modules" takes one entry). The plugin directory's
 * build names `register.tsx` alone.
 */
import type { Register } from 'claude-code'

import { register as sidebar } from './register'
import { register as speakFirst } from './speak-first'

/**
 * ORDER MATTERS: the hook registered first is the outer one on an event. The sidebar comes first, so its
 * `command.run {command: 'counterparts'}` hook answers `/counterparts …` without `next`, and the speak-first's
 * `command.run` observer beneath it never sees that command; the sidebar writes `$.state` `typedIn` instead,
 * which the speak-first reads. Reordering would change who sees what on every shared event.
 */
export const register: Register = (on, options) => {
  sidebar(on, options)
  speakFirst(on, options)
}
