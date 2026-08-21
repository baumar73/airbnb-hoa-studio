// Source-grounded HOA policy extracted from the verified 2026-08-21 corpus.
// Ambiguities fail closed and preserve their source identifiers for human review.

export const HOA_RULE_REGISTRY = Object.freeze({
  version: '2026-08-21-corpus-review',
  rules: Object.freeze([
    { id: 'occupancy-classification', status: 'current', sourceIds: ['CINC-364605', 'CINC-358999', 'CINC-363471', 'CINC-330185', 'LEGAL-fl-509.013-lodging-definitions', 'LEGAL-fl-509.242-lodging-classifications'], authority: 'association-rules-plus-statute' },
    { id: 'minimum-term-boundary', status: 'unresolved', sourceIds: ['CINC-363471', 'CINC-364605'], authority: 'association-conflict' },
    { id: 'application-fee', status: 'current', sourceIds: ['CINC-364605', 'CINC-358998', 'CINC-358996', 'CINC-91915', 'LEGAL-fl-718.112-bylaws-transfer-fees', 'DBPR-current-published-transfer-fee'], authority: 'association-plus-statute' },
    { id: 'occupancy-limit', status: 'current', sourceIds: ['CINC-364605', 'CINC-91915'], authority: 'association-rules-2025' },
    { id: 'pet-rule', status: 'unresolved', sourceIds: ['CINC-358999', 'CINC-363471', 'CINC-364605', 'CINC-80617', 'CINC-220783', 'CINC-220785', 'LEGAL-fl-760.23-fair-housing', 'LEGAL-us-42-3604-fair-housing'], authority: 'association-plus-fair-housing' },
    { id: 'board-approval', status: 'current', sourceIds: ['CINC-116209', 'CINC-112589', 'CINC-80628', 'CINC-80622', 'CINC-358998', 'CINC-364605'], authority: 'recorded-amendment-plus-current-rules' },
  ]),
});

function ruleAudit(ruleId) {
  const rule = HOA_RULE_REGISTRY.rules.find(item => item.id === ruleId);
  if (!rule) throw new Error(`unknown HOA rule: ${ruleId}`);
  return {
    ruleVersionId: `${HOA_RULE_REGISTRY.version}:${rule.id}`,
    ruleStatus: rule.status,
    sourceIds: [...rule.sourceIds],
  };
}

export function classifyOccupancy(input = {}) {
  if (typeof input.ownerPresent !== 'boolean' || typeof input.compensation !== 'boolean') {
    return { kind: 'clarification_required', registrationRequired: false, checkInLocked: true, ...ruleAudit('occupancy-classification') };
  }
  const ownerPresent = input.ownerPresent === true;
  const compensation = input.compensation === true;
  const stayNights = Number(input.stayNights);
  if (ownerPresent && !compensation) {
    return { kind: 'owner_present_visit', registrationRequired: false, checkInLocked: false, ...ruleAudit('occupancy-classification') };
  }
  if (compensation) {
    return { kind: 'rental', registrationRequired: false, checkInLocked: true, ...ruleAudit('occupancy-classification') };
  }
  if (!Number.isFinite(stayNights) || stayNights < 1) {
    return { kind: 'clarification_required', registrationRequired: false, checkInLocked: true, ...ruleAudit('occupancy-classification') };
  }
  if (stayNights < 30) {
    return { kind: 'guest', registrationRequired: true, checkInLocked: true, ...ruleAudit('occupancy-classification') };
  }
  if (stayNights === 30) {
    return { kind: 'clarification_required', registrationRequired: false, checkInLocked: true, ...ruleAudit('minimum-term-boundary') };
  }
  return { kind: 'rental', registrationRequired: false, checkInLocked: true, ...ruleAudit('occupancy-classification') };
}

export function evaluateApplicationFee(input = {}) {
  const base = { currentAssociationAmount: 100, statutoryMaximum: 150, ...ruleAudit('application-fee') };
  if (input.kind === 'guest') return { status: 'not_required', amount: 0, ...base };
  if (input.kind !== 'rental') return { status: 'clarification_required', amount: null, ...base };
  if (input.sameLesseeRenewalClaimed === true && input.sameLesseeRenewalVerified !== true) {
    return { status: 'clarification_required', amount: null, ...base };
  }
  if (input.sameLesseeRenewalVerified === true) return { status: 'not_required', amount: 0, ...base };
  if (input.governingAuthorityVerified !== true) return { status: 'clarification_required', amount: null, ...base };
  return { status: 'required', amount: 100, ...base };
}

export function evaluateOccupancyLimit(input = {}) {
  const bedrooms = Number(input.bedrooms);
  const occupants = Number(input.occupants);
  if (![1, 2].includes(bedrooms) || !Number.isInteger(occupants) || occupants < 1) {
    return { status: 'clarification_required', allowed: false, limit: null, ...ruleAudit('occupancy-limit') };
  }
  const limit = bedrooms === 1 ? 4 : 6;
  return { status: occupants <= limit ? 'allowed' : 'prohibited', allowed: occupants <= limit, limit, ...ruleAudit('occupancy-limit') };
}

