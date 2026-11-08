# TivaroMarket

Self-hosted aplikacja do handlu na wszystkich rynkach (krypto, akcje, ETF, indeksy, forex, surowce), w której **decyzje podejmują agenci AI** (Claude, Gemini, OpenAI/Codex, dowolny model przez OpenRouter albo agent CLI przez MCP), a **każda decyzja jest zapisywana i rozliczana w ciągłym forward teście**, czyli na danych, które pojawiają się dopiero po niej.

> ⚠️ To narzędzie badawcze i paper trading. Nie jest poradą inwestycyjną. Żaden model AI nie gwarantuje zysku. Forward test istnieje właśnie po to, żeby uczciwie sprawdzić, czy agent ma przewagę, **zanim** w grę wejdą prawdziwe pieniądze.

## Co robi

- **Research AI**: agent dostaje zwięzły brief: analizę techniczną na kilku interwałach (EMA 20/50/200, RSI, MACD, ADX, Supertrend, Bollinger + squeeze, ATR, Stochastic, CCI, MFI, VWAP, Donchian, pivoty, wolumen), fundamenty, newsy powiązane z instrumentem, kalendarz makro i wyników, on-chain, funding/open interest, wieloryby, makro z FRED i **własny dotychczasowy wynik** (kalibracja pewności, największe błędy). Opcjonalnie model sam szuka newsów w sieci (Claude web search, Gemini Google Search, OpenAI web search, OpenRouter `:online`).
- **Decyzje**: `buy` / `sell` / `hold` / `close` z pewnością, SL, TP, horyzontem i uzasadnieniem po polsku.
- **Silnik ryzyka**: wielkość pozycji liczona ze stop lossa (domyślnie 1% kapitału na transakcję), limity ekspozycji per klasa aktywów, dzienny limit straty, maks. obsunięcie, kill switch. AI proponuje, ryzyko decyduje.
- **Forward test (codziennie + na każdym interwale)**: wejście po otwarciu pierwszej świecy *po* decyzji (zero look-ahead), konserwatywnie SL przed TP w tej samej świecy, luki cenowe, prowizja i poślizg. Statystyki: zwrot portfela papierowego, max DD, win rate, profit factor, średnie R, trafność kierunku, trafność „trzymaj”, kalibracja pewności. Podział per agent, interwał i klasa aktywów.
- **Ranking modeli**: wszyscy agenci (wbudowani i z CLI) na tych samych danych + **baseline bez AI** jako punkt odniesienia. Jeśli model nie bije baseline'u, nie ma przewagi.
- **Replay**: odtworzenie agenta na historii z danymi dostępnymi w danym momencie (osobno od wyników na żywo).
- **Dashboard** (Next.js): pulpit, rynki z wykresem świecowym i nakładkami wskaźników oraz znacznikami decyzji, dziennik decyzji, forward test z krzywą kapitału i kalibracją, agenci, kalendarz, newsy/on-chain/wieloryby, ustawienia ryzyka i statusy źródeł.

## Architektura

```
apps/worker   API (node:http) + harmonogram: świece po zamknięciu każdej świecy → rozliczenie → agenci; feedy; raport dzienny 00:10 UTC
apps/mcp      serwer MCP (stdio) dla Claude Code / Codex CLI / Gemini CLI / Claude Desktop
apps/web      dashboard Next.js 15 + Tailwind 4 + lightweight-charts (proxy /api → worker, token zostaje po stronie serwera)
packages/core wskaźniki, snapshot techniczny, forward test, metryki, ryzyko, portfel papierowy, walidacja decyzji
packages/data dostawcy danych (świece, newsy, kalendarze, on-chain, wieloryby, fundamenty) + rejestr statusów kluczy
packages/db   SQLite (wbudowane w Node 22, jeden plik, łatwy backup)
packages/agents klienci LLM, budowa briefu, prompt, baseline, runner
```

Silnik nie ma żadnych zewnętrznych zależności runtime (Node 22.18+ uruchamia TypeScript bezpośrednio).

## Szybki start

```bash
pnpm install
cp .env.example .env          # dodaj klucze, które masz (wszystkie są opcjonalne)
pnpm demo                     # offline demo na danych syntetycznych (sprawdza cały pipeline)
pnpm worker                   # API :8787 + harmonogram (prawdziwe dane)
pnpm dev:web                  # dashboard http://localhost:3000
```

Na serwerze 24/7: `docker compose up -d --build` (worker + web, baza w `./data`). Ustaw `TIVARO_API_TOKEN`.

## Źródła danych

