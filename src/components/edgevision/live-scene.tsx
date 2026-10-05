// EdgeVision — داشبورد تحلیل بلادرنگ
// Copyright © 2026 Parsa Fathi — Apache-2.0

// صحنهٔ زنده — بازتاب SVG فریم‌های بلادرنگ با پس‌زمینهٔ هر صحنه،
// جعبهٔ اشیا، جعبهٔ تشخیص، پوشش ناحیهٔ پایش و خط عبور.

'use client';

import { Play } from 'lucide-react';
import { classLabelFa, faNumber } from '@/lib/edgevision/format';
import type { FrameMsg, SceneKind, Stream } from '@/lib/edgevision/types';

const W = 640;
const H = 360;

const OBJECT_FILL: Record<string, string> = {
  VEHICLE: '#a1a1aa',
  PEDESTRIAN: '#fde68a',
  CYCLIST: '#5eead4',
};

// — — — پس‌زمینهٔ صحنه‌ها — — —

function StreetScene() {
  const joints = Array.from({ length: 20 }, (_, i) => i * 32);
  const stripes = Array.from({ length: 8 }, (_, i) => i);
  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={W} height={H} fill="#131316" />
      <rect x={0} y={0} width={W} height={36} fill="#232328" />
      <rect x={0} y={324} width={W} height={36} fill="#232328" />
      {joints.map((x) => (
        <line key={`t${x}`} x1={x + 16} y1={4} x2={x + 16} y2={32} stroke="#2f2f36" strokeWidth={1.5} />
      ))}
      {joints.map((x) => (
        <line key={`b${x}`} x1={x + 16} y1={328} x2={x + 16} y2={356} stroke="#2f2f36" strokeWidth={1.5} />
      ))}
      <rect x={0} y={36} width={W} height={288} fill="#1b1b20" />
      <line x1={0} y1={44} x2={W} y2={44} stroke="#33333b" strokeWidth={1.5} />
      <line x1={0} y1={316} x2={W} y2={316} stroke="#33333b" strokeWidth={1.5} />
      <line x1={0} y1={180} x2={W} y2={180} stroke="#3a3a42" strokeWidth={3} strokeDasharray="26 20" />
      {stripes.map((i) => (
        <rect key={`c${i}`} x={474 + i * 12} y={48} width={7} height={264} fill="#34343c" opacity={0.85} />
      ))}
    </g>
  );
}

function IntersectionScene() {
  const topStripes = Array.from({ length: 7 }, (_, i) => i);
  const sideStripes = Array.from({ length: 6 }, (_, i) => i);
  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={W} height={H} fill="#232328" />
      <rect x={0} y={100} width={W} height={160} fill="#1b1b20" />
      <rect x={180} y={0} width={280} height={H} fill="#1b1b20" />
      <rect x={180} y={100} width={280} height={160} fill="#1b1b20" />
      <line x1={0} y1={100} x2={180} y2={100} stroke="#2f2f36" strokeWidth={2} />
      <line x1={460} y1={100} x2={W} y2={100} stroke="#2f2f36" strokeWidth={2} />
      <line x1={0} y1={260} x2={180} y2={260} stroke="#2f2f36" strokeWidth={2} />
      <line x1={460} y1={260} x2={W} y2={260} stroke="#2f2f36" strokeWidth={2} />
      <line x1={180} y1={0} x2={180} y2={100} stroke="#2f2f36" strokeWidth={2} />
      <line x1={460} y1={0} x2={460} y2={100} stroke="#2f2f36" strokeWidth={2} />
      <line x1={180} y1={260} x2={180} y2={H} stroke="#2f2f36" strokeWidth={2} />
      <line x1={460} y1={260} x2={460} y2={H} stroke="#2f2f36" strokeWidth={2} />
      <line x1={0} y1={180} x2={168} y2={180} stroke="#3a3a42" strokeWidth={3} strokeDasharray="22 16" />
      <line x1={472} y1={180} x2={W} y2={180} stroke="#3a3a42" strokeWidth={3} strokeDasharray="22 16" />
      <line x1={320} y1={0} x2={320} y2={88} stroke="#3a3a42" strokeWidth={3} strokeDasharray="22 16" />
      <line x1={320} y1={272} x2={320} y2={H} stroke="#3a3a42" strokeWidth={3} strokeDasharray="22 16" />
      {topStripes.map((i) => (
        <rect key={`ts${i}`} x={196 + i * 36} y={54} width={22} height={34} fill="#34343c" opacity={0.85} />
      ))}
      {topStripes.map((i) => (
        <rect key={`bs${i}`} x={196 + i * 36} y={272} width={22} height={34} fill="#34343c" opacity={0.85} />
      ))}
      {sideStripes.map((i) => (
        <rect key={`ls${i}`} x={120} y={118 + i * 22} width={34} height={12} fill="#34343c" opacity={0.85} />
      ))}
      {sideStripes.map((i) => (
        <rect key={`rs${i}`} x={486} y={118 + i * 22} width={34} height={12} fill="#34343c" opacity={0.85} />
      ))}
    </g>
  );
}

