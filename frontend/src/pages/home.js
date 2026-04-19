// frontend/src/pages/home.js
import { api } from "../api/client.js";
import { el, formatDate } from "../utils/helpers.js";

export async function renderHome(app, navigate) {
  app.innerHTML = `<div class="page flex-center"><div class="spinner"></div></div>`;

  const token = localStorage.getItem("token");
  if (!token) { navigate("/login"); return; }

  try {
    await api.get("/auth/me");
  } catch {
    localStorage.removeItem("token");
    navigate("/login");
    return;
  }

  async function loadRounds() {
    try {
      const rounds = await api.get("/rounds");
      app.innerHTML = "";
      const wrap = el("div", { className: "page" });

      // Hero header
      const hero = el("div", { style: "margin-bottom:1.25rem" });
      hero.appendChild(el("h1", {}, "⛳ Skins"));
      hero.appendChild(el("p", { className: "text-muted" }, "Track specials with your crew."));
      wrap.appendChild(hero);

      // New round CTA
      const newBtn = el("button", {
        className: "btn-primary w-full",
        style: "padding:0.875rem;font-size:1.05rem;margin-bottom:1.25rem"
      }, "+ New Round");
      newBtn.addEventListener("click", () => navigate("/setup"));
      wrap.appendChild(newBtn);

      const active    = rounds.filter(r => r.status === "active");
      const completed = rounds.filter(r => r.status === "completed");

      if (active.length) {
        wrap.appendChild(el("h2", {}, "Active Rounds"));
        active.forEach(r => wrap.appendChild(roundCard(r, navigate, true, loadRounds)));
      }

      if (completed.length) {
        wrap.appendChild(el("h2", { style: "margin-top:1.25rem" }, "Past Rounds"));
        completed.slice(0, 10).forEach(r => wrap.appendChild(roundCard(r, navigate, false, loadRounds)));
      }

      if (!rounds.length) {
        const empty = el("div", { className: "card empty-state" });
        empty.appendChild(el("div", { className: "empty-icon" }, "⛳"));
        empty.appendChild(el("p", { className: "font-bold", style: "margin-bottom:0.25rem" }, "No rounds yet"));
        empty.appendChild(el("p", { className: "text-muted text-sm" }, "Tap + New Round to get started."));
        wrap.appendChild(empty);
      }

      // Sign out
      const signOut = el("p", {
        className: "text-muted text-sm text-center",
        style: "margin-top:2rem;cursor:pointer"
      }, "Sign out");
      signOut.addEventListener("click", () => {
        localStorage.removeItem("token");
        navigate("/login");
      });
      wrap.appendChild(signOut);

      app.appendChild(wrap);
    } catch (err) {
      app.innerHTML = `<div class="page"><div class="card text-red">Error: ${err.message}</div></div>`;
    }
  }

  loadRounds();
}

function roundCard(round, navigate, isActive, onDelete) {
  const card = el("div", { className: "round-card" });

  const header = el("div", { className: "flex-between", style: "margin-bottom:0.3rem" });
  header.appendChild(el("span", { className: "round-card-title" }, round.name || "Untitled Round"));

  const right = el("div", { className: "flex gap-sm", style: "align-items:center" });

  right.appendChild(el("span", {
    className: `badge ${isActive ? "badge-green" : "badge-muted"}`
  }, isActive ? "Live" : "Done"));

  // Delete button
  const deleteBtn = el("button", {
    className: "btn-danger btn-sm",
    style: "min-height:28px;padding:0 0.5rem;font-size:0.75rem;border-radius:6px"
  }, "✕");
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation(); // prevent card click navigating
    const confirmed = confirm(`Delete "${round.name || "this round"}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.delete(`/rounds/${round.id}`);
      onDelete(); // refresh the list
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  });
  right.appendChild(deleteBtn);
  header.appendChild(right);
  card.appendChild(header);

  const meta = el("div", { className: "round-card-meta flex-between" });
  meta.appendChild(el("span", {}, round.course_name || "—"));
  meta.appendChild(el("span", {}, formatDate(round.created_at)));
  card.appendChild(meta);

  card.addEventListener("click", () =>
    navigate(isActive ? `/round?id=${round.id}` : `/settlement?id=${round.id}`)
  );
  return card;
}
