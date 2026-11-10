/* Which host serves this page, and what it can show (HD2, 2026-11-10).

   ONE page, two hosts: the local server and the hosted one
   (app.counterparts.ai/dashboard/) serve these same files. The server says
   which it is in `<meta name="counterparts-host">` (web/respond.ts#pageFor);
   this is the page's half of the same table. A panel that a host doesn't have
   is hidden by asking here, never by a second copy of the page, and it says
   so ("not on hosted yet"), never silence.

   Read synchronously at import: app.js mounts every page at load. */

function metaContent(name) {
  if (typeof document === "undefined") return null;
  const m = document.querySelector('meta[name="' + name + '"]');
  return m ? m.getAttribute("content") : null;
}

const PROFILES = {
  local: {
    name: "local",
    tabs: null, // every tab
    canAct: true,
    machine: true,
    pulseMs: 4000,
    pulseWhenHidden: true,
  },
  // Hosted's first release (Mike 2026-11-10): home, memories and self, read-only.
  hosted: {
    name: "hosted",
    tabs: ["home", "memories", "self"],
    canAct: false,
    machine: false,
    // A view opens the person's store on the server: a slow poll, and none
    // while the tab is hidden, so an idle store closes.
    pulseMs: 60000,
    pulseWhenHidden: false,
  },
};

export const HOST = PROFILES[metaContent("counterparts-host")] || PROFILES.local;

/** Does this host show this tab? */
export function showsTab(name) {
  return HOST.tabs === null || HOST.tabs.includes(name);
}

/** The one line a hidden part says instead. */
export const NOT_HERE = "Not on hosted yet: this part shows in the local dashboard, on your own computer.";
