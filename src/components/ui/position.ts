// Anchored positioning for Popover and Tooltip. Pure: rects in, coordinates
// out, so it runs the same in any browser and needs no layout library.
// Browser code --- no environment variables, no server imports.

export type Side = "top" | "bottom";
export type Align = "start" | "center" | "end";
export type Placement = `${Side}-${Align}` | Side;

export interface Box { top: number; left: number; width: number; height: number }
export interface Placed { top: number; left: number; side: Side; maxHeight: number }

/**
 * Place a floating box of `size` against `anchor` inside a `viewport` of
 * `vw` x `vh`. Prefers `placement`'s side; flips to the other side when the
 * preferred side can't fit the box and the other side has more room.
 * Horizontally clamps to `margin` from each viewport edge.
 */
export function computePosition(
  anchor: Box,
  size: { width: number; height: number },
  placement: Placement,
  vw: number,
  vh: number,
  offset = 6,
  margin = 8,
): Placed {
  const [prefSide, align = "center"] = placement.split("-") as [Side, Align?];
  const below = vh - (anchor.top + anchor.height) - offset - margin;
  const above = anchor.top - offset - margin;
  let side: Side = prefSide;
  if (prefSide === "bottom" && size.height > below && above > below) side = "top";
  if (prefSide === "top" && size.height > above && below > above) side = "bottom";

  const room = side === "bottom" ? below : above;
  const height = Math.min(size.height, room);
  const top = side === "bottom" ? anchor.top + anchor.height + offset : anchor.top - offset - height;

  let left =
    align === "start" ? anchor.left
    : align === "end" ? anchor.left + anchor.width - size.width
    : anchor.left + anchor.width / 2 - size.width / 2;
  left = Math.max(margin, Math.min(left, vw - margin - size.width));

  return { top: Math.round(top), left: Math.round(left), side, maxHeight: Math.max(0, Math.floor(room)) };
}
