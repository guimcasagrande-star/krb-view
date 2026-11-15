//! Pasta de exames baixados do PACS (fase 11.4): gravar, listar, ler, medir e apagar.
//!
//! Tudo fica dentro de uma pasta-base escolhida pelo usuário (padrão: dados locais do programa).
//! Os caminhos relativos vêm de UIDs do servidor e são validados aqui: sem "..", sem caminho
//! absoluto, sem unidade. Nada fora da pasta-base é tocado.

use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use tauri::{
    http::HeaderMap,
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager,
};

fn decodificar_uri_component(s: &str) -> Result<String, String> {
    let raw = s.as_bytes();
    let mut out = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'%' && i + 2 < raw.len() {
            let hex = std::str::from_utf8(&raw[i + 1..i + 3])
                .map_err(|_| "Cabeçalho com codificação inválida.".to_string())?;
            let byte = u8::from_str_radix(hex, 16)
                .map_err(|_| "Cabeçalho com escape hexadecimal inválido.".to_string())?;
            out.push(byte);
            i += 3;
        } else {
            out.push(raw[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Cabeçalho UTF-8 inválido.".to_string())
}

fn cabecalho(headers: &HeaderMap, nome: &str) -> Result<String, String> {
    let valor = headers
        .get(nome)
        .ok_or_else(|| format!("Cabeçalho obrigatório ausente: {nome}"))?
        .to_str()
        .map_err(|_| format!("Cabeçalho inválido: {nome}"))?;
    decodificar_uri_component(valor)
}

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
pub async fn exames_gravar(request: Request<'_>) -> Result<(), String> {
    let base = cabecalho(request.headers(), "x-exame-base")?;
    let relativo = cabecalho(request.headers(), "x-exame-relativo")?;
    let destino = juntar(&base, &relativo)?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("Corpo binário bruto esperado em exames_gravar.".into()),
    };
    if let Some(pai) = destino.parent() {
        tokio::fs::create_dir_all(pai)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(destino, bytes)
        .await
        .map_err(|e| e.to_string())
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
pub async fn exames_ler(base: String, relativo: String) -> Result<Response, String> {
    let caminho = juntar(&base, &relativo)?;
    let bytes = tokio::fs::read(caminho).await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
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

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn decodifica_caminho_windows_utf8() {
        let encoded = "C%3A%5CUsers%5CJo%C3%A3o%20Silva%5CExames%20M%C3%A9dicos%2B1";
        assert_eq!(
            decodificar_uri_component(encoded).unwrap(),
            "C:\\Users\\João Silva\\Exames Médicos+1"
        );
    }

    #[test]
    fn recusa_escape_invalido_em_cabecalho() {
        assert!(decodificar_uri_component("%ZZ").is_err());
        assert!(decodificar_uri_component("abc%2").is_ok()); // '%' seguido de menos de 2 chars passa literal
    }
}
