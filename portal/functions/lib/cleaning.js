// Automatic Turno cleaning matching for the admin progress board.
// Mirrors the operations app's cleaningProjectForCheckout logic:
// a cleaning project counts for a checkout if its date is 0-2 days after the
// checkout (cancelled projects excluded). Pure + deterministic, so the board can
// derive the Reinigung date automatically from the operations state.
export function cleaningProjectDate(project) {
  return project.date || String(project.scheduledStart || '').slice(0, 10);
}

export function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// Return the matching cleaning project for a checkout, or null.
export function cleaningForCheckout(checkoutDate, projects) {
  if (!checkoutDate) return null;
  return (projects || []).find((p) => {
    if (p.status === 'cancelled' || p.status === 'canceled') return false;
    const diff = daysBetween(checkoutDate, cleaningProjectDate(p));
    return diff !== null && diff >= 0 && diff <= 2;
  }) || null;
}

// Best cleaning date for the board column: explicit is preserved, else derived.
export function resolveCleaning(c, projects) {
  if (c && c.cleaning) return c.cleaning;
  const p = cleaningForCheckout(c && c.checkOut, projects);
  return p ? cleaningProjectDate(p) : null;
}