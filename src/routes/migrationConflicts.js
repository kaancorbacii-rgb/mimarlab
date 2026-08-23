import { json, errorJson, readJson } from '../lib/http.js';

// Faz 2 ID-first migration'ının (bkz. scripts/migrate-to-id-first.js, migrations/0022_id_first_entities.sql)
// otomatik eşleştiremediği isim çakışmalarının admin panelinden okunabildiği/işaretlenebildiği uç
// noktalar. Script BİLEREK hiçbir çakışmayı otomatik çözmüyor (aynı isimde birden fazla mimar/ofis,
// ya da bir proje/ürünün bir çakışma grubundaki bir isme referans vermesi) — bu modül yalnızca o
// raporu admin'e gösterir ve "inceledim" işaretlemesini kaydeder; adayları otomatik BİRLEŞTİRMEZ/
// SEÇMEZ (kullanıcı isteği: "güvenli bir eşleştirme raporu/akışı" — gerçek disambiguation admin'in
// mevcut mimar/ofis düzenleme araçlarıyla elle yapılır, bkz. docs/architecture-roadmap.md Faz 2).
//
// GET    /api/admin/migration-conflicts            — ?status=pending|resolved|ignored, ?entityType=...
// PATCH  /api/admin/migration-conflicts/:id         — { status, resolvedTargetId? }
export async function handleMigrationConflictsAdmin(request, env, url, segments, user) {
  const id = segments[3];

  if (!id && request.method === 'GET') {
    const status = url.searchParams.get('status');
    const entityType = url.searchParams.get('entityType');
    const clauses = [];
    const params = [];
    if (status) { clauses.push('status = ?'); params.push(status); }
    if (entityType) { clauses.push('entity_type = ?'); params.push(entityType); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { results } = await env.DB.prepare(
      `SELECT * FROM migration_name_conflicts ${where} ORDER BY status ASC, entity_type ASC, conflict_key ASC`
    ).bind(...params).all();
    const items = results.map(row => {
      let candidates = [];
      try { candidates = JSON.parse(row.candidates || '[]') || []; } catch { candidates = []; }
      return { ...row, candidates };
    });
    const counts = { pending: 0, resolved: 0, ignored: 0 };
    for (const row of results) counts[row.status] = (counts[row.status] || 0) + 1;
    return json({ items, counts });
  }

  if (id && request.method === 'PATCH') {
    const body = await readJson(request);
    if (!body || !['pending', 'resolved', 'ignored'].includes(body.status)) {
      return errorJson('Geçersiz durum.', 400);
    }
    const row = await env.DB.prepare('SELECT id FROM migration_name_conflicts WHERE id = ?').bind(id).first();
    if (!row) return errorJson('Bulunamadı', 404);
    await env.DB.prepare(
      `UPDATE migration_name_conflicts
       SET status = ?, resolved_target_id = ?, resolved_by_user_id = ?, resolved_at = datetime('now')
       WHERE id = ?`
    ).bind(body.status, body.resolvedTargetId || null, body.status === 'pending' ? null : user.id, id).run();
    return json({ ok: true });
  }

  return errorJson('Bulunamadı', 404);
}
