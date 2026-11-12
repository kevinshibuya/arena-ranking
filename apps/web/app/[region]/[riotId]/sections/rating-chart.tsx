'use client';

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';

export interface RatingPoint {
  /** 1 for the first rated game in the scope. */
  game: number;
  rating: number;
  /** When the game ended, already written for the tooltip. */
  when: string;
}

/** The rating after each rated game, one point per game. */
export function RatingChart({ points }: { points: RatingPoint[] }) {
  return (
    <LineChart responsive data={points} style={{ width: '100%', height: 200 }} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
      <CartesianGrid stroke="#e5e5e5" vertical={false} />
      <XAxis dataKey="game" tick={{ fontSize: 12, fill: '#737373' }} tickLine={false} axisLine={{ stroke: '#d4d4d4' }} />
      <YAxis
        domain={['auto', 'auto']}
        width={36}
        tick={{ fontSize: 12, fill: '#737373' }}
        tickLine={false}
        axisLine={false}
        tickFormatter={(value: number) => value.toFixed(0)}
      />
      <Tooltip
        formatter={(value) => [typeof value === 'number' ? value.toFixed(1) : value, 'Rating']}
        labelFormatter={(_, payload) => {
          const point = payload[0]?.payload as RatingPoint | undefined;
          return point ? `Game ${point.game} · ${point.when}` : '';
        }}
      />
      <Line type="monotone" dataKey="rating" stroke="#0369a1" strokeWidth={2} dot={false} isAnimationActive={false} />
    </LineChart>
  );
}
