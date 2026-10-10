// Tour regions. The polygon goes to Qloo as `filter.location` (WKT), the country list filters our city table.
export type Region = {
  id: string;
  label: string;
  countries: string[];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
};

export const REGIONS: Region[] = [
  { id: "na", label: "US & Canada", countries: ["US", "CA"], bbox: [-125, 24, -66, 50] },
  { id: "uk", label: "UK & Ireland", countries: ["GB", "IE"], bbox: [-10.7, 49.8, 1.9, 59.5] },
  {
    id: "eu",
    label: "Western Europe",
    countries: ["DE", "FR", "NL", "BE", "ES", "PT", "IT", "CH", "AT", "DK", "SE", "NO", "PL", "CZ"],
    bbox: [-9.6, 36, 24, 60],
  },
  { id: "anz", label: "Australia & NZ", countries: ["AU", "NZ"], bbox: [113, -47, 179, -10] },
  { id: "jk", label: "Japan & Korea", countries: ["JP", "KR"], bbox: [124, 30, 146, 44] },
];

export function regionById(id: string) {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0];
}

export function regionWkt(r: Region) {
  const [x1, y1, x2, y2] = r.bbox;
  return `POLYGON((${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1}))`;
}
