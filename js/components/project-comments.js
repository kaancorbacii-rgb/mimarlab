// ProjectComments — yorum listesi/yazma formu/silme. proje-detay.html#loadComments/
// renderCommentForm/initComments'in taşınmış hâli, BİREBİR aynı /api/comments sözleşmesi ve silme
// yetki mantığı (bkz. kullanıcı isteği: v1'de yalnızca mevcut düz liste, reply/like YOK — ayrı bir
// işe bırakıldı). Tek fark: sabit sayfa id'leri yerine bir konteyner elemanı alır (bkz. kullanıcı
// isteği: modüler, ileride başka bir varlık modalında da kullanılabilir bir yapı).
const ProjectComments = (function () {
  const DEFAULT_IDS = { count: 'pm-comments-count', formWrap: 'pm-comment-form-wrap', list: 'pm-comments-list' };
  let canModerate = false;

  async function loadComments(targetId, ids) {
    const res = await fetch(`/api/comments?targetType=project&targetId=${encodeURIComponent(targetId)}`);
    const data = res.ok ? await res.json() : { items: [] };
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
      const profileHref = cp ? `/${cp.type === 'architect' ? 'mimar' : 'firma'}/${encodeURIComponent(slugify(cp.name))}` : null;
      const userInitials = escapeHtml((c.user_name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
      // commenterProfile yoksa (mimar/firma sahiplenmesi olmayan sıradan üye) kendi hesap
      // fotoğrafı (users.photo_url) gösterilir, o da yoksa baş harflere düşülür (kullanıcı isteği).
      const avatarInner = cp
        ? `${escapeHtml(initials(cp.name))}${cp.photo ? `<img src="${escapeAttr(cp.photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`
        : `${userInitials}${c.user_photo ? `<img src="${escapeAttr(c.user_photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ''}`;
      const avatarHtml = cp
        ? `<a class="comment-avatar" href="${profileHref}" style="background:${officeColor(cp.name)}">${avatarInner}</a>`
        : `<div class="comment-avatar">${avatarInner}</div>`;
      const nameHtml = cp ? `<a class="comment-author-link" href="${profileHref}">${escapeHtml(cp.name)}</a>` : escapeHtml(c.user_name);
      return `
      <div class="comment-row">
        ${avatarHtml}
        <div style="flex:1;">
          <div class="comment-meta"><strong>${nameHtml}</strong>${badgeIconHtml(c.user_badge, 14)}<span>${new Date(c.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>${canDelete ? `<button type="button" class="comment-delete-btn" data-id="${c.id}" aria-label="Yorumu sil">Sil</button>` : ''}</div>
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
          if (res.ok) loadComments(targetId, ids);
        } finally { btn.disabled = false; }
      });
    });
  }

  function renderCommentForm(targetId, ids) {
    const wrap = document.getElementById(ids.formWrap);
    if (!currentUser) {
      wrap.innerHTML = `<div class="comment-login-note">Yorum yapmak için <a href="giris-yap.html">giriş yap</a>.</div>`;
      return;
    }
    wrap.innerHTML = `
      <div class="comment-form">
        <div class="comment-input-wrap">
          <textarea id="pm-comment-input" placeholder="Bir yorum yaz..." maxlength="2000"></textarea>
          <button class="comment-submit-btn" id="pm-comment-submit-btn" type="button">Yorum Yap</button>
        </div>
      </div>`;
    const submitBtn = document.getElementById('pm-comment-submit-btn');
    submitBtn.addEventListener('click', async () => {
      const input = document.getElementById('pm-comment-input');
      const body = input.value.trim();
      if (!body) return;
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/comments', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'project', targetId, body }),
        });
        if (res.ok) { input.value = ''; loadComments(targetId, ids); }
      } finally { submitBtn.disabled = false; }
    });
  }

  async function mount(container, slug, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    canModerate = false;
    await savedWidgetReady;
    if (currentUser) {
      try {
        const [projRes, badgesRes] = await Promise.all([fetch('/api/projects/mine'), fetch('/api/badges/mine')]);
        const data = projRes.ok ? await projRes.json() : { items: [] };
        const isOwner = (data.items || []).some(it => it.slug === slug);
        const badgesData = badgesRes.ok ? await badgesRes.json() : { items: [] };
        const now = Date.now();
        const hasActiveBadge = (badgesData.items || []).some(b => b.status === 'active' && (!b.expires_at || b.expires_at > now));
        canModerate = isOwner && hasActiveBadge;
      } catch { /* yetki kontrolü başarısız — güvenli varsayılan: canModerate=false */ }
    }
    renderCommentForm(slug, mergedIds);
    await loadComments(slug, mergedIds);
  }

  return { mount };
})();
