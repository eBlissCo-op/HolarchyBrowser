/*  Holarchy Browser 0.4 Alpha — Trust & Reputation  */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

type UUID = string;
type LinkType = "parent" | "depends" | "inspired" | "child";

interface TrustSignature {
  reputation: number; // −1 … 1
  confidence: number; // 0 … 1
  lastUpdate: string;
  sources: Record<string, number>;
}

interface Holon {
  id: UUID;
  name: string;
  x: number;
  y: number;
  createdAt: string;
  avatar: { default: string | null; alts: string[] };
  pinned?: boolean;
  trust: TrustSignature;
}
interface Link {
  id: UUID;
  fromId: UUID;
  toId: UUID;
  type: LinkType;
  label?: string;
}
interface Note {
  id: UUID;
  holonId: UUID;
  text: string;
  createdAt: string;
}
interface TrustEvent {
  fromId: UUID;
  toId: UUID;
  context: "discussion" | "collaboration" | "assist" | "vote" | "system";
  delta: number;
  reason?: string;
  timestamp: string;
}

const uuid = () =>
  crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const nowISO = () => new Date().toISOString();
const W = 1200,
  H = 800;

const LS = {
  holons: "holarchy_holons",
  links: "holarchy_links",
  notes: "holarchy_notes",
  view: "holarchy_view",
  trustEvents: "holarchy_trust_events",
};

const typeHue: Record<LinkType, string> = {
  parent: "#f59e0b",
  depends: "#3b82f6",
  inspired: "#8b5cf6",
  child: "#10b981",
};

function trustColor(value: number): string {
  const v = Math.max(-1, Math.min(1, value));
  const r = v < 0 ? 255 : Math.floor(255 * (1 - v));
  const g = v > 0 ? 255 : Math.floor(255 * (v + 1) / 2);
  return `rgb(${r},${g},90)`;
}

