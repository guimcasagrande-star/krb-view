// Não abre o console no Windows na versão final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod atualizador;
mod exames;
mod ponte_pacs;
mod totalseg;

use serde::Serialize;
use tauri::{Manager, PhysicalPosition, Position};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InfoMonitor {
    id: String,
    nome: String,
    largura: u32,
    altura: u32,
    x: i32,
    y: i32,
    escala: f64,
    primario: bool,
}

fn id_do_monitor(m: &tauri::Monitor, indice: usize) -> String {
    if let Some(nome) = m.name() {
        if !nome.trim().is_empty() {
            return nome.to_string();
        }
    }
    format!(
        "monitor-{}-{}x{}@{},{}",
        indice + 1,
        m.size().width,
        m.size().height,
        m.position().x,
        m.position().y
    )
}

fn mesmo_monitor(a: &tauri::Monitor, b: &tauri::Monitor) -> bool {
    a.position().x == b.position().x
        && a.position().y == b.position().y
        && a.size().width == b.size().width
        && a.size().height == b.size().height
}

#[tauri::command]
fn monitores_listar(app: tauri::AppHandle) -> Result<Vec<InfoMonitor>, String> {
    let lista = app
        .available_monitors()
        .map_err(|e| format!("Erro ao listar monitores: {e}"))?;
    let primario = app.primary_monitor().ok().flatten();
    let mut saida = Vec::with_capacity(lista.len());
    for (i, m) in lista.iter().enumerate() {
        let eh_primario = primario
            .as_ref()
            .map(|p| mesmo_monitor(p, m))
            .unwrap_or(i == 0);
        let id = id_do_monitor(m, i);
        let codigo = m.name().map(|s| s.as_str()).unwrap_or("");
        let sufixo_primario = if eh_primario { " (Principal)" } else { "" };
        let nome = if codigo.is_empty() {
            format!("Monitor {}{}", i + 1, sufixo_primario)
        } else {
            format!("Monitor {}{} — {}", i + 1, sufixo_primario, codigo)
        };
        saida.push(InfoMonitor {
            id,
            nome,
            largura: m.size().width,
            altura: m.size().height,
            x: m.position().x,
            y: m.position().y,
            escala: m.scale_factor(),
            primario: eh_primario,
        });
    }
    Ok(saida)
}

fn escolher_monitor_alvo(
    app: &tauri::AppHandle,
    label_janela: &str,
    monitor_id: Option<&str>,
) -> Option<tauri::Monitor> {
    let monitores = app.available_monitors().ok()?;
    if monitores.is_empty() {
        return None;
    }

    // 1. Se o usuário escolheu um monitor específico salvo nas preferências, tenta encontrá-lo.
    if let Some(id_alvo) = monitor_id {
        if !id_alvo.is_empty() && id_alvo != "auto" {
            for (i, m) in monitores.iter().enumerate() {
                if id_do_monitor(m, i) == id_alvo {
                    return Some(m.clone());
                }
            }
        }
    }

    // 2. Para a segunda janela em modo "auto", escolhe automaticamente o monitor diferente da principal.
    if label_janela == "secundaria" && monitores.len() >= 2 {
        let monitor_main = app
            .get_webview_window("main")
            .and_then(|w| w.current_monitor().ok().flatten())
            .or_else(|| app.primary_monitor().ok().flatten());
        if let Some(ref m_main) = monitor_main {
            if let Some(outro) = monitores.iter().find(|m| !mesmo_monitor(m, m_main)) {
                return Some(outro.clone());
            }
        }
        return monitores.get(1).cloned();
    }

    // 3. Para a janela principal em modo "auto", só reposiciona se um monitor específico foi pedido.
    None
}

fn aplicar_monitor_e_modo_tela(
    app: &tauri::AppHandle,
    janela: &tauri::WebviewWindow,
    monitor_id: Option<&str>,
    modo_tela: Option<&str>,
) {
    if let Some(alvo) = escolher_monitor_alvo(app, janela.label(), monitor_id) {
        let ja_estava_nele = janela
            .current_monitor()
            .ok()
            .flatten()
            .map(|atual| mesmo_monitor(&atual, &alvo))
            .unwrap_or(false);
        if !ja_estava_nele {
            let _ = janela.set_fullscreen(false);
            let _ = janela.unmaximize();
            let pos = PhysicalPosition::new(alvo.position().x + 48, alvo.position().y + 48);
            let _ = janela.set_position(Position::Physical(pos));
        }
    }

    match modo_tela.unwrap_or("maximizada") {
        "tela-cheia" => {
            let _ = janela.set_fullscreen(true);
        }
        "maximizada" => {
            let _ = janela.set_fullscreen(false);
            let _ = janela.maximize();
        }
        "normal" => {
            let _ = janela.set_fullscreen(false);
            let _ = janela.unmaximize();
        }
        _ => {}
    }
}

