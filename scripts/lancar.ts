/**
 * Script para lançar uma nova versão do KRB View no GitHub Releases.
 *
 * Uso:
 *   npm run lancar 0.1.2
 *
 * O que ele faz:
 * 1. Atualiza a versão em `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
 * 2. Compila os instaladores `.exe` e `.msi` localmente (`npm run tauri build`).
 * 3. Faz commit da nova versão, cria a tag `v<versao>` e envia para o GitHub.
 * 4. Publica a Release e anexa os instaladores diretamente na API do GitHub (usando a credencial do Git).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'guimcasagrande-star/krb-view';

const argVersao = process.argv[2]?.trim().replace(/^v/i, '');
if (!argVersao || !/^\d+\.\d+\.\d+$/.test(argVersao)) {
  console.error('Uso: npm run lancar <versao>   (ex.: npm run lancar 0.1.2)');
  process.exit(1);
}

const notasExtras = process.argv.slice(3).join(' ').trim();
const raiz = process.cwd();

// 1. package.json
const pkgPath = resolve(raiz, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
pkg.version = argVersao;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// 2. src-tauri/tauri.conf.json
const tauriConfPath = resolve(raiz, 'src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8')) as { version: string };
tauriConf.version = argVersao;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');

// 3. src-tauri/Cargo.toml
const cargoPath = resolve(raiz, 'src-tauri/Cargo.toml');
const cargoTxt = readFileSync(cargoPath, 'utf8');
const cargoNovo = cargoTxt.replace(/^version\s*=\s*"[^"]+"/m, `version = "${argVersao}"`);
writeFileSync(cargoPath, cargoNovo, 'utf8');

console.log(`✓ Versão atualizada para ${argVersao}. Compilando instaladores...`);
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'tauri', 'build'], {
  stdio: 'inherit',
});

const tag = `v${argVersao}`;
execFileSync(
  'git',
  ['add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'],
  { stdio: 'inherit' },
);
execFileSync('git', ['commit', '-m', `chore(release): ${tag}`], { stdio: 'inherit' });
execFileSync('git', ['tag', '-f', '-a', tag, '-m', `KRB View ${tag}`], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'main', '--tags'], { stdio: 'inherit' });

// 4. Publica imediatamente no GitHub Releases com os binários locais já compilados
function obterTokenGit(): string | null {
  const res = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  if (res.status !== 0 || !res.stdout) return null;
  const m = /^password=(.+)$/m.exec(res.stdout);
  return m?.[1]?.trim() ?? null;
}

async function publicarReleaseDireto(): Promise<void> {
  const token = obterTokenGit();
  if (!token) {
    console.log('ℹ Token local não encontrado; o GitHub Actions publicará a Release em alguns minutos.');
    return;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'KRB-View-Release-Script',
  };
  const respCriar = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `KRB View ${tag}`,
      body: notasExtras || `Lançamento ${tag} do KRB View.`,
      draft: false,
      prerelease: false,
    }),
  });
  if (!respCriar.ok) {
    console.log('ℹ Release será finalizada pelo GitHub Actions.');
    return;
  }
  const rel = (await respCriar.json()) as { upload_url: string; html_url: string };
  const uploadBase = rel.upload_url.replace(/\{\?name,label\}$/, '');

  const arquivos: Array<{ caminho: string; nomeRemoto: string }> = [
    {
      caminho: resolve(raiz, `src-tauri/target/release/bundle/nsis/KRB View_${argVersao}_x64-setup.exe`),
      nomeRemoto: `KRB.View_${argVersao}_x64-setup.exe`,
    },
    {
      caminho: resolve(raiz, `src-tauri/target/release/bundle/msi/KRB View_${argVersao}_x64_en-US.msi`),
      nomeRemoto: `KRB.View_${argVersao}_x64_en-US.msi`,
    },
  ];

  for (const arq of arquivos) {
    if (!existsSync(arq.caminho)) continue;
    const bytes = readFileSync(arq.caminho);
    await fetch(`${uploadBase}?name=${encodeURIComponent(arq.nomeRemoto)}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
  }
  console.log(`\n🚀 Release ${tag} publicada instantaneamente: ${rel.html_url}`);
}

await publicarReleaseDireto();
