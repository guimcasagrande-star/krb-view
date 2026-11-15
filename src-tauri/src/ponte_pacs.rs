//! Ponte TCP para o cliente de PACS (fase 11.1).
//!
//! O navegador não abre conexões TCP, então o Rust só liga, envia e recebe bytes. Nenhuma regra
//! do protocolo DICOM fica aqui: ela está toda em `src/pacs/` (TypeScript).
//!
//! Segurança: só conecta a host e porta que o usuário cadastrou (lista enviada por
//! `pacs_definir_servidores`) e só quando a tela pede. Os bytes recebidos do socket viajam por
//! `tauri::ipc::Channel` usando `InvokeResponseBody::Raw` (chegam como `ArrayBuffer` puro no JS,
//! sem `serde_json` nem base64), com coalescência de leitura (~192 KB ou flush em 3 ms).
//!
//! Conexão segura (DICOM TLS): o servidor cadastrado com `tls` é acessado por TLS 1.2 ou mais
//! novo. A cadeia de certificados não é validada (PACS de hospital costuma usar certificado
//! próprio, que nenhuma autoridade pública assina); a garantia é a impressão digital SHA-256 do
//! certificado, confirmada pelo usuário na tela de servidores. Sem impressão digital confirmada,
//! ou com certificado diferente, a conexão é recusada antes de qualquer dado ser enviado.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, Manager, State,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
};
use tokio_native_tls::TlsStream;

const TEMPO_CONEXAO: Duration = Duration::from_secs(10);
const TAM_BLOCO_LEITURA: usize = 64 * 1024;
const COALESCENCIA_ALVO: usize = 192 * 1024;
const ATRASO_FLUSH: Duration = Duration::from_millis(3);

enum Comando {
    Enviar(Vec<u8>),
    Fechar,
}

/// Servidor cadastrado pelo usuário: o único destino a que a ponte conecta.
#[derive(Clone, Deserialize)]
pub struct Servidor {
    host: String,
    porta: u16,
    /// Conexão segura (DICOM TLS).
    #[serde(default)]
    tls: bool,
    /// Impressão digital SHA-256 confirmada (64 dígitos hexadecimais maiúsculos).
    #[serde(default)]
    certificado: Option<String>,
}

#[derive(Default)]
pub struct Ponte {
    servidores: Mutex<Vec<Servidor>>,
    proximo: AtomicU32,
    conexoes: Mutex<HashMap<u32, mpsc::UnboundedSender<Comando>>>,
}

#[derive(Clone, Serialize)]
struct Fechou {
    id: u32,
    erro: Option<String>,
}

/// Define quais servidores podem ser acessados: os cadastrados.
#[tauri::command]
pub fn pacs_definir_servidores(estado: State<'_, Ponte>, servidores: Vec<Servidor>) {
    *estado.servidores.lock().unwrap() = servidores;
}

fn cadastrado(estado: &State<'_, Ponte>, host: &str, porta: u16) -> Option<Servidor> {
    estado
        .servidores
        .lock()
        .unwrap()
        .iter()
        .find(|s| s.host.eq_ignore_ascii_case(host) && s.porta == porta)
        .cloned()
}

async fn abrir_tcp(host: &str, porta: u16) -> Result<TcpStream, String> {
    let endereco = format!("{host}:{porta}");
    let fluxo = match tokio::time::timeout(TEMPO_CONEXAO, TcpStream::connect(&endereco)).await {
        Err(_) => return Err("Tempo esgotado ao conectar (10 s).".into()),
        Ok(Err(e)) => return Err(e.to_string()),
        Ok(Ok(f)) => f,
    };
    let _ = fluxo.set_nodelay(true);
    Ok(fluxo)
}

