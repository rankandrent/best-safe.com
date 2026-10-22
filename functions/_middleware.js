// One host only: www.<domain> answers with a 301 to the bare domain (same path and query), so Google
// crawls and indexes a single copy of every page. Every other request passes straight through.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname.startsWith('www.')) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
