import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface Holon {
  id: string;
  name: string;
  x: number;
  y: number;
  pinned: boolean;
}

interface Link {
  id: string;
  from: string;
  to: string;
}

interface TrustEvent {
  id: string;
  from: string;
  to: string;
  delta: number;
  timestamp: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const W = 1200;
const H = 800;
const HOLO_SIZE = 120;
const HOLO_RADIUS = HOLO_SIZE / 2;

const uuid = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

const defaultHolons: Holon[] = [
  { id: uuid(), name: "You", x: W / 2 - 200, y: H / 2, pinned: true },
  { id: uuid(), name: "Mother Earth", x: W / 2 + 200, y: H / 2, pinned: true },
  { id: uuid(), name: "Gift & Need Flow", x: W / 2, y: H / 2 - 200, pinned: true },
];

function App() {
  const [holons, setHolons] = useState<Holon[]>(() => {
    const stored = localStorage.getItem("holons");
    return stored ? JSON.parse(stored) : defaultHolons;
  });
  const [links, setLinks] = useState<Link[]>(() => {
    const stored = localStorage.getItem("links");
    return stored ? JSON.parse(stored) : [];
  });
  const [trustEvents, setTrustEvents] = useState<TrustEvent[]>(() => {
    const stored = localStorage.getItem("trustEvents");
    return stored ? JSON.parse(stored) : [];
  });
  const [linkMode, setLinkMode] = useState<{ from: string | null }>({ from: null });

  useEffect(() => {
    localStorage.setItem("holons", JSON.stringify(holons));
  }, [holons]);
  useEffect(() => {
    localStorage.setItem("links", JSON.stringify(links));
  }, [links]);
  useEffect(() => {
    localStorage.setItem("trustEvents", JSON.stringify(trustEvents));
  }, [trustEvents]);

  const canvasRef = useRef<HTMLDivElement>(null);

  const recordEvent = (event: TrustEvent) => {
    setTrustEvents(prev => [...prev, event]);
  };

  const createHolon = (x: number, y: number) => {
    const name = prompt("Enter holon name:");
    if (!name) return;
    const newHolon: Holon = { id: uuid(), name, x, y, pinned: false };
    setHolons([...holons, newHolon]);
  };

  const startLinkMode = (from: string) => {
    setLinkMode({ from });
  };

  const autoRelate = () => {
    if (holons.length < 2) return;
    const [first, ...rest] = holons;
    const newLinks: Link[] = rest.map(h => ({ id: uuid(), from: first.id, to: h.id }));
    setLinks([...links, ...newLinks]);
  };

  const deleteHolon = (id: string) => {
    setHolons(holons.filter(h => h.id !== id));
    setLinks(links.filter(l => l.from !== id && l.to !== id));
  };

  const updateHolon = (id: string, data: Partial<Holon>) => {
    setHolons(holons.map(h => (h.id === id ? { ...h, ...data } : h)));
  };

  return (
    <div className="w-screen h-screen bg-black text-purple-300 flex flex-col">
      <div className="sticky top-0 z-10 backdrop-blur bg-black/20 border-b border-white/10">
        <div className="flex gap-4 p-2 overflow-x-auto">
          {holons.filter(h => h.pinned).map(h => (
            <button
              key={h.id}
              className="px-3 py-1 rounded-full bg-purple-700 text-white"
              onClick={() => {
                // placeholder for centering pinned holon
              }}
            >
              {h.name}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-grow flex flex-col items-center justify-center px-4 py-3">
        <h1 className="text-2xl font-bold mb-3 text-center">
          New Earth Holarchy 0.4 Alpha — Trust & Reputation
        </h1>
        <div className="mb-3 flex flex-wrap gap-2 items-center">
          <button
            className="px-4 py-2 bg-purple-700 text-white rounded"
            onClick={() => createHolon(W / 2, H / 2)}
          >
            Add Holon
          </button>
          {linkMode.from ? (
            <span className="text-purple-400">Select target holon</span>
          ) : (
            <button
              className="px-4 py-2 bg-purple-700 text-white rounded"
              onClick={() => {
                if (holons.length >= 2) {
                  startLinkMode(holons[0].id);
                }
              }}
            >
              Link Mode
            </button>
          )}
          <button
            className="px-4 py-2 bg-purple-700 text-white rounded"
            onClick={autoRelate}
          >
            Auto Relate
          </button>
        </div>
        <div
          ref={canvasRef}
          className="relative rounded-2xl border border-white/20 bg-black/20 overflow-hidden select-none"
          style={{ width: W, height: H }}
          onDoubleClick={e => {
            const rect = (e.target as HTMLDivElement).getBoundingClientRect();
            createHolon(e.clientX - rect.left, e.clientY - rect.top);
          }}
        >
          <svg
            xmlns={SVG_NS}
            width={W}
            height={H}
            className="absolute top-0 left-0 pointer-events-none"
          >
            {links.map(link => {
              const from = holons.find(h => h.id === link.from);
              const to = holons.find(h => h.id === link.to);
              if (!from || !to) return null;
              return (
                <line
                  key={link.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke="white"
                  strokeWidth={2}
                />
              );
            })}
          </svg>
          {holons.map(holon => (
            <motion.div
              key={holon.id}
              className="absolute rounded-full bg-purple-600 text-white flex items-center justify-center border border-white/30 cursor-pointer select-none"
              style={{
                width: HOLO_SIZE,
                height: HOLO_SIZE,
                x: holon.x - HOLO_RADIUS,
                y: holon.y - HOLO_RADIUS,
              }}
              drag
              dragMomentum={false}
              onDragEnd={(e, info) => {
                updateHolon(holon.id, {
                  x: holon.x + info.delta.x,
                  y: holon.y + info.delta.y,
                });
              }}
              onDoubleClick={() => deleteHolon(holon.id)}
              onClick={() => {
                if (linkMode.from && linkMode.from !== holon.id) {
                  setLinks([...links, { id: uuid(), from: linkMode.from!, to: holon.id }]);
                  setLinkMode({ from: null });
                }
              }}
            >
              <span className="text-center px-2">{holon.name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