/// Faz o aperto de mão TLS e devolve o fluxo com a impressão digital do certificado do servidor.
/// Quem chama decide se confia: nada é enviado antes dessa decisão.
async fn abrir_tls(host: &str, porta: u16) -> Result<(TlsStream<TcpStream>, String), String> {
    let tcp = abrir_tcp(host, porta).await?;
    let conector = native_tls::TlsConnector::builder()
        // A confiança vem da impressão digital confirmada pelo usuário (ver o topo do arquivo).
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .min_protocol_version(Some(native_tls::Protocol::Tlsv12))
        .build()
        .map_err(|e| format!("falha na conexão segura (TLS): {e}"))?;
    let conector = tokio_native_tls::TlsConnector::from(conector);
    let fluxo = match tokio::time::timeout(TEMPO_CONEXAO, conector.connect(host, tcp)).await {
        Err(_) => return Err("Tempo esgotado na conexão segura (10 s).".into()),
        Ok(Err(e)) => return Err(format!("falha na conexão segura (TLS): {e}")),
        Ok(Ok(f)) => f,
    };
    let certificado = fluxo
        .get_ref()
        .peer_certificate()
        .map_err(|e| format!("falha na conexão segura (TLS): {e}"))?
        .ok_or("o servidor não apresentou certificado")?;
    let der = certificado
        .to_der()
        .map_err(|e| format!("falha na conexão segura (TLS): {e}"))?;
    let digital: String = Sha256::digest(&der).iter().map(|b| format!("{b:02X}")).collect();
    Ok((fluxo, digital))
}

/// Impressão digital (SHA-256, hexadecimal) do certificado que o servidor apresenta, para o
/// usuário confirmar na tela de servidores. Não envia nenhum dado DICOM.
#[tauri::command]
pub async fn pacs_certificado(estado: State<'_, Ponte>, host: String, porta: u16) -> Result<String, String> {
    if cadastrado(&estado, &host, porta).is_none() {
        return Err("Servidor não cadastrado.".into());
    }
    let (_fluxo, digital) = abrir_tls(&host, porta).await?;
    Ok(digital)
}

fn pares(hex: &str) -> String {
    hex.as_bytes()
        .chunks(2)
        .take(8)
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect::<Vec<_>>()
        .join(":")
}

