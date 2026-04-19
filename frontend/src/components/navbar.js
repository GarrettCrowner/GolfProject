// frontend/src/components/navbar.js

export function renderNavbar() {
  const nav = document.createElement("nav");
  nav.className = "navbar";
  nav.innerHTML = `
    <a href="/" class="navbar-brand">⛳ Gimme</a>
    <div class="navbar-links">
      <a href="/">Home</a>
      <a href="/stats">Stats</a>
    </div>
  `;

  nav.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link && link.origin === window.location.origin) {
      e.preventDefault();
      window.history.pushState({}, "", link.pathname);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  });

  document.body.prepend(nav);
}