export function evaluatePetRule(input = {}) {
  if (input.accommodationRequested === true) {
    return { status: 'accommodation_review', checkInLocked: true, ...ruleAudit('pet-rule') };
  }
  if (['rental', 'guest'].includes(input.occupancyKind)) {
    return { status: 'prohibited', checkInLocked: true, ...ruleAudit('pet-rule') };
  }
  return { status: 'clarification_required', checkInLocked: true, ...ruleAudit('pet-rule') };
}

const PROHIBITED_NORMALIZED_KEYS = new Set([
  'ssn', 'ssnnumber', 'socialsecurity', 'socialsecuritynumber', 'taxid', 'taxpayeridentificationnumber', 'dateofbirth', 'datebirth', 'birthdate', 'dob',
  'governmentid', 'governmentidnumber', 'identitydocument', 'idtype', 'idnumber', 'idstate', 'idimage', 'photoid', 'photoids',
  'driverlicense', 'driverlicensenumber', 'driverslicense', 'driverslicensenumber', 'passport', 'passportnumber', 'credit', 'creditreport', 'creditscore',
  'creditdata', 'criminal', 'criminalhistory', 'criminalrecord', 'eviction', 'evictionhistory',
  'bank', 'bankaccount', 'bankaccountnumber', 'bankrouting', 'bankinformation', 'routingnumber', 'financialdata',
  'financialinformation', 'gender', 'employer', 'employment', 'employerphone',
  'employeraddress', 'employmenthistory', 'reference', 'references',
  'personalreferences', 'landlordreferences', 'emergency', 'emergencycontact',
  'emergencycontacts', 'screening', 'backgroundauthorization',
  'backgroundreport', 'backgroundcheckreport', 'tenantevaluationreport', 'screeningreport',
]);

function normalizedKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isProhibitedKey(key) {
  return PROHIBITED_NORMALIZED_KEYS.has(normalizedKey(key));
}

const PROHIBITED_STRING_PATTERNS = Object.freeze([
  /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/,
  /\b(?:ssn|social\s*security(?:\s*number)?|tax(?:payer)?\s*(?:id|identification\s*number)|date\s*of\s*birth|dob|gender|passport(?:\s*number)?|driver'?s?\s*licen[cs]e(?:\s*number)?|credit\s*(?:score|report)|criminal\s*(?:history|record)|eviction\s*history|bank\s*(?:account|routing|information)|routing\s*number|financial\s*(?:data|information)|employer|employment(?:\s*history)?|personal\s*references?|landlord\s*references?|emergency\s*contacts?|background(?:\s*check)?\s*report|screening\s*report|tenant\s*evaluation\s*report)\s*[:=#-]\s*\S+/i,
  /(?:^|[&?])[^=&]*(?:ssn|socialsecuritynumber|taxid|taxpayeridentificationnumber|birthdate|dateofbirth|datebirth|governmentid|identitydocument|idtype|idnumber|idstate|idimage|passportnumber|driverslicensenumber|employer|employment|employerphone|creditreport|creditscore|financialdata|financialinformation|criminalhistory|evictionhistory|bankaccount|bankinformation|bankrouting|routingnumber|reference|references|personalreferences|landlordreferences|emergency|emergencycontact|emergencycontacts|backgroundauthorization|backgroundreport|backgroundcheckreport|screening|screeningreport|tenantevaluationreport)=/i,
  /["'](?:ssn|socialSecurityNumber|taxId|taxpayerIdentificationNumber|birthDate|dateOfBirth|dateBirth|governmentId|identityDocument|idType|idNumber|idState|idImage|passportNumber|driversLicenseNumber|employer|employment|employerPhone|creditReport|creditScore|financialData|financialInformation|criminalHistory|evictionHistory|bankAccount|bankInformation|bankRouting|routingNumber|reference|references|personalReferences|landlordReferences|emergency|emergencyContact|emergencyContacts|backgroundAuthorization|backgroundReport|backgroundCheckReport|screening|screeningReport|tenantEvaluationReport)["']\s*:/i,
]);

function containsProhibitedString(value) {
  return PROHIBITED_STRING_PATTERNS.some(pattern => pattern.test(value));
}

export function containsProhibitedSensitiveData(value) {
  if (typeof value === 'string') return containsProhibitedString(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsProhibitedSensitiveData);
  return Object.entries(value).some(([key, nested]) => isProhibitedKey(key) || containsProhibitedSensitiveData(nested));
}

export function stripProhibitedSensitiveData(value) {
  if (typeof value === 'string' && containsProhibitedString(value)) return '[REDACTED PROHIBITED SENSITIVE DATA]';
  if (Array.isArray(value)) return value.map(stripProhibitedSensitiveData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !isProhibitedKey(key))
    .map(([key, nested]) => [key, stripProhibitedSensitiveData(nested)]));
}

export function assertNoProhibitedSensitiveData(value) {
  if (containsProhibitedSensitiveData(value)) throw new Error('prohibited_sensitive_data');
  return value;
}
