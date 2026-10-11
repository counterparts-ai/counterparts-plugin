/* The brain's regions and which mechanisms happen where — the site's mapping
   (counterparts-site features/home-v2/content/regions.ts), with the two parked
   mechanisms (identity, storage) left out, as the site leaves them out of its
   pills. The home page's brain is drawn from this table; clicking a region
   picks its first mechanism, and clicking it again steps to the next.

   `col` is rgb 0..1 as the shader wants it; `anchor` is where the region's
   point sits in the model's space. The cerebellum is drawn for anatomy and has
   nothing to click. */
export const REGIONS = [
  { key: "prefrontal", name: "Prefrontal cortex", role: "Sense of self", col: [0.16, 0.8, 1.0], anchor: [0.0, 0.35, 1.2], active: true,
    mechanisms: ["reconsolidation", "prospective", "schema"] },
  { key: "amygdala", name: "Amygdala", role: "What matters", col: [1.0, 0.42, 0.52], anchor: [0.42, -0.42, 0.42], active: true,
    mechanisms: ["salience", "emotional"] },
  { key: "hippocampus", name: "Hippocampus", role: "Making memories last", col: [0.72, 0.53, 1.0], anchor: [0.38, -0.3, -0.2], active: true,
    mechanisms: ["consolidation", "dreaming", "association", "interference"] },
  { key: "thalamus", name: "Thalamus", role: "What comes to mind", col: [1.0, 0.8, 0.32], anchor: [0.0, 0.05, 0.05], active: true,
    mechanisms: ["retrieval"] },
  { key: "brainstem", name: "Brainstem", role: "The body clock", col: [0.55, 0.66, 0.85], anchor: [0.0, -0.8, -0.35], active: true,
    mechanisms: ["decay"] },
  { key: "cortex", name: "Cortex", role: "Where memories live", col: [0.25, 1.0, 0.72], anchor: [-0.7, 0.55, -0.2], active: true,
    mechanisms: ["episodic-semantic"] },
  { key: "cerebellum", name: "Cerebellum", role: "Movement and timing", col: [0.3, 0.42, 0.5], anchor: [0.0, -0.6, -0.85], active: false,
    mechanisms: [] },
];

/** The region a mechanism happens in. */
export function regionOf(mechanismId) {
  return REGIONS.find((r) => r.mechanisms.includes(mechanismId)) || null;
}
