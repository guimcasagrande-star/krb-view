//! Pasta de exames baixados do PACS (fase 11.4): gravar, listar, ler, medir e apagar.
//!
//! Tudo fica dentro de uma pasta-base escolhida pelo usuário (padrão: dados locais do programa).
//! Os caminhos relativos vêm de UIDs do servidor e são validados aqui: sem "..", sem caminho
//! absoluto, sem unidade. Nada fora da pasta-base é tocado.

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::{AppHandle, Manager};

fn juntar(base: &str, relativo: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(base);
    if !base.is_absolute() {
        return Err("A pasta de exames precisa ser um caminho completo.".into());
    }
    let rel = Path::new(relativo);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("Caminho de arquivo inválido.".into());
    }
    Ok(base.join(rel))
}

#[tauri::command]
pub fn exames_pasta_padrao(app: AppHandle) -> Result<String, String> {
    let pasta = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("exames");
    fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    Ok(pasta.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn exames_gravar(base: String, relativo: String, dados: String) -> Result<(), String> {
    let destino = juntar(&base, &relativo)?;
    let bytes = B64.decode(dados).map_err(|e| e.to_string())?;
    if let Some(pai) = destino.parent() {
        fs::create_dir_all(pai).map_err(|e| e.to_string())?;
    }
    fs::write(destino, bytes).map_err(|e| e.to_string())
}

fn percorrer(pasta: &Path, base: &Path, saida: &mut Vec<String>) {
    let Ok(itens) = fs::read_dir(pasta) else { return };
    for item in itens.flatten() {
        let caminho = item.path();
        if caminho.is_dir() {
            percorrer(&caminho, base, saida);
        } else if let Ok(rel) = caminho.strip_prefix(base) {
            saida.push(rel.to_string_lossy().replace("\\", "/"));
        }
    }
}

/// Lista os arquivos de uma subpasta (caminhos relativos à pasta-base, com "/").
#[tauri::command]
pub fn exames_listar(base: String, relativo: String) -> Result<Vec<String>, String> {
    let pasta = if relativo.is_empty() {
        PathBuf::from(&base)
    } else {
        juntar(&base, &relativo)?
    };
    let mut saida = Vec::new();
    percorrer(&pasta, Path::new(&base), &mut saida);
    saida.sort();
    Ok(saida)
}

#[tauri::command]
pub fn exames_ler(base: String, relativo: String) -> Result<String, String> {
    let caminho = juntar(&base, &relativo)?;
    let bytes = fs::read(caminho).map_err(|e| e.to_string())?;
    Ok(B64.encode(bytes))
}

fn tamanho(pasta: &Path) -> u64 {
    let Ok(itens) = fs::read_dir(pasta) else { return 0 };
    itens
        .flatten()
        .map(|i| {
            let c = i.path();
            if c.is_dir() {
                tamanho(&c)
            } else {
                i.metadata().map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

/// Espaço ocupado pela pasta-base, em bytes.
#[tauri::command]
pub fn exames_tamanho(base: String) -> u64 {
    tamanho(Path::new(&base))
}

/// Apaga uma subpasta (um estudo) ou, com `relativo` vazio, todo o conteúdo da pasta-base.
#[tauri::command]
pub fn exames_apagar(base: String, relativo: String) -> Result<(), String> {
    if relativo.is_empty() {
        let b = PathBuf::from(&base);
        if !b.is_absolute() {
            return Err("A pasta de exames precisa ser um caminho completo.".into());
        }
        for item in fs::read_dir(&b).map_err(|e| e.to_string())?.flatten() {
            let c = item.path();
            if c.is_dir() {
                fs::remove_dir_all(&c).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&c).map_err(|e| e.to_string())?;
            }
        }
        return Ok(());
    }
    let alvo = juntar(&base, &relativo)?;
    if alvo.is_dir() {
        fs::remove_dir_all(alvo).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}
