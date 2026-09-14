// Follows INSEE's commune movements (v_mvt_commune) so an old code lands on
// the code it belongs to in the target geography: mergers chain, a commune
// that still exists keeps its code.
export function successor(code, moves, target, since) {
  const seen = new Set();
  let c = code;
  while (!target.has(c)) {
    if (seen.has(c)) return null;
    seen.add(c);
    const m = moves.find(
      (r) => r.COM_AV === c && r.TYPECOM_AV === "COM" && r.TYPECOM_AP === "COM" && r.COM_AP !== c && r.DATE_EFF >= since,
    );
    if (!m) return null;
    c = m.COM_AP;
  }
  return c;
}
