// Inline SVG icons (16px grid, 1.5 stroke, currentColor). Decorative by
// default (aria-hidden); the control that holds an icon carries the label.
// Browser + SSR safe --- no environment variables.
import type { ComponentChildren, SVGAttributes } from "preact";

type IconProps = Omit<SVGAttributes<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => <Svg {...p}><path d="M8 3.5v9M3.5 8h9" /></Svg>;
/** pencil: change the course in a card */
export const IconPencil = (p: IconProps) => <Svg {...p}><path d="M10.5 3.5l2 2L6 12H4v-2l6.5-6.5z" /><path d="M9.5 4.5l2 2" /></Svg>;
export const IconX = (p: IconProps) => <Svg {...p}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="M3.5 8.5l3 3 6-7" /></Svg>;
/** error: circle with a cross (pairs with the "⨯" strip glyph) */
export const IconError = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M6 6l4 4M10 6l-4 4" /></Svg>;
/** warning: triangle (pairs with "▲") */
export const IconWarn = (p: IconProps) => <Svg {...p}><path d="M8 2.5l6 10.5H2L8 2.5z" /><path d="M8 7v2.5M8 11.4v.1" /></Svg>;
export const IconInfo = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M8 7.5V11M8 5v.1" /></Svg>;
export const IconQuestion = (p: IconProps) => <Svg {...p}><circle cx="8" cy="8" r="6" /><path d="M6.4 6.3a1.7 1.7 0 013.2.7c0 1.1-1.6 1.4-1.6 2.3M8 11.3v.1" /></Svg>;
export const IconGrid = (p: IconProps) => <Svg {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></Svg>;
export const IconGraph = (p: IconProps) => <Svg {...p}><circle cx="3.5" cy="4" r="1.5" /><circle cx="3.5" cy="12" r="1.5" /><circle cx="12.5" cy="8" r="1.5" /><path d="M5 4.6l6 2.8M5 11.4l6-2.8" /></Svg>;
export const IconMore = (p: IconProps) => <Svg {...p} stroke-width="2.2"><path d="M3.5 8h.01M8 8h.01M12.5 8h.01" /></Svg>;
export const IconSearch = (p: IconProps) => <Svg {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" /></Svg>;
export const IconZoomIn = IconPlus;
export const IconZoomOut = (p: IconProps) => <Svg {...p}><path d="M3.5 8h9" /></Svg>;
export const IconFit = (p: IconProps) => <Svg {...p}><path d="M2.5 6V3.5a1 1 0 011-1H6M10 2.5h2.5a1 1 0 011 1V6M13.5 10v2.5a1 1 0 01-1 1H10M6 13.5H3.5a1 1 0 01-1-1V10" /></Svg>;
export const IconExternal = (p: IconProps) => <Svg {...p}><path d="M6 3.5H3.5v9h9V10M9 2.5h4.5V7M13.5 2.5L7.5 8.5" /></Svg>;
export const IconChevronDown = (p: IconProps) => <Svg {...p}><path d="M4 6l4 4 4-4" /></Svg>;
export const IconList = (p: IconProps) => <Svg {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" /></Svg>;
export const IconTrash = (p: IconProps) => <Svg {...p}><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.6 8.5h6.8L12 4.5" /></Svg>;
