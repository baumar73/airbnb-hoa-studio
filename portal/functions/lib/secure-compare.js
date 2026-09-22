// Constant-time string comparison for the Workers runtime.
//
// Web Crypto has no timing-safe equality primitive, so we hash both operands to
// a fixed-length SHA-256 digest and compare the two 32-byte digests with an
// XOR accumulator that never short-circuits on a differing byte. Fixed-length
// digests also hide the plaintext length from the main comparison loop (length
// itself is still observable through the hashing step — unavoidable here, and
// not the attack surface this helper targets).
//
// Operands may be plaintext secrets (env passwords) or already-hashed compare
// strings (e.g. admin-password-hash). Callers decide which to pass.

export async function tolerantCompare(a, b) {
  const ca = a == null ? '' : String(a);
  const cb = b == null ? '' : String(b);
  const enc = new TextEncoder();
  const digestOf = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  const da = await digestOf(ca);
  const db = await digestOf(cb);
  if (da.length !== db.length) return false; // defensive; both are SHA-256 → 32
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}