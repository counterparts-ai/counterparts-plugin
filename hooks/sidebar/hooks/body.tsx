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

/** `prose`: the surface sets text in its own font (desktop): a heading's `─` rule becomes space that pushes the right part to the edge. */
export type BodyProps = { lines: Line[]; prose?: boolean }

const RULE = /^ ?─+$/

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
            {l.segs.map((s, i) =>
              props.prose === true && (s.grow === true || RULE.test(s.t)) ? (
                <Box key={String(i)} flexGrow={1} />
              ) : props.prose === true && s.fill !== undefined ? (
                // a share of its column, drawn in half blocks clipped to that share: whatever width the app's
                // font gives `▄`, the bar is the right length, half a row tall like the terminal's
                <Box key={String(i)} width={s.of ?? s.fill} overflow="hidden">
                  {/* one row tall and clipped, no `wrap`: a truncating Text drew `…` at the bar's end */}
                  {s.fill > 0 ? (
                    <Box width={`${String(Math.round((100 * s.fill) / Math.max(1, s.of ?? s.fill)))}%`} height={1} overflow="hidden">
                      <Text color={s.c}>{'▄'.repeat(2 * (s.of ?? s.fill))}</Text>
                    </Box>
                  ) : null}
                </Box>
              ) : props.prose === true && s.cw !== undefined ? (
                <Box key={String(i)} width={s.cw}>
                  <Text color={s.c} {...(s.b === true ? { bold: true } : {})}>{s.t}</Text>
                </Box>
              ) : (
                <Text key={String(i)} color={s.c} {...(s.b === true ? { bold: true } : {})} {...(s.i === true ? { italic: true } : {})}>
                  {props.prose === true && i > 0 && RULE.test(l.segs[i - 1]?.t ?? '') ? s.t.replace(/^ /, '') : s.t}
                </Text>
              ),
            )}
          </Box>
        ),
      )}
    </Box>
  )
}

export default Body
