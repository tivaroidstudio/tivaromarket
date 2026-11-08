/**
 * Storage on Node's built-in SQLite (no native deps, one file, easy backups).
 * The worker is the only writer; web + MCP talk to the worker's HTTP API.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CalendarEvent, Candle, Decision, DecisionResult, Fundamentals, Instrument, NewsItem, OnchainMetric, Timeframe, WhaleTx,
} from '@tivaro/core';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS instruments (
  id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL, asset_class TEXT NOT NULL,
  provider TEXT NOT NULL, provider_symbol TEXT, quote TEXT, venue TEXT, tags TEXT, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS candles (
  instrument_id TEXT NOT NULL, tf TEXT NOT NULL, t INTEGER NOT NULL,
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
  PRIMARY KEY (instrument_id, tf, t)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, url TEXT,
  summary TEXT, symbols TEXT, sentiment REAL
);
CREATE INDEX IF NOT EXISTS news_ts ON news(ts DESC);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, country TEXT, symbol TEXT,
  importance INTEGER NOT NULL, actual TEXT, forecast TEXT, previous TEXT, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS onchain (
  key TEXT NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL, source TEXT NOT NULL, meta TEXT,
  PRIMARY KEY (key, ts)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS whales (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, chain TEXT NOT NULL, symbol TEXT NOT NULL, amount REAL NOT NULL,
  amount_usd REAL NOT NULL, from_owner TEXT, to_owner TEXT, flow TEXT NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS whales_ts ON whales(ts DESC);
CREATE TABLE IF NOT EXISTS fundamentals (
  instrument_id TEXT NOT NULL, ts INTEGER NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (instrument_id, source)
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER,
  status TEXT NOT NULL, scope TEXT, input_tokens INTEGER, output_tokens INTEGER, decisions INTEGER DEFAULT 0,
  error TEXT, summary TEXT
);
CREATE INDEX IF NOT EXISTS runs_started ON agent_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, model TEXT, instrument_id TEXT NOT NULL, tf TEXT NOT NULL,
  action TEXT NOT NULL, confidence REAL NOT NULL, entry_price REAL, stop_loss REAL, take_profit REAL,
  horizon_bars INTEGER NOT NULL, size_pct REAL, rationale TEXT NOT NULL, evidence TEXT, sources TEXT,
  created_at INTEGER NOT NULL, price_at_decision REAL, mode TEXT NOT NULL DEFAULT 'live', run_id TEXT,
  risk_approved INTEGER, risk_size_pct REAL, risk_reasons TEXT
);
CREATE INDEX IF NOT EXISTS decisions_created ON decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS decisions_instr ON decisions(instrument_id, tf);
CREATE TABLE IF NOT EXISTS decision_results (
  decision_id TEXT PRIMARY KEY REFERENCES decisions(id) ON DELETE CASCADE, status TEXT NOT NULL, side TEXT NOT NULL,
  entry_time INTEGER, entry_price REAL, exit_time INTEGER, exit_price REAL, exit_reason TEXT,
  return_pct REAL NOT NULL, r_multiple REAL, mfe_pct REAL, mae_pct REAL, bars_held INTEGER,
  horizon_move_pct REAL, direction_correct INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS job_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, job TEXT NOT NULL, ok INTEGER NOT NULL, message TEXT
);
`;

type Row = Record<string, unknown>;
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
const pj = <T>(v: unknown): T | undefined => (typeof v === 'string' && v ? (JSON.parse(v) as T) : undefined);
const n = (v: unknown) => (v === null || v === undefined ? undefined : Number(v));

export interface AgentRecord {
  id: string;
  name: string;
  provider: string;
  model: string;
  config: AgentConfig;
  enabled: boolean;
  createdAt: number;
}

export interface AgentConfig {
  /** Instruments the agent covers (ids). Empty = all enabled instruments. */
  instruments?: string[];
  timeframes?: Timeframe[];
  /** Minutes between runs per timeframe; default derived from timeframe. */
  everyMinutes?: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Extra system instructions / strategy description. */
  style?: string;
}

export interface RunRecord {
  id: string;
  agentId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'ok' | 'error';
  scope?: string;
  inputTokens?: number;
  outputTokens?: number;
  decisions?: number;
  error?: string;
  summary?: string;
}

