/**
 * The pane's body as a `Client` surface module: the lines `./sections.ts`
 * laid out, drawn as they are, and a click on one posted back to the hooks
 * module by the key it carries (`{ click: 'mem:0' }`), or, from a row's
 * link column on, by the link's (`{ click: 'more:mem_…' }`).
 *
 * Why not Buttons: the engine inverts a Button under the pointer and the
 * focus, so moving the mouse over a list lit row after row (v0.1, NOTES).
 * Here nothing changes under a passing pointer; a click on any row of an item
 * is a click on the item. No `$` here, and no state: what is open lives in
 * the hooks module's `$.state`, which draws this again.
 */
import type { ClientModule, ClientSurface } from 'claude-code'

import type { Line } from './sections'

export type BodyProps = { lines: Line[] }

const Body: ClientModule<BodyProps, never> = (props, surface: ClientSurface<never>) => {
  const { Box, Text } = surface.elements
  surface.onPointer(ev => {
    if (ev.type !== 'down' || (ev.button !== undefined && ev.button !== 'left')) return
    const l = props.lines[ev.y]
    // a row's link (the `more` that ends a cut text) takes the click from its column on
    const key = l?.link !== undefined && ev.x >= l.link.from ? l.link.key : l?.key
    if (key !== undefined) surface.post({ click: key })
  })
  return (
    <Box flexDirection="column">
      {props.lines.map((l, y) =>
        l.segs.length === 0 ? (
          <Text key={`l${String(y)}`}> </Text>
        ) : (
          <Box key={`l${String(y)}`} flexDirection="row">
            {l.segs.map((s, i) => (
              <Text key={String(i)} color={s.c} {...(s.b === true ? { bold: true } : {})} {...(s.i === true ? { italic: true } : {})}>
                {s.t}
              </Text>
            ))}
          </Box>
        ),
      )}
    </Box>
  )
}

export default Body
