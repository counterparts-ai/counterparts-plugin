/* The page's own buttons: add a memory (a note the owner writes, the same as
   `counterparts note`), back up, export. Each runs the
   console's own command through `shared/actions.js` and says what it said.
   (Remove lives on the memory card, where the memory is.) */
import { act, resultHtml } from "../../../shared/actions.js";
import { $, esc } from "../../../shared/dom.js";
import { MY_NAME } from "../../../shared/voice.js";
import { changed } from "../state.js";

export const markup = `
    <div class="tools">
      <button class="mbtn primary" id="note-open" type="button" aria-expanded="false">+ Add a memory</button>
      <button class="mbtn" id="backup-open" type="button">Back up…</button>
      <button class="mbtn" id="export-open" type="button">Export…</button>
    </div>`;

export const notePanel = `
    <div class="card pad note-panel" id="note-panel" hidden>
      <div class="np-head">Remember this, on purpose</div>
      <textarea id="note-text" rows="3" spellcheck="true" placeholder="something for ${MY_NAME} to remember"></textarea>
      <div class="np-row">
        <input id="note-title" type="text" autocomplete="off" placeholder="a title (optional)">
        <button class="mbtn primary" id="note-go" type="button">Remember</button>
        <button class="mbtn" id="note-cancel" type="button">Close</button>
      </div>
      <div id="note-out"></div>
    </div>`;

export function mount() {
  const panel = $("note-panel");
  const setOpen = (open) => {
    panel.hidden = !open;
    $("note-open").setAttribute("aria-expanded", String(open));
    if (open) $("note-text").focus();
  };
  $("note-open").addEventListener("click", () => setOpen(panel.hidden));
  $("note-cancel").addEventListener("click", () => setOpen(false));
  $("note-go").addEventListener("click", async () => {
    const text = $("note-text").value.trim();
    if (!text) { $("note-text").focus(); return; }
    const title = $("note-title").value.trim();
    $("note-go").disabled = true;
    $("note-out").innerHTML = '<div class="act-out">writing…</div>';
    const r = await act("note", title ? { text, title } : { text });
    $("note-go").disabled = false;
    if (r && r.ok) {
      const said = (r.out || []).find((l) => /^Remembered /.test(l));
      const id = said && (said.match(/\b(mem_[A-Za-z0-9_-]+)/) || [])[1];
      $("note-out").innerHTML = '<div class="act-out act-good">' + esc(said || "Remembered.") +
        (id ? ' <button class="linkbtn" type="button" onclick="openMemory(\'' + esc(id) + '\')">open it</button>' : "") +
        "</div>";
      $("note-text").value = ""; $("note-title").value = "";
      changed();
    } else {
      $("note-out").innerHTML = resultHtml(r);
    }
  });
  $("backup-open").addEventListener("click", () => folderDialog("backup"));
  $("export-open").addEventListener("click", () => folderDialog("export"));
}

// ── the folder dialog (back up / export) ────────────────────────────────────

const COPY = {
  backup: {
    title: "Back up this memory",
    lede: "A dated snapshot of the whole store — the database and the conversation it is still " +
      "writing up — into a new folder inside the one you name. Nothing in the store changes.",
    go: "Back up",
  },
  export: {
    title: "Export a copy",
    lede: "A copy to keep or move elsewhere. Choose how it should be locked and what shape it should take. " +
      "Nothing in the store changes.",
    go: "Export",
  },
};

function folderDialog(kind) {
  const c = COPY[kind];
  const back = document.createElement("div");
  back.className = "confirm-back";
  back.innerHTML =
    '<div class="confirm mdialog" role="dialog" aria-modal="true" aria-labelledby="fd-title">' +
      '<h3 id="fd-title">' + esc(c.title) + "</h3>" +
      '<p class="fd-lede">' + esc(c.lede) + "</p>" +
      '<label class="fd-lab">Folder (a full path, like /Users/you/Backups)' +
        '<input class="confirm-input" id="fd-path" type="text" autocomplete="off" spellcheck="false"></label>' +
      (kind === "export"
        ? '<fieldset class="fd-set"><legend>Lock it?</legend>' +
            '<label><input type="radio" name="fd-lock" value="pass" checked> With a passphrase</label>' +
            '<input class="confirm-input" id="fd-pass" type="password" autocomplete="new-password" placeholder="passphrase">' +
            '<label><input type="radio" name="fd-lock" value="plain"> No — an unencrypted copy anyone can read</label>' +
          "</fieldset>" +
          '<fieldset class="fd-set"><legend>Shape</legend>' +
            '<label><input type="radio" name="fd-shape" value="db" checked> One database file (restorable)</label>' +
            '<label><input type="radio" name="fd-shape" value="md"> Readable markdown files, one per memory</label>' +
          "</fieldset>"
        : "") +
      '<div id="fd-out"></div>' +
      '<div class="confirm-buttons"><button class="fd-cancel" type="button">Close</button>' +
        '<button class="fd-go" type="button">' + esc(c.go) + "</button></div>" +
    "</div>";
  const q = (sel) => back.querySelector(sel);
  const close = () => {
    removeEventListener("keydown", onKey, true);
    if (back.parentNode) back.parentNode.removeChild(back);
  };
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  const run = async () => {
    const out = q("#fd-path").value.trim();
    if (!out) { q("#fd-path").focus(); return; }
    const fields = { out };
    if (kind === "export") {
      const plain = q('input[name="fd-lock"]:checked').value === "plain";
      if (plain) fields.plaintext = true;
      else {
        const pass = q("#fd-pass").value;
        if (!pass) { q("#fd-pass").focus(); return; }
        fields.passphrase = pass;
      }
      if (q('input[name="fd-shape"]:checked').value === "md") fields.markdown = true;
    }
    q(".fd-go").disabled = true;
    q("#fd-out").innerHTML = '<div class="act-out">working… a large store can take a few minutes</div>';
    const r = await act(kind, fields);
    q(".fd-go").disabled = false;
    q("#fd-out").innerHTML = plainResult(r);
  };
  if (kind === "export") {
    const sync = () => { q("#fd-pass").disabled = q('input[name="fd-lock"]:checked').value === "plain"; };
    back.querySelectorAll('input[name="fd-lock"]').forEach((r) => r.addEventListener("change", sync));
  }
  q(".fd-go").addEventListener("click", run);
  q(".fd-cancel").addEventListener("click", close);
  q("#fd-path").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  addEventListener("keydown", onKey, true);
  document.body.appendChild(back);
  q("#fd-path").focus();
}

/** The console's answer, headline first: its first line says where the copy
 *  went (or why it refused); the rest folds under "details". */
function plainResult(r) {
  if (!r || r.error || !r.ok) return resultHtml(r);
  const lines = (r.out || []).filter((l) => l.trim().length > 0);
  const head = lines[0] || "Done.";
  const rest = lines.slice(1);
  return '<div class="act-out act-good"><b>Done.</b> ' + esc(head) +
    (rest.length
      ? '<details class="fd-more"><summary>details</summary>' + rest.map((l) => "<div>" + esc(l) + "</div>").join("") +
        (r.command ? '<div class="act-cmd">$ ' + esc(r.command) + "</div>" : "") + "</details>"
      : "") +
    "</div>";
}
