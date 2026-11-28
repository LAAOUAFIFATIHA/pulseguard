// One page per feature, chosen by the URL hash (#/live, #/coach, ...).
const ROUTES = {
  home: ["Home", "Runs shared by you, your friends and the community"],
  live: ["Live monitor", "Real-time ECG, heart rate and body sensors"],
  coach: ["AI coach", "Hybrid AI: Gemini Nano on device, Gemini in the cloud"],
  history: ["History", "Your saved sessions, ready to replay"],
  team: ["Team", "Training partners who chose to share with each other"],
  friends: ["Friends", "Find runners, manage requests and invite friends to run"],
  rating: ["Rating", "Your rank, divisions and why your rating changed"],
  plan: ["Plan a run", "AI plan with warm-up, water stops and live voice cues"],
  compete: ["Compete", "Challenges, runners at your level and leaderboards"],
  runner: ["Runner", "Profile, runs, records and badges"],
  profile: ["Profile", "Your status, thresholds and personal details"],
  settings: ["Settings", "Data, privacy and account"],
};

const $ = (id) => document.getElementById(id);

export function initRouter({ onEnter } = {}) {
  const pages = [...document.querySelectorAll("[data-page]")];
  const links = [...document.querySelectorAll("[data-route]")];

  const setMenu = (open) => {
    document.body.classList.toggle("menu-open", open);
    $("backdrop").hidden = !open;
    $("menu-toggle").setAttribute("aria-expanded", String(open));
  };
  $("menu-toggle").onclick = () => setMenu(!document.body.classList.contains("menu-open"));
  $("backdrop").onclick = () => setMenu(false);

  function go() {
    const [wanted, param] = location.hash.replace(/^#\/?/, "").split("/");
    const route = ROUTES[wanted] ? wanted : "home";
    for (const page of pages) page.hidden = page.dataset.page !== route;
    for (const link of links) {
      if (link.dataset.route === route) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    const [title, subtitle] = ROUTES[route];
    $("page-title").textContent = title;
    $("page-subtitle").textContent = subtitle;
    document.title = `${title} · PulseGuard`;
    setMenu(false);
    window.scrollTo(0, 0);
    onEnter?.(route, param);
  }

  window.addEventListener("hashchange", go);
  go();
}
