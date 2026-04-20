// client/src/pages/round.js
import { api } from "../api/client.js";
import { el, formatCurrency } from "../utils/helpers.js";
import { showToast } from "../utils/toast.js";
import { RoundSocket } from "../utils/roundSocket.js";
import {
  calculateBalances, calculateSettlements, deriveScoreSpecials,
  calculateStrokePlayPayouts, mergeBalances, getLeaderboard,
  calculateCourseHandicap, distributeHandicapStrokes, SCORE_GAME_DEFAULTS,
} from "../utils/scoring.js";

const SPECIAL_META = {
  sandy:    { emoji: "🏖️", label: "Sandy"   },
  poley:    { emoji: "🚩", label: "Poley"   },
  barkie:   { emoji: "🌲", label: "Barkie"  },
  greenie:  { emoji: "🟢", label: "Greenie" },
  splashy:  { emoji: "💧", label: "Splashy" },
};

const PLAYER_COLORS = ["#1a7a4a","#e8960c","#e03131","#1971c2","#7209b7","#f72585"];

export async function renderRound(app, navigate) {
  app.innerHTML = `<div class="page flex-center"><div class="spinner"></div></div>`;

  const params  = new URLSearchParams(window.location.search);
  const roundId = params.get("id");
  if (!roundId) { navigate("/"); return; }

  let round      = null;
  let players    = [];
  let games      = [];
  let holeScores = [];
  let specials   = [];
  let activeHole = 1;
  let wsStatus   = "connecting";

  // par values keyed by hole — default 4 until user sets it
  let parValues  = {};

  function getCurrentUserId() {
    try {
      const token = localStorage.getItem("token");
      const payload = JSON.parse(atob(token.split(".")[1]));
      return payload.id;
    } catch { return null; }
  }

  // ── WebSocket live sync ──
  const socket = new RoundSocket(roundId, {
    onStatus: (status) => {
      wsStatus = status;
      const dot = document.getElementById("ws-dot");
      if (!dot) return;
      const colors = { connected: "#25a864", connecting: "#e8960c", reconnecting: "#e8960c", disconnected: "#e03131" };
      dot.style.background = colors[status] || "#e8960c";
      dot.title = status;
    },
    onEvent: async (msg) => {
      switch (msg.type) {
        case "SPECIAL_LOGGED":
        case "SPECIAL_REMOVED":
          specials = await api.get(`/rounds/${roundId}/specials`);
          render();
          if (msg.fromUserId !== getCurrentUserId()) {
            const label = msg.gameType ? msg.gameType.charAt(0).toUpperCase() + msg.gameType.slice(1) : "Special";
            showToast(`${msg.playerName || "Someone"} got a ${label}! ⭐`);
          }
          break;
        case "SCORE_SAVED":
          holeScores = await api.get(`/rounds/${roundId}/holes`);
          holeScores.forEach(s => { if (s.par) parValues[s.hole_number] = s.par; });
          render();
          break;
        case "ROUND_FINISHED":
          showToast("Round finished! Redirecting...");
          setTimeout(() => navigate(`/settlement?id=${roundId}`), 1500);
          break;
        case "USER_JOINED":
          if (msg.userId !== getCurrentUserId()) showToast(`${msg.name} joined the round`);
          break;
      }
    },
  });

  window.addEventListener("popstate", () => socket.disconnect(), { once: true });

  let strokeIndexes = []; // [{ hole_number, par, stroke_index }]

  async function loadData() {
    [round, holeScores, specials, strokeIndexes] = await Promise.all([
      api.get(`/rounds/${roundId}`),
      api.get(`/rounds/${roundId}/holes`),
      api.get(`/rounds/${roundId}/specials`),
      api.get(`/rounds/${roundId}/stroke-indexes`),
    ]);
    players = round.players;
    games   = round.games;

    // Seed par values from stroke indexes first, then from saved scores
    strokeIndexes.forEach(si => { parValues[si.hole_number] = si.par; });
    holeScores.forEach(s => { if (s.par) parValues[s.hole_number] = s.par; });
  }

  function playerName(p) {
    return p.user_name || p.guest_name || "?";
  }

  function playerColor(p, i) {
    return p.color || PLAYER_COLORS[i % PLAYER_COLORS.length];
  }

  function getScore(playerId, hole) {
    return holeScores.find(s => s.round_player_id === playerId && s.hole_number === hole);
  }

  function holeHasSpecial(hole) {
    return specials.some(s => s.hole_number === hole);
  }

  function holeHasScore(hole) {
    return holeScores.some(s => s.hole_number === hole);
  }

  function scoreDiffClass(strokes, par) {
    if (!strokes || !par) return "";
    const d = strokes - par;
    if (d <= -2) return "score-eagle";
    if (d === -1) return "score-birdie";
    if (d === 0)  return "score-par";
    if (d === 1)  return "score-bogey";
    return "score-double";
  }

  function computeLeaderboard() {
    const mappedPlayers = players.map(p => ({ id: p.id, name: playerName(p) }));

    const handicapStrokes = {};
    // Use actual slope/rating from selected tee if available
    const slopeRating  = round.slope_rating  || 113;
    const courseRating = round.course_rating || null;
    const parTotal     = round.par_total     || 72;

    for (const p of players) {
      if (p.handicap_index && strokeIndexes.length) {
        const ch = calculateCourseHandicap(p.handicap_index, slopeRating, courseRating, parTotal);
        handicapStrokes[p.id] = distributeHandicapStrokes(ch, strokeIndexes);
      } else if (p.handicap_index) {
        const ch = calculateCourseHandicap(p.handicap_index, slopeRating, courseRating, parTotal);
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
      holeScores.map(s => ({ ...s, roundPlayerId: s.round_player_id, holeNumber: s.hole_number })),
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
        holeScores.map(s => ({ ...s, roundPlayerId: s.round_player_id, holeNumber: s.hole_number })),
        handicapStrokes,
        parseFloat(strokePlayGame.point_value),
        round.holes
      );
    }

    return getLeaderboard(mergeBalances(specialsBal, strokeBal), mappedPlayers, allSpecials);
  }

  // Stepper component — returns { container, getValue }
  function makeStepperEl(label, initial, min, max) {
    let value = initial ?? min;

    const wrap  = el("div");
    const ctr   = el("div", { className: "stepper" });
    const minus = el("button", { className: "stepper-btn" }, "−");
    const disp  = el("span",  { className: "stepper-value" }, String(value));
    const plus  = el("button", { className: "stepper-btn" }, "+");

    minus.addEventListener("click", () => { if (value > min) { value--; disp.textContent = value; } });
    plus.addEventListener("click",  () => { if (value < max) { value++; disp.textContent = value; } });

    ctr.appendChild(minus);
    ctr.appendChild(disp);
    ctr.appendChild(plus);

    const lbl = el("div", { className: "stepper-label" }, label);
    wrap.appendChild(ctr);
    wrap.appendChild(lbl);

    return { container: wrap, getValue: () => value };
  }

  async function logSpecial(playerId, game) {
    // Check if already logged — if so, this is an undo
    const existing = specials.find(
      s => s.round_player_id === playerId && s.hole_number === activeHole && s.game_type === game.game_type
    );
    try {
      if (existing) {
        await api.delete(`/rounds/specials/${existing.id}`);
        showToast(`${SPECIAL_META[game.game_type]?.emoji} ${game.game_type} removed`);
      } else {
        await api.post(`/rounds/${roundId}/specials`, {
          round_player_id: playerId,
          round_game_id: game.id,
          hole_number: activeHole,
        });
        showToast(`${SPECIAL_META[game.game_type]?.emoji} ${SPECIAL_META[game.game_type]?.label}!`);
      }
      specials = await api.get(`/rounds/${roundId}/specials`);
      socket.send(existing ? "SPECIAL_REMOVED" : "SPECIAL_LOGGED", {
        gameType: game.game_type,
        playerName: playerName(players.find(p => p.id === playerId) || {}),
        holeNumber: activeHole,
      });
      // Update only the special chips and leaderboard — don't re-render the whole page
      // which would reset the stepper values
      updateSpecialChips();
      updateLeaderboard();
    } catch (err) { showToast("Error: " + err.message); }
  }

  function updateSpecialChips() {
    // Re-render just the special chips for each player
    players.forEach(p => {
      const games = (window._roundGames || []).filter(g => SPECIAL_META[g.game_type]);
      games.forEach(g => {
        const chipId = `chip-${p.id}-${g.game_type}`;
        const chip = document.getElementById(chipId);
        if (!chip) return;
        const logged = specials.some(
          s => s.round_player_id === p.id && s.hole_number === activeHole && s.game_type === g.game_type
        );
        chip.className = `special-chip${logged ? ' logged' : ''}`;
      });
    });
    // Also update hole grid indicators
    const holeButtons = document.querySelectorAll('.hole-btn');
    holeButtons.forEach((btn, i) => {
      const h = i + 1;
      if (holeHasSpecial(h)) btn.classList.add('has-special');
      else btn.classList.remove('has-special');
    });
  }

  function updateLeaderboard() {
    const lbList = document.querySelector('.leaderboard');
    if (!lbList) return;
    const lb = computeLeaderboard();
    lb.forEach((p, i) => {
      const rows = lbList.querySelectorAll('.leaderboard-row');
      if (!rows[i]) return;
      const balEl = rows[i].querySelector('.leaderboard-balance');
      const spcEl = rows[i].querySelector('.leaderboard-specials');
      if (balEl) {
        balEl.textContent = formatCurrency(p.balance);
        balEl.className = `leaderboard-balance ${p.balance >= 0 ? 'text-green' : 'text-red'}`;
      }
      if (spcEl) spcEl.textContent = `${p.specialsCount}★`;
    });
  }

  async function saveScores(playerScores) {
    // playerScores: [{ playerId, strokes, par }]
    try {
      await Promise.all(playerScores.map(ps =>
        api.post(`/rounds/${roundId}/holes`, {
          round_player_id: ps.playerId,
          hole_number: activeHole,
          strokes: ps.strokes,
          par: ps.par,
        })
      ));
      holeScores = await api.get(`/rounds/${roundId}/holes`);
      parValues[activeHole] = playerScores[0]?.par;
      socket.send("SCORE_SAVED", { holeNumber: activeHole });

      // Auto-advance to next hole
      if (activeHole < round.holes) activeHole++;
      showToast("✓ Scores saved");
      render();
    } catch (err) { showToast("Error: " + err.message); }
  }

  async function finishRound() {
    try {
      const mappedPlayers = players.map(p => ({ id: p.id, name: playerName(p) }));
      const gameValues = Object.fromEntries(games.map(g => [g.game_type, parseFloat(g.point_value)]));
      const scoreSpecials = deriveScoreSpecials(
        holeScores.map(s => ({ ...s, roundPlayerId: s.round_player_id })), gameValues
      );
      const allSpecials = [
        ...specials.map(s => ({ roundPlayerId: s.round_player_id, gameType: s.game_type, pointValue: parseFloat(s.point_value) })),
        ...scoreSpecials,
      ];
      const finalBal   = mergeBalances(calculateBalances(mappedPlayers, allSpecials));
      const settlements = calculateSettlements(finalBal, mappedPlayers);
      const dbSettlements = settlements.map(s => ({
        from_player: players.find(p => p.id === s.from)?.id,
        to_player:   players.find(p => p.id === s.to)?.id,
        amount: s.amount,
      }));
      await api.post(`/rounds/${roundId}/settlement`, { settlements: dbSettlements });
      await api.patch(`/rounds/${roundId}`, { status: "completed" });
      socket.send("ROUND_FINISHED", { roundId });
      socket.disconnect();
      // Small delay to let DB writes settle before loading the settlement page
      setTimeout(() => navigate(`/settlement?id=${roundId}`), 300);
    } catch (err) { showToast("Error: " + err.message); }
  }

  function render() {
    app.innerHTML = "";
    const wrap = el("div", { className: "page" });

    // Header
    const hdr = el("div", { className: "flex-between", style: "margin-bottom:0.75rem" });
    const hdrLeft = el("div");
    const titleRow = el("div", { className: "flex gap-sm", style: "align-items:center" });
    titleRow.appendChild(el("h1", { style: "margin-bottom:0" }, round.name || "Round"));
    // WS connection dot
    const wsDot = el("div", {
      id: "ws-dot",
      title: wsStatus,
      style: `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${
        wsStatus === "connected" ? "#25a864" : "#e8960c"
      };margin-top:4px`
    });
    titleRow.appendChild(wsDot);
    hdrLeft.appendChild(titleRow);
    if (round.course_name) {
      const courseStr = round.tee_name
        ? `${round.course_name} · ${round.tee_name} tees (${round.slope_rating}/${round.course_rating})`
        : round.course_name;
      hdrLeft.appendChild(el("p", { className: "text-muted text-sm" }, courseStr));
    }

    // Active games badges
    const GAME_EMOJI = {
      sandy: "🏖️", poley: "🚩", barkie: "🌲", greenie: "🟢",
      splashy: "💧", birdie: "🐦", eagle: "🦅", stroke_play: "💰"
    };
    if (games.length) {
      const gameBadges = el("div", { className: "flex gap-xs", style: "flex-wrap:wrap;margin-top:0.4rem" });
      games.forEach(g => {
        const badge = el("span", {
          style: [
            "display:inline-flex;align-items:center;gap:0.2rem",
            "background:var(--surface-2);border:1px solid var(--border)",
            "border-radius:999px;padding:0.1rem 0.5rem;font-size:0.72rem;font-weight:600"
          ].join(";")
        }, `${GAME_EMOJI[g.game_type] || "⭐"} $${parseFloat(g.point_value).toFixed(0)}`);
        gameBadges.appendChild(badge);
      });
      hdrLeft.appendChild(gameBadges);
    }

    hdr.appendChild(hdrLeft);
    const finishBtn = el("button", { className: "btn-gold btn-sm" }, "🏁 Finish");
    finishBtn.addEventListener("click", finishRound);
    hdr.appendChild(finishBtn);
    wrap.appendChild(hdr);

    // Leaderboard
    const lbCard = el("div", { className: "card" });
    lbCard.appendChild(el("h2", {}, "Leaderboard"));
    const lb = computeLeaderboard();
    const lbList = el("ul", { className: "leaderboard" });
    lb.forEach((p, i) => {
      const row  = el("li", { className: "leaderboard-row" });
      const rank = el("span", { className: `leaderboard-rank${i < 3 ? ` rank-${i+1}` : ""}` }, `${i+1}`);
      const player = players.find(pl => pl.id === p.id);
      const avatar = el("div", {
        className: "leaderboard-avatar",
        style: `background:${playerColor(player || {}, i)}`
      }, p.name[0]?.toUpperCase() || "?");
      const name = el("span", { className: "leaderboard-name" }, p.name);
      const spc  = el("span", { className: "leaderboard-specials" }, `${p.specialsCount}★`);
      const bal  = el("span", {
        className: `leaderboard-balance ${p.balance >= 0 ? "text-green" : "text-red"}`
      }, formatCurrency(p.balance));
      row.append(rank, avatar, name, spc, bal);
      lbList.appendChild(row);
    });
    lbCard.appendChild(lbList);
    wrap.appendChild(lbCard);

    // Hole selector
    const holeCard = el("div", { className: "card" });
    holeCard.appendChild(el("h2", {}, "Select Hole"));
    const grid = el("div", { className: "hole-grid" });
    for (let h = 1; h <= round.holes; h++) {
      const btn = el("div", {
        className: [
          "hole-btn",
          h === activeHole    ? "active"      : "",
          holeHasScore(h)     ? "has-score"   : "",
          holeHasSpecial(h)   ? "has-special" : "",
        ].filter(Boolean).join(" ")
      }, String(h));
      btn.addEventListener("click", () => { activeHole = h; render(); });
      grid.appendChild(btn);
    }
    holeCard.appendChild(grid);
    wrap.appendChild(holeCard);

    // Active hole scoring
    const holeCard2 = el("div", { className: "card" });
    holeCard2.appendChild(el("h2", {}, `Hole ${activeHole}`));

    // Par stepper — shared for all players on this hole
    const existingPar = parValues[activeHole] || 4;
    const parStepper = makeStepperEl("Par", existingPar, 3, 5);

    const parRow = el("div", { style: "margin-bottom:1rem; max-width:160px" });
    parRow.appendChild(parStepper.container);
    holeCard2.appendChild(parRow);
    holeCard2.appendChild(el("hr", { className: "divider" }));

    // Per-player score + specials
    const playerSteppers = [];
    players.forEach((p, i) => {
      const name    = playerName(p);
      const color   = playerColor(p, i);
      const existing = getScore(p.id, activeHole);

      const section = el("div", { className: "player-row" });

      // Header
      const pHdr = el("div", { className: "player-row-header" });
      pHdr.appendChild(el("div", { className: "player-color-dot", style: `background:${color}` }));
      pHdr.appendChild(el("span", { className: "player-name" }, name));

      // Show existing score badge if saved
      if (existing?.strokes) {
        const badge = el("span", {
          className: `score-badge ${scoreDiffClass(existing.strokes, existing.par)}`,
          style: "margin-left:auto"
        }, String(existing.strokes));
        pHdr.appendChild(badge);
      }
      section.appendChild(pHdr);

      // Strokes stepper
      const strokeStepper = makeStepperEl("Strokes", existing?.strokes || existingPar, 1, 20);
      const stepWrap = el("div", { style: "max-width:160px" });
      stepWrap.appendChild(strokeStepper.container);
      section.appendChild(stepWrap);

      playerSteppers.push({ playerId: p.id, getStrokes: strokeStepper.getValue });

      // Special chips
      const specialGames = games.filter(g => SPECIAL_META[g.game_type]);
      window._roundGames = games; // store for updateSpecialChips
      if (specialGames.length) {
        const chips = el("div", { className: "special-chips" });
        specialGames.forEach(g => {
          const logged = specials.some(
            s => s.round_player_id === p.id && s.hole_number === activeHole && s.game_type === g.game_type
          );
          const meta = SPECIAL_META[g.game_type];
          const chip = el("div", {
            className: `special-chip${logged ? " logged" : ""}`,
            id: `chip-${p.id}-${g.game_type}`
          }, `${meta.emoji} ${meta.label}`);
          chip.addEventListener("click", () => logSpecial(p.id, g));
          chips.appendChild(chip);
        });
        section.appendChild(chips);
      }

      holeCard2.appendChild(section);
    });

    // Save scores button
    const saveBtn = el("button", { className: "btn-primary w-full", style: "margin-top:1rem" }, "Save Scores →");
    saveBtn.addEventListener("click", () => {
      const par = parStepper.getValue();
      const scores = playerSteppers.map(ps => ({ playerId: ps.playerId, strokes: ps.getStrokes(), par }));
      saveScores(scores);
    });
    holeCard2.appendChild(saveBtn);
    wrap.appendChild(holeCard2);

    app.appendChild(wrap);
  }

  try {
    await loadData();
    render();
    socket.connect();
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="card text-red">Failed to load round: ${err.message}</div></div>`;
  }
}
