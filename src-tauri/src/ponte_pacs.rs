//! Ponte TCP para o cliente de PACS (fase 11.1).
//!
//! O navegador não abre conexões TCP, então o Rust só liga, envia e recebe bytes. Nenhuma regra
//! do protocolo DICOM fica aqui: ela está toda em `src/pacs/` (TypeScript).
//!
//! Segurança: só conecta a host e porta que o usuário cadastrou (lista enviada por
//! `pacs_definir_servidores`) e só quando a tela pede. Os bytes viajam em base64 (eventos).

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
};

const TEMPO_CONEXAO: Duration = Duration::from_secs(10);

enum Comando {
    Enviar(Vec<u8>),
    Fechar,
}

#[derive(Default)]
pub struct Ponte {
    servidores: Mutex<Vec<(String, u16)>>,
    proximo: AtomicU32,
    conexoes: Mutex<HashMap<u32, mpsc::UnboundedSender<Comando>>>,
}

#[derive(Clone, Serialize)]
struct Dados {
    id: u32,
    dados: String,
}

#[derive(Clone, Serialize)]
struct Fechou {
    id: u32,
    erro: Option<String>,
}

/// Define quais (host, porta) podem ser acessados: os servidores cadastrados.
#[tauri::command]
pub fn pacs_definir_servidores(estado: State<'_, Ponte>, servidores: Vec<(String, u16)>) {
    *estado.servidores.lock().unwrap() = servidores;
}

#[tauri::command]
pub async fn pacs_conectar(
    app: AppHandle,
    estado: State<'_, Ponte>,
    host: String,
    porta: u16,
) -> Result<u32, String> {
    let permitido = estado
        .servidores
        .lock()
        .unwrap()
        .iter()
        .any(|(h, p)| h.eq_ignore_ascii_case(&host) && *p == porta);
    if !permitido {
        return Err("Servidor não cadastrado.".into());
    }
    let endereco = format!("{host}:{porta}");
    let fluxo = match tokio::time::timeout(TEMPO_CONEXAO, TcpStream::connect(&endereco)).await {
        Err(_) => return Err("Tempo esgotado ao conectar (10 s).".into()),
        Ok(Err(e)) => return Err(e.to_string()),
        Ok(Ok(f)) => f,
    };
    let _ = fluxo.set_nodelay(true);

    let id = estado.proximo.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, mut rx) = mpsc::unbounded_channel::<Comando>();
    estado.conexoes.lock().unwrap().insert(id, tx);
    let (mut leitor, mut escritor) = fluxo.into_split();

    // Leitura: cada pedaço recebido vira um evento; ao terminar, avisa e remove a conexão.
    let app_leitura = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; 64 * 1024];
        let erro = loop {
            match leitor.read(&mut buf).await {
                Ok(0) => break None,
                Ok(n) => {
                    let _ = app_leitura.emit("pacs-dados", Dados { id, dados: B64.encode(&buf[..n]) });
                }
                Err(e) => break Some(e.to_string()),
            }
        };
        app_leitura.state::<Ponte>().conexoes.lock().unwrap().remove(&id);
        let _ = app_leitura.emit("pacs-fechou", Fechou { id, erro });
    });

    // Escrita: recebe os comandos da tela.
    tauri::async_runtime::spawn(async move {
        while let Some(c) = rx.recv().await {
            match c {
                Comando::Enviar(d) => {
                    if escritor.write_all(&d).await.is_err() {
                        break;
                    }
                }
                Comando::Fechar => {
                    let _ = escritor.shutdown().await;
                    break;
                }
            }
        }
    });

    Ok(id)
}

#[tauri::command]
pub fn pacs_enviar(estado: State<'_, Ponte>, id: u32, dados: String) -> Result<(), String> {
    let bytes = B64.decode(dados).map_err(|e| e.to_string())?;
    let mapa = estado.conexoes.lock().unwrap();
    let tx = mapa.get(&id).ok_or("Conexão encerrada.")?;
    tx.send(Comando::Enviar(bytes)).map_err(|_| "Conexão encerrada.".to_string())
}

#[tauri::command]
pub fn pacs_fechar(estado: State<'_, Ponte>, id: u32) {
    if let Some(tx) = estado.conexoes.lock().unwrap().get(&id) {
        let _ = tx.send(Comando::Fechar);
    }
}
