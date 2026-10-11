/* The hover tooltip (the memories tab's "How it feels" uses it). `#tip` lives in the shell. */
import { $ } from "./dom.js";

export function showTip(x, y, html) {
  const tip = $("tip");
  tip.innerHTML = html;
  tip.style.display = "block";
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 10, Math.max(8, x + 14)) + "px";
  tip.style.top = Math.max(8, y - h - 12) + "px";
}
export function hideTip() { $("tip").style.display = "none"; }