export interface StoredDecision extends Decision {
  runId?: string;
  risk?: { approved: boolean; sizePct: number; reasons: string[] };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path = process.env.TIVARO_DB ?? './data/tivaromarket.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- instruments ----------
  upsertInstrument(i: Instrument, enabled = true) {
    this.db
      .prepare(
        `INSERT INTO instruments (id,symbol,name,asset_class,provider,provider_symbol,quote,venue,tags,enabled)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,asset_class=excluded.asset_class,
         provider=excluded.provider,provider_symbol=excluded.provider_symbol,quote=excluded.quote,venue=excluded.venue,tags=excluded.tags`,
      )
      .run(i.id, i.symbol, i.name, i.assetClass, i.provider, i.providerSymbol ?? null, i.quote ?? null, i.venue ?? null, j(i.tags), enabled ? 1 : 0);
  }

  setInstrumentEnabled(id: string, enabled: boolean) {
    this.db.prepare('UPDATE instruments SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id);
  }

  instruments(onlyEnabled = false): (Instrument & { enabled: boolean })[] {
    const rows = this.db.prepare(`SELECT * FROM instruments ${onlyEnabled ? 'WHERE enabled=1' : ''} ORDER BY asset_class, symbol`).all() as Row[];
    return rows.map(rowToInstrument);
  }

  instrument(id: string): (Instrument & { enabled: boolean }) | undefined {
    const r = this.db.prepare('SELECT * FROM instruments WHERE id=?').get(id) as Row | undefined;
    return r ? rowToInstrument(r) : undefined;
  }

  // ---------- candles ----------
  upsertCandles(instrumentId: string, tf: Timeframe, candles: Candle[]) {
    const st = this.db.prepare(
      `INSERT INTO candles (instrument_id,tf,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(instrument_id,tf,t) DO UPDATE SET o=excluded.o,h=excluded.h,l=excluded.l,c=excluded.c,v=excluded.v`,
    );
    this.tx(() => {
      for (const c of candles) st.run(instrumentId, tf, c.t, c.o, c.h, c.l, c.c, c.v);
    });
    return candles.length;
  }

  /** Candles ascending. `limit` keeps the LATEST n bars, unless `first` is set (then the earliest n after `from`). */
  candles(instrumentId: string, tf: Timeframe, opts: { from?: number; to?: number; limit?: number; first?: boolean } = {}): Candle[] {
    const limit = opts.limit ?? 1000;
    const rows = this.db
      .prepare(
        `SELECT t,o,h,l,c,v FROM candles WHERE instrument_id=? AND tf=? AND t>=? AND t<=? ORDER BY t ${opts.first ? 'ASC' : 'DESC'} LIMIT ?`,
      )
      .all(instrumentId, tf, opts.from ?? 0, opts.to ?? Number.MAX_SAFE_INTEGER, limit) as unknown as Candle[];
    const asc = opts.first ? rows : rows.reverse();
    return asc.map((r) => ({ t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
  }

  lastCandleTime(instrumentId: string, tf: Timeframe): number | undefined {
    const r = this.db.prepare('SELECT MAX(t) AS t FROM candles WHERE instrument_id=? AND tf=?').get(instrumentId, tf) as Row;
    return n(r?.t);
  }

  // ---------- news / events / on-chain / whales / fundamentals ----------
  upsertNews(items: NewsItem[]) {
    const st = this.db.prepare(
      `INSERT INTO news (id,ts,source,title,url,summary,symbols,sentiment) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET summary=COALESCE(excluded.summary,summary), sentiment=COALESCE(excluded.sentiment,sentiment)`,
    );
    this.tx(() => items.forEach((x) => st.run(x.id, x.ts, x.source, x.title, x.url ?? null, x.summary ?? null, j(x.symbols), x.sentiment ?? null)));
    return items.length;
  }

  news(opts: { since?: number; symbol?: string; limit?: number; q?: string } = {}): NewsItem[] {
    const where = ['ts>=?'];
    const args: (string | number)[] = [opts.since ?? 0];
    if (opts.symbol) {
      where.push('symbols LIKE ?');
      args.push(`%"${opts.symbol}"%`);
    }
    if (opts.q) {
      where.push('(title LIKE ? OR summary LIKE ?)');
      args.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    args.push(opts.limit ?? 50);
    const rows = this.db.prepare(`SELECT * FROM news WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`).all(...args) as Row[];
    return rows.map((r) => ({
      id: String(r.id), ts: Number(r.ts), source: String(r.source), title: String(r.title), url: (r.url as string) ?? undefined,
      summary: (r.summary as string) ?? undefined, symbols: pj<string[]>(r.symbols), sentiment: n(r.sentiment),
    }));
  }

  upsertEvents(items: CalendarEvent[]) {
    const st = this.db.prepare(
      `INSERT INTO events (id,ts,kind,title,country,symbol,importance,actual,forecast,previous,source) VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET ts=excluded.ts, actual=excluded.actual, forecast=excluded.forecast, previous=excluded.previous, importance=excluded.importance`,
    );
    const s = (v: unknown) => (v === undefined || v === null ? null : String(v));
    this.tx(() => items.forEach((e) => st.run(e.id, e.ts, e.kind, e.title, e.country ?? null, e.symbol ?? null, e.importance, s(e.actual), s(e.forecast), s(e.previous), e.source)));
    return items.length;
  }

  events(opts: { from?: number; to?: number; minImportance?: number; kind?: string; symbol?: string; limit?: number } = {}): CalendarEvent[] {
    const where = ['ts>=?', 'ts<=?', 'importance>=?'];
    const args: (string | number)[] = [opts.from ?? 0, opts.to ?? Number.MAX_SAFE_INTEGER, opts.minImportance ?? 1];
    if (opts.kind) {
      where.push('kind=?');
      args.push(opts.kind);
    }
    if (opts.symbol) {
      where.push('symbol=?');
      args.push(opts.symbol);
    }
    args.push(opts.limit ?? 200);
    const rows = this.db.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY ts ASC LIMIT ?`).all(...args) as Row[];
    return rows.map((r) => ({
      id: String(r.id), ts: Number(r.ts), kind: r.kind as CalendarEvent['kind'], title: String(r.title),
      country: (r.country as string) ?? undefined, symbol: (r.symbol as string) ?? undefined, importance: Number(r.importance) as 1 | 2 | 3,
      actual: (r.actual as string) ?? null, forecast: (r.forecast as string) ?? null, previous: (r.previous as string) ?? null, source: String(r.source),
    }));
  }

  upsertOnchain(items: OnchainMetric[]) {
    const st = this.db.prepare(
      `INSERT INTO onchain (key,ts,value,source,meta) VALUES (?,?,?,?,?) ON CONFLICT(key,ts) DO UPDATE SET value=excluded.value, meta=excluded.meta`,
    );
    this.tx(() => items.forEach((m) => st.run(m.key, m.ts, m.value, m.source, j(m.meta))));
    return items.length;
  }

  /** Latest value per metric key (optionally filtered by prefix), plus value ~24h earlier for change. */
  onchainLatest(prefix = ''): (OnchainMetric & { prev24h?: number })[] {
    const rows = this.db
      .prepare(
        `SELECT o.* FROM onchain o JOIN (SELECT key, MAX(ts) mts FROM onchain WHERE key LIKE ? GROUP BY key) m
         ON o.key=m.key AND o.ts=m.mts ORDER BY o.key`,
      )
      .all(`${prefix}%`) as Row[];
    const prevSt = this.db.prepare('SELECT value FROM onchain WHERE key=? AND ts<=? ORDER BY ts DESC LIMIT 1');
    return rows.map((r) => {
      const prev = prevSt.get(String(r.key), Number(r.ts) - 86_400_000 + 3_600_000) as Row | undefined;
      return { key: String(r.key), ts: Number(r.ts), value: Number(r.value), source: String(r.source), meta: pj(r.meta), prev24h: n(prev?.value) };
    });
  }

  onchainSeries(key: string, since = 0): OnchainMetric[] {
    return (this.db.prepare('SELECT * FROM onchain WHERE key=? AND ts>=? ORDER BY ts').all(key, since) as Row[]).map((r) => ({
      key: String(r.key), ts: Number(r.ts), value: Number(r.value), source: String(r.source),
    }));
  }

  upsertWhales(items: WhaleTx[]) {
    const st = this.db.prepare(
      `INSERT OR IGNORE INTO whales (id,ts,chain,symbol,amount,amount_usd,from_owner,to_owner,flow,source) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    this.tx(() => items.forEach((w) => st.run(w.id, w.ts, w.chain, w.symbol, w.amount, w.amountUsd, w.from ?? null, w.to ?? null, w.flow, w.source)));
    return items.length;
  }

  whales(opts: { since?: number; symbol?: string; minUsd?: number; limit?: number } = {}): WhaleTx[] {
    const rows = this.db
      .prepare(`SELECT * FROM whales WHERE ts>=? AND amount_usd>=? ${opts.symbol ? 'AND symbol=?' : ''} ORDER BY ts DESC LIMIT ?`)
      .all(...([opts.since ?? 0, opts.minUsd ?? 0, ...(opts.symbol ? [opts.symbol] : []), opts.limit ?? 100] as (string | number)[])) as Row[];
    return rows.map((r) => ({
      id: String(r.id), ts: Number(r.ts), chain: String(r.chain), symbol: String(r.symbol), amount: Number(r.amount), amountUsd: Number(r.amount_usd),
      from: (r.from_owner as string) ?? undefined, to: (r.to_owner as string) ?? undefined, flow: r.flow as WhaleTx['flow'], source: String(r.source),
    }));
  }

  upsertFundamentals(f: Fundamentals) {
    this.db
      .prepare(`INSERT INTO fundamentals (instrument_id,ts,source,data) VALUES (?,?,?,?) ON CONFLICT(instrument_id,source) DO UPDATE SET ts=excluded.ts, data=excluded.data`)
      .run(f.instrumentId, f.ts, f.source, JSON.stringify(f.data));
  }

  fundamentals(instrumentId: string): Fundamentals[] {
    return (this.db.prepare('SELECT * FROM fundamentals WHERE instrument_id=?').all(instrumentId) as Row[]).map((r) => ({
      instrumentId: String(r.instrument_id), ts: Number(r.ts), source: String(r.source), data: JSON.parse(String(r.data)),
    }));
  }

  // ---------- agents & runs ----------
  upsertAgent(a: Omit<AgentRecord, 'createdAt'> & { createdAt?: number }) {
    this.db
      .prepare(
        `INSERT INTO agents (id,name,provider,model,config,enabled,created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider=excluded.provider, model=excluded.model, config=excluded.config, enabled=excluded.enabled`,
      )
      .run(a.id, a.name, a.provider, a.model, JSON.stringify(a.config ?? {}), a.enabled ? 1 : 0, a.createdAt ?? Date.now());
  }

  agents(): AgentRecord[] {
    return (this.db.prepare('SELECT * FROM agents ORDER BY created_at').all() as Row[]).map((r) => ({
      id: String(r.id), name: String(r.name), provider: String(r.provider), model: String(r.model),
      config: JSON.parse(String(r.config)), enabled: !!r.enabled, createdAt: Number(r.created_at),
    }));
  }

  agent(id: string) {
    return this.agents().find((a) => a.id === id);
  }

  deleteAgent(id: string) {
    this.db.prepare('DELETE FROM agents WHERE id=?').run(id);
  }

  startRun(r: Pick<RunRecord, 'id' | 'agentId' | 'scope'>) {
    this.db.prepare(`INSERT INTO agent_runs (id,agent_id,started_at,status,scope) VALUES (?,?,?,?,?)`).run(r.id, r.agentId, Date.now(), 'running', r.scope ?? null);
  }

  finishRun(id: string, f: Partial<RunRecord> & { status: 'ok' | 'error' }) {
    this.db
      .prepare(`UPDATE agent_runs SET finished_at=?, status=?, input_tokens=?, output_tokens=?, decisions=?, error=?, summary=? WHERE id=?`)
      .run(Date.now(), f.status, f.inputTokens ?? null, f.outputTokens ?? null, f.decisions ?? 0, f.error ?? null, f.summary ?? null, id);
  }

  runs(limit = 50, agentId?: string): RunRecord[] {
    const rows = (agentId
      ? this.db.prepare('SELECT * FROM agent_runs WHERE agent_id=? ORDER BY started_at DESC LIMIT ?').all(agentId, limit)
      : this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?').all(limit)) as Row[];
    return rows.map((r) => ({
      id: String(r.id), agentId: String(r.agent_id), startedAt: Number(r.started_at), finishedAt: n(r.finished_at),
      status: r.status as RunRecord['status'], scope: (r.scope as string) ?? undefined, inputTokens: n(r.input_tokens),
      outputTokens: n(r.output_tokens), decisions: n(r.decisions), error: (r.error as string) ?? undefined, summary: (r.summary as string) ?? undefined,
    }));
  }

  lastRunAt(agentId: string, scope: string): number | undefined {
    const r = this.db.prepare(`SELECT MAX(started_at) t FROM agent_runs WHERE agent_id=? AND scope=? AND status!='error'`).get(agentId, scope) as Row;
    return n(r?.t);
  }

  // ---------- decisions ----------
  insertDecision(d: StoredDecision) {
    this.db
      .prepare(
        `INSERT INTO decisions (id,agent_id,model,instrument_id,tf,action,confidence,entry_price,stop_loss,take_profit,horizon_bars,size_pct,
         rationale,evidence,sources,created_at,price_at_decision,mode,run_id,risk_approved,risk_size_pct,risk_reasons)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        d.id, d.agentId, d.model ?? null, d.instrumentId, d.timeframe, d.action, d.confidence, d.entryPrice ?? null, d.stopLoss ?? null,
        d.takeProfit ?? null, d.horizonBars, d.sizePct ?? null, d.rationale, j(d.evidence), j(d.sources), d.createdAt,
        d.priceAtDecision ?? null, d.mode ?? 'live', d.runId ?? null, d.risk ? (d.risk.approved ? 1 : 0) : null,
        d.risk?.sizePct ?? null, j(d.risk?.reasons),
      );
  }

  decisions(opts: { agentId?: string; instrumentId?: string; since?: number; limit?: number; unsettledOnly?: boolean; mode?: string } = {}): StoredDecision[] {
    const where: string[] = ['d.created_at>=?'];
    const args: (string | number)[] = [opts.since ?? 0];
    if (opts.agentId) {
      where.push('d.agent_id=?');
      args.push(opts.agentId);
    }
    if (opts.instrumentId) {
      where.push('d.instrument_id=?');
      args.push(opts.instrumentId);
    }
    if (opts.mode) {
      where.push('d.mode=?');
      args.push(opts.mode);
    }
    if (opts.unsettledOnly) where.push(`(r.status IS NULL OR r.status IN ('pending','open'))`);
    args.push(opts.limit ?? 500);
    const rows = this.db
      .prepare(`SELECT d.* FROM decisions d LEFT JOIN decision_results r ON r.decision_id=d.id WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ?`)
      .all(...args) as Row[];
    return rows.map(rowToDecision);
  }

  decision(id: string): StoredDecision | undefined {
    const r = this.db.prepare('SELECT * FROM decisions WHERE id=?').get(id) as Row | undefined;
    return r ? rowToDecision(r) : undefined;
  }

  saveResult(r: DecisionResult) {
    this.db
      .prepare(
        `INSERT INTO decision_results (decision_id,status,side,entry_time,entry_price,exit_time,exit_price,exit_reason,return_pct,r_multiple,
         mfe_pct,mae_pct,bars_held,horizon_move_pct,direction_correct,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(decision_id) DO UPDATE SET status=excluded.status, side=excluded.side, entry_time=excluded.entry_time, entry_price=excluded.entry_price,
         exit_time=excluded.exit_time, exit_price=excluded.exit_price, exit_reason=excluded.exit_reason, return_pct=excluded.return_pct,
         r_multiple=excluded.r_multiple, mfe_pct=excluded.mfe_pct, mae_pct=excluded.mae_pct, bars_held=excluded.bars_held,
         horizon_move_pct=excluded.horizon_move_pct, direction_correct=excluded.direction_correct, updated_at=excluded.updated_at`,
      )
      .run(
        r.decisionId, r.status, r.side, r.entryTime ?? null, r.entryPrice ?? null, r.exitTime ?? null, r.exitPrice ?? null, r.exitReason,
        r.returnPct, r.rMultiple, r.mfePct, r.maePct, r.barsHeld, r.horizonMovePct, r.directionCorrect === null ? null : r.directionCorrect ? 1 : 0, r.updatedAt,
      );
  }

  /** Decisions joined with their latest forward-test result. */
  scored(opts: { agentId?: string; since?: number; limit?: number; mode?: string } = {}): { decision: StoredDecision; result: DecisionResult; assetClass: Instrument['assetClass'] }[] {
    const where = ['d.created_at>=?'];
    const args: (string | number)[] = [opts.since ?? 0];
    if (opts.agentId) {
      where.push('d.agent_id=?');
      args.push(opts.agentId);
    }
    if (opts.mode) {
      where.push('d.mode=?');
      args.push(opts.mode);
    }
    args.push(opts.limit ?? 100_000);
    const rows = this.db
      .prepare(
        `SELECT d.*, r.status r_status, r.side r_side, r.entry_time, r.entry_price r_entry, r.exit_time, r.exit_price, r.exit_reason, r.return_pct,
         r.r_multiple, r.mfe_pct, r.mae_pct, r.bars_held, r.horizon_move_pct, r.direction_correct, r.updated_at, i.asset_class
         FROM decisions d JOIN decision_results r ON r.decision_id=d.id LEFT JOIN instruments i ON i.id=d.instrument_id
         WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ?`,
      )
      .all(...args) as Row[];
    return rows.map((r) => ({
      decision: rowToDecision(r),
      assetClass: (r.asset_class as Instrument['assetClass']) ?? 'other',
      result: {
        decisionId: String(r.id), status: r.r_status as DecisionResult['status'], side: r.r_side as DecisionResult['side'],
        entryTime: n(r.entry_time), entryPrice: n(r.r_entry), exitTime: n(r.exit_time), exitPrice: n(r.exit_price),
        exitReason: (r.exit_reason as DecisionResult['exitReason']) ?? null, returnPct: Number(r.return_pct), rMultiple: r.r_multiple === null ? null : Number(r.r_multiple),
        mfePct: Number(r.mfe_pct ?? 0), maePct: Number(r.mae_pct ?? 0), barsHeld: Number(r.bars_held ?? 0),
        horizonMovePct: r.horizon_move_pct === null ? null : Number(r.horizon_move_pct),
        directionCorrect: r.direction_correct === null ? null : !!r.direction_correct, updatedAt: Number(r.updated_at),
      },
    }));
  }

  // ---------- settings & logs ----------
  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined;
    return r ? (JSON.parse(String(r.value)) as T) : fallback;
  }

  setSetting(key: string, value: unknown) {
    this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }

  log(job: string, ok: boolean, message?: string) {
    this.db.prepare('INSERT INTO job_log (ts,job,ok,message) VALUES (?,?,?,?)').run(Date.now(), job, ok ? 1 : 0, message?.slice(0, 2000) ?? null);
    this.db.prepare('DELETE FROM job_log WHERE id < (SELECT MAX(id) - 5000 FROM job_log)').run();
  }

  logs(limit = 100) {
    return (this.db.prepare('SELECT * FROM job_log ORDER BY id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      ts: Number(r.ts), job: String(r.job), ok: !!r.ok, message: (r.message as string) ?? undefined,
    }));
  }
}

function rowToInstrument(r: Row): Instrument & { enabled: boolean } {
  return {
    id: String(r.id), symbol: String(r.symbol), name: String(r.name), assetClass: r.asset_class as Instrument['assetClass'],
    provider: String(r.provider), providerSymbol: (r.provider_symbol as string) ?? undefined, quote: (r.quote as string) ?? undefined,
    venue: (r.venue as string) ?? undefined, tags: pj<string[]>(r.tags), enabled: !!r.enabled,
  };
}

function rowToDecision(r: Row): StoredDecision {
  return {
    id: String(r.id), agentId: String(r.agent_id), model: (r.model as string) ?? undefined, instrumentId: String(r.instrument_id),
    timeframe: r.tf as Timeframe, action: r.action as Decision['action'], confidence: Number(r.confidence),
    entryPrice: n(r.entry_price), stopLoss: n(r.stop_loss), takeProfit: n(r.take_profit), horizonBars: Number(r.horizon_bars),
    sizePct: n(r.size_pct), rationale: String(r.rationale), evidence: pj<string[]>(r.evidence), sources: pj<string[]>(r.sources),
    createdAt: Number(r.created_at), priceAtDecision: n(r.price_at_decision), mode: r.mode as Decision['mode'], runId: (r.run_id as string) ?? undefined,
    risk: r.risk_approved === null || r.risk_approved === undefined ? undefined : { approved: !!r.risk_approved, sizePct: Number(r.risk_size_pct ?? 0), reasons: pj<string[]>(r.risk_reasons) ?? [] },
  };
}