/// Liga o fluxo (TCP ou TLS) ao canal binário (`InvokeResponseBody::Raw`) e comandos da tela.
fn ligar<F>(
    app: AppHandle,
    id: u32,
    mut rx: mpsc::UnboundedReceiver<Comando>,
    fluxo: F,
    canal: Channel<InvokeResponseBody>,
) where
    F: AsyncRead + AsyncWrite + Send + 'static,
{
    let (mut leitor, mut escritor) = tokio::io::split(fluxo);

    // Leitura com coalescência (~192 KB ou flush em até 3 ms): envia `ArrayBuffer` puro sem JSON/base64.
    tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; TAM_BLOCO_LEITURA];
        let mut acumulado = Vec::with_capacity(COALESCENCIA_ALVO + TAM_BLOCO_LEITURA);
        let mut prazo: Option<tokio::time::Instant> = None;

        let erro = loop {
            let leitura = match prazo {
                None => leitor.read(&mut buf).await.map(Some),
                Some(limite) => match tokio::time::timeout_at(limite, leitor.read(&mut buf)).await {
                    Ok(res) => res.map(Some),
                    Err(_) => Ok(None), // timeout de coalescência: faz flush do que já chegou
                },
            };

            match leitura {
                Ok(None) => {
                    prazo = None;
                    if !acumulado.is_empty() {
                        let bloco = std::mem::replace(
                            &mut acumulado,
                            Vec::with_capacity(COALESCENCIA_ALVO + TAM_BLOCO_LEITURA),
                        );
                        let _ = canal.send(InvokeResponseBody::Raw(bloco));
                    }
                }
                Ok(Some(0)) => {
                    if !acumulado.is_empty() {
                        let bloco = std::mem::take(&mut acumulado);
                        let _ = canal.send(InvokeResponseBody::Raw(bloco));
                    }
                    break None;
                }
                Ok(Some(n)) => {
                    acumulado.extend_from_slice(&buf[..n]);
                    if acumulado.len() >= COALESCENCIA_ALVO {
                        prazo = None;
                        let bloco = std::mem::replace(
                            &mut acumulado,
                            Vec::with_capacity(COALESCENCIA_ALVO + TAM_BLOCO_LEITURA),
                        );
                        let _ = canal.send(InvokeResponseBody::Raw(bloco));
                    } else if prazo.is_none() {
                        prazo = Some(tokio::time::Instant::now() + ATRASO_FLUSH);
                    }
                }
                Err(e) => {
                    if !acumulado.is_empty() {
                        let bloco = std::mem::take(&mut acumulado);
                        let _ = canal.send(InvokeResponseBody::Raw(bloco));
                    }
                    break Some(e.to_string());
                }
            }
        };
        app.state::<Ponte>().conexoes.lock().unwrap().remove(&id);
        let _ = app.emit("pacs-fechou", Fechou { id, erro });
    });

    // Escrita: recebe os comandos da tela.
    tauri::async_runtime::spawn(async move {
        while let Some(c) = rx.recv().await {
            match c {
                Comando::Enviar(d) => {
                    if escritor.write_all(&d).await.is_err() || escritor.flush().await.is_err() {
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
}

#[tauri::command]
pub async fn pacs_conectar(
    app: AppHandle,
    estado: State<'_, Ponte>,
    host: String,
    porta: u16,
    canal: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let Some(servidor) = cadastrado(&estado, &host, porta) else {
        return Err("Servidor não cadastrado.".into());
    };

    if servidor.tls {
        let Some(esperado) = servidor.certificado.filter(|c| !c.is_empty()) else {
            return Err("conexão segura (TLS): o certificado deste servidor ainda não foi confirmado. Confirme-o antes de conectar.".into());
        };
        let (fluxo, recebido) = abrir_tls(&host, porta).await?;
        if !recebido.eq_ignore_ascii_case(&esperado) {
            return Err(format!(
                "conexão segura (TLS): o servidor apresentou um certificado diferente do confirmado (esperado {}…, recebido {}…). Não conectei. Confirme com o TI do hospital antes de aceitar o novo certificado.",
                pares(&esperado),
                pares(&recebido)
            ));
        }
        let id = estado.proximo.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = mpsc::unbounded_channel::<Comando>();
        estado.conexoes.lock().unwrap().insert(id, tx);
        ligar(app, id, rx, fluxo, canal);
        return Ok(id);
    }

    let fluxo = abrir_tcp(&host, porta).await?;
    let id = estado.proximo.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = mpsc::unbounded_channel::<Comando>();
    estado.conexoes.lock().unwrap().insert(id, tx);
    ligar(app, id, rx, fluxo, canal);
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

#[cfg(test)]
mod testes {
    use super::*;

    /// Teste manual: precisa do servidor de teste com TLS no ar.
    ///
    ///   PACS_TLS_CERT=cert.pem PACS_TLS_KEY=chave.pem python scripts/pacs-servidor-teste.py test-data/phantom 11113
    ///   PACS_TESTE_SHA256=<impressão digital do cert.pem> cargo test -- --ignored
    #[test]
    #[ignore]
    fn tls_le_a_impressao_digital_do_servidor_de_teste() {
        let esperado = std::env::var("PACS_TESTE_SHA256").unwrap_or_default().replace(':', "");
        let (_fluxo, digital) = tauri::async_runtime::block_on(abrir_tls("127.0.0.1", 11113)).expect("conexão TLS");
        assert_eq!(digital.len(), 64);
        if !esperado.is_empty() {
            assert!(digital.eq_ignore_ascii_case(&esperado), "recebido {digital}");
        }
    }

    #[test]
    fn mostra_so_o_comeco_da_impressao_digital() {
        assert_eq!(pares("0689095E95DB8DAE0BDB"), "06:89:09:5E:95:DB:8D:AE");
    }
}
