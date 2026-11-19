//! Pasta de exames baixados do PACS (fase 11.4): gravar, listar, ler, medir e apagar.
//!
//! Tudo fica dentro de uma pasta-base escolhida pelo usuário (padrão: dados locais do programa).
//! Os caminhos relativos vêm de UIDs do servidor e são validados aqui: sem "..", sem caminho
//! absoluto, sem unidade. Nada fora da pasta-base é tocado.

use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
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
pub async fn exames_escolher_pasta(titulo: Option<String>) -> Result<Option<String>, String> {
    let mut dlg = rfd::AsyncFileDialog::new();
    if let Some(t) = titulo {
        dlg = dlg.set_title(t);
    }
    let escolhida = dlg.pick_folder().await;
    Ok(escolhida.map(|p| p.path().to_string_lossy().into_owned()))
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

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoLimpeza {
    pub removidos: usize,
    pub bytes_liberados: u64,
    pub total_restante: u64,
}

struct InfoEstudoCache {
    nome: String,
    caminho: PathBuf,
    bytes: u64,
    modificado: SystemTime,
}

fn resumo_pasta(pasta: &Path) -> (u64, SystemTime) {
    let mut total: u64 = 0;
    let mut recente = pasta
        .metadata()
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let Ok(itens) = fs::read_dir(pasta) else {
        return (0, recente);
    };
    for item in itens.flatten() {
        let caminho = item.path();
        if caminho.is_dir() {
            let (sub_bytes, sub_mod) = resumo_pasta(&caminho);
            total = total.saturating_add(sub_bytes);
            if sub_mod > recente {
                recente = sub_mod;
            }
        } else if let Ok(meta) = item.metadata() {
            total = total.saturating_add(meta.len());
            if let Ok(m) = meta.modified() {
                if m > recente {
                    recente = m;
                }
            }
        }
    }
    (total, recente)
}

fn limpar_cache_em_dir(
    base: &Path,
    limite_bytes: u64,
    proteger_estudo_uid: Option<&str>,
) -> Result<ResultadoLimpeza, String> {
    if !base.is_absolute() {
        return Err("A pasta de exames precisa ser um caminho completo.".into());
    }
    if !base.exists() {
        return Ok(ResultadoLimpeza {
            removidos: 0,
            bytes_liberados: 0,
            total_restante: 0,
        });
    }
    if limite_bytes == 0 {
        return Ok(ResultadoLimpeza {
            removidos: 0,
            bytes_liberados: 0,
            total_restante: tamanho(base),
        });
    }

    let mut estudos: Vec<InfoEstudoCache> = Vec::new();
    let mut bytes_soltos: u64 = 0;
    for item in fs::read_dir(base).map_err(|e| e.to_string())?.flatten() {
        let caminho = item.path();
        if caminho.is_dir() {
            let (bytes, modificado) = resumo_pasta(&caminho);
            let nome = item.file_name().to_string_lossy().into_owned();
            estudos.push(InfoEstudoCache {
                nome,
                caminho,
                bytes,
                modificado,
            });
        } else if let Ok(meta) = item.metadata() {
            bytes_soltos = bytes_soltos.saturating_add(meta.len());
        }
    }

    let mut total_atual = bytes_soltos.saturating_add(estudos.iter().map(|e| e.bytes).sum::<u64>());
    if total_atual <= limite_bytes {
        return Ok(ResultadoLimpeza {
            removidos: 0,
            bytes_liberados: 0,
            total_restante: total_atual,
        });
    }

    estudos.sort_by(|a, b| a.modificado.cmp(&b.modificado).then_with(|| a.nome.cmp(&b.nome)));

    let mut removidos = 0usize;
    let mut bytes_liberados = 0u64;
    for estudo in estudos {
        if total_atual <= limite_bytes {
            break;
        }
        if proteger_estudo_uid == Some(estudo.nome.as_str()) {
            continue;
        }
        fs::remove_dir_all(&estudo.caminho).map_err(|e| e.to_string())?;
        total_atual = total_atual.saturating_sub(estudo.bytes);
        bytes_liberados = bytes_liberados.saturating_add(estudo.bytes);
        removidos += 1;
    }

    Ok(ResultadoLimpeza {
        removidos,
        bytes_liberados,
        total_restante: total_atual,
    })
}

/// Remove pastas de estudos mais antigas (por timestamp de modificação mais recente) até ficar
/// dentro de `limite_bytes` (0 = sem limite), preservando `proteger_estudo_uid` se informado.
#[tauri::command]
pub fn exames_limpar_cache(
    base: String,
    limite_bytes: u64,
    proteger_estudo_uid: Option<String>,
) -> Result<ResultadoLimpeza, String> {
    limpar_cache_em_dir(
        Path::new(&base),
        limite_bytes,
        proteger_estudo_uid.as_deref().filter(|s| !s.is_empty()),
    )
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaidaTotalSegmentator {
    pub sessao_saida: String,
    pub nomes: Vec<String>,
}

struct LimpaDirTemp(Option<PathBuf>);
impl LimpaDirTemp {
    fn desarmar(&mut self) {
        self.0 = None;
    }
}
impl Drop for LimpaDirTemp {
    fn drop(&mut self) {
        if let Some(p) = &self.0 {
            let _ = fs::remove_dir_all(p);
        }
    }
}

fn dir_temp_sessao(prefixo: &str, sessao: &str) -> Result<PathBuf, String> {
    if sessao.is_empty()
        || !sessao
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Identificador de sessão temporária inválido.".into());
    }
    Ok(std::env::temp_dir().join(format!("{prefixo}_{sessao}")))
}

fn limpar_sessoes_ts_antigas() {
    let temp = std::env::temp_dir();
    let Ok(itens) = fs::read_dir(&temp) else { return };
    let agora = SystemTime::now();
    let max_idade = std::time::Duration::from_secs(24 * 60 * 60);
    for item in itens.flatten() {
        let nome = item.file_name().to_string_lossy().into_owned();
        if !nome.starts_with("visu_ts_in_") && !nome.starts_with("visu_ts_out_") {
            continue;
        }
        let caminho = item.path();
        if !caminho.is_dir() {
            continue;
        }
        let expirado = item
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| agora.duration_since(m).ok())
            .is_some_and(|idade| idade > max_idade);
        if expirado {
            let _ = fs::remove_dir_all(&caminho);
        }
    }
}