function ParkingScene() {
  const topBays = Array.from({ length: 10 }, (_, i) => i);
  const bottomBays = Array.from({ length: 10 }, (_, i) => i);
  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={W} height={H} fill="#1b1b20" />
      <rect x={24} y={22} width={592} height={316} fill="none" stroke="#2b2b32" strokeWidth={2} />
      {topBays.map((i) => (
        <line
          key={`tb${i}`}
          x1={72 + i * 56}
          y1={26}
          x2={72 + i * 56}
          y2={150}
          stroke="#38383f"
          strokeWidth={2.5}
        />
      ))}
      {bottomBays.map((i) => (
        <line
          key={`bb${i}`}
          x1={72 + i * 56}
          y1={210}
          x2={72 + i * 56}
          y2={334}
          stroke="#38383f"
          strokeWidth={2.5}
        />
      ))}
      <line x1={24} y1={180} x2={616} y2={180} stroke="#33333b" strokeWidth={3} strokeDasharray="26 20" />
    </g>
  );
}

function SceneBackground({ scene }: { scene: SceneKind | string }) {
  if (scene === 'INTERSECTION') return <IntersectionScene />;
  if (scene === 'PARKING') return <ParkingScene />;
  return <StreetScene />;
}

// — — — برچسب‌ها و نشان‌ها — — —

function ChipText({
  x,
  y,
  text,
  color,
  bg = 'rgba(24,24,27,0.88)',
  anchor = 'start',
}: {
  x: number;
  y: number;
  text: string;
  color: string;
  bg?: string;
  anchor?: 'start' | 'middle' | 'end';
}) {
  const w = text.length * 5.9 + 12;
  const rx = anchor === 'start' ? x - 4 : anchor === 'middle' ? x - w / 2 : x - w + 4;
  return (
    <g>
      <rect x={rx} y={y - 11} width={w} height={15} rx={3} fill={bg} stroke="#3f3f46" strokeWidth={0.75} />
      <text x={x} y={y} fill={color} fontSize={10.5} fontWeight={500} textAnchor={anchor} direction="rtl">
        {text}
      </text>
    </g>
  );
}

export interface LiveSceneProps {
  stream: Stream;
  frame: FrameMsg | null;
  running: boolean;
  /** نشان «داده‌های کهنه» وقتی بیش از ۵ ثانیه فریمی نرسیده است. */
  stale?: boolean;
  /** جهت حرکت هر شیء (oid → -۱/۰/+۱) — از تاریخچهٔ فریم‌ها در والد محاسبه می‌شود. */
  objectDirs?: Record<string, number>;
  className?: string;
}

