// Pump.fun Paper Sprint: deterministic paper-trading entry.
// Iteration 6: rare, high-conviction momentum entries with asymmetric exits.
// No clock, no environment, no randomness and no files: decisions depend only on the harness stream.
import { LAMPORTS_PER_SOL, runBot, type OrderInput } from './vendor/makefun-bot.ts';

const STAKE = LAMPORTS_PER_SOL / 80n;
const MIN_BUY = LAMPORTS_PER_SOL / 90n;
const MAX_SLIP = 10_000;
const TP_BPS = 180n;
const SL_BPS = 90n;
const MAX_HOLD_SLOTS = 8;
const FEE_BPS = 125n;

interface Coin {
  mint: string;
  vq0: bigint;
  vt0: bigint;
  buyers: Set<string>;
  spent: bigint;
  devSold: boolean;
  decision: boolean;
  created: number;
  lastTrade: number;
}
interface Held { opened: number; cost: bigint; peak: bigint; }

const coins = new Map<string, Coin>();
const held = new Map<string, Held>();
const selling = new Set<string>();

function sellValue(tokens: bigint, vq: bigint, vt: bigint): bigint {
  if (tokens <= 0n || vt <= 0n) return 0n;
  const q = (tokens * vq) / (vt + tokens);
  return q - (q * FEE_BPS + 9_999n) / 10_000n;
}
function pendingSide(mint: string, state: { pending: Map<string, { order: { mint: string; side: string } }> }, side: string): boolean {
  for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === side) return true;
  return false;
}

await runBot({
  onBatch(state, batch) {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint, vq0: BigInt(e.virtual_quote_reserves), vt0: BigInt(e.virtual_token_reserves),
          buyers: new Set(), spent: 0n, devSold: false, decision: false,
          created: e.slot, lastTrade: e.slot,
        });
      } else if (e.event === 'TradeEvent') {
        let c = coins.get(e.mint);
        if (c === undefined) {
          c = { mint: e.mint, vq0: BigInt(e.virtual_quote_reserves) * 2n,
            vt0: BigInt(e.virtual_token_reserves) * 2n, buyers: new Set(), spent: 0n,
            devSold: false, decision: true, created: e.slot, lastTrade: e.slot };
          coins.set(e.mint, c);
        }
        c.lastTrade = e.slot;
        if (e.is_buy) {
          c.spent += BigInt(e.sol_amount);
          if (e.user !== e.creator) c.buyers.add(e.user);
        } else if (e.user === e.creator) c.devSold = true;
      } else if (e.event === 'CompleteEvent') {
        const c = coins.get(e.mint);
        if (c !== undefined) c.decision = true;
      }
    }

    for (const f of batch.fills) {
      if (f.side === 'buy' && f.status === 'filled' && !held.has(f.mint)) {
        held.set(f.mint, { opened: f.slot, cost: BigInt(f.quote_lamports), peak: 0n });
      }
    }
    for (const mint of [...selling]) if (!pendingSide(mint, state, 'sell')) selling.delete(mint);
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint) && !selling.has(mint) && !pendingSide(mint, state, 'buy')) held.delete(mint);
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();

    for (const [mint, pos] of state.positions) {
      if (orders.length >= cap) break;
      if (selling.has(mint)) continue;
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      const value = sellValue(pos.token_amount, curve.virtual_quote_reserves, curve.virtual_token_reserves) - tx;
      let h = held.get(mint);
      if (h === undefined) { h = { opened: state.slot, cost: pos.cost_lamports, peak: 0n }; held.set(mint, h); }
      if (value > h.peak) h.peak = value;
      const basis = h.cost + tx;
      if (value * 10_000n >= basis * (10_000n + TP_BPS) ||
          value * 10_000n <= basis * (10_000n - SL_BPS) ||
          (h.peak > basis && h.peak * 10_000n >= basis * 10_500n && h.peak * 10_000n >= value * 9_700n) ||
          state.slot - h.opened >= MAX_HOLD_SLOTS) {
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: MAX_SLIP });
        selling.add(mint);
        const c = coins.get(mint);
        if (c !== undefined) c.decision = true;
      }
    }

    let free = state.freeCashLamports() - tx * BigInt(orders.length);
    let slots = state.hello.caps.max_open_positions - state.committedPositionCount();
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      const c = coins.get(e.mint);
      if (c === undefined || c.decision || c.devSold || state.positions.has(e.mint)) continue;
      const curve = state.curves.get(e.mint);
      if (curve === undefined || curve.complete || curve.real_quote_reserves < LAMPORTS_PER_SOL / 2n) continue;
      if (state.slot - c.created > 3 || state.slot - c.lastTrade > 1) { c.decision = true; continue; }
      if (c.buyers.size < 5 || c.spent < LAMPORTS_PER_SOL / 10n) continue;
      const ratio = curve.virtual_quote_reserves * c.vt0;
      const base = c.vq0 * curve.virtual_token_reserves;
      if (ratio < base * 110n / 100n || ratio > base * 500n) { c.decision = true; continue; }
      const max = state.maxBuyLamports(e.mint);
      if (max < MIN_BUY) continue;
      c.decision = true;
      const amount = max < STAKE ? max : STAKE;
      if (orders.length >= cap || slots <= 0 || free < amount + tx || pendingSide(e.mint, state, 'buy')) continue;
      orders.push({ side: 'buy', mint: e.mint, quote_lamports: amount, max_slippage_bps: MAX_SLIP });
      free -= amount + tx;
      slots -= 1;
    }
    return orders;
  },
});
