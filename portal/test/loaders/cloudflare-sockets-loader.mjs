// Test-only module loader: stubs the Cloudflare-only 'cloudflare:sockets' module
// so route handlers can be imported under plain `node --test` without any
// network capability. Any attempt to actually open a socket throws.
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:sockets') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export function connect(){ throw new Error("network access is forbidden in tests"); }',
    };
  }
  return next(specifier, context);
}
