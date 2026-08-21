// Test-only module loader: stubs the Cloudflare-only 'cloudflare:sockets' module
// so route handlers can be imported under plain `node --test` without any
// network capability. Any attempt to actually open a socket throws.
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:sockets') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,let attempts=0; export function connect(){ attempts += 1; throw new Error("network access is forbidden in tests"); } export function socketAttempts(){ return attempts; } export function resetSocketAttempts(){ attempts=0; }',
    };
  }
  return next(specifier, context);
}
