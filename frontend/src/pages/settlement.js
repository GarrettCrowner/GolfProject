// client/src/pages/settlement.js
import { api } from "../api/client.js";
import { el, formatCurrency, formatDate } from "../utils/helpers.js";
import { renderSettlementTable } from "../components/settlementTable.js";
import { renderLeaderboard } from "../components/leaderboard.js";
import { renderGamesBadge } from "../components/gamesBadge.js";
import {
  calculateBalances, calculateSettlements, deriveScoreSpecials,
  calculateStrokePlayPayouts, mergeBalances, getLeaderboard,
  calculateCourseHandicap, SCORE_GAME_DEFAULTS,
} from "../utils/scoring.js";

export async function renderSettlement(app, navigate) {
  app.innerHTML = `<div class="page flex-center"><div class="spinner"></div></div>`;

  const params  = new URLSearchParams(window.location.search);
  const roundId = params.get("id");
  if (!roundId) { navigate("/"); return; }

  // Retry helper — gives the backend a moment to commit writes before we read
  async function fetchWithRetry(fn, retries = 3, delay = 400) {
    for (let i = 0; i < retries; i++) {
      try { return await fn(); } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  try {
    const [round, holeScores, specials] = await Promise.all([
      fetchWithRetry(() => api.get(`/rounds/${roundId}`)),
      fetchWithRetry(() => api.get(`/rounds/${roundId}/holes`)),
      fetchWithRetry(() => api.get(`/rounds/${roundId}/specials`)),
    ]);

    const players  = round.players;
    const games    = round.games;
    const isLive   = round.status === "active";

    // Recompute settlement from scratch (source of truth)
    const mappedPlayers = players.map(p => ({
      id: p.id,
      name: p.user_name || p.guest_name || "Unknown",
    }));

    const handicapStrokes = {};
    for (const p of players) {
      if (p.handicap_index) {
        const ch = calculateCourseHandicap(p.handicap_index);
        const strokes = {};
        const base = Math.floor(ch / round.holes);
        const rem  = ch % round.holes;
        for (let h = 1; h <= round.holes; h++) strokes[h] = base + (h <= rem ? 1 : 0);
        handicapStrokes[p.id] = strokes;
      } else {
        handicapStrokes[p.id] = {};
      }
    }

    const gameValues = Object.fromEntries(games.map(g => [g.game_type, parseFloat(g.point_value)]));
    const scoreSpecials = deriveScoreSpecials(
      holeScores.map(s => ({ ...s, roundPlayerId: s.round_player_id })),
      { ...SCORE_GAME_DEFAULTS, ...gameValues }
    );
    const allSpecials = [
      ...specials.map(s => ({ roundPlayerId: s.round_player_id, gameType: s.game_type, pointValue: parseFloat(s.point_value) })),
      ...scoreSpecials,
    ];

    const specialsBal = calculateBalances(mappedPlayers, allSpecials);
    const strokePlayGame = games.find(g => g.game_type === "stroke_play");
    let strokeBal = null;
    if (strokePlayGame) {
      strokeBal = calculateStrokePlayPayouts(
        mappedPlayers,
        holeScores.map(s => ({ ...s, roundPlayerId: s.round_player_id })),
        handicapStrokes,
        parseFloat(strokePlayGame.point_value),
        round.holes
      );
    }

    const finalBalances  = mergeBalances(specialsBal, strokeBal);
    const settlements    = calculateSettlements(finalBalances, mappedPlayers);
    const leaderboard    = getLeaderboard(finalBalances, mappedPlayers, allSpecials);

    app.innerHTML = "";
    const wrap = el("div", { className: "page" });

    // Header
    wrap.appendChild(el("h1", {}, isLive ? "📊 Mid-Round" : "🏁 Final Settlement"));
    const subRow = el("div", { className: "flex-between", style: "margin-bottom:1rem" });
    subRow.appendChild(el("p", { className: "text-muted text-sm" },
      `${round.name}${round.course_name ? " · " + round.course_name : ""}`
    ));
    subRow.appendChild(el("p", { className: "text-muted text-sm" },
      formatDate(round.completed_at || round.created_at)
    ));
    wrap.appendChild(subRow);

    // Final leaderboard
    const lbCard = el("div", { className: "card" });
    lbCard.appendChild(el("h2", {}, "Final Standings"));
    lbCard.appendChild(renderLeaderboard(leaderboard, players));
    wrap.appendChild(lbCard);

    // Settlement table
    const settleCard = el("div", { className: "card" });
    settleCard.appendChild(el("h2", {}, "Who Pays Who"));
    settleCard.appendChild(renderSettlementTable(settlements.map(s => ({
      fromName: mappedPlayers.find(p => String(p.id) === String(s.from))?.name || "?",
      toName:   mappedPlayers.find(p => String(p.id) === String(s.to))?.name   || "?",
      amount:   s.amount,
    }))));
    wrap.appendChild(settleCard);

    // Specials breakdown per player
    const specCard = el("div", { className: "card" });
    specCard.appendChild(el("h2", {}, "Specials Earned"));

    players.forEach(p => {
      const name = p.user_name || p.guest_name || "Unknown";
      const playerSpecials = allSpecials.filter(s => s.roundPlayerId === p.id);

      const row = el("div", { style: "padding:0.65rem 0;border-bottom:1px solid var(--border)" });
      const header = el("div", { className: "flex-between", style: "margin-bottom:0.3rem" });
      header.appendChild(el("span", { className: "font-bold" }, name));

      const bal = finalBalances[p.id] || 0;
      header.appendChild(el("span", {
        className: `font-bold ${bal >= 0 ? "text-green" : "text-red"}`
      }, formatCurrency(bal)));
      row.appendChild(header);

      if (playerSpecials.length) {
        const badges = el("div", { className: "flex gap-xs", style: "flex-wrap:wrap;margin-top:0.3rem" });
        const counts = {};
        playerSpecials.forEach(s => { counts[s.gameType] = (counts[s.gameType] || 0) + 1; });
        Object.entries(counts).forEach(([type, count]) => {
          badges.appendChild(renderGamesBadge(type, count));
        });
        row.appendChild(badges);
      } else {
        row.appendChild(el("p", { className: "text-muted text-sm" }, "No specials"));
      }

      specCard.appendChild(row);
    });
    wrap.appendChild(specCard);

    // Hole-by-hole score summary
    if (holeScores.length) {
      const scoreCard = el("div", { className: "card" });
      scoreCard.appendChild(el("h2", {}, "Scorecard"));

      // Build holes list
      const holes = [...new Set(holeScores.map(s => s.hole_number))].sort((a, b) => a - b);

      const table = el("table", { style: "width:100%;border-collapse:collapse;font-size:0.85rem" });
      const thead = el("thead");
      const hr    = el("tr");
      hr.appendChild(el("th", { style: "text-align:left;padding:0.3rem 0.4rem;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em" }, "Hole"));
      players.forEach(p => {
        hr.appendChild(el("th", {
          style: "text-align:center;padding:0.3rem 0.4rem;color:var(--text-muted);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em"
        }, (p.user_name || p.guest_name || "?").split(" ")[0]));
      });
      thead.appendChild(hr);
      table.appendChild(thead);

      const tbody = el("tbody");
      holes.forEach(hole => {
        const row = el("tr");
        row.appendChild(el("td", {
          style: "padding:0.35rem 0.4rem;font-weight:600;color:var(--text-muted)"
        }, String(hole)));

        players.forEach(p => {
          const score = holeScores.find(s => s.round_player_id === p.id && s.hole_number === hole);
          const td = el("td", { style: "text-align:center;padding:0.35rem 0.4rem" });
          if (score?.strokes) {
            const diff = score.strokes - (score.par || 4);
            const cls = diff <= -2 ? "score-eagle" : diff === -1 ? "score-birdie" : diff === 0 ? "score-par" : diff === 1 ? "score-bogey" : "score-double";
            const badge = el("span", { className: `score-badge ${cls}` }, String(score.strokes));
            td.appendChild(badge);
          } else {
            td.appendChild(el("span", { className: "text-muted" }, "—"));
          }
          row.appendChild(td);
        });
        tbody.appendChild(row);
      });

      // Totals row
      const totRow = el("tr", { style: "border-top:2px solid var(--border)" });
      totRow.appendChild(el("td", { style: "padding:0.5rem 0.4rem;font-weight:700" }, "Total"));
      players.forEach(p => {
        const total = holeScores
          .filter(s => s.round_player_id === p.id)
          .reduce((sum, s) => sum + (s.strokes || 0), 0);
        totRow.appendChild(el("td", {
          style: "text-align:center;padding:0.5rem 0.4rem;font-weight:700"
        }, total ? String(total) : "—"));
      });
      tbody.appendChild(totRow);

      table.appendChild(tbody);
      scoreCard.appendChild(table);
      wrap.appendChild(scoreCard);
    }

    // Actions
    const btnRow = el("div", { className: "flex gap-sm", style: "margin-top:0.5rem" });
    if (isLive) {
      const backBtn = el("button", { className: "btn-primary", style: "flex:1" }, "← Back to Round");
      backBtn.addEventListener("click", () => navigate(`/round?id=${roundId}`));
      btnRow.appendChild(backBtn);
    } else {
      const homeBtn = el("button", { className: "btn-outline", style: "flex:1" }, "← Home");
      homeBtn.addEventListener("click", () => navigate("/"));
      btnRow.appendChild(homeBtn);
    }
    wrap.appendChild(btnRow);

    app.appendChild(wrap);
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="card text-red">Failed to load: ${err.message}</div></div>`;
  }
}
