# Journeyman — Core Model Pseudocode

Settlement: 3rd-party cash venues only. Steam prices excluded from all math.

---

## 1. Pricing layer

```
struct Quote {
  ask        // avg of asks across venues, liquidity-filtered
  bid_net    // avg of (bid - venue seller fee) across venues
  listings   // [{venue, price, float, url}] for completion buys
}

price(skin_id, wear, stat_trak) -> Quote

// Venue filter: drop venues with < MIN_LISTINGS for the item.
// ask feeds BUY side (completions). bid_net feeds SELL side (baselines).
// Never blend the two into one number.
```

## 2. Valuation

```
value(inventory_skin)   = bid_net(skin)        // sell-now baseline
cost(owned_skin_in_slot) = bid_net(skin)       // opportunity cost
cost(bought_skin_in_slot) = ask(skin)          // completion buy
```

## 3. Contract math (single trade-up)

```
// Inputs: 10 skins, same rarity R, count vector over collections
// count_vec = {collection_c: n_c}, sum n_c = 10

outcomes(count_vec):
  for each collection c with n_c > 0:
    for each skin s at rarity R+1 in c:
      p(s) = n_c / (10 * |skins at R+1 in c|)     // Valve formula

output_float(inputs, target_skin):
  avg_norm = mean( (f_i - min_i) / (max_i - min_i) )   // normalize per input skin range
  f_out    = target.min + avg_norm * (target.max - target.min)
  // wear bracket of f_out determines which Quote applies

contract_delta(slots):
  ev  = sum over outcomes: p(s) * bid_net(s, wear(f_out(s)), st)
  cost = sum over slots: cost(slot)
  return ev - cost        // signed; red if negative
```

## 4. Enumeration (count-vector space)

```
enumerate_contracts(inventory, cash, rarity R):
  for each count_vec over collections with rarity-R skins:      // small space
    owned_c  = min(n_c, owned_count(c, R))
    bought_c = n_c - owned_c
    skip if sum(bought_c * min_ask) > cash
    slots = assign_skins(count_vec)
    yield Contract(slots, contract_delta(slots), buy_list)

assign_skins(count_vec):
  // owned first: pick floats to steer f_out toward best wear bracket
  //   of the highest-EV outcomes (float steering, not just cheapest)
  // bought: pick listing minimizing ask subject to float range needed
  //   -> buy rec = (skin, float_range, max_price), not just skin name
```

## 5. Greedy policy (the planner)

```
best_move(inventory, cash):
  C = enumerate_contracts(...) for each rarity present
  C = filter(delta > 0)
  return argmax(delta) or NONE

// Chains are emergent: execute, add outcome, replan.
// No precomputed multi-hop plan survives a random outcome.
```

## 6. Trade locks

```
struct InvSkin { skin_id, float, stat_trak, unlock_at }

// Bought skins: unlock_at = now + venue lock duration
// Contract requires all 10 slots unlocked at execution time
// Planner may propose locked-input contracts as FUTURE moves
//   -> waypoint: "buy 1 pink ($2.10), hop unlocks in N days"
```

## 7. Monte Carlo rollout (journey preview)

```
simulate(inventory, cash, horizon, trials):
  for t in trials:
    inv, money, clock, log = copy(inventory), cash, now, []
    loop:
      m = best_move(inv, money) considering unlock times
      break if m == NONE or clock > horizon
      pay completion buys from money; set unlock_at on buys
      clock = max(clock, latest unlock in m)
      s = sample outcome ~ p(·)                  // one draw per contract
      inv = inv - m.inputs + InvSkin(s, f_out(inputs, s))
      log.append(waypoint(m, s))
    terminal[t] = sum(bid_net(inv)) + money
    routes[t]   = log
  return percentiles(terminal), representative routes for chain view

// UI: p10 / p50 / p90 of terminal value vs. do-nothing baseline
//     (baseline = sum(bid_net(inventory)) + cash)
// Every waypoint shows its own signed delta. Facade on narrative,
// never on numbers: route total = sum of hop deltas, no better.
```

## 8. Invariants

- No Steam wallet prices anywhere in math.
- ask and bid_net never blended.
- Every displayed route delta reconciles to per-hop deltas.
- Bought-skin float is real listing float when available; else median
  of wear bracket, flagged approximate.
- Replan after every executed contract with actual outcome float.