#[tauri::command]
async fn janela_secundaria_abrir(
    app: tauri::AppHandle,
    monitor_id: Option<String>,
    modo_tela: Option<String>,
) -> Result<bool, String> {
    if let Some(janela) = app.get_webview_window("secundaria") {
        let _ = janela.unminimize();
        aplicar_monitor_e_modo_tela(
            &app,
            &janela,
            monitor_id.as_deref(),
            modo_tela.as_deref(),
        );
        let _ = janela.show();
        let _ = janela.set_focus();
        return Ok(false);
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "secundaria",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("KRB View — 2ª janela")
    .inner_size(1200.0, 850.0)
    .disable_drag_drop_handler();

    if let Some(alvo) = escolher_monitor_alvo(&app, "secundaria", monitor_id.as_deref()) {
        let escala = if alvo.scale_factor() > 0.0 {
            alvo.scale_factor()
        } else {
            1.0
        };
        let x = (alvo.position().x as f64 / escala) + 40.0;
        let y = (alvo.position().y as f64 / escala) + 40.0;
        builder = builder.position(x, y);
    }

    let janela = builder
        .build()
        .map_err(|e| format!("Não foi possível abrir a segunda janela: {e}"))?;

    aplicar_monitor_e_modo_tela(
        &app,
        &janela,
        monitor_id.as_deref(),
        Some(modo_tela.as_deref().unwrap_or("maximizada")),
    );
    Ok(true)
}

#[tauri::command]
async fn janela_configurar_exibicao(
    app: tauri::AppHandle,
    janela: String,
    monitor_id: Option<String>,
    modo_tela: Option<String>,
) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(&janela) {
        aplicar_monitor_e_modo_tela(&app, &w, monitor_id.as_deref(), modo_tela.as_deref());
    }
    Ok(())
}

#[tauri::command]
async fn janela_alternar_tela_cheia(
    app: tauri::AppHandle,
    janela: String,
) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window(&janela) {
        let atual = w.is_fullscreen().unwrap_or(false);
        let novo = !atual;
        let _ = w.set_fullscreen(novo);
        return Ok(novo);
    }
    Ok(false)
}

fn caminho_preferencia_gpu() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(std::path::PathBuf::from))?;
    Some(base.join("VisuTS").join("gpu_webview.txt"))
}

#[tauri::command]
fn gpu_definir_preferencia(modo: String) -> Result<(), String> {
    let limpo = match modo.trim() {
        "alto-desempenho" | "economia" | "auto" => modo.trim(),
        _ => "alto-desempenho",
    };
    if let Some(caminho) = caminho_preferencia_gpu() {
        if let Some(pai) = caminho.parent() {
            let _ = std::fs::create_dir_all(pai);
        }
        std::fs::write(&caminho, limpo)
            .map_err(|e| format!("Falha ao salvar preferência de GPU: {e}"))?;
    }
    Ok(())
}

fn aplicar_preferencia_gpu_webview2() {
    #[cfg(target_os = "windows")]
    {
        if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_some() {
            return;
        }
        let modo = caminho_preferencia_gpu()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "alto-desempenho".to_string());
        let flag = match modo.as_str() {
            "alto-desempenho" => Some("--force_high_performance_gpu"),
            "economia" => Some("--force_low_power_gpu"),
            _ => None,
        };
        if let Some(arg) = flag {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", arg);
        }
    }
}

fn main() {
    aplicar_preferencia_gpu_webview2();
    tauri::Builder::default()
        .manage(ponte_pacs::Ponte::default())
        .manage(totalseg::EstadoTotalSeg::default())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(sec) = window.app_handle().get_webview_window("secundaria") {
                        std::thread::spawn(move || {
                            let _ = sec.close();
                        });
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            ponte_pacs::pacs_definir_servidores,
            ponte_pacs::pacs_conectar,
            ponte_pacs::pacs_certificado,
            ponte_pacs::pacs_enviar,
            ponte_pacs::pacs_fechar,
            ponte_pacs::pacs_escutar,
            ponte_pacs::pacs_aceitar_canal,
            ponte_pacs::pacs_parar_escuta,
            exames::exames_escolher_pasta,
            exames::exames_pasta_padrao,
            exames::exames_gravar,
            exames::exames_listar,
            exames::exames_ler,
            exames::exames_tamanho,
            exames::exames_apagar,
            exames::exames_limpar_cache,
            exames::exames_gravar_temp,
            exames::exames_limpar_temp,
            exames::exames_rodar_totalsegmentator,
            exames::exames_ler_saida_ts,
            exames::exames_limpar_saida_ts,
            totalseg::totalseg_diagnosticar,
            totalseg::totalseg_escolher_executavel,
            totalseg::totalseg_escolher_pasta_pesos,
            totalseg::totalseg_salvar_config_manual,
            totalseg::totalseg_limpar_config_customizada,
            totalseg::totalseg_instalar,
            totalseg::totalseg_baixar_pesos,
            totalseg::totalseg_cancelar_instalacao,
            totalseg::totalseg_salvar_licenca,
            atualizador::atualizador_obter_config,
            atualizador::atualizador_salvar_config,
            atualizador::atualizador_verificar,
            atualizador::atualizador_baixar_e_instalar,
            monitores_listar,
            janela_secundaria_abrir,
            janela_configurar_exibicao,
            janela_alternar_tela_cheia,
            gpu_definir_preferencia
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o visualizador");
}
