"use client";

import { useEffect, useRef } from "react";
import type { Map as LMap, LayerGroup } from "leaflet";
import type { CityScore, PlanStop } from "@/lib/agent";

type Props = {
  cities: CityScore[];
  stops: PlanStop[];
  baseline: { label: string; lat: number; lon: number }[];
  home?: { label: string; lat: number; lon: number };
  bbox: [number, number, number, number];
};

export default function TourMap({ cities, stops, baseline, home, bbox }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !el.current || map.current) return;
      L.current = mod;
      const m = mod.map(el.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      mod
        .tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
          attribution: "Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
          maxZoom: 12,
        })
        .addTo(m);
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities, stops, baseline, home, bbox]);

  function draw() {
    const mod = L.current;
    const m = map.current;
    const g = layer.current;
    if (!mod || !m || !g) return;
    g.clearLayers();

    const [x1, y1, x2, y2] = bbox;
    const bounds = stops.length
      ? mod.latLngBounds(stops.map((s) => [s.lat, s.lon] as [number, number]).concat(home ? [[home.lat, home.lon]] : []))
      : mod.latLngBounds([y1, x1], [y2, x2]);
    m.fitBounds(bounds.pad(stops.length ? 0.25 : 0), { animate: false });

    // Taste heat: circle size = affinity, faded for cities already played.
    for (const c of cities.slice(0, 120)) {
      const r = 4 + Math.max(0, c.affinity) * 22;
      mod
        .circleMarker([c.lat, c.lon], {
          radius: r,
          stroke: false,
          fillColor: c.played ? "#8b949e" : "#f2c230",
          fillOpacity: c.played ? 0.35 : 0.25 + c.affinity * 0.5,
        })
        .bindTooltip(
          `<span class="city-tip">${c.city}</span><br/>Taste affinity ${(c.affinity * 100).toFixed(0)}${c.played ? " · already played" : ""}`,
        )
        .addTo(g);
    }

    // What a model guesses without taste data.
    for (const b of baseline) {
      mod
        .circleMarker([b.lat, b.lon], { radius: 7, color: "#5d6673", weight: 2, dashArray: "3 3", fill: false })
        .bindTooltip(`${b.label}<br/>Guess without Qloo`)
        .addTo(g);
    }

    if (stops.length) {
      const pts = [...(home ? [[home.lat, home.lon]] : []), ...stops.map((s) => [s.lat, s.lon])] as [number, number][];
      mod.polyline(pts, { color: "#ffffff", weight: 8, opacity: 0.9 }).addTo(g);
      mod.polyline(pts, { color: "#c8322b", weight: 4 }).addTo(g);
      stops.forEach((s, i) => {
        const icon = mod.divIcon({ className: "", html: `<span class="shield">${i + 1}</span>`, iconSize: [34, 36], iconAnchor: [17, 18] });
        mod.marker([s.lat, s.lon], { icon, title: s.city }).bindTooltip(`${i + 1}. ${s.city}<br/>${s.venue.name}`).addTo(g);
      });
    }
    if (home) {
      const icon = mod.divIcon({ className: "", html: `<span class="shield red">H</span>`, iconSize: [34, 36], iconAnchor: [17, 18] });
      mod.marker([home.lat, home.lon], { icon, title: `Start: ${home.label}` }).bindTooltip(`Start: ${home.label}`).addTo(g);
    }
  }

  return <div ref={el} className="h-full w-full" role="img" aria-label="Map of taste affinity by city and the planned route" />;
}
