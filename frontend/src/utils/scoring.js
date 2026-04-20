// client/src/utils/scoring.js

export const SCORE_GAME_DEFAULTS = {
  birdie: 2.0,
  eagle: 5.0,
  strokePlay: 1.0,
};

export function calculateCourseHandicap(handicapIndex, slopeRating = 113, courseRating = null, par = 72) {
  const base = handicapIndex * (slopeRating / 113);
  const adjustment = courseRating != null ? courseRating - par : 0;
  return Math.round(base + adjustment);
}

export function distributeHandicapStrokes(courseHandicap, holeStrokeIndexes) {
  const strokes = {};
  for (const { holeNumber } of holeStrokeIndexes) strokes[holeNumber] = 0;
  if (courseHandicap <= 0) return strokes;
  const sorted = [...holeStrokeIndexes].sort((a, b) => a.strokeIndex - b.strokeIndex);
  for (let i = 0; i < Math.min(courseHandicap, 18); i++) strokes[sorted[i].holeNumber] += 1;
  if (courseHandicap > 18) {
    for (let i = 0; i < courseHandicap - 18; i++) strokes[sorted[i].holeNumber] += 1;
  }
  return strokes;
}

export function netScore(grossStrokes, handicapStrokesOnHole) {
  return grossStrokes - handicapStrokesOnHole;
}

export function deriveScoreSpecials(holeScores, gameValues = SCORE_GAME_DEFAULTS) {
  const derived = [];
  for (const score of holeScores) {
    if (score.strokes == null || score.par == null) continue;
    const diff = score.strokes - score.par;
    if (diff === -1 && gameValues.birdie != null) {
      derived.push({ roundPlayerId: score.roundPlayerId, holeNumber: score.holeNumber, gameType: "birdie", pointValue: gameValues.birdie });
    }
    if (diff <= -2 && gameValues.eagle != null) {
      derived.push({ roundPlayerId: score.roundPlayerId, holeNumber: score.holeNumber, gameType: "eagle", pointValue: gameValues.eagle });
    }
  }
  return derived;
}

export function calculateStrokePlayPayouts(players, holeScores, handicapStrokes, valuePerHole = SCORE_GAME_DEFAULTS.strokePlay, totalHoles = 18) {
  const playerIds = players.map((p) => p.id);
  const balances = Object.fromEntries(playerIds.map((id) => [id, 0]));
  const playerCount = playerIds.length;

  const scoreByHole = {};
  for (const score of holeScores) {
    if (!scoreByHole[score.holeNumber]) scoreByHole[score.holeNumber] = {};
    scoreByHole[score.holeNumber][score.roundPlayerId] = score.strokes;
  }

  let carryOver = 0;

  for (let hole = 1; hole <= totalHoles; hole++) {
    const holeData = scoreByHole[hole] || {};
    const netScores = playerIds
      .filter((id) => holeData[id] != null)
      .map((id) => ({ id, net: netScore(holeData[id], handicapStrokes[id]?.[hole] ?? 0) }));

    if (netScores.length === 0) { continue; } // skip unplayed holes, don't add carry

    const minNet = Math.min(...netScores.map((s) => s.net));
    const winners = netScores.filter((s) => s.net === minNet);

    // Push for one is push for all — any tie means nobody wins, full pot carries
    if (winners.length > 1) { carryOver += valuePerHole * playerCount; continue; }

    // Single winner collects the carryOver pot on top of the normal per-hole payout.
    // Each loser pays only their flat $valuePerHole — they already "paid" the carryOver
    // holes implicitly since they didn't win them.
    const winnerId = winners[0].id;
    for (const id of playerIds) {
      if (id === winnerId) {
        balances[id] += parseFloat(((playerCount - 1) * valuePerHole + carryOver).toFixed(2));
      } else {
        balances[id] -= parseFloat(valuePerHole.toFixed(2));
      }
    }
    carryOver = 0;
  }

  return balances;
}

export function calculateBalances(players, specials) {
  const playerCount = players.length;
  const playerIds = players.map((p) => p.id);
  const balances = Object.fromEntries(playerIds.map((id) => [id, 0]));
  for (const special of specials) {
    const achieverId = special.roundPlayerId;
    const value = parseFloat(special.pointValue);
    for (const playerId of playerIds) {
      if (playerId === achieverId) balances[playerId] += value * (playerCount - 1);
      else balances[playerId] -= value;
    }
  }
  return balances;
}

export function mergeBalances(specialsBalances, strokePlayBalances = null) {
  const merged = { ...specialsBalances };
  if (strokePlayBalances) {
    for (const [id, amount] of Object.entries(strokePlayBalances)) {
      merged[id] = parseFloat(((merged[id] || 0) + amount).toFixed(2));
    }
  }
  return merged;
}

export function calculateSettlements(balances, players) {
  const playerMap = Object.fromEntries(players.map((p) => [p.id, p.name]));
  const creditors = [];
  const debtors = [];
  for (const [id, balance] of Object.entries(balances)) {
    const rounded = parseFloat(balance.toFixed(2));
    if (rounded > 0) creditors.push({ id, amount: rounded });
    if (rounded < 0) debtors.push({ id, amount: Math.abs(rounded) });
  }
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);
  const settlements = [];
  let i = 0, j = 0;
  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];
    const amount = parseFloat(Math.min(creditor.amount, debtor.amount).toFixed(2));
    settlements.push({ from: debtor.id, fromName: playerMap[debtor.id], to: creditor.id, toName: playerMap[creditor.id], amount });
    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount < 0.01) i++;
    if (debtor.amount < 0.01) j++;
  }
  return settlements;
}

export function getLeaderboard(balances, players, specials) {
  return players
    .map((player) => ({
      id: player.id,
      name: player.name,
      balance: parseFloat((balances[player.id] || 0).toFixed(2)),
      specialsCount: specials.filter((s) => s.roundPlayerId === player.id).length,
    }))
    .sort((a, b) => b.balance - a.balance);
}

export function getPlayerHoleSummary(playerId, specials) {
  const summary = {};
  for (const special of specials) {
    if (special.roundPlayerId !== playerId) continue;
    const hole = special.holeNumber;
    if (!summary[hole]) summary[hole] = [];
    summary[hole].push({ gameType: special.gameType, pointValue: parseFloat(special.pointValue) });
  }
  return summary;
}

export function getBreakdownByGameType(players, specials) {
  const playerCount = players.length;
  const playerIds = players.map((p) => p.id);
  const breakdown = Object.fromEntries(playerIds.map((id) => [id, {}]));
  for (const special of specials) {
    const achieverId = special.roundPlayerId;
    const value = parseFloat(special.pointValue);
    const gameType = special.gameType;
    for (const playerId of playerIds) {
      if (!breakdown[playerId][gameType]) breakdown[playerId][gameType] = 0;
      if (playerId === achieverId) breakdown[playerId][gameType] += value * (playerCount - 1);
      else breakdown[playerId][gameType] -= value;
    }
  }
  for (const playerId of playerIds) {
    for (const gameType of Object.keys(breakdown[playerId])) {
      breakdown[playerId][gameType] = parseFloat(breakdown[playerId][gameType].toFixed(2));
    }
  }
  return breakdown;
}
