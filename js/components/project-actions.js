// ProjectActions — Kaydet/Düzenle/Arşivle/Sil buton satırı. proje-detay.html#mountEditButton/
// mountAdminModerationButtons/runProjectModeration'ın taşınmış hâli; save-widget.js'in paylaşılan
// wireSaveButtons/editSubmissionBtnHtml fonksiyonlarını AYNEN yeniden kullanır (bkz. kullanıcı
// isteği: mevcut çalışan yardımcı fonksiyonları tekrar üretme).
const ProjectActions = (function () {
  const DEFAULT_IDS = { root: 'pm-actions' };

  function saveBtnHtml(item) {
    return `
      <button class="save-btn card-save-btn" id="pm-save-btn" type="button" data-key="${escapeAttr(item.slug)}" data-title="${escapeAttr(item.title)}" data-meta="${escapeAttr(item.location || '')}" data-image="${escapeAttr((item.images && item.images[0]) || '')}" data-href="/projeler/${encodeURIComponent(item.slug)}" aria-label="Kaydet">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z"/></svg>
        <span class="save-btn-label-default">Kaydet</span>
        <span class="save-btn-label-saved">Kaydedildi</span>
      </button>
      <span class="save-count" id="pm-save-count"></span>
      <span id="pm-edit-submission-slot"></span>
      <span id="pm-admin-actions-slot"></span>`;
  }

  async function mountEditButton(item) {
    await savedWidgetReady;
    const slot = document.getElementById('pm-edit-submission-slot');
    if (item.submissionId) {
      const html = await editSubmissionBtnHtml('projects', item.submissionId);
      if (html) slot.innerHTML = html;
    } else if (currentUser && currentUser.role === 'admin') {
      slot.innerHTML = `<a class="card-edit-btn" href="proje-ekle.html?claim=${encodeURIComponent(item.slug)}">Düzenle</a>`;
    }
  }

  function mountAdminModerationButtons(item) {
    if (!currentUser || currentUser.role !== 'admin') return;
    const slot = document.getElementById('pm-admin-actions-slot');
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

  function render(item, ids) {
    const mergedIds = Object.assign({}, DEFAULT_IDS, ids || {});
    document.getElementById(mergedIds.root).innerHTML = saveBtnHtml(item);
    wireSaveButtons('project');
    fetch(`/api/public/save-count?type=project&key=${encodeURIComponent(item.slug)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) document.getElementById('pm-save-count').textContent = data.count > 0 ? `${data.count} kez kaydedildi` : ''; })
      .catch(() => {});
    mountEditButton(item).then(() => mountAdminModerationButtons(item));
  }

  return { render };
})();
