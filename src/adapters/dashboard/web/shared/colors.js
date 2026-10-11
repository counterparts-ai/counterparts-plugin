/* The palette as JS values, for the canvas and for inline bar fills. The same
   colours live as CSS variables in `tokens.css`; a canvas cannot read those. */

export const COL = { cyan:"#00e5ff", purple:"#b388ff", amber:"#ffd740", teal:"#00bfa5", red:"#ff5252", dim:"#5c6773" };
export const BANDCOL = { episodic:COL.dim, semantic:COL.cyan, identity:COL.purple };
export const ACCENT = { cyan:COL.cyan, purple:COL.purple, amber:COL.amber, teal:COL.teal };
