export async function onRequestGet({ request, params }) {
  const oid = params.code;

  if (!oid) {
    return new Response('Not Found', { status: 404 });
  }

  const target = new URL(request.url);
  target.pathname = '/adminindex.html';
  target.search = '';
  target.searchParams.set('oid', oid);

  return Response.redirect(target.toString(), 302);
}