fn listar_niftis_nao_vazios(pasta: &Path) -> Result<Vec<String>, String> {
    let mut nomes = Vec::new();
    let itens =
        fs::read_dir(pasta).map_err(|e| format!("Falha ao ler saída do TotalSegmentator: {e}"))?;
    for item in itens.flatten() {
        let caminho = item.path();
        if !caminho.is_file() {
            continue;
        }
        let nome = item.file_name().to_string_lossy().into_owned();
        let lower = nome.to_ascii_lowercase();
        if !lower.ends_with(".nii") && !lower.ends_with(".nii.gz") {
            continue;
        }
        let meta = fs::metadata(&caminho).map_err(|e| e.to_string())?;
        if meta.len() == 0 {
            continue;
        }
        nomes.push(nome);
    }
    nomes.sort();
    Ok(nomes)
}

#[tauri::command]
pub async fn exames_gravar_temp(request: Request<'_>) -> Result<String, String> {
    let sessao = cabecalho(request.headers(), "x-ts-sessao")?;
    let nome = cabecalho(request.headers(), "x-ts-nome")?;
    let base = dir_temp_sessao("visu_ts_in", &sessao)?;
    let destino = juntar(&base.to_string_lossy(), &nome)?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        InvokeBody::Json(_) => return Err("Corpo binário bruto esperado em exames_gravar_temp.".into()),
    };
    if let Some(pai) = destino.parent() {
        tokio::fs::create_dir_all(pai)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(destino, bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(base.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn exames_limpar_temp(sessao: String) -> Result<(), String> {
    let base = dir_temp_sessao("visu_ts_in", &sessao)?;
    if base.exists() {
        let _ = tokio::fs::remove_dir_all(&base).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn exames_rodar_totalsegmentator(
    app: AppHandle,
    pasta_serie: String,
    tarefa: Option<String>,
    orgaos: Vec<String>,
    modo_rapido: bool,
) -> Result<SaidaTotalSegmentator, String> {
    tokio::task::spawn_blocking(move || {
        limpar_sessoes_ts_antigas();
        let entrada = Path::new(&pasta_serie);
        if !entrada.is_dir() {
            return Err(format!("Pasta da série não encontrada: {pasta_serie}"));
        }

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let sessao_saida = format!("{}_{}", std::process::id(), ts);
        let pasta_saida = dir_temp_sessao("visu_ts_out", &sessao_saida)?;
        fs::create_dir_all(&pasta_saida)
            .map_err(|e| format!("Falha ao criar pasta temporária: {e}"))?;
        let mut guard = LimpaDirTemp(Some(pasta_saida.clone()));

        crate::totalseg::executar_totalsegmentator_em_pasta(
            &app,
            &pasta_serie,
            &pasta_saida,
            tarefa.as_deref(),
            &orgaos,
            modo_rapido,
        )?;
        let nomes = listar_niftis_nao_vazios(&pasta_saida)?;
        guard.desarmar();

        Ok(SaidaTotalSegmentator {
            sessao_saida,
            nomes,
        })
    })
    .await
    .map_err(|e| format!("Falha interna ao aguardar TotalSegmentator: {e}"))?
}

#[tauri::command]
pub async fn exames_ler_saida_ts(sessao: String, nome: String) -> Result<Response, String> {
    let base = dir_temp_sessao("visu_ts_out", &sessao)?;
    let caminho = juntar(&base.to_string_lossy(), &nome)?;
    let bytes = tokio::fs::read(caminho)
        .await
        .map_err(|e| format!("Falha ao ler {nome}: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn exames_limpar_saida_ts(sessao: String) -> Result<(), String> {
    let base = dir_temp_sessao("visu_ts_out", &sessao)?;
    if base.exists() {
        let _ = tokio::fs::remove_dir_all(&base).await;
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;

    struct PastaTemp(PathBuf);
    impl PastaTemp {
        fn nova(nome: &str) -> Self {
            let p = std::env::temp_dir().join(format!("visu_{nome}_{}", std::process::id()));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for PastaTemp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn criar_estudo(base: &Path, uid: &str, tamanho_bytes: usize) {
        let dir = base.join(uid).join("serie1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("img.dcm"), vec![7u8; tamanho_bytes]).unwrap();
    }

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

    #[test]
    fn limpa_estudo_mais_antigo_ate_respeitar_limite() {
        let tmp = PastaTemp::nova("cache_lru");
        criar_estudo(&tmp.0, "estudo_1_antigo", 1000);
        std::thread::sleep(std::time::Duration::from_millis(30));
        criar_estudo(&tmp.0, "estudo_2_meio", 1000);
        std::thread::sleep(std::time::Duration::from_millis(30));
        criar_estudo(&tmp.0, "estudo_3_novo", 1000);

        let res = limpar_cache_em_dir(&tmp.0, 2000, Some("estudo_3_novo")).unwrap();
        assert_eq!(res.removidos, 1);
        assert_eq!(res.bytes_liberados, 1000);
        assert_eq!(res.total_restante, 2000);
        assert!(!tmp.0.join("estudo_1_antigo").exists());
        assert!(tmp.0.join("estudo_2_meio").exists());
        assert!(tmp.0.join("estudo_3_novo").exists());
    }

    #[test]
    fn preserva_estudo_protegido_mesmo_quando_e_o_mais_antigo() {
        let tmp = PastaTemp::nova("cache_protegido");
        criar_estudo(&tmp.0, "estudo_protegido", 1000);
        std::thread::sleep(std::time::Duration::from_millis(30));
        criar_estudo(&tmp.0, "estudo_segundo", 1000);
        std::thread::sleep(std::time::Duration::from_millis(30));
        criar_estudo(&tmp.0, "estudo_novo", 1000);

        let res = limpar_cache_em_dir(&tmp.0, 2000, Some("estudo_protegido")).unwrap();
        assert_eq!(res.removidos, 1);
        assert_eq!(res.bytes_liberados, 1000);
        assert_eq!(res.total_restante, 2000);
        assert!(tmp.0.join("estudo_protegido").exists());
        assert!(!tmp.0.join("estudo_segundo").exists());
        assert!(tmp.0.join("estudo_novo").exists());
    }

    #[test]
    fn limite_zero_desativa_limpeza() {
        let tmp = PastaTemp::nova("cache_sem_limite");
        criar_estudo(&tmp.0, "estudo_a", 500);
        criar_estudo(&tmp.0, "estudo_b", 500);

        let res = limpar_cache_em_dir(&tmp.0, 0, None).unwrap();
        assert_eq!(res.removidos, 0);
        assert_eq!(res.bytes_liberados, 0);
        assert_eq!(res.total_restante, 1000);
        assert!(tmp.0.join("estudo_a").exists());
        assert!(tmp.0.join("estudo_b").exists());
    }

    #[test]
    fn lista_apenas_niftis_nao_vazios_ordenados() {
        let tmp = PastaTemp::nova("ts_nifti");
        fs::write(tmp.0.join("liver.nii.gz"), vec![1u8; 32]).unwrap();
        fs::write(tmp.0.join("aorta.nii"), vec![2u8; 16]).unwrap();
        fs::write(tmp.0.join("vazio.nii.gz"), Vec::<u8>::new()).unwrap();
        fs::write(tmp.0.join("log.txt"), b"ignorar").unwrap();

        let nomes = listar_niftis_nao_vazios(&tmp.0).unwrap();
        assert_eq!(nomes, vec!["aorta.nii", "liver.nii.gz"]);
    }

    #[test]
    fn valida_sessao_temp_e_impede_traversal() {
        assert!(dir_temp_sessao("visu_ts_out", "1234_abc").is_ok());
        assert!(dir_temp_sessao("visu_ts_out", "../fora").is_err());
        let base = dir_temp_sessao("visu_ts_out", "1234_abc").unwrap();
        assert!(juntar(&base.to_string_lossy(), "liver.nii.gz").is_ok());
        assert!(juntar(&base.to_string_lossy(), "../segredo.nii.gz").is_err());
    }
}
