import { errorJson } from './lib/http.js';
import { handleAuthRoute, handleProfileRoute } from './routes/auth.js';
import { handleSubmissionRoute } from './routes/submissions.js';
import { handlePublicRoute } from './routes/public.js';
import { handleAdminRoute } from './routes/admin.js';
import { handleUploadRoute, handleMediaRoute } from './routes/upload.js';
import { handleCommentsRoute } from './routes/comments.js';
import { handleSavedRoute } from './routes/saved.js';
import { handleRatingsRoute } from './routes/ratings.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let response;
    if (url.pathname.startsWith('/api/')) {
      try {
        response = await routeApi(request, env, url);
      } catch (err) {
        console.error(err);
        response = errorJson('Sunucu hatası oluştu.', 500);
      }
    } else if (url.pathname.startsWith('/media/')) {
      response = await handleMediaRoute(request, env, url);
    } else {
      response = await env.ASSETS.fetch(request);
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};

async function routeApi(request, env, url) {
  const path = url.pathname;
  if (path.startsWith('/api/auth/')) return handleAuthRoute(request, env, url);
  if (path === '/api/profile') return handleProfileRoute(request, env, url);
  if (path === '/api/uploads') return handleUploadRoute(request, env);
  if (path.startsWith('/api/admin/')) return handleAdminRoute(request, env, url);
  if (path.startsWith('/api/public/')) return handlePublicRoute(request, env, url);
  if (path === '/api/comments') return handleCommentsRoute(request, env, url);
  if (path.startsWith('/api/saved')) return handleSavedRoute(request, env, url);
  if (path.startsWith('/api/ratings')) return handleRatingsRoute(request, env, url);
  if (
    path.startsWith('/api/offices') || path.startsWith('/api/projects') ||
    path.startsWith('/api/products') || path.startsWith('/api/jobs') ||
    path.startsWith('/api/architects') || path.startsWith('/api/news')
  ) return handleSubmissionRoute(request, env, url);
  return errorJson('Bulunamadı', 404);
}
