import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatTime } from '../lib/format';
import type { ActivityStats } from '../lib/types';

/** 標高プロファイル。Action Blue の単色で描く（多色パレットは使わない） */
export function ElevationChart({ stats }: { stats: ActivityStats }) {
  const data = stats.elevation_profile.map((p) => ({
    t: new Date(p.at).getTime(),
    elevation: Math.round(p.elevation_m),
  }));

  if (data.length < 2) {
    return <p className="empty t-caption">標高を持つEXIF写真が足りません（2枚以上必要）。</p>;
  }

  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => formatTime(new Date(v).toISOString())}
            stroke="#7a7a7a"
            tick={{ fontSize: 12 }}
          />
          <YAxis
            unit="m"
            stroke="#7a7a7a"
            tick={{ fontSize: 12 }}
            width={64}
            domain={['dataMin - 50', 'dataMax + 50']}
          />
          <Tooltip
            labelFormatter={(v) => formatTime(new Date(Number(v)).toISOString())}
            formatter={(v: number) => [`${v} m`, '標高']}
          />
          <Line
            type="monotone"
            dataKey="elevation"
            stroke="#0066cc"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
