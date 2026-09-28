/** GOST 23360-78 prismatic keys: shaft range (over, up to] → key width b and hub slot depth t2, mm. */
const table: [number, number, number, number][] = [
  [6, 8, 2, 1], [8, 10, 3, 1.4], [10, 12, 4, 1.8], [12, 17, 5, 2.3], [17, 22, 6, 2.8], [22, 30, 8, 3.3],
  [30, 38, 10, 3.3], [38, 44, 12, 3.3], [44, 50, 14, 3.8], [50, 58, 16, 4.3], [58, 65, 18, 4.4],
  [65, 75, 20, 4.9], [75, 85, 22, 5.4], [85, 95, 25, 5.4], [95, 110, 28, 6.4],
];

export interface StandardKeyway { width: number; depth: number; standard: 'GOST 23360-78' }

/** Nominal slot for a bore; null outside the tabulated 6–110 mm range. Tolerances stay in the manufacturing card. */
export function standardKeyway(bore: number): StandardKeyway | null {
  const row = table.find(([over, upTo]) => bore > over && bore <= upTo);
  return row ? { width: row[2], depth: row[3], standard: 'GOST 23360-78' } : null;
}
