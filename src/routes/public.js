import { json, errorJson } from '../lib/http.js';
import { SUBMISSION_TYPES, parseSubmissionRow } from '../lib/submissionTypes.js';

const TYPE_BY_PATH = {
  offices: 'offices', projects: 'projects', products: 'products', jobs: 'jobs',
  architects: 'architects',
};

// Onaylanmış (status='approved') satırları, statik data.js/projeler-data.js/urunler-data.js
// dizilerindeki mevcut şekle olabildiğince uyacak biçimde dönüştürür — böylece istemci
// tarafında tek satırlık bir fetch+push ile mevcut render() koduna karışabilirler.
function toPublicShape(type, row) {
  const parsed = parseSubmissionRow(type, row);
  if (type === 'offices') {
    return {
      name: parsed.name, loc: parsed.loc, cats: parsed.cats, yil: parsed.yil,
      website: parsed.website, about: parsed.about, logo: parsed.logo_url,
      awards: parsed.awards, source: 'member', submissionId: parsed.id,
    };
  }
  if (type === 'projects') {
    return {
      slug: parsed.slug, title: parsed.title, category: parsed.category, type: parsed.type,
      location: parsed.location, locationDetail: parsed.locationDetail, date: parsed.date,
      dateBucket: parsed.dateBucket, period: parsed.period, designer: parsed.designer,
      photoCredit: { text: parsed.photoCreditText || '', url: parsed.photoCreditUrl || '' },
      description: parsed.description, mostVisited: null, recommendations: [],
      images: parsed.images, source: 'member', submissionId: parsed.id,
    };
  }
  if (type === 'products') {
    return {
      title: parsed.title, brand: parsed.brand, website: parsed.website, category: parsed.category,
      description: parsed.description, images: parsed.images,
      image: parsed.images && parsed.images[0] ? parsed.images[0] : null,
      source: 'member', submissionId: parsed.id,
    };
  }
  if (type === 'architects') {
    return {
      name: parsed.name, dob: parsed.dob, school: parsed.school, dept: parsed.dept, office: parsed.office,
      role: parsed.position, status: parsed.position, awards: parsed.awards, photo: parsed.photo_url,
      source: 'member', submissionId: parsed.id,
    };
  }
  // jobs
  return {
    title: parsed.title, office: parsed.office, loc: parsed.loc, level: parsed.level,
    role: parsed.role, tags: parsed.tags, domain: parsed.domain, description: parsed.description,
    apply: parsed.apply, image: parsed.image_url, source: 'member', submissionId: parsed.id,
  };
}

export async function handlePublicRoute(request, env, url) {
  const segments = url.pathname.split('/').filter(Boolean); // ["api", "public", "offices"]
  if (segments[2] === 'news') return listPublicNews(env);

  const typeKey = TYPE_BY_PATH[segments[2]];
  if (!typeKey || request.method !== 'GET') return errorJson('Bulunamadı', 404);

  const config = SUBMISSION_TYPES[typeKey];
  const { results } = await env.DB.prepare(
    `SELECT * FROM ${config.table} WHERE status = 'approved' ORDER BY created_at DESC`
  ).all();
  return json({ items: results.map(r => toPublicShape(typeKey, r)) });
}

async function listPublicNews(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, category, source, description, image_url, created_at FROM news WHERE published = 1
     UNION ALL
     SELECT id, title, category, source, description, image_url, created_at FROM news_submissions WHERE status = 'approved'
     ORDER BY created_at DESC`
  ).all();
  return json({
    items: results.map(n => ({
      title: n.title, category: n.category, source: n.source, description: n.description,
      image: n.image_url, id: n.id,
    })),
  });
}
