import { NextResponse, type NextRequest } from 'next/server';

/**
 * A password in front of everything.
 *
 * S6 installs and executes code an agent wrote moments earlier, from a repository whoever
 * loads the page typed in. That is fine on a laptop and not fine on a public URL, where it
 * is a stranger spending your API credits to run arbitrary code on your container.
 *
 * In production the password is required, and its absence fails **closed**: a deploy that
 * forgot to set it serves 503 rather than an open endpoint. Locally it is optional, so
 * `pnpm --filter web dev` still just works.
 */
export function middleware(request: NextRequest): NextResponse {
  const expected = process.env.QUARRY_PASSWORD;

  if (expected === undefined || expected === '') {
    if (process.env.NODE_ENV !== 'production') return NextResponse.next();

    return new NextResponse(
      'QUARRY_PASSWORD is not set. Refusing to serve — this app runs generated code.',
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded !== undefined) {
    const [, password] = atob(encoded).split(':');
    if (password === expected) return NextResponse.next();
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="Quarry", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next's own static output, which carries nothing worth gating.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
