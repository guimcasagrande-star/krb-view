/**
 * Script para lançar uma nova versão do KRB View no GitHub Releases.
 *
 * Uso:
 *   npm run lancar 0.2.0
 *
 * O que ele faz:
 * 1. Atualiza a versão em `package.json`, `src-tauri/tauri.conf.json` e `src-tauri/Cargo.toml`.
 * 2. Faz commit da nova versão e cria a tag `v<versao>`.
 * 3. Faz `git push origin main --tags` (disparando o GitHub Actions que gera o `.exe` e `.msi` na Release).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argVersao = process.argv[2]?.trim().replace(/^v/i, '');
if (!argVersao || !/^\d+\.\d+\.\d+$/.test(argVersao)) {
  console.error('Uso: npm run lancar <versao>   (ex.: npm run lancar 0.2.0)');
  process.exit(1);
}

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

console.log(`✓ Versão atualizada para ${argVersao} em package.json, tauri.conf.json e Cargo.toml.`);

const tag = `v${argVersao}`;
execFileSync('git', ['add', 'package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'], {
  stdio: 'inherit',
});
execFileSync('git', ['commit', '-m', `chore(release): ${tag}`], { stdio: 'inherit' });
execFileSync('git', ['tag', '-a', tag, '-m', `KRB View ${tag}`], { stdio: 'inherit' });
execFileSync('git', ['push', 'origin', 'main', '--tags'], { stdio: 'inherit' });

console.log(`\n🚀 Tag ${tag} enviada para o GitHub! O instalador será publicado automaticamente em Releases.`);
