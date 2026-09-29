// BRANCH-ONLY demo island for src/pages/kit.astro. Deleted before merge.
import { useRef, useState } from "preact/hooks";
import {
  Button, Chip, IconButton, Popover, SegmentedControl, Sheet, Tooltip,
  IconCheck, IconError, IconExternal, IconFit, IconGraph, IconGrid, IconInfo, IconMore, IconPlus,
  IconSearch, IconWarn, IconX, IconZoomIn, IconZoomOut, IconQuestion, IconList,
} from "../index";

function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--s-3)", padding: "var(--s-3) 0", borderTop: "1px solid var(--line)" }}>
      <span class="code muted" style={{ width: "140px", font: "400 var(--t-xs) var(--font-code)" }}>{label}</span>
      {children}
    </div>
  );
}

export default function KitDemo() {
  const [view, setView] = useState<"grid" | "graph">("grid");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLButtonElement>(null);
  const [flipOpen, setFlipOpen] = useState(false);
  const flipRef = useRef<HTMLButtonElement>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const hoverRef = useRef<HTMLButtonElement>(null);
  const hoverTimer = useRef<number>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [log, setLog] = useState("—");

  const hoverIn = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverOpen(true), 300); };
  const hoverOut = () => { window.clearTimeout(hoverTimer.current); hoverTimer.current = window.setTimeout(() => setHoverOpen(false), 120); };

  return (
    <div>
      <section aria-labelledby="k-btn" class="kit-panel">
        <h2 id="k-btn">Button</h2>
        {(["primary", "secondary", "ghost", "danger", "text"] as const).map((v) => (
          <Row label={`.btn--${v}`}>
            <Button variant={v}>{v === "danger" ? "Remove year" : v === "text" ? "+ Add summer session" : "Start with COMP1100"}</Button>
            <Button variant={v} icon={<IconPlus />}>Add year</Button>
            <Button variant={v} size="sm">Small</Button>
            <Button variant={v} disabled>Disabled</Button>
          </Row>
        ))}
        <Row label="aria-disabled + Tooltip">
          <Tooltip content="Plans go up to 6 years">
            <Button variant="secondary" icon={<IconPlus />} aria-disabled="true" onClick={() => setLog("should never fire")}>Add year</Button>
          </Tooltip>
          <span class="muted">click log: <span data-testid="log">{log}</span></span>
        </Row>
      </section>

      <section aria-labelledby="k-ib" class="kit-panel">
        <h2 id="k-ib">IconButton</h2>
        <Row label=".icon-btn">
          <Tooltip content="More actions"><IconButton label="More actions" icon={<IconMore />} /></Tooltip>
          <IconButton label="Search" icon={<IconSearch />} />
          <IconButton label="Show as list" icon={<IconList />} aria-pressed="true" />
          <IconButton label="Disabled" icon={<IconX />} disabled />
        </Row>
        <Row label=".icon-btn--sm/danger">
          <IconButton size="sm" tone="danger" label="Remove COMP2100 from Year 2, Semester 1" icon={<IconX />} />
          <IconButton size="sm" label="Info" icon={<IconInfo />} />
        </Row>
        <Row label=".icon-btn--raised">
          <IconButton tone="raised" label="Zoom in" icon={<IconZoomIn />} />
          <IconButton tone="raised" label="Zoom out" icon={<IconZoomOut />} />
          <IconButton tone="raised" label="Fit graph to view" icon={<IconFit />} />
        </Row>
      </section>

      <section aria-labelledby="k-chip" class="kit-panel">
        <h2 id="k-chip">Chip</h2>
        <Row label="tones">
          <Chip>S1</Chip>
          <Chip tone="gold">S2</Chip>
          <Chip tone="danger" icon={<IconError />}>Needs COMP1100</Chip>
          <Chip tone="warn" icon={<IconWarn />}>Not offered S2</Chip>
          <Chip tone="info" icon={<IconInfo />}>Permission code needed</Chip>
          <Chip tone="outline" icon={<IconCheck />}>Ready</Chip>
          <Chip tone="neutral" icon={<IconQuestion />}>Check official requisites</Chip>
        </Row>
        <Row label="code / lg / button">
          <Chip tone="danger" code>COMP1130</Chip>
          <Chip size="lg" tone="gold" code>COMP2100</Chip>
          <Chip size="lg" tone="warn" icon={<IconWarn />} onClick={() => setLog("problems chip")}>2 problems</Chip>
          <Chip size="lg" tone="danger" icon={<IconError />} onClick={() => setLog("problems chip")}>3 problems</Chip>
        </Row>
      </section>

      <section aria-labelledby="k-seg" class="kit-panel">
        <h2 id="k-seg">SegmentedControl</h2>
        <Row label="ViewToggle">
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Grid", icon: <IconGrid />, controls: "k-panel" },
              { value: "graph", label: "Graph", icon: <IconGraph />, controls: "k-panel" },
            ]}
          />
          <span id="k-panel" role="tabpanel" class="muted">Showing: {view}</span>
        </Row>
      </section>

      <section aria-labelledby="k-pop" class="kit-panel">
        <h2 id="k-pop">Popover / Sheet</h2>
        <Row label="dialog (confirm)">
          <Button ref={confirmRef} variant="secondary" aria-expanded={confirmOpen} aria-haspopup="dialog" onClick={() => setConfirmOpen((o) => !o)}>Remove year 3</Button>
          <Popover open={confirmOpen} anchor={confirmRef} labelledBy="k-confirm-title" onClose={(r) => { setConfirmOpen(false); setLog(`confirm closed: ${r}`); }}>
            <div class="popover__body" style={{ width: "300px" }}>
              <p id="k-confirm-title" style={{ fontWeight: 600 }}>Remove Year 3 and its 4 courses?</p>
              <p class="muted" style={{ marginTop: "var(--s-1)", font: "400 var(--t-sm) var(--font-ui)" }}>This can't be undone.</p>
            </div>
            <div class="popover__footer">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => { setConfirmOpen(false); setLog("removed"); }}>Remove year</Button>
            </div>
          </Popover>
          <Button ref={searchRef} variant="secondary" icon={<IconSearch />} aria-expanded={searchOpen} onClick={() => setSearchOpen((o) => !o)}>Search (closeOnTab, 380px)</Button>
          <Popover open={searchOpen} anchor={searchRef} width={380} label="Add course" closeOnTab onClose={(r) => { setSearchOpen(false); setLog(`search closed: ${r}`); }}>
            <div class="popover__body">
              <input class="input" placeholder="Search code or name — e.g. COMP2100 or algorithms" aria-label="Search courses" />
              <p class="muted" style={{ marginTop: "var(--s-3)", font: "500 var(--t-xs) var(--font-ui)" }}>Suggested for Year 2, Semester 1</p>
            </div>
          </Popover>
        </Row>
        <Row label="hover card (role none)">
          <button
            ref={hoverRef}
            class="btn btn--secondary"
            aria-describedby={hoverOpen ? "k-hover" : undefined}
            onPointerEnter={hoverIn}
            onPointerLeave={hoverOut}
            onFocus={() => setHoverOpen(true)}
            onBlur={() => setHoverOpen(false)}
          >
            <span class="code" style={{ fontWeight: 600 }}>COMP2100</span>
          </button>
          <Popover open={hoverOpen} anchor={hoverRef} id="k-hover" role="none" initialFocus="none" returnFocus={false} width={340} sheet="never"
            onClose={() => setHoverOpen(false)} onPointerEnter={() => window.clearTimeout(hoverTimer.current)} onPointerLeave={hoverOut}>
            <div class="popover__body">
              <p style={{ font: "600 var(--t-md) var(--font-ui)" }}><span class="code">COMP2100</span> Software Design Methodologies</p>
              <p class="muted" style={{ font: "400 var(--t-sm) var(--font-ui)", marginTop: "var(--s-1)" }}>6 units · 2000-level · Offered S1, S2</p>
              <p style={{ marginTop: "var(--s-3)", font: "400 var(--t-sm) var(--font-ui)", color: "var(--danger)" }}>✗ COMP1110 or COMP1140</p>
              <a href="#k-pop" style={{ display: "inline-flex", gap: "4px", alignItems: "center", marginTop: "var(--s-3)", font: "500 var(--t-sm) var(--font-ui)" }}>View on Programs and Courses <IconExternal size={12} /></a>
            </div>
          </Popover>
          <Button variant="secondary" onClick={() => setSheetOpen(true)}>Open sheet</Button>
          <Sheet open={sheetOpen} label="COMP2100 details" onClose={(r) => { setSheetOpen(false); setLog(`sheet closed: ${r}`); }}>
            <div class="popover__header"><span>COMP2100</span><IconButton label="Close" icon={<IconX />} onClick={() => setSheetOpen(false)} /></div>
            <div class="popover__body">
              <p class="muted">Bottom sheet: scrim, drag handle, Esc / scrim / drag closes, focus returns to the opener.</p>
              <div style={{ marginTop: "var(--s-4)", display: "flex", gap: "var(--s-2)" }}>
                <Button variant="primary">Move to semester…</Button>
                <Button variant="ghost" onClick={() => setSheetOpen(false)}>Cancel</Button>
              </div>
            </div>
          </Sheet>
        </Row>
      </section>

      <section aria-labelledby="k-flip" class="kit-panel">
        <h2 id="k-flip">Flip near viewport bottom</h2>
        <Row label="bottom-start → top">
          <Button ref={flipRef} variant="secondary" aria-expanded={flipOpen} onClick={() => setFlipOpen((o) => !o)}>Open near bottom</Button>
          <Popover open={flipOpen} anchor={flipRef} width={320} label="Flip demo" onClose={() => setFlipOpen(false)}>
            <div class="popover__body">
              {Array.from({ length: 8 }, (_, i) => <p class="muted" style={{ padding: "var(--s-1) 0" }}>Result row {i + 1}</p>)}
              <Button variant="primary" onClick={() => setFlipOpen(false)}>Done</Button>
            </div>
          </Popover>
        </Row>
        <p class="muted" style={{ font: "400 var(--t-xs) var(--font-ui)" }}>last close: <span data-testid="log2">{log}</span></p>
      </section>
    </div>
  );
}
