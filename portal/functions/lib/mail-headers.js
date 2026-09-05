// Deliberately conservative ASCII identifiers. No arbitrary header injection.
export const validMessageId=value=>typeof value==='string'&&value.length<=250&&/^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+>$/.test(value);
export function singleMailAddress(value) {
  if(typeof value!=='string'||value.length>500||/[\r\n\0]/.test(value)) return '';
  const match=value.trim().match(/^(?:[^<>,]*<([A-Za-z0-9._+\-]+@[A-Za-z0-9.-]+)>|([A-Za-z0-9._+\-]+@[A-Za-z0-9.-]+))$/);
  return match?(match[1]||match[2]):'';
}
export function threadingHeaders({messageId,inReplyTo,references}={}) {
  if(messageId!==undefined&&!validMessageId(messageId))throw Error('Invalid message identifier');
  if(inReplyTo!==undefined&&!validMessageId(inReplyTo))throw Error('Invalid reply identifier');
  if(references!==undefined&&(!Array.isArray(references)||references.length>20||!references.every(validMessageId)))throw Error('Invalid message references');
  return [messageId&&`Message-ID: ${messageId}`,inReplyTo&&`In-Reply-To: ${inReplyTo}`,references?.length&&`References: ${references.join(' ')}`].filter(Boolean);
}
