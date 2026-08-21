const ADULT_FIELDS = [
  'firstName', 'middleName', 'lastName', 'street', 'city', 'state', 'zip',
  'phone', 'altPhone', 'email',
];

function field(form, name, max = 254) {
  return String(form.get(name) || '').trim().slice(0, max);
}

export function confirmHoaOccupancy(c, input, at = new Date().toISOString()) {
  const hoaAdults = Number(input && input.hoaAdults);
  const minors = Number(input && input.minors);
  if (!Number.isInteger(hoaAdults) || hoaAdults < 1 || hoaAdults > 2) {
    return { ok: false, error: 'automated HOA paperwork supports one or two adults age 18+' };
  }
  if (!Number.isInteger(minors) || minors < 0 || minors > 2 || hoaAdults + minors > 4) {
    return { ok: false, error: 'automated paperwork supports up to two minor occupants and four total occupants' };
  }
  if (!Number.isInteger(Number(c && c.airbnbAdults))) c.airbnbAdults = Number(c && c.adults);
  c.adults = hoaAdults;
  c.expectedMinors = minors;
  c.hoaOccupancyConfirmedAt = at;
  return { ok: true };
}

export function parseAdultFormSlots(form, count) {
  const adults = [];
  const explicitSigs = [];
  const removeSigs = [];
  for (let i = 0; i < count; i++) {
    const adult = {};
    for (const name of ADULT_FIELDS) adult[name] = field(form, `a${i}_${name}`);
    const signatureUrl = String(form.get(`a${i}_sig`) || '');
    const match = signatureUrl.match(/^data:image\/png;base64,(.+)$/s);
    explicitSigs[i] = (match && match[1].length <= 400000) ? match[1] : null;
    removeSigs[i] = field(form, `a${i}_remove_sig`) === 'yes';
    adult.esignConsent = field(form, `a${i}_esign_consent`) === 'yes';
    adult.sigPng = explicitSigs[i];
    adults.push(adult);
  }
  return { adults, explicitSigs, removeSigs };
}