export function LiveScene({ stream, frame, running, stale = false, objectDirs = {}, className }: LiveSceneProps) {
  const objects = (frame?.objects ?? []).slice(0, 64);
  const detections = (frame?.detections ?? []).slice(0, 64);

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-zinc-800 bg-[#131316] ${className ?? ''}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`پیش‌نمایش زندهٔ استریم ${stream.name}`}
        style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `${W} / ${H}` }}
      >
        <SceneBackground scene={stream.scene} />

        {/* ناحیهٔ پایش (ROI) */}
        {stream.roi && (
          <g>
            <rect
              x={stream.roi.x * W}
              y={stream.roi.y * H}
              width={stream.roi.w * W}
              height={stream.roi.h * H}
              fill="rgba(245,158,11,0.05)"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="7 5"
              rx={3}
            />
            <text
              x={stream.roi.x * W + 6}
              y={stream.roi.y * H + 14}
              fill="#fbbf24"
              fontSize={11}
              fontWeight={500}
            >
              ناحیهٔ پایش
            </text>
          </g>
        )}

        {/* خط عبور */}
        {stream.line && (
          <g>
            <line
              x1={stream.line.x1 * W}
              y1={stream.line.y1 * H}
              x2={stream.line.x2 * W}
              y2={stream.line.y2 * H}
              stroke="#2dd4bf"
              strokeWidth={2}
              strokeDasharray="9 6"
            />
            <text
              x={((stream.line.x1 + stream.line.x2) / 2) * W}
              y={((stream.line.y1 + stream.line.y2) / 2) * H - 7}
              fill="#5eead4"
              fontSize={11}
              fontWeight={500}
              textAnchor="middle"
            >
              خط عبور
            </text>
          </g>
        )}

        {/* اشیا — جعبه‌های گرد با رنگ دسته + نشان جهت */}
        {objects.map((o) => {
          const fill = OBJECT_FILL[o.t] ?? '#a1a1aa';
          const dir = objectDirs[String(o.oid)] ?? 0;
          const x = o.x * W;
          const y = o.y * H;
          const w = Math.max(8, o.w * W);
          const h = Math.max(8, o.h * H);
          return (
            <g
              key={String(o.oid)}
              style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 160ms linear' }}
            >
              <rect width={w} height={h} rx={4} fill={fill} opacity={0.88} stroke="rgba(0,0,0,0.4)" strokeWidth={1} />
              {dir !== 0 && (
                <polygon
                  points={
                    dir > 0
                      ? `${w - 2},${h / 2 - 5} ${w + 5},${h / 2} ${w - 2},${h / 2 + 5}`
                      : `2,${h / 2 - 5} -5,${h / 2} 2,${h / 2 + 5}`
                  }
                  fill={fill}
                  stroke="rgba(0,0,0,0.4)"
                  strokeWidth={0.75}
                />
              )}
            </g>
          );
        })}

        {/* تشخیص‌ها — قاب زمرّد + برچسب */}
        {detections.map((d) => {
          const x = d.x * W;
          const y = d.y * H;
          const w = Math.max(8, d.w * W);
          const h = Math.max(8, d.h * H);
          const label = `${classLabelFa(String(d.label))} ٪${faNumber(Math.round(d.conf * 100))}`;
          return (
            <g
              key={d.trackId}
              style={{ transform: `translate(${x}px, ${y}px)`, transition: 'transform 160ms linear' }}
            >
              <rect width={w} height={h} rx={3} fill="none" stroke="#10b981" strokeWidth={1.75} />
              {y > 18 ? (
                <ChipText x={0} y={-6} text={label} color="#a7f3d0" bg="rgba(6,78,59,0.88)" />
              ) : (
                <ChipText x={0} y={h + 12} text={label} color="#a7f3d0" bg="rgba(6,78,59,0.88)" />
              )}
            </g>
          );
        })}

        {/* نشان فریم و تأخیر */}
        {frame && (
          <g>
            <ChipText
              x={8}
              y={344}
              text={`فریم ${faNumber(frame.frameIndex)}`}
              color="#d4d4d8"
            />
            {frame.latencyMs !== null && frame.latencyMs !== undefined && (
              <ChipText
                x={110}
                y={344}
                text={`تأخیر ${faNumber(Math.round(frame.latencyMs))} میلی‌ثانیه`}
                color="#a1a1aa"
              />
            )}
          </g>
        )}
      </svg>

      {stale && running && (
        <span className="absolute start-2 top-2 rounded-md border border-amber-900/60 bg-amber-950/70 px-2 py-0.5 text-xs font-medium text-amber-300">
          داده‌های کهنه
        </span>
      )}

      {!running && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/55 backdrop-blur-[1px]">
          <div className="flex size-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
            <Play className="size-6 text-zinc-400" aria-hidden="true" />
          </div>
          <p className="text-sm text-zinc-300">استریم در حال اجرا نیست</p>
        </div>
      )}

      {running && !frame && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/35">
          <p className="rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-1.5 text-xs text-zinc-400">
            در انتظار نخستین فریم…
          </p>
        </div>
      )}
    </div>
  );
}
