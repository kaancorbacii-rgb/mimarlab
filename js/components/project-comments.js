// ProjectComments — yorum listesi/yazma formu/silme. proje-detay.html#loadComments/
// renderCommentForm/initComments'in taşınmış hâli, BİREBİR aynı /api/comments sözleşmesi ve silme
// yetki mantığı (bkz. kullanıcı isteği: v1'de yalnızca mevcut düz liste, reply/like YOK — ayrı bir
// işe bırakıldı). Tek fark: sabit sayfa id'leri yerine bir konteyner elemanı alır (bkz. kullanıcı
// isteği: modüler, ileride başka bir varlık modalında da kullanılabilir bir yapı).
//
// targetType (mount()'un 4. argümanı, options.targetType) — varsayılan 'project'; bileşen 'architect'/
// 'office' hedeflerini de destekleyecek şekilde tasarlandı ama şu an yalnızca project-modal.js
// tarafından, varsayılan değerle çağrılıyor. Sahiplik/moderasyon kontrolü hedefe göre DEĞİŞİR: 'project' için
// gönderi sahipliği + aktif rozet (mevcut davranış, DEĞİŞMEDİ); 'architect'/'office' için
// src/routes/comments.js#canDeleteComment'teki AYNI kural — profile_claims'te onaylı sahiplik yeterli,
// rozet ŞARTI YOK.
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
    document.getElementById(ids.count).textContent = items.length;
    const list = document.getElementById(ids.list);
    if (!items.length) { list.innerHTML = ''; return; }
    list.innerHTML = items.map(c => {
      const canDelete = currentUser && (currentUser.id === c.user_id || canModerate);
      // commenterProfile: yorumcunun hesabı bir mimar/firma profiline bağlıysa (bkz.
      // src/routes/comments.js#listComments) varsayılan baş harf avatarı/düz isim yerine profil
      // fotoğrafı+adı gösterilir, ikisi de /mimar veya /firma sayfasına link olur (kullanıcı isteği).
      // href, proje künyesindeki designer-chip ile AYNI kuralı (slugify(name), stored slug değil —
      // bkz. js/components/project-meta.js#designerChipHtml yorumu) izler.
      const cp = c.commenterProfile;
      const profileHref = cp ? escapeAttr(`/${cp.type === 'architect' ? 'mimar' : 'firma'}/${encodeURIComponent(slugify(cp.name))}`) : null;
      const userInitials = escapeHtml((c.user_name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
      // commenterProfile yoksa (mimar/firma sahiplenmesi olmayan sıradan üye) kendi hesap
      // fotoğrafı (users.photo_url) gösterilir, o da yoksa baş harflere düşülür (kullanıcı isteği).
      const cpPhotoUrl = cp && cp.photo ? safeUrl(cp.photo) : '';
      const userPhotoUrl = c.user_photo ? safeUrl(c.user_photo) : '';
      const avatarInner = cp
        ? `${escapeHtml(initials(cp.name))}${cpPhotoUrl ? `<img src="${escapeAttr(cpPhotoUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`
        : `${userInitials}${userPhotoUrl ? `<img src="${escapeAttr(userPhotoUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`;
      const avatarHtml = cp
        ? `<a class="comment-avatar" href="${profileHref}" style="background:${officeColor(cp.name)}">${avatarInner}</a>`
        : `<div class="comment-avatar">${avatarInner}</div>`;
      const nameHtml = cp ? `<a class="comment-author-link" href="${profileHref}">${escapeHtml(cp.name)}</a>` : escapeHtml(c.user_name);
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
      try {
        if (targetType === 'project') {
          const [projRes, badgesRes] = await Promise.all([fetch('/api/projects/mine'), fetch('/api/badges/mine')]);
          const data = projRes.ok ? await projRes.json() : { items: [] };
          const isOwner = (data.items || []).some(it => it.slug === slug);
          const badgesData = badgesRes.ok ? await badgesRes.json() : { items: [] };
          const now = Date.now();
          const hasActiveBadge = (badgesData.items || []).some(b => b.status === 'active' && (!b.expires_at || b.expires_at > now));
          canModerate = isOwner && hasActiveBadge;
        } else {
          // architect/office — src/routes/comments.js#canDeleteComment ile AYNI kural: rozet
          // ŞARTI YOK, yalnızca bu profil için onaylı bir profile_claims kaydı yeterli.
          const res = await fetch(`/api/claims/status?profileType=${targetType}&profileKey=${encodeURIComponent(slug)}`);
          const data = res.ok ? await res.json() : { status: 'none' };
          canModerate = data.status === 'approved';
        }
      } catch { /* yetki kontrolü başarısız — güvenli varsayılan: canModerate=false */ }
    }
    if (mySeq !== mountSeq) return;
    renderCommentForm(slug, mergedIds, targetType, mySeq);
    await loadComments(slug, mergedIds, targetType, canModerate, mySeq);
  }

  return { mount };
})();
