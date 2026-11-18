//! Verificador e instalador de atualizações via GitHub Releases (100% sob demanda por padrão).
//!
//! - Não faz nenhuma requisição de rede a menos que o usuário clique em "Verificar atualizações"
//!   (ou ative explicitamente a opção "Verificar ao iniciar" nas Configurações).
//! - Lê o último lançamento público (`https://api.github.com/repos/<dono>/<repo>/releases/latest`),
//!   compara a versão SemVer com `CARGO_PKG_VERSION`, localiza o instalador `.exe` (NSIS) ou `.msi`,
//!   valida o hash SHA-256 quando informado pelo GitHub e inicia o instalador.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::totalseg::configurar_janela_oculta;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigAtualizador {
    #[serde(default)]
    pub repositorio: String,
    #[serde(default)]
    pub verificar_ao_iniciar: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EstadoAtualizador {
    pub versao_atual: String,
    pub repositorio: String,
    pub verificar_ao_iniciar: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoVerificacaoAtualizacao {
    pub versao_atual: String,
    pub versao_remota: String,
    pub atualizacao_disponivel: bool,
    pub titulo: String,
    pub notas: String,
    pub publicado_em: Option<String>,
    pub nome_instalador: Option<String>,
    pub url_instalador: Option<String>,
    pub tamanho_bytes: Option<u64>,
    pub sha256_esperado: Option<String>,
    pub url_release: Option<String>,
}

fn caminho_config_atualizador(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Falha ao obter pasta local do aplicativo: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta local do aplicativo: {e}"))?;
    Ok(dir.join("atualizador.json"))
}

pub fn ler_config_atualizador(caminho: &Path) -> ConfigAtualizador {
    let Ok(texto) = fs::read_to_string(caminho) else {
        return ConfigAtualizador::default();
    };
    serde_json::from_str::<ConfigAtualizador>(&texto).unwrap_or_default()
}

pub fn gravar_config_atualizador(caminho: &Path, cfg: &ConfigAtualizador) -> Result<(), String> {
    if let Some(pai) = caminho.parent() {
        fs::create_dir_all(pai).map_err(|e| format!("Falha ao criar pasta: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Falha ao serializar configuração de atualização: {e}"))?;
    fs::write(caminho, json)
        .map_err(|e| format!("Falha ao salvar configuração de atualização: {e}"))
}

/// Normaliza `"dono/repo"` ou `"https://github.com/dono/repo..."` para `"dono/repo"`.
pub fn normalizar_repositorio_github(entrada: &str) -> Result<String, String> {
    let mut limpo = entrada.trim().trim_end_matches('/').to_string();
    if limpo.is_empty() {
        return Err("Informe o repositório do GitHub no formato usuario/repositorio.".into());
    }
    for prefixo in [
        "https://github.com/",
        "http://github.com/",
        "https://www.github.com/",
        "github.com/",
    ] {
        if let Some(resto) = limpo.strip_prefix(prefixo) {
            limpo = resto.to_string();
            break;
        }
    }
    if let Some(sem_git) = limpo.strip_suffix(".git") {
        limpo = sem_git.to_string();
    }
    let partes: Vec<&str> = limpo.split('/').filter(|s| !s.is_empty()).collect();
    if partes.len() < 2 {
        return Err(
            "Formato de repositório inválido. Use \"usuario/repositorio\" (ex.: guimc/Visu)."
                .into(),
        );
    }
    let dono = partes[0];
    let repo = partes[1];
    let valido = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    };
    if !valido(dono) || !valido(repo) {
        return Err("Nome de usuário ou repositório contém caracteres inválidos.".into());
    }
    Ok(format!("{dono}/{repo}"))
}

fn extrair_numeros_versao(v: &str) -> Vec<u64> {
    let sem_v = v
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("");
    sem_v
        .split('.')
        .map(|p| p.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

/// Compara duas versões SemVer (`> 0` se `remota > atual`, `0` se iguais, `< 0` se menor).
pub fn comparar_versoes(atual: &str, remota: &str) -> i32 {
    let a = extrair_numeros_versao(atual);
    let r = extrair_numeros_versao(remota);
    let n = a.len().max(r.len()).max(3);
    for i in 0..n {
        let va = a.get(i).copied().unwrap_or(0);
        let vr = r.get(i).copied().unwrap_or(0);
        if vr > va {
            return 1;
        }
        if vr < va {
            return -1;
        }
    }
    0
}

pub fn interpretar_release_github(
    json_str: &str,
    versao_atual: &str,
) -> Result<ResultadoVerificacaoAtualizacao, String> {
    let val: serde_json::Value = serde_json::from_str(json_str)
        .map_err(|e| format!("Resposta inválida da API do GitHub: {e}"))?;

    if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
        if val.get("tag_name").is_none() {
            return Err(format!("GitHub retornou: {msg}"));
        }
    }

    let tag = val
        .get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Nenhum lançamento (Release) encontrado neste repositório.".to_string())?;
    let versao_remota = tag.trim().trim_start_matches(['v', 'V']).to_string();
    let titulo = val
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(tag)
        .to_string();
    let notas = val
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let publicado_em = val
        .get("published_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let url_release = val
        .get("html_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut nome_instalador: Option<String> = None;
    let mut url_instalador: Option<String> = None;
    let mut tamanho_bytes: Option<u64> = None;
    let mut sha256_esperado: Option<String> = None;
    let mut melhor_prioridade = 0u8;

    if let Some(assets) = val.get("assets").and_then(|a| a.as_array()) {
        for asset in assets {
            let Some(nome) = asset.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            let Some(url) = asset.get("browser_download_url").and_then(|u| u.as_str()) else {
                continue;
            };
            let lower = nome.to_ascii_lowercase();
            // Prioridade: 3 = instalador NSIS (*-setup.exe), 2 = qualquer .exe, 1 = .msi
            let prio = if lower.ends_with("-setup.exe") || lower.ends_with("_setup.exe") {
                3
            } else if lower.ends_with(".exe") && !lower.ends_with(".sig") {
                2
            } else if lower.ends_with(".msi") {
                1
            } else {
                0
            };
            if prio > melhor_prioridade {
                melhor_prioridade = prio;
                nome_instalador = Some(nome.to_string());
                url_instalador = Some(url.to_string());
                tamanho_bytes = asset.get("size").and_then(|s| s.as_u64());
                sha256_esperado = asset
                    .get("digest")
                    .and_then(|d| d.as_str())
                    .and_then(|d| d.strip_prefix("sha256:"))
                    .map(|s| s.trim().to_ascii_lowercase());
            }
        }
    }

    let atualizacao_disponivel = comparar_versoes(versao_atual, &versao_remota) > 0;

    Ok(ResultadoVerificacaoAtualizacao {
        versao_atual: versao_atual.to_string(),
        versao_remota,
        atualizacao_disponivel,
        titulo,
        notas,
        publicado_em,
        nome_instalador,
        url_instalador,
        tamanho_bytes,
        sha256_esperado,
        url_release,
    })
}

fn validar_nome_instalador(nome: &str) -> Result<String, String> {
    let limpo = nome.trim();
    if limpo.is_empty()
        || limpo.contains("..")
        || limpo.contains('/')
        || limpo.contains('\\')
        || limpo.contains(':')
    {
        return Err("Nome de arquivo do instalador inválido.".into());
    }
    let lower = limpo.to_ascii_lowercase();
    if !lower.ends_with(".exe") && !lower.ends_with(".msi") {
        return Err("O arquivo de atualização precisa ser um instalador .exe ou .msi.".into());
    }
    Ok(limpo.to_string())
}

#[tauri::command]
pub fn atualizador_obter_config(app: AppHandle) -> Result<EstadoAtualizador, String> {
    let caminho = caminho_config_atualizador(&app)?;
    let cfg = ler_config_atualizador(&caminho);
    Ok(EstadoAtualizador {
        versao_atual: env!("CARGO_PKG_VERSION").to_string(),
        repositorio: cfg.repositorio,
        verificar_ao_iniciar: cfg.verificar_ao_iniciar,
    })
}

#[tauri::command]
pub fn atualizador_salvar_config(
    app: AppHandle,
    repositorio: String,
    verificar_ao_iniciar: bool,
) -> Result<EstadoAtualizador, String> {
    let repo_limpo = if repositorio.trim().is_empty() {
        String::new()
    } else {
        normalizar_repositorio_github(&repositorio)?
    };
    let caminho = caminho_config_atualizador(&app)?;
    let cfg = ConfigAtualizador {
        repositorio: repo_limpo.clone(),
        verificar_ao_iniciar,
    };
    gravar_config_atualizador(&caminho, &cfg)?;
    Ok(EstadoAtualizador {
        versao_atual: env!("CARGO_PKG_VERSION").to_string(),
        repositorio: repo_limpo,
        verificar_ao_iniciar,
    })
}

#[tauri::command]
pub async fn atualizador_verificar(
    app: AppHandle,
    repositorio: Option<String>,
) -> Result<ResultadoVerificacaoAtualizacao, String> {
    let caminho = caminho_config_atualizador(&app)?;
    let mut cfg = ler_config_atualizador(&caminho);
    let repo_alvo = match repositorio.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(r) => {
            let norm = normalizar_repositorio_github(r)?;
            if cfg.repositorio != norm {
                cfg.repositorio = norm.clone();
                let _ = gravar_config_atualizador(&caminho, &cfg);
            }
            norm
        }
        None => normalizar_repositorio_github(&cfg.repositorio)?,
    };

    tokio::task::spawn_blocking(move || {
        let url = format!("https://api.github.com/repos/{repo_alvo}/releases/latest");
        let mut cmd = Command::new("curl.exe");
        cmd.args([
            "-fsSL",
            "--connect-timeout",
            "15",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: KRB-View-Updater",
            &url,
        ]);
        configurar_janela_oculta(&mut cmd);
        let out = cmd
            .output()
            .map_err(|e| format!("Falha ao consultar GitHub Releases via curl: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.contains("404") {
                return Err(format!(
                    "Nenhum Release público encontrado em github.com/{repo_alvo} (ou o repositório é privado/inexistente)."
                ));
            }
            return Err(format!(
                "Não foi possível consultar github.com/{repo_alvo}: {}",
                stderr.trim()
            ));
        }
        let corpo = String::from_utf8_lossy(&out.stdout);
        interpretar_release_github(&corpo, env!("CARGO_PKG_VERSION"))
    })
    .await
    .map_err(|e| format!("Falha interna ao verificar atualização: {e}"))?
}

#[tauri::command]
pub async fn atualizador_baixar_e_instalar(
    app: AppHandle,
    url_instalador: String,
    nome_instalador: String,
    sha256_esperado: Option<String>,
) -> Result<(), String> {
    let url = url_instalador.trim().to_string();
    if !url.starts_with("https://") {
        return Err("A URL do instalador precisa usar HTTPS.".into());
    }
    let nome = validar_nome_instalador(&nome_instalador)?;

    tokio::task::spawn_blocking(move || {
        let pasta_temp = std::env::temp_dir().join("krb_view_update");
        fs::create_dir_all(&pasta_temp)
            .map_err(|e| format!("Falha ao criar pasta temporária de atualização: {e}"))?;
        let destino = pasta_temp.join(&nome);
        let destino_part = pasta_temp.join(format!("{nome}.part"));
        let _ = fs::remove_file(&destino_part);

        let mut cmd = Command::new("curl.exe");
        cmd.args([
            "-fL",
            "--retry",
            "2",
            "--connect-timeout",
            "20",
            "--silent",
            "--show-error",
            "-o",
        ]);
        cmd.arg(&destino_part);
        cmd.arg(&url);
        configurar_janela_oculta(&mut cmd);

        let out = cmd
            .output()
            .map_err(|e| format!("Falha ao baixar o instalador: {e}"))?;
        if !out.status.success() {
            let _ = fs::remove_file(&destino_part);
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Erro no download do instalador: {}", stderr.trim()));
        }

        if let Some(ref esperado) = sha256_esperado.map(|s| s.trim().to_ascii_lowercase()).filter(|s| !s.is_empty()) {
            let bytes = fs::read(&destino_part)
                .map_err(|e| format!("Falha ao ler instalador baixado para conferência: {e}"))?;
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let calculado: String = hasher
                .finalize()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            if &calculado != esperado {
                let _ = fs::remove_file(&destino_part);
                return Err(format!(
                    "Verificação de integridade SHA-256 falhou (esperado {esperado}, obtido {calculado})."
                ));
            }
        }

        let _ = fs::remove_file(&destino);
        fs::rename(&destino_part, &destino)
            .map_err(|e| format!("Falha ao preparar instalador baixado: {e}"))?;

        if nome.to_ascii_lowercase().ends_with(".msi") {
            Command::new("msiexec.exe")
                .arg("/i")
                .arg(&destino)
                .spawn()
                .map_err(|e| format!("Não foi possível iniciar o instalador MSI: {e}"))?;
        } else {
            Command::new(&destino)
                .spawn()
                .map_err(|e| format!("Não foi possível iniciar o instalador: {e}"))?;
        }

        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(450));
            app_clone.exit(0);
        });

        Ok(())
    })
    .await
    .map_err(|e| format!("Falha interna ao instalar atualização: {e}"))?
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn normaliza_formatos_de_repositorio_github() {
        assert_eq!(
            normalizar_repositorio_github("guimc/Visu").unwrap(),
            "guimc/Visu"
        );
        assert_eq!(
            normalizar_repositorio_github("  https://github.com/guimc/Visu/releases  ").unwrap(),
            "guimc/Visu"
        );
        assert_eq!(
            normalizar_repositorio_github("https://github.com/guimc/Visu.git").unwrap(),
            "guimc/Visu"
        );
        assert!(normalizar_repositorio_github("apenas_um_nome").is_err());
        assert!(normalizar_repositorio_github("").is_err());
    }

    #[test]
    fn compara_versoes_semver_corretamente() {
        assert_eq!(comparar_versoes("0.1.0", "0.2.0"), 1);
        assert_eq!(comparar_versoes("v0.1.0", "v0.1.1"), 1);
        assert_eq!(comparar_versoes("0.2.0", "0.2.0"), 0);
        assert_eq!(comparar_versoes("0.3.0", "0.2.9"), -1);
        assert_eq!(comparar_versoes("1.0", "1.0.0"), 0);
    }

    #[test]
    fn interpreta_json_de_release_e_prioriza_instalador_setup_exe() {
        let json = r#"{
            "tag_name": "v0.2.0",
            "name": "KRB View 0.2.0",
            "body": "- Ambiente dedicado de segmentação\n- Correção de memória no TotalSegmentator",
            "published_at": "2026-11-18T14:00:00Z",
            "html_url": "https://github.com/guimc/Visu/releases/tag/v0.2.0",
            "assets": [
                {
                    "name": "KRB View_0.2.0_x64_en-US.msi",
                    "browser_download_url": "https://github.com/guimc/Visu/releases/download/v0.2.0/KRB.msi",
                    "size": 6200000
                },
                {
                    "name": "KRB View_0.2.0_x64-setup.exe",
                    "browser_download_url": "https://github.com/guimc/Visu/releases/download/v0.2.0/KRB-setup.exe",
                    "size": 4800000,
                    "digest": "sha256:ABCDEF123456"
                }
            ]
        }"#;

        let res = interpretar_release_github(json, "0.1.0").unwrap();
        assert!(res.atualizacao_disponivel);
        assert_eq!(res.versao_remota, "0.2.0");
        assert_eq!(
            res.nome_instalador.as_deref(),
            Some("KRB View_0.2.0_x64-setup.exe")
        );
        assert_eq!(res.sha256_esperado.as_deref(), Some("abcdef123456"));
    }
}
