// Canonical public production identity for Isla del Sol Unit 405D.
// Secrets never belong here. SMTP credentials, admin credentials and Telegram
// credentials remain Cloudflare secrets. Runtime email sender is supplied as
// the non-secret GMAIL_USER environment variable.
export const PROPERTY_CONFIG = Object.freeze({
  portalOrigin: 'https://isladelsol405d.com',
  portalHostname: 'isladelsol405d.com',
  portalTitle: 'Isla del Sol 405D Guest Portal',
  listingId: '1097686557541958107',
  listingName: 'Isla del Sol, Meerblick',
  listingUrl: 'https://www.airbnb.com/rooms/1097686557541958107',
  listingShortUrl: 'https://airbnb.de/h/isladelsol405d',
  propertyName: 'Isla del Sol Bay-View Condo',
  condominiumName: 'Palma del Mar No. 2',
  associationName: 'Palma del Mar No. 2 Condominium Association, Inc.',
  managementName: 'Condominium Associates, Inc.',
  ownerName: 'Markus Oliver Bauer',
  unit: 'Unit 405D',
  streetAddress: '6219 Palma Del Mar Blvd S',
  city: 'St. Petersburg',
  state: 'FL',
  postalCode: '33715',
  managementAddress: '570 Carillon Parkway, Suite 210, St. Petersburg, FL 33716',
  feeAmount: 'USD 100',
  feePayee: 'Palma del Mar No. 2',
  hoaTo: Object.freeze(['info@condominiumassociates.com', 'kruiz@condominiumassociates.com']),
  hoaCc: Object.freeze([]),
  hoaPhone: '727-573-9300',
});

export function configuredPortalOrigin(env = {}) {
  const candidate = String(env.PORTAL_ORIGIN || PROPERTY_CONFIG.portalOrigin).trim();
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid');
    return url.origin;
  } catch (_) {
    throw new Error('PORTAL_ORIGIN must be an HTTPS origin');
  }
}

export function configuredOwnerEmail(env = {}) {
  const value = String(env.OWNER_EMAIL || env.GMAIL_USER || '').trim();
  if (!value) throw new Error('OWNER_EMAIL or GMAIL_USER is required for owner-only test delivery');
  return value;
}

// Hard release boundary. This cannot be changed by an environment variable or
// an old KV value. A future atomic exactly-once coordinator must replace this
// implementation in reviewed code before live HOA delivery can exist.
export function liveSubmissionEnabled() {
  return false;
}
