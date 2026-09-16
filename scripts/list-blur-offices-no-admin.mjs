#!/usr/bin/env node
// Blurlu (preview_at dolu, hidden_at boş) olup yönetici atanmayan firmalar
// En çok proje sahibinden az proje sahibine doğru sıralanmış

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

globalThis.caches ||= {
  default: {
    match: async () => undefined,
    put: async () => {},
    delete: async () => true
  }
};

const cfgPath = join(homedir(), '.wrangler', 'state', 'v3', '.env.${environment}.local');
const wranglerConfig = JSON.parse(readFileSync(join(homedir(), '.wrangler', 'config-cache.json'), 'utf8').catch(() => '{}'));

import CloudflareDatabases from 'wrangler';

// Cloudflare API ile D1'ye bağlan
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !apiToken) {
  console.error('Error: CLOUDFLARE_ACCOUNT_ID veya CLOUDFLARE_API_TOKEN set edilmemiş');
  process.exit(1);
}

const dbId = 'mimarlab'; // D1 database ID

const query = `
SELECT
  o.slug,
  o.name,
  COUNT(DISTINCT p.id) as project_count,
  o.preview_at,
  o.created_at
FROM offices o
LEFT JOIN projects p ON p.office_id = o.id AND p.hidden_at IS NULL
WHERE
  o.preview_at IS NOT NULL
  AND o.hidden_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM profile_claims
    WHERE profile_type = 'office'
      AND profile_key = o.slug
      AND status = 'approved'
  )
GROUP BY o.id, o.slug, o.name, o.preview_at, o.created_at
ORDER BY project_count DESC, o.name ASC;
`;

try {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: query }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`API Error (${response.status}):`, error);
    process.exit(1);
  }

  const result = await response.json();

  if (result.success) {
    const results = result.result[0]?.results || [];

    console.log('\n=== BLURLU FIRMALAR (YÖNETİCİ ATANMAMIŞ) ===\n');
    console.log(`Toplam: ${results.length} firma\n`);

    if (results.length === 0) {
      console.log('Hiçbir firma bulunamadı.\n');
    } else {
      console.log('Slug\t\t\t\tAdı\t\t\t\tProje Sayısı');
      console.log('-'.repeat(100));

      results.forEach((row, idx) => {
        const previewAt = new Date(row.preview_at).toLocaleDateString('tr-TR');
        console.log(
          `${row.slug.padEnd(30)}\t${row.name.padEnd(30)}\t${row.project_count}` +
          `\n  → Blur tarihi: ${previewAt}\n`
        );
      });
    }
  } else {
    console.error('Query Error:', result.errors);
    process.exit(1);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
