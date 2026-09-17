// ProjectComments — yorum listesi/yazma formu/silme. proje-detay.html#loadComments/
// renderCommentForm/initComments'in taşınmış hâli, BİREBİR aynı /api/comments sözleşmesi ve silme
// yetki mantığı (bkz. kullanıcı isteği: v1'de yalnızca mevcut düz liste, reply/like YOK — ayrı bir
// işe bırakıldı). Tek fark: sabit sayfa id'leri yerine bir konteyner elemanı alır (bkz. kullanıcı
// isteği: modüler, ileride başka bir varlık modalında da kullanılabilir bir yapı).
//
// targetType (mount()'un 4. argümanı, options.targetType) — varsayılan 'project'; bileşen 'architect'/
// 'office' hedeflerini de destekleyecek şekilde tasarlandı ama şu an yalnızca project-modal.js
// tarafından, varsayılan değerle çağrılıyor. Sahiplik/moderasyon kontrolü hedefe göre DEĞİŞİR:
// 'project' için (a) gönderi sahipliği + aktif rozet (mevcut davranış, DEĞİŞMEDİ) YA DA (b) projenin
// künyesindeki bir mimar/firma profilini onaylı sahiplenmek (YENİ, kullanıcı isteği, 2026-09-17:
// "admine ve firma yöneticisine yorumu silme yetkisi ver" — bkz. src/routes/comments.js#
// canDeleteComment'teki AYNI iki yol); admin AYRICA açıkça kontrol edilir (server zaten admin'i
// koşulsuz geçiriyordu, istemci bunu hiç sormuyordu — Sil düğmesi admine hiç görünmüyordu).
// 'architect'/'office' için src/routes/comments.js#canDeleteComment'teki AYNI kural —
// profile_claims'te onaylı sahiplik yeterli, rozet ŞARTI YOK.
//
// "commenterProfile" KALDIRILDI (kullanıcı isteği, 2026-09-17: "Her kullanıcı sadece kullanıcı
// ismiyle yorum yapabilsin. Kişi popuplarını yorum kısmına karıştırma") — bkz. src/routes/
// comments.js#listComments'teki AYNI gerekçe. Her yorum artık KOŞULSUZ `user_name`/`user_photo`
// ile gösterilir, hiçbir /kisi veya /firma bağlantısı kurulmaz.
const ProjectComments = (function () {
  const DEFAULT_IDS = { count: 'pm-comments-count', formWrap: 'pm-comment-form-wrap', list: 'pm-comments-list' };
  // mountSeq: proje popup'ı hızla değiştirildiğinde önceki projenin yavaş kalan /api/comments
  // isteği, artık ekranda olan YENİ projenin yorum listesinin üzerine yazabiliyordu (gerçek bulgu —
  // bkz. kullanıcı isteği: "bir önceki projeyi kapatıp başka açıyorum, ilk açtığımı gösteriyor").
  // project-modal.js#requestSeq ile AYNI desen: her mount() kendi sıra numarasını alır, o an en
  // güncel mountSeq ile eşleşmeyen (= aradan yeni bir mount() başlamış) sonuçlar DOM'a yazılmaz.
  let mountSeq = 0;

  async function loadComments(targetId, ids, targetType, canModerate, mySeq) {
    const res = await fetch(`/api/comments?targetType=${encodeURIComponent(targetType)}&targetId=${encodeURIComponent(targetId)}`);
    if (mySeq !== mountSeq) return;
    const data = res.ok ? await res.json() : { items: [] };
    if (mySeq !== mountSeq) return;
    const items = data.items || [];
    // "Yorumlar (1)" biçimi, 0 yorumda TAMAMEN boş (kullanıcı isteği, 2026-09-17) — auth-modal.js#
    // loadArchive'daki "am-archive-count" ile AYNI desen (bkz. o dosyadaki `\` (${n})\` : ''`).
    document.getElementById(ids.count).textContent = items.length ? ` (${items.length})` : '';
    const list = document.getElementById(ids.list);
    if (!items.length) { list.innerHTML = ''; return; }
    list.innerHTML = items.map(c => {
      // canModerate artık admin'i de kapsıyor (bkz. mount()'taki YENİ satır) — server zaten
      // admin'i koşulsuz geçiriyordu, bu yalnızca düğmeyi görünür kılıyor.
      const canDelete = currentUser && (currentUser.id === c.user_id || canModerate);
      // Her yorum KOŞULSUZ kendi hesap kimliğiyle gösterilir (kullanıcı isteği, 2026-09-17) —
      // /kisi veya /firma'ya giden bir "commenterProfile" bağlantısı YOK, bkz. src/routes/
      // comments.js#listComments'teki AYNI gerekçe.
      const userInitials = escapeHtml((c.user_name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
      const userPhotoUrl = c.user_photo ? safeUrl(c.user_photo) : '';
      const avatarInner = `${userInitials}${userPhotoUrl ? `<img src="${escapeAttr(userPhotoUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`;
      const avatarHtml = `<div class="comment-avatar">${avatarInner}</div>`;
      const nameHtml = escapeHtml(c.user_name);
      return `
      <div class="comment-row">
        ${avatarHtml}
        <div style="flex:1;">
          <div class="comment-meta"><strong>${nameHtml}</strong>${badgeIconHtml(c.user_badge, 14)}<span>${new Date(c.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>${canDelete ? `<button type="button" class="comment-delete-btn" data-id="${escapeAttr(c.id)}" aria-label="Yorumu sil">Sil</button>` : ''}</div>
          <p class="comment-body-text">${escapeHtml(c.body)}</p>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.comment-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Bu yorumu silmek istediğine emin misin?')) return;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/comments/${btn.dataset.id}`, { method: 'DELETE' });
          if (res.ok) loadComments(targetId, ids, targetType, canModerate, mySeq);
        } finally { btn.disabled = false; }
      });
    });
  }

  function renderCommentForm(targetId, ids, targetType, mySeq) {
    const wrap = document.getElementById(ids.formWrap);
    if (!currentUser) {
      wrap.innerHTML = `<div class="comment-login-note">Yorum yapmak için <a href="/giris">giriş yap</a>.</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="comment-form">
        <div class="comment-input-wrap">
          <textarea id="pm-comment-input" placeholder="Bir yorum yaz..." maxlength="2000"></textarea>
          <button class="comment-submit-btn" id="pm-comment-submit-btn" type="button">Gönder</button>
        </div>
        <p class="comment-submit-notice" id="pm-comment-submit-notice" style="display:none;"></p>
      </div>`;
    const submitBtn = document.getElementById('pm-comment-submit-btn');
    submitBtn.addEventListener('click', async () => {
      const input = document.getElementById('pm-comment-input');
      const body = input.value.trim();
      if (!body) return;
      const notice = document.getElementById('pm-comment-submit-notice');
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/comments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType, targetId, body }),
        });
        // gerçek bulgu: mySeq kontrolü olmadan bu blok, kullanıcı gönderim beklerken hızlıca başka bir
        // projeye geçtiyse (renderCommentForm() aynı id'lerle yeni projenin formunu yeniden kurar)
        // input/notice'ı getElementById ile YENİ projenin DOM'undan buluyor — eski projenin "alındı"
        // bildirimini yeni projenin formuna yazıp, kullanıcı yeni formda yazmaya başlamışsa taslağını
        // sessizce siliyordu.
        if (mySeq !== mountSeq) return;
        // Yorum admin onayına düşer, hemen listede görünmez (bkz. src/routes/comments.js#listComments
        // status='approved' filtresi, kullanıcı isteği: yorum moderasyonu) — bu yüzden loadComments()
        // ÇAĞRILMAZ, kullanıcıya yalnızca bir bilgilendirme mesajı gösterilir.
        if (res.ok) {
          input.value = '';
          notice.textContent = 'Yorumunuz alındı. Admin onayından sonra yayınlanacaktır.';
          notice.style.display = '';
        }
      } finally { if (mySeq === mountSeq) submitBtn.disabled = false; }
    });
  }

  async function mount(container, slug, ids, options) {
    const mySeq = ++mountSeq;
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    const targetType = (options && options.targetType) || 'project';
    let canModerate = false;
    await savedWidgetReady;
    if (currentUser) {
      // Admin AYRICA burada kontrol edilir (kullanıcı isteği, 2026-09-17: "admine ... yorumu silme
      // yetkisi ver") — server (canDeleteComment) admin'i zaten koşulsuz geçiriyordu ama istemci
      // bunu hiç sormadığından Sil düğmesi admine popup'ta HİÇ görünmüyordu (yalnızca admin paneli
      // üzerinden silinebiliyordu). Diğer dallar bu durumda hiç çalıştırılmaz.
      if (currentUser.role === 'admin') {
        canModerate = true;
      } else {
      try {
        if (targetType === 'project') {
          // firma yöneticisi (YENİ, kullanıcı isteği, 2026-09-17: "firma yöneticisine yorumu silme
          // yetkisi ver") — projenin künyesindeki bir mimar/firma profilini onaylı sahiplenen
          // kullanıcı, /api/project/:slug/can-edit'in AYNI yetki kuralıyla (bkz. src/lib/
          // projectClaimAccess.js#canUserEditProjectBySlug, src/routes/comments.js#
          // canDeleteComment'teki AYNI ikinci yol). ESKİ yol (isOwner && hasActiveBadge)
          // DARALTILMADI — ikisi OR'lanır.
          const [projRes, badgesRes, canEditRes] = await Promise.all([
            fetch('/api/projects/mine'), fetch('/api/badges/mine'),
            fetch(`/api/project/${encodeURIComponent(slug)}/can-edit`),
          ]);
          const data = projRes.ok ? await projRes.json() : { items: [] };
          const isOwner = (data.items || []).some(it => it.slug === slug);
          const badgesData = badgesRes.ok ? await badgesRes.json() : { items: [] };
          const now = Date.now();
          const hasActiveBadge = (badgesData.items || []).some(b => b.status === 'active' && (!b.expires_at || b.expires_at > now));
          const canEditProject = canEditRes.ok ? !!(await canEditRes.json()).canEdit : false;
          canModerate = (isOwner && hasActiveBadge) || canEditProject;
        } else {
          // architect/office — src/routes/comments.js#canDeleteComment ile AYNI kural: rozet
          // ŞARTI YOK, yalnızca bu profil için onaylı bir profile_claims kaydı yeterli.
          const res = await fetch(`/api/claims/status?profileType=${targetType}&profileKey=${encodeURIComponent(slug)}`);
          const data = res.ok ? await res.json() : { status: 'none' };
          canModerate = data.status === 'approved';
        }
      } catch { /* yetki kontrolü başarısız — güvenli varsayılan: canModerate=false */ }
      }
    }
    if (mySeq !== mountSeq) return;
    renderCommentForm(slug, mergedIds, targetType, mySeq);
    await loadComments(slug, mergedIds, targetType, canModerate, mySeq);
  }

  return { mount };
})();
