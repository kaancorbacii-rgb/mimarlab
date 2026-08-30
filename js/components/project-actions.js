// ProjectActions — Kaydet/Paylaş/Düzenle/Arşivle/Sil buton satırı. proje-detay.html#mountEditButton/
// mountAdminModerationButtons/runProjectModeration'ın taşınmış hâli; save-widget.js'in paylaşılan
// wireSaveButtons/editSubmissionBtnHtml fonksiyonlarını AYNEN yeniden kullanır (bkz. kullanıcı
// isteği: mevcut çalışan yardımcı fonksiyonları tekrar üretme). Kaydet/Paylaş ARTIK Puanlama
// satırında DEĞİL — X'in yanında (ModalShell.getHeaderActionsSlot()), Düzenle/Arşivle/Sil ise X'in
// KARŞI kenarında (ModalShell.getAdminActionsSlot()) render edilir (bkz. kullanıcı isteği: aksiyon
// butonları X'in yanına, admin butonları satırın diğer ucuna taşınsın).
const ProjectActions = (function () {
  // renderSeq: project-comments.js#mountSeq ile AYNI desen/gerekçe — proje popup'ı hızla
  // değiştirildiğinde önceki projenin yavaş kalan sahiplik (/api/projects/mine) ya da kayıt-sayısı
  // isteği, artık ekranda olan YENİ projenin Düzenle/Sil butonlarını ya da Kaydet sayacını ezmesin diye.
  let renderSeq = 0;

  function saveBtnHtml(item) {
    const hrefPrefix = '/proje/';
    return `
      <button class="save-btn card-save-btn" id="pm-save-btn" type="button" data-key="${escapeAttr(item.slug)}" data-title="${escapeAttr(item.title)}" data-meta="${escapeAttr(item.location || '')}" data-image="${escapeAttr((item.images && item.images[0]) || '')}" data-href="${hrefPrefix}${encodeURIComponent(item.slug)}" aria-label="Kaydet">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>
        <span class="save-btn-label-default">Kaydet</span>
        <span class="save-btn-label-saved">Kaydedildi</span>
        <span class="save-btn-count" id="pm-save-count"></span>
      </button>`;
  }

  // Oturum açmış kullanıcının bu projeyi yükleyen/paylaşan kişi olup olmadığını kontrol eder (bkz.
  // kullanıcı isteği: "Kullanıcı Gönderi Düzenleme & Silme İzinleri") — /api/project/:slug yanıtı
  // hiçbir sahiplik/submission id'si taşımadığından (item.submissionId HER ZAMAN undefined'dı, bu
  // yüzden Düzenle butonu şimdiye dek fiilen HİÇBİR sahip için görünmüyordu — gerçek bulgu), aynı
  // /api/projects/mine ucu ve slug eşleşmesi ProjectComments#canModerate'te ZATEN kullanılan AYNI
  // yöntemle burada da sahiplik belirlemek için sorgulanır. Admin isteği bu sorguyu atlar — admin
  // için "Düzenle" her zaman claim linkine, "Sil/Arşivle" mountAdminModerationButtons'a gider
  // (mevcut davranış korunur). Kendi göndermediği ama künyesindeki bir mimar/firmayı onaylı bir
  // profile_claims ile sahiplendiği bir proje için de (bkz. kullanıcı isteği: "o firmaya/mimara ait
  // projelerde de istediği zaman değişiklik yapabilsin") GET /api/project/:slug/can-edit ile AYNI
  // Düzenle/Arşivle/Sil üçlüsü gösterilir.
  async function mountOwnerActions(item, mySeq) {
    await savedWidgetReady;
    const editSlot = document.getElementById('pm-edit-submission-slot');
    if (!currentUser || !editSlot) return;
    let mySubmission = null;
    if (currentUser.role !== 'admin') {
      try {
        const res = await fetch('/api/projects/mine');
        const data = res.ok ? await res.json() : { items: [] };
        mySubmission = (data.items || []).find(it => it.slug === item.slug || it.claimed_slug === item.slug) || null;
      } catch { /* sahiplik kontrolü başarısız — güvenli varsayılan: buton gösterme */ }
    }
    if (mySeq !== renderSeq) return;
    if (mySubmission) {
      const html = await editSubmissionBtnHtml('projects', mySubmission.id);
      if (html) editSlot.innerHTML = html;
      // Sahip için Arşivle + Sil — admin'in aynı çiftiyle AYNI görünüm (kullanıcı isteği: sahip
      // popup'ından Düzenle/Arşivle/Sil üçünü de görebilsin).
      mountClaimBasedActions(item);
    } else if (currentUser.role === 'admin') {
      editSlot.innerHTML = `<a class="card-edit-btn" href="proje-ekle.html?claim=${encodeURIComponent(item.slug)}">Düzenle</a>`;
    } else {
      let canEdit = false;
      try {
        const res = await fetch(`/api/project/${encodeURIComponent(item.slug)}/can-edit`);
        canEdit = res.ok && (await res.json()).canEdit;
      } catch { /* claim tabanlı yetki kontrolü başarısız — güvenli varsayılan: buton gösterme */ }
      if (mySeq !== renderSeq) return;
      if (canEdit) {
        editSlot.innerHTML = `<a class="card-edit-btn" href="proje-ekle.html?claim=${encodeURIComponent(item.slug)}">Düzenle</a>`;
        mountClaimBasedActions(item);
      }
    }
  }

  function mountClaimBasedActions(item) {
    const adminSlot = document.getElementById('pm-admin-actions-slot');
    adminSlot.innerHTML = `
      <button type="button" class="card-edit-btn" id="pm-owner-archive-btn">Arşivle</button>
      <button type="button" class="card-delete-btn" id="pm-owner-delete-btn">Sil</button>
    `;
    document.getElementById('pm-owner-archive-btn').addEventListener('click', () => runOwnerArchive(item));
    document.getElementById('pm-owner-delete-btn').addEventListener('click', () => runOwnerDelete(item));
  }

  async function runOwnerArchive(item) {
    if (!confirm('Bu projeyi arşivlemek istediğine emin misin? Proje canlıdan kaldırılıp hesabından tekrar düzenleyebilirsin.')) return;
    const btn = document.getElementById('pm-owner-archive-btn');
    const otherBtn = document.getElementById('pm-owner-delete-btn');
    if (btn) btn.disabled = true;
    if (otherBtn) otherBtn.disabled = true;
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(item.slug)}/moderate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive' }),
      });
      if (!res.ok) throw new Error('request failed');
      window.location.href = '/proje';
    } catch {
      alert('Bir şeyler ters gitti, tekrar dene.');
      if (btn) btn.disabled = false;
      if (otherBtn) otherBtn.disabled = false;
    }
  }

  async function runOwnerDelete(item) {
    if (!confirm('Bu projeyi silmek istediğine emin misin? Proje anında canlı siteden kaldırılır.')) return;
    const btn = document.getElementById('pm-owner-delete-btn');
    const otherBtn = document.getElementById('pm-owner-archive-btn');
    if (btn) btn.disabled = true;
    if (otherBtn) otherBtn.disabled = true;
    try {
      const res = await fetch(`/api/project/${encodeURIComponent(item.slug)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('request failed');
      window.location.href = '/proje';
    } catch {
      alert('Bir şeyler ters gitti, tekrar dene.');
      if (btn) btn.disabled = false;
      if (otherBtn) otherBtn.disabled = false;
    }
  }

  function mountAdminModerationButtons(item) {
    if (!currentUser || currentUser.role !== 'admin') return;
    const slot = document.getElementById('pm-admin-actions-slot');
    if (!slot) return;
    slot.innerHTML = `
      <button type="button" class="card-edit-btn" id="pm-archive-btn">Arşivle</button>
      <button type="button" class="card-delete-btn" id="pm-delete-btn">Sil</button>
    `;
    document.getElementById('pm-archive-btn').addEventListener('click', () => runModeration(item, 'archive'));
    document.getElementById('pm-delete-btn').addEventListener('click', () => runModeration(item, 'delete'));
  }

  async function runModeration(item, action) {
    const confirmText = action === 'delete'
      ? 'Bu projeyi silmek istediğine emin misin? Proje anında canlı siteden kaldırılır.'
      : 'Bu projeyi arşivlemek istediğine emin misin? Proje canlıdan kaldırılıp admin panelindeki Arşiv sekmesine taşınır.';
    if (!confirm(confirmText)) return;
    const btn = document.getElementById(action === 'delete' ? 'pm-delete-btn' : 'pm-archive-btn');
    const otherBtn = document.getElementById(action === 'delete' ? 'pm-archive-btn' : 'pm-delete-btn');
    if (btn) btn.disabled = true;
    if (otherBtn) otherBtn.disabled = true;
    try {
      const res = await fetch('/api/admin/legacy/project-action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.submissionId ? { action, id: item.submissionId } : { action, slug: item.slug }),
      });
      if (!res.ok) throw new Error('request failed');
      // Modal içinde olduğumuzdan proje.html'e tam sayfa yönlendirme yerine listeye geri dönülür —
      // ProjectModal kapatılır, arka plandaki liste (bu proje artık görünmeyecek şekilde) yeniden çekilir.
      window.location.href = '/proje';
    } catch {
      alert('Bir şeyler ters gitti, tekrar dene.');
      if (btn) btn.disabled = false;
      if (otherBtn) otherBtn.disabled = false;
    }
  }

  function render(item) {
    const mySeq = ++renderSeq;
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = saveBtnHtml(item) + (typeof ShareWidget !== 'undefined' ? ShareWidget.html('pm-share-btn') : '');
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = `<span id="pm-edit-submission-slot"></span><span id="pm-admin-actions-slot"></span>`;
    wireSaveButtons('project');
    if (typeof ShareWidget !== 'undefined') {
      ShareWidget.wire('pm-share-btn', () => ({ title: item.title, url: `${window.location.origin}/proje/${encodeURIComponent(item.slug)}` }));
    }
    fetch(`/api/public/save-count?type=project&key=${encodeURIComponent(item.slug)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (mySeq !== renderSeq) return; const el = document.getElementById('pm-save-count'); if (data && el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    mountOwnerActions(item, mySeq).then(() => { if (mySeq === renderSeq) mountAdminModerationButtons(item); });
  }

  return { render };
})();
