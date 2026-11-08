'use client';
import { useEffect, useRef } from 'react';
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart, createSeriesMarkers,
  type IChartApi, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface Overlay { name: string; color: string; values: (number | null)[]; t: number[]; dashed?: boolean }
export interface Marker { t: number; side: 'buy' | 'sell' | 'hold' | 'close'; text?: string }

const ts = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

export function PriceChart({ candles, overlays = [], markers = [], height = 460 }: { candles: Candle[]; overlays?: Overlay[]; markers?: Marker[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#7d8896', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(30,38,50,0.5)' }, horzLines: { color: 'rgba(30,38,50,0.5)' } },
      rightPriceScale: { borderColor: '#1e2632' },
      timeScale: { borderColor: '#1e2632', timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#1fc77e', downColor: '#ff4d5e', wickUpColor: '#1fc77e', wickDownColor: '#ff4d5e', borderVisible: false,
    });
    candleSeries.setData(candles.map((c) => ({ time: ts(c.t), open: c.o, high: c.h, low: c.l, close: c.c })));

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: ts(c.t), value: c.v, color: c.c >= c.o ? 'rgba(31,199,126,0.25)' : 'rgba(255,77,94,0.25)' })));

    for (const o of overlays) {
      const s = chart.addSeries(LineSeries, { color: o.color, lineWidth: 1, lineStyle: o.dashed ? 2 : 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(o.t.map((t, i) => ({ time: ts(t), value: o.values[i] })).filter((p): p is { time: UTCTimestamp; value: number } => p.value !== null && Number.isFinite(p.value)));
    }

    if (markers.length && candles.length) {
      // snap markers to the bar they fall into
      const bars = candles.map((c) => c.t);
      const snap = (t: number) => {
        let lo = 0;
        let hi = bars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (bars[mid] <= t) lo = mid;
          else hi = mid - 1;
        }
        return bars[lo];
      };
      const ms: SeriesMarker<Time>[] = markers
        .filter((m) => m.t >= bars[0] && m.side !== 'hold')
        .map((m) => ({
          time: ts(snap(m.t)),
          position: m.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
          color: m.side === 'buy' ? '#1fc77e' : m.side === 'sell' ? '#ff4d5e' : '#f5b83d',
          shape: m.side === 'buy' ? ('arrowUp' as const) : m.side === 'sell' ? ('arrowDown' as const) : ('circle' as const),
          text: m.text,
        }))
        .sort((a, b) => (a.time as number) - (b.time as number));
      createSeriesMarkers(candleSeries, ms);
    }
    chart.timeScale().fitContent();
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, overlays, markers, height]);

  return <div ref={el} style={{ height }} className="w-full" />;
}

export function LineChart({ points, height = 220, color = '#5b8cff', baseline }: { points: { t: number; v: number }[]; height?: number; color?: string; baseline?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#7d8896' },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(30,38,50,0.5)' } },
      rightPriceScale: { borderColor: '#1e2632' },
      timeScale: { borderColor: '#1e2632', timeVisible: true },
    });
    const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false });
    const seen = new Set<number>();
    const data = points
      .map((p) => ({ time: ts(p.t), value: p.v }))
      .sort((a, b) => a.time - b.time)
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)));
    s.setData(data);
    if (baseline !== undefined) s.createPriceLine({ price: baseline, color: '#7d8896', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, height, color, baseline]);
  return <div ref={el} style={{ height }} className="w-full" />;
}
