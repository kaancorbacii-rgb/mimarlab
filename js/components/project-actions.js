// ProjectActions — Kaydet/Paylaş/Düzenle buton satırı. proje-detay.html#mountEditButton'ın taşınmış
// hâli; save-widget.js'in paylaşılan wireSaveButtons/editSubmissionBtnHtml fonksiyonlarını AYNEN
// yeniden kullanır (bkz. kullanıcı isteği: mevcut çalışan yardımcı fonksiyonları tekrar üretme).
// Kaydet/Paylaş X'in yanında (ModalShell.getHeaderActionsSlot()), Düzenle ise X'in KARŞI kenarında
// (ModalShell.getAdminActionsSlot()) render edilir. Arşivle/Sil ARTIK popup'ta DEĞİL (bkz. kullanıcı
// isteği: "Arşivle ve Sil butonlarını popup'tan kaldır") — proje-ekle.html?claim=/?edit=
// (mountProjectAdminActions, Değişiklikleri Kaydet'in altında) üzerinden erişilir; o dosyadaki
// runOwnerArchive/runOwnerDelete/runModeration'ın AYNI mantığı (owner → /api/project/:slug/moderate
// + DELETE, admin → /api/admin/legacy/project-action) burada TEKRAR ÜRETİLMEDEN oraya taşındı.
const ProjectActions = (function () {
  // renderSeq: project-comments.js#mountSeq ile AYNI desen/gerekçe — proje popup'ı hızla
  // değiştirildiğinde önceki projenin yavaş kalan sahiplik (/api/projects/mine) ya da kayıt-sayısı
  // isteği, artık ekranda olan YENİ projenin Düzenle/Sil butonlarını ya da Kaydet sayacını ezmesin diye.
  let renderSeq = 0;

  function saveBtnHtml(item) {
    const hrefPrefix = '/proje/';
    return `
      <!-- data-save-chooser: kullanıcı isteği (2026-09-01 madde 5) — proje POPUP'ının Kaydet
           butonu tıklanınca doğrudan kaydetmez, "Kaydedilenler / Pano" seçicisini açar (bkz.
           save-widget.js#openSaveChooser). Izgara kartlarındaki .card-save-btn'ler bu bayrağı
           TAŞIMAZ, onlarda tek tıkla kaydet davranışı aynen kalır. -->
      <button class="save-btn card-save-btn" id="pm-save-btn" type="button" data-save-chooser="1" aria-haspopup="dialog" aria-expanded="false" data-key="${escapeAttr(item.slug)}" data-title="${escapeAttr(item.title)}" data-meta="${escapeAttr(item.location || '')}" data-image="${escapeAttr((item.images && item.images[0]) || '')}" data-href="${hrefPrefix}${encodeURIComponent(item.slug)}" aria-label="Kaydet">
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
  // yöntemle burada da sahiplik belirlemek için sorgulanır. Admin için "Düzenle" her zaman claim
  // linkine gider. Kendi göndermediği ama künyesindeki bir mimar/firmayı onaylı bir profile_claims
  // ile sahiplendiği bir proje için de (bkz. kullanıcı isteği: "o firmaya/mimara ait projelerde de
  // istediği zaman değişiklik yapabilsin") GET /api/project/:slug/can-edit ile AYNI Düzenle linki
  // gösterilir. Arşivle/Sil ARTIK burada render EDİLMEZ (bkz. dosya başı yorumu) — Düzenle linkinin
  // hedeflediği proje-ekle.html sayfası kendi yetki kontrolünü tekrar yapıp onları orada gösterir.
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
    } else if (currentUser.role === 'admin') {
      editSlot.innerHTML = `<a class="card-edit-btn" href="/proje-ekle?claim=${encodeURIComponent(item.slug)}">Düzenle</a>`;
    } else {
      let canEdit = false;
      try {
        const res = await fetch(`/api/project/${encodeURIComponent(item.slug)}/can-edit`);
        canEdit = res.ok && (await res.json()).canEdit;
      } catch { /* claim tabanlı yetki kontrolü başarısız — güvenli varsayılan: buton gösterme */ }
      if (mySeq !== renderSeq) return;
      if (canEdit) {
        editSlot.innerHTML = `<a class="card-edit-btn" href="/proje-ekle?claim=${encodeURIComponent(item.slug)}">Düzenle</a>`;
      }
    }
  }

  function render(item) {
    const mySeq = ++renderSeq;
    const headerActions = ModalShell.getHeaderActionsSlot();
    if (headerActions) headerActions.innerHTML = saveBtnHtml(item) + (typeof ShareWidget !== 'undefined' ? ShareWidget.html('pm-share-btn') : '');
    const adminActions = ModalShell.getAdminActionsSlot();
    if (adminActions) adminActions.innerHTML = `<span id="pm-edit-submission-slot"></span>`;
    wireSaveButtons('project');
    if (typeof ShareWidget !== 'undefined') {
      // type/key/image/meta — yalnızca Aktivitelerim > Paylaştıklarım kaydı için (bkz.
      // js/components/share-button.js#logShare); paylaşımın kendisini hiç etkilemez. Anahtar
      // konvansiyonu Kaydet ile AYNI (proje: slug).
      ShareWidget.wire('pm-share-btn', () => ({
        title: item.title,
        url: `${window.location.origin}/proje/${encodeURIComponent(item.slug)}`,
        type: 'project', key: item.slug,
        image: (item.images && item.images[0]) || '',
        meta: [item.location, item.date].filter(Boolean).join(' · '),
      }));
    }
    fetch(`/api/public/save-count?type=project&key=${encodeURIComponent(item.slug)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (mySeq !== renderSeq) return; const el = document.getElementById('pm-save-count'); if (data && el) el.textContent = data.count > 0 ? ` (${data.count})` : ''; })
      .catch(() => {});
    mountOwnerActions(item, mySeq);
  }

  return { render };
})();