export default function App() {
  const [holons, setHolons] = useState<Holon[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [events, setEvents] = useState<TrustEvent[]>([]);
  const [selected, setSelected] = useState<Holon | null>(null);
  const [linkMode, setLinkMode] = useState({
    active: false,
    source: null as UUID | null,
    type: "parent" as LinkType,
  });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [draggingId, setDraggingId] = useState<UUID | null>(null);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    holonId: null as UUID | null,
  });
  const pinned = holons.filter((h) => h.pinned);

  /* ----------  Initialization & persistence  ---------- */
  useEffect(() => {
    const hRaw = localStorage.getItem(LS.holons);
    const lRaw = localStorage.getItem(LS.links);
    const nRaw = localStorage.getItem(LS.notes);
    const vRaw = localStorage.getItem(LS.view);
    const eRaw = localStorage.getItem(LS.trustEvents);
    if (hRaw) {
      const arr = JSON.parse(hRaw);
      setHolons(
        arr.map((h: any) => ({
          ...h,
          trust:
            h.trust ||
            ({ reputation: 0, confidence: 0.5, lastUpdate: nowISO(), sources: {} } as TrustSignature),
        }))
      );
    } else {
      setHolons([
        {
          id: uuid(),
          name: "eBliss Co-op",
          x: 0,
          y: 0,
          createdAt: nowISO(),
          avatar: { default: null, alts: [] },
          trust: { reputation: 0.3, confidence: 0.7, lastUpdate: nowISO(), sources: {} },
        },
        {
          id: uuid(),
          name: "Supportable",
          x: 240,
          y: 180,
          createdAt: nowISO(),
          avatar: { default: null, alts: [] },
          trust: { reputation: 0.4, confidence: 0.6, lastUpdate: nowISO(), sources: {} },
        },
        {
          id: uuid(),
          name: "Holarchy Browser",
          x: -260,
          y: 160,
          createdAt: nowISO(),
          avatar: { default: null, alts: [] },
          trust: { reputation: 0.1, confidence: 0.5, lastUpdate: nowISO(), sources: {} },
        },
      ]);
    }
    if (lRaw) setLinks(JSON.parse(lRaw));
    if (nRaw) setNotes(JSON.parse(nRaw));
    if (vRaw) {
      try {
        const v = JSON.parse(vRaw);
        setScale(v.scale || 1);
        setOffset(v.offset || { x: 0, y: 0 });
      } catch {}
    }
    if (eRaw) setEvents(JSON.parse(eRaw));
  }, []);

  useEffect(() => localStorage.setItem(LS.holons, JSON.stringify(holons)), [holons]);
  useEffect(() => localStorage.setItem(LS.links, JSON.stringify(links)), [links]);
  useEffect(() => localStorage.setItem(LS.notes, JSON.stringify(notes)), [notes]);
  useEffect(() => localStorage.setItem(LS.trustEvents, JSON.stringify(events)), [events]);
  useEffect(
    () => localStorage.setItem(LS.view, JSON.stringify({ scale, offset })),
    [scale, offset]
  );

  /* ----------  Utility helpers  ---------- */
  const byId = (id: UUID) => holons.find((h) => h.id === id) || null;
  const toScreen = (p: { x: number; y: number }) => ({
    x: W / 2 + (p.x + offset.x) * scale,
    y: H / 2 + (p.y + offset.y) * scale,
  });
  const toWorld = (p: { x: number; y: number }) => ({
    x: (p.x - W / 2) / scale - offset.x,
    y: (p.y - H / 2) / scale - offset.y,
  });

  const inferType = (a: Holon, b: Holon): LinkType => {
    const A = a.name.toLowerCase(),
      B = b.name.toLowerCase();
    if (A.includes(B) || B.includes(A)) return "parent";
    const depends = ["support", "base", "foundation", "server", "client", "infra", "core"];
    if (depends.some((w) => A.includes(w) || B.includes(w))) return "depends";
    const inspire = ["idea", "vision", "design", "concept", "art", "avatar"];
    if (inspire.some((w) => A.includes(w) || B.includes(w))) return "inspired";
    return "child";
  };

  const holonHue = (h: Holon) => {
    const outgoing = links.filter((l) => l.fromId === h.id);
    if (!outgoing.length) return "rgba(255,255,255,0.6)";
    const counts: Record<LinkType, number> = { parent: 0, depends: 0, inspired: 0, child: 0 };
    outgoing.forEach((l) => counts[l.type]++);
    const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as LinkType;
    return typeHue[dom];
  };

  /* ----------  Trust + reputation math  ---------- */
  const reputationOf = (h: Holon) => {
    const incoming = events.filter((e) => e.toId === h.id).map((e) => e.delta);
    if (!incoming.length) return h.trust.reputation;
    const avg = incoming.reduce((a, b) => a + b, 0) / incoming.length;
    return Math.max(-1, Math.min(1, h.trust.reputation * 0.7 + avg * 0.3));
  };

  const recordTrustEvent = (ev: TrustEvent) => {
    setEvents((p) => [...p, ev]);
    setHolons((prev) =>
      prev.map((h) => {
        if (h.id !== ev.toId) return h;
        const decay = 0.05,
          weight = 0.25;
        const rep = h.trust.reputation * (1 - decay) + ev.delta * weight;
        const conf = Math.max(0, Math.min(1, h.trust.confidence + Math.sign(ev.delta) * 0.02));
        return {
          ...h,
          trust: {
            reputation: rep,
            confidence: conf,
            lastUpdate: nowISO(),
            sources: { ...h.trust.sources, [ev.fromId]: (h.trust.sources[ev.fromId] || 0) + ev.delta },
          },
        };
      })
    );
  };

  /* ----------  Core interactions (create/link/etc.)  ---------- */
  const createHolon = () => {
    const name = prompt("New holon name:");
    if (!name) return;
    const h: Holon = {
      id: uuid(),
      name: name.trim(),
      x: Math.round(Math.random() * 400 - 200),
      y: Math.round(Math.random() * 300 - 150),
      createdAt: nowISO(),
      avatar: { default: null, alts: [] },
      trust: { reputation: 0, confidence: 0.5, lastUpdate: nowISO(), sources: {} },
    };
    setHolons((p) => [...p, h]);
    if (selected) {
      const type = inferType(selected, h);
      setLinks((p) => [...p, { id: uuid(), fromId: selected.id, toId: h.id, type }]);
      recordTrustEvent({
        fromId: selected.id,
        toId: h.id,
        context: "collaboration",
        delta: 0.05,
        reason: "created link",
        timestamp: nowISO(),
      });
    }
  };

  const startLinkMode = () =>
    setLinkMode((s) => ({ ...s, active: !s.active, source: null }));

  const handleHolonClick = (h: Holon) => {
    if (linkMode.active) {
      if (!linkMode.source) setLinkMode((s) => ({ ...s, source: h.id }));
      else {
        const type = inferType(byId(linkMode.source!)!, h);
        setLinks((p) => [...p, { id: uuid(), fromId: linkMode.source!, toId: h.id, type }]);
        recordTrustEvent({
          fromId: linkMode.source!,
          toId: h.id,
          context: "collaboration",
          delta: 0.03,
          reason: "manual link",
          timestamp: nowISO(),
        });
        setLinkMode((s) => ({ ...s, source: null }));
      }
    } else setSelected(h);
  };

  const autoRelate = () => {
    const newLinks: Link[] = [];
    holons.forEach((a) =>
      holons.forEach((b) => {
        if (a.id === b.id) return;
        if (!links.some((l) => l.fromId === a.id && l.toId === b.id))
          newLinks.push({ id: uuid(), fromId: a.id, toId: b.id, type: inferType(a, b) });
      })
    );
    if (newLinks.length) {
      setLinks((p) => [...p, ...newLinks]);
      newLinks.forEach((l) =>
        recordTrustEvent({
          fromId: l.fromId,
          toId: l.toId,
          context: "system",
          delta: 0.01,
          reason: "auto relate",
          timestamp: nowISO(),
        })
      );
      alert(`Created ${newLinks.length} links`);
    } else alert("No new links");
  };

  const togglePin = (h: Holon) =>
    setHolons((p) => p.map((x) => (x.id === h.id ? { ...x, pinned: !x.pinned } : x)));

  /* ----------  Rendering  ---------- */
  return (
    <div className="min-h-screen text-white bg-gradient-to-br from-indigo-900 via-purple-800 to-pink-700">
      <div className="sticky top-0 z-10 backdrop-blur bg-black/20 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 overflow-x-auto">
          <span className="text-sm opacity-80 mr-2">Pinned:</span>
          {pinned.length
            ? pinned.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setSelected(h)}
                  className="px-3 py-1 rounded-full bg-white/10 border border-white/20 hover:bg-white/15 text-sm whitespace-nowrap"
                >
                  {h.name}
                </button>
              ))
            : <span className="text-sm opacity-60">None</span>}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-3">
        <h1 className="text-2xl font-bold mb-3 text-center">
          New Earth Holarchy 0.4 Alpha — Trust & Reputation
        </h1>
        <div className="mb-3 flex flex-wrap gap-2 items-center">
          <button onClick={createHolon} className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/15">Add Holon</button>
          <button onClick={startLinkMode} className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/15">
            {linkMode.active ? (linkMode.source ? "Link: choose target…" : "Link Mode (on)") : "Link Mode"}
          </button>
          <button onClick={autoRelate} className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 hover:bg-white/15">Auto Relate</button>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative mx-auto rounded-2xl border border-white/20 bg-black/20 overflow-hidden select-none"
          style={{ width: W, height: H }}
        >
          <svg width={W} height={H} className="absolute left-0 top-0 pointer-events-none">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 Z" fill="currentColor" />
              </marker>
            </defs>
            {links.map((l) => {
              const a = byId(l.fromId),
                b = byId(l.toId);
              if (!a || !b) return null;
              const A = toScreen(a),
                B = toScreen(b);
              return (
                <g key={l.id}>
                  <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={typeHue[l.type]} strokeWidth={2} markerEnd="url(#arrow)" />
                  <text x={(A.x + B.x) / 2} y={(A.y + B.y) / 2 - 6} fontSize="12" fill="#fff" textAnchor="middle">
                    {l.label || l.type}
                  </text>
                </g>
              );
            })}
          </svg>

          {holons.map((h) => {
            const s = toScreen(h);
            const hue = holonHue(h);
            const rep = reputationOf(h);
            const ring = trustColor(rep);
            return (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: draggingId === h.id ? 1.02 : 1 }}
                transition={{ duration: 0.12 }}
                style={{ left: s.x, top: s.y }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing"
                onClick={() => setSelected(h)}
                title={`Trust ${rep.toFixed(2)} • Conf ${h.trust.confidence.toFixed(2)}`}
              >
                <div
                  className="mx-auto rounded-full border pulse"
                  style={{
                    width: 56,
                    height: 56,
                    borderColor: hue,
                    outline: `3px solid ${ring}`,
                    outlineOffset: "3px",
                  }}
                />
                <div className="mt-2 px-3 py-1 rounded-2xl bg-white/15 border text-sm text-center whitespace-nowrap" style={{ borderColor: hue }}>
                  {h.name} <span className="opacity-70 text-xs">({rep.toFixed(2)})</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

