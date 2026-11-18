// SPDX-License-Identifier: GPL-3.0-or-later
const MAX_RESPONSE_BYTES = 1_048_576;

export class ProofreadingError extends Error {}
const HTTP_ERRORS:Record<number,string>={
  400:'The proofreading service rejected the request (HTTP 400).',
  401:'The proofreading service rejected the API key (HTTP 401).',
  402:'The proofreading service requires payment or has insufficient balance (HTTP 402).',
  403:'The proofreading service denied access (HTTP 403).',
  404:'The proofreading service could not find this endpoint or model (HTTP 404).',
  408:'The proofreading service timed out while receiving the request (HTTP 408).',
  413:'The proofreading request is too large for the service (HTTP 413).',
  422:'The proofreading service rejected a request parameter (HTTP 422).',
  429:'The proofreading service is rate-limited (HTTP 429).',
  500:'The proofreading service encountered an internal error (HTTP 500).',
  502:'The proofreading service gateway returned an invalid response (HTTP 502).',
  503:'The proofreading service is temporarily unavailable (HTTP 503).',
  504:'The proofreading service gateway timed out (HTTP 504).',
};
export class ProofreadingServiceError extends ProofreadingError {
  constructor(readonly status:number,readonly detail?:string){
    super(HTTP_ERRORS[status]??`The proofreading service returned an HTTP error. (HTTP ${status})`);
  }
}
export const invalidProofreadingResponse = () => new ProofreadingError('The proofreading service returned an invalid response.');
export const cancelledProofreading = () => new DOMException('The proofreading request was cancelled.', 'AbortError');

/** Validate a proofreading service URL without assuming its API protocol. */
export function resolveProofreadingServiceURL(value: string): URL {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new ProofreadingError('Enter a valid HTTP or HTTPS API address.');
  }
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ProofreadingError('Enter a valid HTTP or HTTPS API address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new ProofreadingError('Enter a valid HTTP or HTTPS API address.');
  }
  if (url.username || url.password || value.includes('#')) {
    throw new ProofreadingError('The API address must not contain a username, password, or fragment.');
  }
  // CSP host sources cannot match an IPv6 literal. The localhost name also
  // reaches IPv6 loopback without requiring a broader desktop network policy.
  if (url.protocol === 'http:' && url.hostname === '[::1]') {
    throw new ProofreadingError('Use localhost or 127.0.0.1 for the local HTTP service.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new ProofreadingError('Use HTTPS for remote proofreading services. HTTP is allowed only on localhost.');
  }
  return url;
}

export async function readProofreadingResponse(response: Response, signal: AbortSignal, maxBytes=MAX_RESPONSE_BYTES): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ProofreadingError('The proofreading service returned too much data.');
  }
  if (!response.body) throw invalidProofreadingResponse();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once: true});
  try {
    if (signal.aborted) throw cancelledProofreading();
    for (;;) {
      const result = await reader.read();
      if (signal.aborted) throw cancelledProofreading();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new ProofreadingError('The proofreading service returned too much data.');
      }
      text += decoder.decode(result.value, {stream: true});
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export function isProofreadingObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Keep the actual status and a short service explanation, never a whole error page. */
export async function proofreadingServiceError(response:Response,signal:AbortSignal,apiKey:string,text:string):Promise<ProofreadingServiceError>{
  let detail:string|undefined;
  if(/(?:application\/json|\+json)(?:\s*;|$)/i.test(response.headers.get('Content-Type')??'')){
    const bodyController=new AbortController(),abort=()=>bodyController.abort();
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      // Diagnostics must not turn an already known HTTP error into a 45s timeout.
      const raw=await Promise.race([
        readProofreadingResponse(response,bodyController.signal,16_384).catch(()=>undefined),
        new Promise<undefined>(resolve=>{timer=setTimeout(()=>{abort();resolve(undefined);},1000);}),
      ]);
      if(signal.aborted)throw cancelledProofreading();
      const body:unknown=raw===undefined?undefined:JSON.parse(raw);
      if(isProofreadingObject(body)){
        const candidate=isProofreadingObject(body.error)?body.error.message:typeof body.error==='string'?body.error:body.message;
        if(typeof candidate==='string'){
          let safe=candidate;
          const secrets=[apiKey,text].filter(Boolean).flatMap(value=>{
            const quoted=JSON.stringify(value);return [value,encodeURIComponent(value),quoted,quoted.slice(1,-1)];
          }).sort((a,b)=>b.length-a.length);
          for(const secret of secrets)safe=safe.split(secret).join('[redacted]');
          safe=safe.replace(/\bBearer\s+[^\s,;"']+/gi,'Bearer [redacted]')
            .replace(/\bsk-[A-Za-z0-9_-]{6,}/g,'[redacted]')
            .replace(/https?:\/\/[^\s<>"']+/gi,'[URL]')
            .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g,' ')
            .replace(/\s+/g,' ').trim();
          if(safe)detail=safe.length>500?safe.slice(0,499)+'…':safe;
        }
      }
    }catch{
      if(signal.aborted)throw cancelledProofreading();
      // A missing, malformed or oversized body must not hide the HTTP status.
    }finally{
      if(timer!==undefined)clearTimeout(timer);signal.removeEventListener('abort',abort);abort();
    }
  }else void response.body?.cancel().catch(()=>{});
  return new ProofreadingServiceError(response.status,detail);
}