| Co | Źródło | Klucz |
|---|---|---|
| Krypto świece | Binance (fallback Bybit) | – |
| Akcje, ETF, indeksy, FX, surowce, GPW | Yahoo Finance (nieoficjalne) | – |
| Akcje/ETF USA (dokładniej) | Alpaca | `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY` (darmowe) |
| Forex, metale, CFD indeksy/surowce | OANDA v20 | `OANDA_API_TOKEN` (konto demo wystarczy) |
| Newsy | RSS (CoinDesk, Cointelegraph, CNBC, MarketWatch, Yahoo, FXStreet, Investing, Fed, ECB, OilPrice), GDELT (geopolityka) | – |
| Newsy rynkowe/spółek | Finnhub, Alpaca/Benzinga, CryptoPanic | `FINNHUB_API_KEY`, Alpaca, `CRYPTOPANIC_API_KEY` |
| Kalendarz makro | Forex Factory (tydzień bieżący + następny) | – |
| Kalendarz wyników + fundamenty | Finnhub | `FINNHUB_API_KEY` |
| Makro (rentowności, CPI, Fed, VIX, USD, HY spread) | FRED | `FRED_API_KEY` |
| Sentyment, on-chain, DeFi | Fear & Greed, mempool.space, DefiLlama (TVL, podaż stablecoinów), funding i OI z Binance Futures | – |
| ETH gas | Etherscan | `ETHERSCAN_API_KEY` |
| Wieloryby | Whale Alert | `WHALE_ALERT_API_KEY` |

Statusy wszystkich źródeł widać w **Ustawienia → Źródła danych**. Brakujące klucze = źródło nieaktywne; nic nie jest zmyślane.

### XTB

XTB wyłączył publiczne API (xAPI) 14 marca 2025, więc nie da się tam automatycznie składać zleceń ani pobierać notowań. Instrumenty oznaczone `XTB (ręcznie)` mają notowania z Yahoo/OANDA, a sygnały wykonujesz sam w xStation.

## Agenci

- **Wbudowani przez API**: dodaj w zakładce *Agenci* (dostawca, model, interwały, web search, profil strategii). Harmonogram uruchamia ich po zamknięciu świecy na ich interwałach (dla LLM nie częściej niż co 15 min). Instrumenty są pakowane po 8 w jedno wywołanie, żeby oszczędzać tokeny.
- **CLI przez MCP**: Claude Code, Codex CLI, Gemini CLI. Dostają te same narzędzia: `get_market_brief`, `get_candles`, `get_indicators`, `get_news`, `get_calendar`, `get_onchain`, `get_whales`, `submit_decisions`, `get_track_record`, `get_leaderboard`.

```bash
claude mcp add tivaromarket -e TIVARO_AGENT_ID=claude-code -- node /ścieżka/tivaromarket/apps/mcp/src/main.ts
```

Konfiguracje dla Codex i Gemini są w zakładce *Agenci* w dashboardzie.

## Jak liczony jest forward test

1. Decyzja ma znacznik czasu. Brief agenta zawiera tylko **zamknięte** świece sprzed tej chwili.
2. Wejście: otwarcie pierwszej świecy, która zaczęła się po decyzji (albo limit, jeśli podano `entryPrice`).
3. Wyjście: SL / TP (luka = fill po otwarciu; SL i TP w jednej świecy → zakładamy SL), albo zamknięcie po `horizonBars` świecach.
4. Prowizja (domyślnie 5 bps/strona) i poślizg (2 bps) są odejmowane.
5. Otwarte pozycje są wyceniane po ostatnim zamknięciu; worker przelicza je po każdej nowej świecy, a raz dziennie przelicza wszystko od nowa i zapisuje raport.
6. Portfel papierowy odtwarza „co by było, gdybym słuchał agenta” z regułami ryzyka (wielkość pozycji, limity, nakładanie się pozycji).

## Testy

```bash
pnpm test        # 20 testów: wskaźniki (m.in. RSI vs referencja Wildera), forward test, ryzyko, baza, parsery, agenci, API + MCP end-to-end
pnpm typecheck
```

## Plan dalej

- Realne zlecenia przez Alpaca paper/live i OANDA z ręcznym zatwierdzaniem i limitami (po sprawdzeniu agentów w forward teście).
- Import historii transakcji z XTB (CSV) do porównania z decyzjami AI.
- Powiadomienia (Telegram/Discord) o nowych decyzjach i wydarzeniach.
- Komitet agentów (kilka modeli głosuje, decyzja wg wagi z wyników forward testu).
