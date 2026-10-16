/**
 * The plugin's own build's hooks module: the sidebar (`register.tsx`), the
 * speak-first (`speak-first.tsx`) and the full sidebar's actions
 * (`actions.tsx`: the Meet row, the dashboard link and line, the view and
 * avatar switches) in one, since a plugin loads one hooks module
 * (`hooks.json` "modules" takes one entry). The plugin directory's build
 * names `register.tsx` alone, so none of the other two is in it.
 *
 * THE ONE SWITCH (2026-10-16): registering `actions.tsx` is what turns the
 * full sidebar's pieces on (it sets `state.ts#run.full`); nothing else does.
 */
import type { Register } from 'claude-code'

import { register as actions } from './actions'
import { register as sidebar } from './register'
import { register as speakFirst } from './speak-first'

/**
 * ORDER MATTERS: the hook registered first is the outer one on an event. The actions come first, and
 * hook only `ui.message`, matched to their own clicks (`fill:…`), which they answer; the sidebar's
 * `ui.message` beneath answers every other click without `next`, so it would swallow theirs. Then the
 * sidebar, so its `command.run {command: 'counterparts'}` hook answers `/counterparts …` without `next`, and
 * the speak-first's `command.run` observer beneath it never sees that command; the sidebar writes `$.state`
 * `typedIn` instead, which the speak-first reads. Reordering would change who sees what on every shared event.
 */
export const register: Register = (on, options) => {
  actions(on, options)
  sidebar(on, options)
  speakFirst(on, options)
}
