//! Gerenciamento do TotalSegmentator (Opção 3: instalação sob demanda e configuração offline).
//!
//! Mantém o instalador do aplicativo leve e permite:
//! - Descoberta em 3 níveis: (1) caminho customizado salvo, (2) ambiente isolado em
//!   `%LOCALAPPDATA%\VisuTS` (caminho curto para evitar `MAX_PATH = 260` no Windows) e
//!   (3) `PATH` do sistema;
//! - Injeção automática de `TOTALSEG_HOME_DIR` em todas as chamadas de execução e download;
//! - Diagnóstico completo (executável, pasta de pesos, tarefas baixadas, `nvidia-smi` e
//!   `torch.cuda.is_available()`);
//! - Instalação guiada via `uv` portátil (Python 3.11 isolado + PyTorch CUDA `cu124` ou CPU +
//!   `TotalSegmentator` + pré-download de pesos `total_fast`, `total` e opcional `total_mr`), com
//!   streaming de progresso e cancelamento seguro da árvore de processos no Windows.

use std::{
    collections::{BTreeMap, VecDeque},
    ffi::OsString,
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const URL_UV_WINDOWS_X64: &str =
    "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip";
const URL_PYTORCH_CU124: &str = "https://download.pytorch.org/whl/cu124";
const URL_PYTORCH_CPU: &str = "https://download.pytorch.org/whl/cpu";
const PYTHON_VERSAO_ALVO: &str = "3.11";
const MAX_LINHAS_LOG: usize = 160;

pub const EVENTO_PROGRESSO_TOTALSEG: &str = "totalseg-instalacao-progresso";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigTotalSeg {
    #[serde(default)]
    pub executavel_customizado: Option<String>,
    #[serde(default)]
    pub pasta_pesos: Option<String>,
    #[serde(default)]
    pub modo_instalacao: Option<String>,
    #[serde(default)]
    pub chave_licenca: Option<String>,
    #[serde(default)]
    pub chaves_por_tarefa: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InfoGpuNvidia {
    pub nome: String,
    pub memoria_mb: u64,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InfoTarefaPesos {
    pub id: String,
    pub nome: String,
    pub categoria: String,
    pub requer_licenca: bool,
    pub baixado: bool,
    pub parcial: bool,
    pub detalhe: String,
    pub tamanho_mb: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticoTotalSeg {
    pub instalado: bool,
    pub origem: String,
    pub executavel_caminho: Option<String>,
    pub python_caminho: Option<String>,
    pub pasta_pesos: String,
    pub pesos_customizados: bool,
    pub caminho_customizado_invalido: Option<String>,
    pub tarefas_baixadas: Vec<InfoTarefaPesos>,
    pub gpu_nvidia: Option<InfoGpuNvidia>,
    pub cuda_disponivel: Option<bool>,
    pub versao_torch: Option<String>,
    pub versao_cuda_torch: Option<String>,
    pub versao_total_seg: Option<String>,
    pub espaco_livre_bytes: u64,
    pub instalacao_em_andamento: bool,
    pub tem_licenca_salva: bool,
    pub tem_licenca_padrao: bool,
    pub tarefas_com_licenca: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpcoesInstalacaoTotalSeg {
    pub modo_hardware: String,
    #[serde(default = "padrao_true")]
    pub baixar_total_fast: bool,
    #[serde(default = "padrao_true")]
    pub baixar_total: bool,
    #[serde(default)]
    pub baixar_total_mr: bool,
    #[serde(default)]
    pub tarefas_pesos: Option<Vec<String>>,
}

fn padrao_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventoProgressoTotalSeg {
    pub etapa: String,
    pub indice_etapa: usize,
    pub total_etapas: usize,
    pub percentual: Option<u8>,
    pub linha_log: Option<String>,
    pub ultimas_linhas: Vec<String>,
    pub concluido: bool,
    pub erro: Option<String>,
    pub cancelado: bool,
}

#[derive(Default)]
pub struct ControleInstalacao {
    pub pid_atual: AtomicU32,
    pub cancelado: AtomicBool,
}

#[derive(Default)]
pub struct EstadoTotalSeg {
    pub ativa: Mutex<Option<Arc<ControleInstalacao>>>,
}

struct GuardaInstalacao<'a> {
    estado: &'a EstadoTotalSeg,
}

impl<'a> Drop for GuardaInstalacao<'a> {
    fn drop(&mut self) {
        if let Ok(mut g) = self.estado.ativa.lock() {
            *g = None;
        }
    }
}

pub fn configurar_janela_oculta(_cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn configurar_ambiente_python(cmd: &mut Command, pasta_pesos: &Path) {
    cmd.env("TOTALSEG_HOME_DIR", pasta_pesos);
    cmd.env("PYTHONUTF8", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PIP_DISABLE_PIP_VERSION_CHECK", "1");
    configurar_janela_oculta(cmd);
}

fn configurar_ambiente_uv(cmd: &mut Command, base: &Path, pasta_pesos: &Path) {
    cmd.env("UV_PYTHON_INSTALL_DIR", base.join("py"));
    cmd.env("UV_CACHE_DIR", base.join("cache"));
    cmd.env("UV_PYTHON_PREFERENCE", "only-managed");
    cmd.env("UV_NO_PROGRESS", "1");
    // Evita falha por lock do Windows Defender (os error 32/5) ao descompactar pacotes grandes
    // com DLLs nativas (como python-gdcm, vtk, simpleitk, torch) e evita timeout de 30s.
    cmd.env("UV_LINK_MODE", "copy");
    cmd.env("UV_CONCURRENT_DOWNLOADS", "4");
    cmd.env("UV_CONCURRENT_INSTALLS", "1");
    cmd.env("UV_HTTP_TIMEOUT", "300");
    cmd.env("UV_HTTP_RETRIES", "5");
    configurar_ambiente_python(cmd, pasta_pesos);
}

/// Garante que `<TOTALSEG_HOME_DIR>/config.json` mantenha telemetria desativada (100% local)
/// e aplique a chave de licença acadêmica/não-comercial quando informada pelo usuário.
pub fn garantir_config_privada_totalseg(pasta_pesos: &Path, chave_licenca: Option<&str>) {
    let _ = fs::create_dir_all(pasta_pesos);
    let arq = pasta_pesos.join("config.json");
    let mut obj = fs::read_to_string(&arq)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    if !obj.contains_key("totalseg_id") {
        obj.insert(
            "totalseg_id".to_string(),
            serde_json::Value::String("totalseg_local".to_string()),
        );
    }
    if !obj.contains_key("prediction_counter") {
        obj.insert("prediction_counter".to_string(), serde_json::json!(0));
    }
    obj.insert("send_usage_stats".to_string(), serde_json::Value::Bool(false));
    obj.insert(
        "statistics_disclaimer_shown".to_string(),
        serde_json::Value::Bool(true),
    );
    if let Some(lic) = chave_licenca {
        let limpa = lic.trim();
        if !limpa.is_empty() {
            obj.insert(
                "license_number".to_string(),
                serde_json::Value::String(limpa.to_string()),
            );
        }
    }
    if let Ok(texto) = serde_json::to_string_pretty(&serde_json::Value::Object(obj)) {
        let _ = fs::write(&arq, texto);
    }
}

/// Resolve a chave de licença aplicável a uma tarefa específica (ex.: `tissue_types`,
/// `coronary_arteries`, `heartchambers_highres`), priorizando a chave específica da tarefa
/// (ou da variante TC/RM irmã) e caindo para a chave padrão quando existir.
pub fn resolver_chave_para_tarefa<'a>(
    cfg: &'a ConfigTotalSeg,
    tarefa: Option<&str>,
) -> Option<&'a str> {
    if let Some(t_raw) = tarefa {
        let t = t_raw.trim();
        if !t.is_empty() {
            if let Some(k) = cfg.chaves_por_tarefa.get(t).map(|s| s.trim()).filter(|s| !s.is_empty()) {
                return Some(k);
            }
            if let Some(base) = t.strip_suffix("_mr") {
                if let Some(k) = cfg
                    .chaves_por_tarefa
                    .get(base)
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    return Some(k);
                }
            }
        }
    }
    if let Some(padrao) = cfg.chave_licenca.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return Some(padrao);
    }
    // Se não há chave padrão mas há alguma chave salva por tarefa, usa a primeira não vazia como fallback geral
    cfg.chaves_por_tarefa
        .values()
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
}

/// Caminho curto dedicado em `%LOCALAPPDATA%\VisuTS` para evitar erros de `MAX_PATH` (260 chars).
pub fn pasta_base_isolada(app: Option<&AppHandle>) -> PathBuf {
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local);
        if !p.as_os_str().is_empty() {
            return p.join("VisuTS");
        }
    }
    if let Some(h) = app {
        if let Ok(dir) = h.path().app_local_data_dir() {
            return dir.join("VisuTS");
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local);
        if !p.as_os_str().is_empty() {
            return p.join("VisuTS");
        }
    }
    std::env::temp_dir().join("VisuTS")
}

fn caminho_arquivo_config(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Falha ao obter pasta de configuração do app: {e}"))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta de configuração do app: {e}"))?;
    Ok(dir.join("totalseg.json"))
}

pub fn ler_config_em_arquivo(caminho: &Path) -> ConfigTotalSeg {
    let Ok(conteudo) = fs::read_to_string(caminho) else {
        return ConfigTotalSeg::default();
    };
    serde_json::from_str::<ConfigTotalSeg>(&conteudo).unwrap_or_default()
}

pub fn gravar_config_em_arquivo(caminho: &Path, cfg: &ConfigTotalSeg) -> Result<(), String> {
    if let Some(pai) = caminho.parent() {
        fs::create_dir_all(pai)
            .map_err(|e| format!("Falha ao criar diretório de configuração: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Falha ao serializar configuração do TotalSegmentator: {e}"))?;
    fs::write(caminho, json)
        .map_err(|e| format!("Falha ao salvar configuração do TotalSegmentator: {e}"))
}

pub fn resolver_pasta_pesos(cfg: &ConfigTotalSeg, base_isolada: &Path) -> (PathBuf, bool) {
    if let Some(custom) = cfg.pasta_pesos.as_deref() {
        let limpo = custom.trim();
        if !limpo.is_empty() {
            return (PathBuf::from(limpo), true);
        }
    }
    (base_isolada.join("weights"), false)
}

fn eh_executavel_python(caminho: &Path) -> bool {
    let nome = caminho
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    nome.starts_with("python") || nome == "py.exe" || nome == "py"
}

fn nomes_python_candidatos() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["python.exe", "python3.exe"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["python3", "python"]
    }
}

fn nome_totalseg_binario() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "TotalSegmentator.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "TotalSegmentator"
    }
}

fn nome_download_weights_binario() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "totalseg_download_weights.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "totalseg_download_weights"
    }
}

fn python_irmao_de(executavel: &Path) -> Option<PathBuf> {
    if eh_executavel_python(executavel) {
        return Some(executavel.to_path_buf());
    }
    let pai = executavel.parent()?;
    for cand in nomes_python_candidatos() {
        let p = pai.join(cand);
        if p.is_file() {
            return Some(p);
        }
    }
    // Em ambientes Conda no Windows, TotalSegmentator.exe fica em <env>\Scripts\ e python.exe em <env>\.
    if let Some(avo) = pai.parent() {
        for cand in nomes_python_candidatos() {
            let p = avo.join(cand);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn totalseg_irmao_de(python: &Path) -> Option<PathBuf> {
    let nome = nome_totalseg_binario();
    let pai = python.parent()?;
    let mesmo_dir = pai.join(nome);
    if mesmo_dir.is_file() {
        return Some(mesmo_dir);
    }
    let scripts = pai.join("Scripts").join(nome);
    if scripts.is_file() {
        return Some(scripts);
    }
    let bin = pai.join("bin").join(nome);
    if bin.is_file() {
        return Some(bin);
    }
    None
}

fn download_weights_irmao_de(exec_ou_python: &Path) -> Option<PathBuf> {
    let nome = nome_download_weights_binario();
    let pai = exec_ou_python.parent()?;
    for cand in [
        pai.join(nome),
        pai.join("Scripts").join(nome),
        pai.join("bin").join(nome),
    ] {
        if cand.is_file() {
            return Some(cand);
        }
    }
    None
}

fn buscar_no_path_com_var(nome: &str, path_env: Option<OsString>) -> Option<PathBuf> {
    let path_val = path_env?;
    for dir in std::env::split_paths(&path_val) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let direto = dir.join(nome);
        if direto.is_file() {
            return Some(direto);
        }
        #[cfg(target_os = "windows")]
        if Path::new(nome).extension().is_none() {
            for ext in [".exe", ".bat", ".cmd"] {
                let com_ext = dir.join(format!("{nome}{ext}"));
                if com_ext.is_file() {
                    return Some(com_ext);
                }
            }
        }
    }
    None
}

fn buscar_no_path(nome: &str) -> Option<PathBuf> {
    buscar_no_path_com_var(nome, std::env::var_os("PATH"))
}

fn venv_scripts_dir(venv: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        venv.join("Scripts")
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv.join("bin")
    }
}

fn caminho_sentinel_incompleto(venv: &Path) -> PathBuf {
    venv.join(".visu_incompleto")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DescobertaTotalSeg {
    pub origem: String,
    pub executavel: Option<PathBuf>,
    pub python: Option<PathBuf>,
    pub caminho_customizado_invalido: Option<String>,
}

fn python_importa_totalseg(python: &Path, pasta_pesos: &Path) -> Result<(), String> {
    let mut cmd = Command::new(python);
    cmd.args(["-c", "import totalsegmentator; print('OK')"]);
    configurar_ambiente_python(&mut cmd, pasta_pesos);
    let out = cmd
        .output()
        .map_err(|e| format!("Falha ao executar Python ({}): {e}", python.display()))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let detalhe = stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("módulo totalsegmentator não encontrado");
    Err(detalhe.trim().to_string())
}

pub fn descobrir_ambiente(
    cfg: &ConfigTotalSeg,
    base_isolada: &Path,
    pasta_pesos: &Path,
    validar_python_path: bool,
) -> DescobertaTotalSeg {
    let mut caminho_customizado_invalido = None;

    // (1) Caminho customizado salvo nas configurações
    if let Some(custom) = cfg.executavel_customizado.as_deref() {
        let limpo = custom.trim();
        if !limpo.is_empty() {
            let p = PathBuf::from(limpo);
            if p.is_file() {
                let python = python_irmao_de(&p);
                return DescobertaTotalSeg {
                    origem: "customizado".to_string(),
                    executavel: Some(p),
                    python,
                    caminho_customizado_invalido: None,
                };
            }
            caminho_customizado_invalido = Some(limpo.to_string());
        }
    }

    // (2) Ambiente isolado próprio do app em %LOCALAPPDATA%\VisuTS\venv
    let venv = base_isolada.join("venv");
    if !caminho_sentinel_incompleto(&venv).exists() {
        let scripts = venv_scripts_dir(&venv);
        let ts_isolado = scripts.join(nome_totalseg_binario());
        let py_isolado = nomes_python_candidatos()
            .iter()
            .map(|n| scripts.join(n))
            .find(|p| p.is_file());
        if ts_isolado.is_file() {
            return DescobertaTotalSeg {
                origem: "isolado".to_string(),
                executavel: Some(ts_isolado),
                python: py_isolado,
                caminho_customizado_invalido,
            };
        }
        if let Some(py) = py_isolado {
            let pkg_dir = venv.join("Lib").join("site-packages").join("totalsegmentator");
            if pkg_dir.is_dir() {
                return DescobertaTotalSeg {
                    origem: "isolado".to_string(),
                    executavel: Some(py.clone()),
                    python: Some(py),
                    caminho_customizado_invalido,
                };
            }
        }
    }

    // (3) PATH do sistema
    if let Some(ts_path) = buscar_no_path(nome_totalseg_binario()) {
        let python = python_irmao_de(&ts_path);
        return DescobertaTotalSeg {
            origem: "path".to_string(),
            executavel: Some(ts_path),
            python,
            caminho_customizado_invalido,
        };
    }

    if validar_python_path {
        for nome_py in nomes_python_candidatos() {
            if let Some(py) = buscar_no_path(nome_py) {
                if python_importa_totalseg(&py, pasta_pesos).is_ok() {
                    let exec = totalseg_irmao_de(&py).unwrap_or_else(|| py.clone());
                    return DescobertaTotalSeg {
                        origem: "path".to_string(),
                        executavel: Some(exec),
                        python: Some(py),
                        caminho_customizado_invalido,
                    };
                }
            }
        }
    }

    DescobertaTotalSeg {
        origem: "nao_encontrado".to_string(),
        executavel: None,
        python: None,
        caminho_customizado_invalido,
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SondaPython {
    #[serde(default)]
    ts_ok: bool,
    ts_ver: Option<String>,
    torch_ver: Option<String>,
    cuda: Option<bool>,
    cuda_ver: Option<String>,
}

fn sondar_python(python: &Path, pasta_pesos: &Path) -> Option<SondaPython> {
    let script = concat!(
        "import json, importlib.metadata as m\n",
        "out = {'tsOk': False, 'tsVer': None, 'torchVer': None, 'cuda': None, 'cudaVer': None}\n",
        "try:\n",
        "    import totalsegmentator\n",
        "    out['tsOk'] = True\n",
        "    try: out['tsVer'] = m.version('TotalSegmentator')\n",
        "    except Exception: pass\n",
        "except Exception: pass\n",
        "try:\n",
        "    import torch\n",
        "    out['torchVer'] = getattr(torch, '__version__', None)\n",
        "    out['cuda'] = bool(torch.cuda.is_available())\n",
        "    out['cudaVer'] = getattr(torch.version, 'cuda', None)\n",
        "except Exception: pass\n",
        "print(json.dumps(out))\n",
    );
    let mut cmd = Command::new(python);
    cmd.args(["-c", script]);
    configurar_ambiente_python(&mut cmd, pasta_pesos);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let texto = String::from_utf8_lossy(&out.stdout);
    let ultima = texto.lines().rev().find(|l| !l.trim().is_empty())?;
    serde_json::from_str::<SondaPython>(ultima).ok()
}

fn validar_executavel_direto(exec_path: &Path, pasta_pesos: &Path) -> Result<(), String> {
    if eh_executavel_python(exec_path) {
        return python_importa_totalseg(exec_path, pasta_pesos);
    }
    let mut cmd = Command::new(exec_path);
    cmd.arg("--help");
    configurar_ambiente_python(&mut cmd, pasta_pesos);
    let out = cmd
        .output()
        .map_err(|e| format!("Falha ao executar {}: {e}", exec_path.display()))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    if stdout.contains("TotalSegmentator") || stderr.contains("TotalSegmentator") {
        return Ok(());
    }
    let detalhe = stderr
        .lines()
        .chain(stdout.lines())
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("código de saída diferente de zero");
    Err(format!("Executável respondeu com erro: {detalhe}"))
}

fn detectar_gpu_nvidia() -> Option<InfoGpuNvidia> {
    let mut candidatos = vec![PathBuf::from("nvidia-smi")];
    #[cfg(target_os = "windows")]
    {
        candidatos.push(PathBuf::from(r"C:\Windows\System32\nvidia-smi.exe"));
        candidatos.push(PathBuf::from(
            r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        ));
    }

    for prog in candidatos {
        let mut cmd = Command::new(&prog);
        cmd.args([
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader,nounits",
        ]);
        configurar_janela_oculta(&mut cmd);
        let Ok(out) = cmd.output() else { continue };
        if !out.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        for linha in stdout.lines() {
            let partes: Vec<&str> = linha.split(',').map(|s| s.trim()).collect();
            if partes.len() >= 3 && !partes[0].is_empty() {
                let memoria_mb = partes[1].parse::<u64>().unwrap_or(0);
                return Some(InfoGpuNvidia {
                    nome: partes[0].to_string(),
                    memoria_mb,
                    driver: partes[2].to_string(),
                });
            }
        }
    }
    None
}

fn somar_checkpoints_em_dir(pasta: &Path, profundidade: u8) -> (bool, u64) {
    if profundidade > 5 {
        return (false, 0);
    }
    let Ok(itens) = fs::read_dir(pasta) else {
        return (false, 0);
    };
    let mut tem_ckpt = false;
    let mut total_bytes: u64 = 0;
    for item in itens.flatten() {
        let caminho = item.path();
        if caminho.is_dir() {
            let (sub_ckpt, sub_bytes) = somar_checkpoints_em_dir(&caminho, profundidade + 1);
            tem_ckpt |= sub_ckpt;
            total_bytes = total_bytes.saturating_add(sub_bytes);
        } else if let Ok(meta) = item.metadata() {
            let tam = meta.len();
            total_bytes = total_bytes.saturating_add(tam);
            let nome = item.file_name().to_string_lossy().to_ascii_lowercase();
            if tam > 0 && (nome.ends_with(".pth") || nome.ends_with(".pt") || nome.ends_with(".model")) {
                tem_ckpt = true;
            }
        }
    }
    (tem_ckpt, total_bytes)
}

fn encontrar_dataset_dir(results_dir: &Path, prefixo: &str) -> Option<(bool, u64)> {
    let Ok(itens) = fs::read_dir(results_dir) else {
        return None;
    };
    for item in itens.flatten() {
        let caminho = item.path();
        if !caminho.is_dir() {
            continue;
        }
        let nome = item.file_name().to_string_lossy().into_owned();
        if nome.starts_with(prefixo) {
            let (tem_ckpt, bytes) = somar_checkpoints_em_dir(&caminho, 0);
            if tem_ckpt {
                return Some((true, bytes));
            }
        }
    }
    None
}

struct DefTarefaPesos {
    id: &'static str,
    nome: &'static str,
    categoria: &'static str,
    requer_licenca: bool,
    datasets: &'static [&'static str],
    dep_crop: Option<&'static str>,
}

const CATALOGO_TAREFAS_PESOS: &[DefTarefaPesos] = &[
    // Principais (TC e RM — livres)
    DefTarefaPesos {
        id: "total_fast",
        nome: "Modelo rápido TC (--fast · 117 estruturas)",
        categoria: "essenciais",
        requer_licenca: false,
        datasets: &["Dataset297_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "total",
        nome: "Modelo completo TC alta resolução (117 estruturas)",
        categoria: "essenciais",
        requer_licenca: false,
        datasets: &["Dataset291_", "Dataset292_", "Dataset293_", "Dataset294_", "Dataset295_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "total_fast_mr",
        nome: "Modelo rápido RM (--fast · 50 estruturas)",
        categoria: "essenciais",
        requer_licenca: false,
        datasets: &["Dataset852_", "Dataset853_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "total_mr",
        nome: "Modelo completo RM alta resolução (50 estruturas)",
        categoria: "essenciais",
        requer_licenca: false,
        datasets: &["Dataset850_", "Dataset851_"],
        dep_crop: None,
    },
    // Abdome, Fígado e Oncologia (livres)
    DefTarefaPesos {
        id: "liver_vessels",
        nome: "Vasos hepáticos e tumores hepáticos (TC)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset008_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "liver_segments",
        nome: "Segmentos hepáticos de Couinaud I–VIII (TC)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset570_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "liver_segments_mr",
        nome: "Segmentos hepáticos de Couinaud I–VIII (RM)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset576_"],
        dep_crop: Some("total_fast_mr"),
    },
    DefTarefaPesos {
        id: "liver_lesions",
        nome: "Lesões hepáticas (TC)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset591_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "liver_lesions_mr",
        nome: "Lesões hepáticas (RM)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset589_"],
        dep_crop: Some("total_fast_mr"),
    },
    DefTarefaPesos {
        id: "kidney_cysts",
        nome: "Cistos renais (TC)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset789_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "abdominal_muscles",
        nome: "Musculatura abdominal e psoas / sarcopenia (TC)",
        categoria: "abdome",
        requer_licenca: false,
        datasets: &["Dataset952_"],
        dep_crop: Some("body_fast"),
    },
    // Tórax e Pulmão (livres)
    DefTarefaPesos {
        id: "lung_vessels",
        nome: "Artérias/veias pulmonares e árvore brônquica (TC)",
        categoria: "torax",
        requer_licenca: false,
        datasets: &["Dataset117_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "lung_nodules",
        nome: "Nódulos pulmonares e pulmão (TC)",
        categoria: "torax",
        requer_licenca: false,
        datasets: &["Dataset913_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "pleural_pericard_effusion",
        nome: "Derrame pleural e pericárdico (TC)",
        categoria: "torax",
        requer_licenca: false,
        datasets: &["Dataset315_"],
        dep_crop: Some("total_fast"),
    },
    // Coluna, Cabeça/Pescoço, Mama e Outros (livres)
    DefTarefaPesos {
        id: "vertebrae_mr",
        nome: "Vértebras e discos intervertebrais (RM)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset756_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "breasts",
        nome: "Mamas (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset527_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "cerebral_bleed",
        nome: "Hemorragia intracraniana (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset150_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "brain_aneurysm",
        nome: "Aneurismas cerebrais (TOF-MRA / Angio-TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset615_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "ventricle_parts",
        nome: "Partes dos ventrículos cerebrais (TC/RM)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset552_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "head_glands_cavities",
        nome: "Glândulas salivares, tireoide e seios da face (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset775_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "headneck_bones_vessels",
        nome: "Ossos e vasos de cabeça e pescoço (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset776_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "headneck_muscles",
        nome: "Músculos de cabeça e pescoço (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset778_", "Dataset779_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "hip_implant",
        nome: "Prótese de quadril (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset260_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "body",
        nome: "Contorno corporal e extremidades (TC)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset299_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "body_mr",
        nome: "Contorno corporal (RM)",
        categoria: "outros",
        requer_licenca: false,
        datasets: &["Dataset597_"],
        dep_crop: None,
    },
    // Tarefas com licença acadêmica/não-comercial gratuita
    DefTarefaPesos {
        id: "tissue_types",
        nome: "Composição corporal: gordura visceral/subcutânea e músculo (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset481_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "tissue_types_mr",
        nome: "Composição corporal: gordura visceral/subcutânea e músculo (RM)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset925_"],
        dep_crop: None,
    },
    DefTarefaPesos {
        id: "aortic_dissection",
        nome: "Dissecção de aorta: luz verdadeira e luz falsa (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset716_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "renal_arteries",
        nome: "Tronco celíaco, AMS e artérias renais (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset710_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "coronary_arteries",
        nome: "Artérias coronárias (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset509_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "heartchambers_highres",
        nome: "Câmaras cardíacas e miocárdio em alta resolução (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset301_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "appendicular_bones",
        nome: "Ossos do esqueleto apendicular (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset304_"],
        dep_crop: Some("total_fast"),
    },
    DefTarefaPesos {
        id: "appendicular_bones_mr",
        nome: "Ossos do esqueleto apendicular (RM)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset855_"],
        dep_crop: Some("total_fast_mr"),
    },
    DefTarefaPesos {
        id: "brain_structures",
        nome: "Estruturas encefálicas detalhadas (TC)",
        categoria: "licenca",
        requer_licenca: true,
        datasets: &["Dataset409_"],
        dep_crop: Some("total_fast"),
    },
];

pub fn expandir_tarefas_com_dependencias(pedidas: &[String]) -> Vec<String> {
    let mut saida: Vec<String> = Vec::new();
    for raw in pedidas {
        let id = raw.trim();
        let Some(def) = CATALOGO_TAREFAS_PESOS.iter().find(|d| d.id == id) else {
            continue;
        };
        if let Some(dep) = def.dep_crop {
            if !saida.iter().any(|s| s == dep) {
                saida.push(dep.to_string());
            }
        }
        if !saida.iter().any(|s| s == def.id) {
            saida.push(def.id.to_string());
        }
    }
    saida
}

pub fn inspecionar_pesos(pasta_pesos: &Path) -> Vec<InfoTarefaPesos> {
    let nnunet_results = pasta_pesos.join("nnunet").join("results");
    let results_dir = if nnunet_results.is_dir() {
        nnunet_results
    } else {
        pasta_pesos.to_path_buf()
    };

    let mut tarefas = Vec::with_capacity(CATALOGO_TAREFAS_PESOS.len());
    for def in CATALOGO_TAREFAS_PESOS {
        let mut presentes = 0usize;
        let mut bytes: u64 = 0;
        for pref in def.datasets {
            if let Some((_, b)) = encontrar_dataset_dir(&results_dir, pref) {
                presentes += 1;
                bytes = bytes.saturating_add(b);
            }
        }
        let n_partes = def.datasets.len();
        let ok = presentes == n_partes;
        let parcial = presentes > 0 && !ok;
        let detalhe = if ok {
            if n_partes > 1 {
                format!("Pronto para uso offline ({n_partes}/{n_partes} modelos)")
            } else {
                "Pronto para uso offline".to_string()
            }
        } else if parcial {
            format!("Incompleto ({presentes}/{n_partes} modelos)")
        } else {
            "Não baixado".to_string()
        };
        tarefas.push(InfoTarefaPesos {
            id: def.id.to_string(),
            nome: def.nome.to_string(),
            categoria: def.categoria.to_string(),
            requer_licenca: def.requer_licenca,
            baixado: ok,
            parcial,
            detalhe,
            tamanho_mb: bytes / (1024 * 1024),
        });
    }
    tarefas
}

#[cfg(target_os = "windows")]
fn espaco_livre_bytes(caminho: &Path) -> u64 {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let raiz = caminho
        .ancestors()
        .find(|p| p.exists())
        .unwrap_or_else(|| Path::new("C:\\"));
    let mut wide: Vec<u16> = raiz.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut disponivel: u64 = 0;
    let mut total: u64 = 0;
    let mut livre_total: u64 = 0;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut disponivel,
            &mut total,
            &mut livre_total,
        )
    };
    if ok != 0 {
        disponivel
    } else {
        0
    }
}

#[cfg(not(target_os = "windows"))]
fn espaco_livre_bytes(_caminho: &Path) -> u64 {
    0
}

fn construir_diagnostico(
    cfg: &ConfigTotalSeg,
    base_isolada: &Path,
    instalacao_em_andamento: bool,
) -> DiagnosticoTotalSeg {
    let (pasta_pesos_path, pesos_customizados) = resolver_pasta_pesos(cfg, base_isolada);
    let descoberta = descobrir_ambiente(cfg, base_isolada, &pasta_pesos_path, true);
    let gpu_nvidia = detectar_gpu_nvidia();
    let espaco_livre = espaco_livre_bytes(&pasta_pesos_path);
    let tarefas_baixadas = inspecionar_pesos(&pasta_pesos_path);

    let mut instalado = descoberta.executavel.is_some();
    let mut cuda_disponivel = None;
    let mut versao_torch = None;
    let mut versao_cuda_torch = None;
    let mut versao_total_seg = None;

    if let Some(ref py) = descoberta.python {
        if let Some(sonda) = sondar_python(py, &pasta_pesos_path) {
            cuda_disponivel = sonda.cuda;
            versao_torch = sonda.torch_ver;
            versao_cuda_torch = sonda.cuda_ver;
            versao_total_seg = sonda.ts_ver;
            if !sonda.ts_ok && descoberta.executavel.as_deref() == Some(py.as_path()) {
                instalado = false;
            }
        }
    } else if let Some(ref exe) = descoberta.executavel {
        if validar_executavel_direto(exe, &pasta_pesos_path).is_err() {
            instalado = false;
        }
    }

    let tem_licenca_padrao = cfg
        .chave_licenca
        .as_deref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
        || fs::read_to_string(pasta_pesos_path.join("config.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("license_number")?.as_str().map(|s| !s.trim().is_empty()))
            .unwrap_or(false);
    let tarefas_com_licenca: Vec<String> = cfg
        .chaves_por_tarefa
        .iter()
        .filter(|(_, v)| !v.trim().is_empty())
        .map(|(k, _)| k.clone())
        .collect();
    let tem_licenca_salva = tem_licenca_padrao || !tarefas_com_licenca.is_empty();

    DiagnosticoTotalSeg {
        instalado,
        origem: if instalado {
            descoberta.origem
        } else {
            "nao_encontrado".to_string()
        },
        executavel_caminho: if instalado {
            descoberta
                .executavel
                .map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        },
        python_caminho: if instalado {
            descoberta.python.map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        },
        pasta_pesos: pasta_pesos_path.to_string_lossy().into_owned(),
        pesos_customizados,
        caminho_customizado_invalido: descoberta.caminho_customizado_invalido,
        tarefas_baixadas,
        gpu_nvidia,
        cuda_disponivel,
        versao_torch,
        versao_cuda_torch,
        versao_total_seg,
        espaco_livre_bytes: espaco_livre,
        instalacao_em_andamento,
        tem_licenca_salva,
        tem_licenca_padrao,
        tarefas_com_licenca,
    }
}

/// Resolve o executável e a pasta de pesos (`TOTALSEG_HOME_DIR`) para rodar o TotalSegmentator.
pub fn resolver_para_execucao(
    app: &AppHandle,
) -> Result<(DescobertaTotalSeg, PathBuf, ConfigTotalSeg), String> {
    let cfg_path = caminho_arquivo_config(app)?;
    let cfg = ler_config_em_arquivo(&cfg_path);
    let base_isolada = pasta_base_isolada(Some(app));
    let (pasta_pesos, _) = resolver_pasta_pesos(&cfg, &base_isolada);
    garantir_config_privada_totalseg(&pasta_pesos, resolver_chave_para_tarefa(&cfg, None));

    let desc = descobrir_ambiente(&cfg, &base_isolada, &pasta_pesos, true);
    if desc.executavel.is_none() {
        return Err(
            "TotalSegmentator não configurado. Clique em \"Instalar / Configurar TotalSegmentator\" para instalar automaticamente ou apontar uma instalação existente."
                .to_string(),
        );
    }
    Ok((desc, pasta_pesos, cfg))
}

/// Executa o TotalSegmentator sobre `pasta_serie` gravando os NIfTIs em `pasta_saida`,
/// com `TOTALSEG_HOME_DIR`, UTF-8 e `CREATE_NO_WINDOW` sempre configurados.
pub fn executar_totalsegmentator_em_pasta(
    app: &AppHandle,
    pasta_serie: &str,
    pasta_saida: &Path,
    tarefa: Option<&str>,
    orgaos: &[String],
    modo_rapido: bool,
) -> Result<(), String> {
    let (desc, pasta_pesos, cfg) = resolver_para_execucao(app)?;
    let chave_tarefa = resolver_chave_para_tarefa(&cfg, tarefa);
    garantir_config_privada_totalseg(&pasta_pesos, chave_tarefa);
    let executavel = desc
        .executavel
        .ok_or_else(|| "Executável do TotalSegmentator não encontrado.".to_string())?;

    let mut args = vec![
        "-i".to_string(),
        pasta_serie.to_string(),
        "-o".to_string(),
        pasta_saida.to_string_lossy().into_owned(),
    ];
    if let Some(t) = tarefa.map(|s| s.trim()).filter(|s| !s.is_empty() && *s != "total") {
        args.push("-ta".to_string());
        args.push(t.to_string());
    }
    if let Some(lic) = chave_tarefa {
        args.push("-l".to_string());
        args.push(lic.to_string());
    }
    if !orgaos.is_empty() {
        args.push("--roi_subset".to_string());
        for o in orgaos {
            args.push(o.clone());
        }
    }
    if modo_rapido && orgaos.is_empty() {
        args.push("--fast".to_string());
    }

    let mut cmd = if eh_executavel_python(&executavel) {
        let mut c = Command::new(&executavel);
        c.args(["-m", "totalsegmentator.bin.TotalSegmentator"]);
        c.args(&args);
        c
    } else {
        let mut c = Command::new(&executavel);
        c.args(&args);
        c
    };

    configurar_ambiente_python(&mut cmd, &pasta_pesos);

    let out = cmd
        .output()
        .map_err(|e| format!("Erro ao executar TotalSegmentator: {e}"))?;

    if out.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&out.stderr);
    let stdout = String::from_utf8_lossy(&out.stdout);
    if stderr.contains("No module named") && stderr.contains("totalsegmentator") {
        return Err(
            "Módulo TotalSegmentator não encontrado no Python configurado. Reinstale ou reconfigure no botão \"Instalar / Configurar TotalSegmentator\"."
                .to_string(),
        );
    }
    let detalhe = stderr
        .lines()
        .chain(stdout.lines())
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("falha desconhecida");
    Err(format!("TotalSegmentator falhou: {detalhe}"))
}

// ---------------------------------------------------------------------------
// Helpers puros de linha de comando (bootstrap com `uv` + PyTorch + pesos)
// ---------------------------------------------------------------------------

pub fn args_uv_python_install() -> Vec<String> {
    vec![
        "python".into(),
        "install".into(),
        PYTHON_VERSAO_ALVO.into(),
    ]
}

pub fn args_uv_venv(venv_dir: &Path) -> Vec<String> {
    vec![
        "venv".into(),
        "--python-preference".into(),
        "only-managed".into(),
        "--python".into(),
        PYTHON_VERSAO_ALVO.into(),
        "--clear".into(),
        venv_dir.to_string_lossy().into_owned(),
    ]
}

pub fn args_uv_pip_pytorch(python_exe: &Path, modo_gpu: bool) -> Vec<String> {
    let index = if modo_gpu {
        URL_PYTORCH_CU124
    } else {
        URL_PYTORCH_CPU
    };
    vec![
        "pip".into(),
        "install".into(),
        "--python".into(),
        python_exe.to_string_lossy().into_owned(),
        "torch".into(),
        "torchvision".into(),
        "--index-url".into(),
        index.into(),
    ]
}

pub fn args_uv_pip_totalsegmentator(python_exe: &Path, modo_gpu: bool) -> Vec<String> {
    let mut args = vec![
        "pip".into(),
        "install".into(),
        "--python".into(),
        python_exe.to_string_lossy().into_owned(),
        "TotalSegmentator".into(),
    ];
    if modo_gpu {
        args.push("--extra-index-url".into());
        args.push(URL_PYTORCH_CU124.into());
        args.push("--index-strategy".into());
        args.push("unsafe-best-match".into());
    }
    args
}

// ---------------------------------------------------------------------------
// Limpeza tolerante a locks (Windows Defender) e cancelamento da árvore
// ---------------------------------------------------------------------------

fn limpar_arquivo_nao_fatal(caminho: &Path) {
    if caminho.exists() {
        let _ = fs::remove_file(caminho);
    }
}

fn limpar_pasta_nao_fatal(pasta: &Path) {
    if pasta.exists() {
        let _ = fs::remove_dir_all(pasta);
    }
}

fn limpar_arquivos_temporarios_uv(pasta_uv: &Path) {
    limpar_arquivo_nao_fatal(&pasta_uv.join("uv.zip.part"));
    limpar_arquivo_nao_fatal(&pasta_uv.join("uv.zip"));
}

fn limpar_zips_parciais_em_pesos(pasta_pesos: &Path) {
    let Ok(itens) = fs::read_dir(pasta_pesos) else {
        return;
    };
    for item in itens.flatten() {
        let p = item.path();
        if p.is_file() {
            let nome = item.file_name().to_string_lossy().to_ascii_lowercase();
            if nome.ends_with(".zip") || nome.ends_with(".part") || nome.ends_with(".tmp") {
                limpar_arquivo_nao_fatal(&p);
            }
        }
    }
}

fn matar_arvore_processos(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        configurar_janela_oculta(&mut cmd);
        let _ = cmd.output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }
}

struct RegistroLogs {
    ultimas: VecDeque<String>,
}

impl RegistroLogs {
    fn novo() -> Self {
        Self {
            ultimas: VecDeque::with_capacity(MAX_LINHAS_LOG),
        }
    }

    fn empurrar(&mut self, linha: String) -> Vec<String> {
        if self.ultimas.len() >= MAX_LINHAS_LOG {
            self.ultimas.pop_front();
        }
        self.ultimas.push_back(linha);
        self.ultimas.iter().cloned().collect()
    }

    fn snapshot(&self) -> Vec<String> {
        self.ultimas.iter().cloned().collect()
    }
}

fn emitir_progresso(
    app: &AppHandle,
    etapa: &str,
    indice_etapa: usize,
    total_etapas: usize,
    percentual: Option<u8>,
    linha_log: Option<String>,
    logs: &Arc<Mutex<RegistroLogs>>,
    concluido: bool,
    erro: Option<String>,
    cancelado: bool,
) {
    let ultimas_linhas = if let Ok(mut g) = logs.lock() {
        if let Some(ref l) = linha_log {
            g.empurrar(l.clone())
        } else {
            g.snapshot()
        }
    } else {
        Vec::new()
    };

    let _ = app.emit(
        EVENTO_PROGRESSO_TOTALSEG,
        EventoProgressoTotalSeg {
            etapa: etapa.to_string(),
            indice_etapa,
            total_etapas,
            percentual,
            linha_log,
            ultimas_linhas,
            concluido,
            erro,
            cancelado,
        },
    );
}

fn ler_stream_linhas<R: Read + Send + 'static>(
    leitor: R,
    tx: mpsc::Sender<String>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(leitor);
        let mut byte_buf = [0u8; 1024];
        let mut acumulado: Vec<u8> = Vec::with_capacity(256);

        loop {
            match buf_reader.read(&mut byte_buf) {
                Ok(0) => {
                    if !acumulado.is_empty() {
                        let texto = String::from_utf8_lossy(&acumulado).trim().to_string();
                        if !texto.is_empty() {
                            let _ = tx.send(texto);
                        }
                    }
                    break;
                }
                Ok(n) => {
                    for &b in &byte_buf[..n] {
                        if b == b'\n' || b == b'\r' {
                            if !acumulado.is_empty() {
                                let texto = String::from_utf8_lossy(&acumulado).trim().to_string();
                                acumulado.clear();
                                if !texto.is_empty() {
                                    let _ = tx.send(texto);
                                }
                            }
                        } else {
                            acumulado.push(b);
                            if acumulado.len() >= 1024 {
                                let texto = String::from_utf8_lossy(&acumulado).trim().to_string();
                                acumulado.clear();
                                if !texto.is_empty() {
                                    let _ = tx.send(texto);
                                }
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }
    })
}

fn executar_com_progresso(
    app: &AppHandle,
    mut cmd: Command,
    controle: &Arc<ControleInstalacao>,
    logs: &Arc<Mutex<RegistroLogs>>,
    etapa: &str,
    indice_etapa: usize,
    total_etapas: usize,
    percentual: u8,
) -> Result<(), String> {
    if controle.cancelado.load(Ordering::SeqCst) {
        return Err("CANCELADO".to_string());
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut filho: Child = cmd
        .spawn()
        .map_err(|e| format!("Falha ao iniciar processo na etapa \"{etapa}\": {e}"))?;

    let pid = filho.id();
    controle.pid_atual.store(pid, Ordering::SeqCst);

    // Se o usuário clicou em Cancelar no exato instante entre spawn() e store(pid):
    if controle.cancelado.load(Ordering::SeqCst) {
        matar_arvore_processos(pid);
    }

    let (tx, rx) = mpsc::channel::<String>();
    let t_out = filho.stdout.take().map(|s| ler_stream_linhas(s, tx.clone()));
    let t_err = filho.stderr.take().map(|s| ler_stream_linhas(s, tx));

    loop {
        if controle.cancelado.load(Ordering::SeqCst) {
            matar_arvore_processos(pid);
        }

        while let Ok(linha) = rx.try_recv() {
            emitir_progresso(
                app,
                etapa,
                indice_etapa,
                total_etapas,
                Some(percentual),
                Some(linha),
                logs,
                false,
                None,
                false,
            );
        }

        match filho.try_wait() {
            Ok(Some(status)) => {
                if let Some(h) = t_out {
                    let _ = h.join();
                }
                if let Some(h) = t_err {
                    let _ = h.join();
                }
                while let Ok(linha) = rx.try_recv() {
                    emitir_progresso(
                        app,
                        etapa,
                        indice_etapa,
                        total_etapas,
                        Some(percentual),
                        Some(linha),
                        logs,
                        false,
                        None,
                        false,
                    );
                }
                controle.pid_atual.store(0, Ordering::SeqCst);

                if controle.cancelado.load(Ordering::SeqCst) {
                    return Err("CANCELADO".to_string());
                }
                if status.success() {
                    return Ok(());
                }
                let detalhe = logs
                    .lock()
                    .ok()
                    .map(|g| extrair_resumo_erro(&g.snapshot()))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("código {status}"));
                return Err(format!("Falha na etapa \"{etapa}\": {detalhe}"));
            }
            Ok(None) => {
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(e) => {
                controle.pid_atual.store(0, Ordering::SeqCst);
                return Err(format!("Erro ao acompanhar processo em \"{etapa}\": {e}"));
            }
        }
    }
}

fn extrair_resumo_erro(linhas: &[String]) -> String {
    if linhas.is_empty() {
        return String::new();
    }
    let inicio_bloco = linhas
        .iter()
        .rposition(|l| {
            let t = l.trim_start();
            t.starts_with("error:")
                || t.starts_with("× ")
                || t.starts_with("ERROR:")
                || t.starts_with("RuntimeError:")
                || t.starts_with("ValueError:")
        })
        .unwrap_or_else(|| linhas.len().saturating_sub(3));
    linhas[inicio_bloco..]
        .iter()
        .take(5)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" | ")
}

fn executar_uv_pip_com_retentativa(
    app: &AppHandle,
    uv_exe: &Path,
    args: &[String],
    base_isolada: &Path,
    pasta_pesos: &Path,
    controle: &Arc<ControleInstalacao>,
    logs: &Arc<Mutex<RegistroLogs>>,
    etapa: &str,
    indice_etapa: usize,
    total_etapas: usize,
    percentual: u8,
) -> Result<(), String> {
    const MAX_TENTATIVAS: usize = 3;
    let mut ultimo_erro = String::new();
    for tentativa in 1..=MAX_TENTATIVAS {
        if controle.cancelado.load(Ordering::SeqCst) {
            return Err("CANCELADO".to_string());
        }
        if tentativa > 1 {
            emitir_progresso(
                app,
                etapa,
                indice_etapa,
                total_etapas,
                Some(percentual),
                Some(format!(
                    "Retentando instalação de pacotes (tentativa {tentativa}/{MAX_TENTATIVAS}) após bloqueio temporário de arquivo/rede…"
                )),
                logs,
                false,
                None,
                false,
            );
            std::thread::sleep(Duration::from_millis(2500));
        }
        let mut cmd = Command::new(uv_exe);
        cmd.args(args);
        configurar_ambiente_uv(&mut cmd, base_isolada, pasta_pesos);
        match executar_com_progresso(
            app,
            cmd,
            controle,
            logs,
            etapa,
            indice_etapa,
            total_etapas,
            percentual,
        ) {
            Ok(()) => return Ok(()),
            Err(e) if e == "CANCELADO" => return Err(e),
            Err(e) => ultimo_erro = e,
        }
    }
    Err(ultimo_erro)
}

fn encontrar_uv_extraido(pasta: &Path, profundidade: u8) -> Option<PathBuf> {
    if profundidade > 3 {
        return None;
    }
    let direto = pasta.join("uv.exe");
    if direto.is_file() {
        return Some(direto);
    }
    let Ok(itens) = fs::read_dir(pasta) else {
        return None;
    };
    for item in itens.flatten() {
        let p = item.path();
        if p.is_dir() {
            if let Some(achado) = encontrar_uv_extraido(&p, profundidade + 1) {
                return Some(achado);
            }
        }
    }
    None
}

fn garantir_uv_portatil(
    app: &AppHandle,
    base: &Path,
    controle: &Arc<ControleInstalacao>,
    logs: &Arc<Mutex<RegistroLogs>>,
    indice_etapa: usize,
    total_etapas: usize,
) -> Result<PathBuf, String> {
    let pasta_uv = base.join("uv");
    let destino_uv = pasta_uv.join("uv.exe");
    if destino_uv.is_file() {
        emitir_progresso(
            app,
            "uv portátil já disponível",
            indice_etapa,
            total_etapas,
            Some(10),
            Some(format!("Reutilizando uv em {}", destino_uv.display())),
            logs,
            false,
            None,
            false,
        );
        return Ok(destino_uv);
    }

    fs::create_dir_all(&pasta_uv)
        .map_err(|e| format!("Falha ao criar pasta para o uv: {e}"))?;
    limpar_arquivos_temporarios_uv(&pasta_uv);

    let zip_part = pasta_uv.join("uv.zip.part");
    let zip_final = pasta_uv.join("uv.zip");

    let mut cmd_dl = Command::new("curl.exe");
    cmd_dl.args([
        "-fL",
        "--retry",
        "2",
        "--connect-timeout",
        "20",
        "--silent",
        "--show-error",
        "-o",
    ]);
    cmd_dl.arg(&zip_part);
    cmd_dl.arg(URL_UV_WINDOWS_X64);
    configurar_janela_oculta(&mut cmd_dl);

    emitir_progresso(
        app,
        "Baixando gerenciador uv portátil…",
        indice_etapa,
        total_etapas,
        Some(5),
        Some(format!("Baixando {URL_UV_WINDOWS_X64}")),
        logs,
        false,
        None,
        false,
    );

    if let Err(e) = executar_com_progresso(
        app,
        cmd_dl,
        controle,
        logs,
        "Baixando gerenciador uv portátil…",
        indice_etapa,
        total_etapas,
        8,
    ) {
        limpar_arquivos_temporarios_uv(&pasta_uv);
        return Err(e);
    }

    fs::rename(&zip_part, &zip_final)
        .map_err(|e| format!("Falha ao preparar arquivo uv.zip: {e}"))?;

    let mut cmd_ext = Command::new("tar.exe");
    cmd_ext.arg("-xf").arg(&zip_final).arg("-C").arg(&pasta_uv);
    configurar_janela_oculta(&mut cmd_ext);

    let extracao = executar_com_progresso(
        app,
        cmd_ext,
        controle,
        logs,
        "Extraindo uv portátil…",
        indice_etapa,
        total_etapas,
        12,
    );

    if extracao.is_err() && !controle.cancelado.load(Ordering::SeqCst) {
        let mut cmd_ps = Command::new("powershell.exe");
        let comando_ps = format!(
            "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
            zip_final.to_string_lossy().replace('\'', "''"),
            pasta_uv.to_string_lossy().replace('\'', "''"),
        );
        cmd_ps.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &comando_ps]);
        configurar_janela_oculta(&mut cmd_ps);
        if let Err(e_ps) = executar_com_progresso(
            app,
            cmd_ps,
            controle,
            logs,
            "Extraindo uv portátil…",
            indice_etapa,
            total_etapas,
            12,
        ) {
            limpar_arquivos_temporarios_uv(&pasta_uv);
            return Err(e_ps);
        }
    } else if let Err(e) = extracao {
        limpar_arquivos_temporarios_uv(&pasta_uv);
        return Err(e);
    }

    limpar_arquivo_nao_fatal(&zip_final);

    let achado = encontrar_uv_extraido(&pasta_uv, 0)
        .ok_or_else(|| "Não foi possível localizar uv.exe após a extração.".to_string())?;
    if achado != destino_uv {
        fs::rename(&achado, &destino_uv)
            .or_else(|_| fs::copy(&achado, &destino_uv).map(|_| ()))
            .map_err(|e| format!("Falha ao posicionar uv.exe: {e}"))?;
    }
    Ok(destino_uv)
}

fn baixar_tarefa_pesos(
    app: &AppHandle,
    exec_ou_python: &Path,
    pasta_pesos: &Path,
    cfg: &ConfigTotalSeg,
    tarefa: &str,
    controle: &Arc<ControleInstalacao>,
    logs: &Arc<Mutex<RegistroLogs>>,
    indice_etapa: usize,
    total_etapas: usize,
    percentual: u8,
) -> Result<(), String> {
    garantir_config_privada_totalseg(pasta_pesos, resolver_chave_para_tarefa(cfg, Some(tarefa)));
    let etapa = format!("Baixando pesos: {tarefa}…");
    emitir_progresso(
        app,
        &etapa,
        indice_etapa,
        total_etapas,
        Some(percentual),
        Some(format!("Iniciando download dos pesos para tarefa \"{tarefa}\" em {}", pasta_pesos.display())),
        logs,
        false,
        None,
        false,
    );

    let mut cmd = if let Some(bin_dl) = download_weights_irmao_de(exec_ou_python) {
        let mut c = Command::new(bin_dl);
        c.args(["-t", tarefa]);
        c
    } else {
        let py = python_irmao_de(exec_ou_python)
            .unwrap_or_else(|| exec_ou_python.to_path_buf());
        let mut c = Command::new(py);
        c.args(["-m", "totalsegmentator.bin.totalseg_download_weights", "-t", tarefa]);
        c
    };

    configurar_ambiente_python(&mut cmd, pasta_pesos);

    let res = executar_com_progresso(
        app,
        cmd,
        controle,
        logs,
        &etapa,
        indice_etapa,
        total_etapas,
        percentual,
    );

    // Tolerância a lock do Windows Defender ao limpar zips temporários
    limpar_zips_parciais_em_pesos(pasta_pesos);
    res
}

// ---------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn totalseg_diagnosticar(
    app: AppHandle,
    estado: State<'_, EstadoTotalSeg>,
) -> Result<DiagnosticoTotalSeg, String> {
    let em_andamento = estado
        .ativa
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);
    let cfg_path = caminho_arquivo_config(&app)?;
    let cfg = ler_config_em_arquivo(&cfg_path);
    let base_isolada = pasta_base_isolada(Some(&app));

    tokio::task::spawn_blocking(move || {
        construir_diagnostico(&cfg, &base_isolada, em_andamento)
    })
    .await
    .map_err(|e| format!("Falha ao executar diagnóstico do TotalSegmentator: {e}"))
}

#[tauri::command]
pub async fn totalseg_escolher_executavel(
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    let res = rfd::AsyncFileDialog::new()
        .set_title("Selecionar TotalSegmentator.exe ou python.exe")
        .add_filter("Executáveis Windows (*.exe)", &["exe"])
        .set_parent(&window)
        .pick_file()
        .await;
    Ok(res.map(|f| f.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn totalseg_escolher_pasta_pesos(
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    let res = rfd::AsyncFileDialog::new()
        .set_title("Selecionar pasta de pesos do TotalSegmentator (TOTALSEG_HOME_DIR)")
        .set_parent(&window)
        .pick_folder()
        .await;
    Ok(res.map(|f| f.path().to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn totalseg_salvar_config_manual(
    app: AppHandle,
    estado: State<'_, EstadoTotalSeg>,
    executavel: Option<String>,
    pasta_pesos: Option<String>,
) -> Result<DiagnosticoTotalSeg, String> {
    let em_andamento = estado
        .ativa
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);
    if em_andamento {
        return Err("Aguarde ou cancele a instalação em andamento antes de alterar a configuração.".into());
    }

    let cfg_path = caminho_arquivo_config(&app)?;
    let base_isolada = pasta_base_isolada(Some(&app));
    let exe_limpo = executavel.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let pesos_limpo = pasta_pesos.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    tokio::task::spawn_blocking(move || {
        let mut cfg = ler_config_em_arquivo(&cfg_path);
        let pesos_efetivos = pesos_limpo
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| base_isolada.join("weights"));

        if let Some(ref pasta_str) = pesos_limpo {
            if !Path::new(pasta_str).is_dir() {
                return Err(format!("A pasta de pesos informada não existe: {pasta_str}"));
            }
        }

        if let Some(ref exe_str) = exe_limpo {
            let p = Path::new(exe_str);
            if !p.is_file() {
                return Err(format!("O executável informado não foi encontrado: {exe_str}"));
            }
            validar_executavel_direto(p, &pesos_efetivos)?;
            cfg.modo_instalacao = Some("manual".to_string());
        }

        cfg.executavel_customizado = exe_limpo;
        cfg.pasta_pesos = pesos_limpo;
        gravar_config_em_arquivo(&cfg_path, &cfg)?;

        Ok(construir_diagnostico(&cfg, &base_isolada, false))
    })
    .await
    .map_err(|e| format!("Falha interna ao validar configuração: {e}"))?
}

#[tauri::command]
pub async fn totalseg_limpar_config_customizada(
    app: AppHandle,
    estado: State<'_, EstadoTotalSeg>,
) -> Result<DiagnosticoTotalSeg, String> {
    let em_andamento = estado
        .ativa
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);
    if em_andamento {
        return Err("Aguarde ou cancele a instalação em andamento.".into());
    }
    let cfg_path = caminho_arquivo_config(&app)?;
    let base_isolada = pasta_base_isolada(Some(&app));

    tokio::task::spawn_blocking(move || {
        let mut cfg = ler_config_em_arquivo(&cfg_path);
        cfg.executavel_customizado = None;
        cfg.pasta_pesos = None;
        gravar_config_em_arquivo(&cfg_path, &cfg)?;
        Ok(construir_diagnostico(&cfg, &base_isolada, false))
    })
    .await
    .map_err(|e| format!("Falha ao restaurar configuração automática: {e}"))?
}

#[tauri::command]
pub async fn totalseg_instalar(
    app: AppHandle,
    estado: State<'_, EstadoTotalSeg>,
    opcoes: OpcoesInstalacaoTotalSeg,
) -> Result<DiagnosticoTotalSeg, String> {
    let modo_gpu = opcoes.modo_hardware.eq_ignore_ascii_case("gpu");
    let controle = Arc::new(ControleInstalacao::default());
    {
        let mut ativa = estado
            .ativa
            .lock()
            .map_err(|_| "Falha ao acessar estado da instalação.".to_string())?;
        if ativa.is_some() {
            return Err("Já existe uma instalação ou download do TotalSegmentator em andamento.".into());
        }
        *ativa = Some(Arc::clone(&controle));
    }

    let _guarda = GuardaInstalacao { estado: &estado };
    let cfg_path = caminho_arquivo_config(&app)?;
    let base_isolada = pasta_base_isolada(Some(&app));

    let app_clone = app.clone();
    let controle_clone = Arc::clone(&controle);

    let resultado = tokio::task::spawn_blocking(move || {
        let logs = Arc::new(Mutex::new(RegistroLogs::novo()));
        let mut cfg = ler_config_em_arquivo(&cfg_path);
        let (pasta_pesos, _) = resolver_pasta_pesos(&cfg, &base_isolada);

        fs::create_dir_all(&base_isolada)
            .map_err(|e| format!("Falha ao criar diretório base {}: {e}", base_isolada.display()))?;
        fs::create_dir_all(&pasta_pesos)
            .map_err(|e| format!("Falha ao criar pasta de pesos {}: {e}", pasta_pesos.display()))?;

        // Validação mínima de espaço livre no Windows (evita iniciar download quando impossível)
        #[cfg(target_os = "windows")]
        {
            let livre = espaco_livre_bytes(&base_isolada);
            let minimo_gb: u64 = if modo_gpu { 4 } else { 2 };
            if livre > 0 && livre < minimo_gb * 1024 * 1024 * 1024 {
                let livre_gb = (livre as f64) / (1024.0 * 1024.0 * 1024.0);
                return Err(format!(
                    "Espaço livre insuficiente no disco ({livre_gb:.1} GB). Libere pelo menos {} antes de continuar.",
                    if modo_gpu { "6 a 8 GB (GPU + pesos)" } else { "3 GB (CPU + pesos)" }
                ));
            }
        }

        let mut pedidas: Vec<String> = if let Some(lista) = opcoes.tarefas_pesos.clone() {
            lista
        } else {
            let mut v = Vec::new();
            if opcoes.baixar_total_fast {
                v.push("total_fast".to_string());
            }
            if opcoes.baixar_total {
                v.push("total".to_string());
            }
            if opcoes.baixar_total_mr {
                v.push("total_mr".to_string());
            }
            v
        };
        let tarefas_pesos = expandir_tarefas_com_dependencias(&pedidas);
        pedidas.clear();
        garantir_config_privada_totalseg(&pasta_pesos, cfg.chave_licenca.as_deref());

        // Etapas: 1=uv, 2=python+venv, 3=pytorch, 4=TotalSegmentator, 5..=pesos, última=validação
        let total_etapas = 5 + tarefas_pesos.len();
        let venv_dir = base_isolada.join("venv");
        let cache_dir = base_isolada.join("cache");
        let sentinel = caminho_sentinel_incompleto(&venv_dir);

        // Etapa 1: uv portátil
        let uv_exe = match garantir_uv_portatil(
            &app_clone,
            &base_isolada,
            &controle_clone,
            &logs,
            1,
            total_etapas,
        ) {
            Ok(p) => p,
            Err(e) => {
                let cancelado = e == "CANCELADO";
                emitir_progresso(
                    &app_clone,
                    if cancelado { "Instalação cancelada." } else { "Falha ao obter uv." },
                    1,
                    total_etapas,
                    None,
                    None,
                    &logs,
                    true,
                    if cancelado { None } else { Some(e.clone()) },
                    cancelado,
                );
                return Err(if cancelado {
                    "Instalação cancelada pelo usuário.".to_string()
                } else {
                    e
                });
            }
        };

        // Etapa 2: Python 3.11 + venv isolado
        emitir_progresso(
            &app_clone,
            "Instalando Python 3.11 isolado…",
            2,
            total_etapas,
            Some(18),
            Some("Instalando Python 3.11 gerenciado pelo uv (sem alterar o sistema)…".into()),
            &logs,
            false,
            None,
            false,
        );

        let mut cmd_py = Command::new(&uv_exe);
        cmd_py.args(args_uv_python_install());
        configurar_ambiente_uv(&mut cmd_py, &base_isolada, &pasta_pesos);

        if let Err(e) = executar_com_progresso(
            &app_clone,
            cmd_py,
            &controle_clone,
            &logs,
            "Instalando Python 3.11 isolado…",
            2,
            total_etapas,
            24,
        ) {
            let cancelado = e == "CANCELADO";
            emitir_progresso(
                &app_clone,
                if cancelado { "Instalação cancelada." } else { "Falha ao instalar Python." },
                2,
                total_etapas,
                None,
                None,
                &logs,
                true,
                if cancelado { None } else { Some(e.clone()) },
                cancelado,
            );
            return Err(if cancelado {
                "Instalação cancelada pelo usuário.".to_string()
            } else {
                e
            });
        }

        emitir_progresso(
            &app_clone,
            "Criando ambiente virtual isolado…",
            2,
            total_etapas,
            Some(28),
            Some(format!("Criando venv em {}", venv_dir.display())),
            &logs,
            false,
            None,
            false,
        );
        // Remove eventual venv corrompido de tentativa anterior (tolerante a locks)
        limpar_pasta_nao_fatal(&venv_dir);

        let mut cmd_venv = Command::new(&uv_exe);
        cmd_venv.args(args_uv_venv(&venv_dir));
        configurar_ambiente_uv(&mut cmd_venv, &base_isolada, &pasta_pesos);

        if let Err(e) = executar_com_progresso(
            &app_clone,
            cmd_venv,
            &controle_clone,
            &logs,
            "Criando ambiente virtual isolado…",
            2,
            total_etapas,
            32,
        ) {
            limpar_pasta_nao_fatal(&venv_dir);
            let cancelado = e == "CANCELADO";
            emitir_progresso(
                &app_clone,
                if cancelado { "Instalação cancelada." } else { "Falha ao criar venv." },
                2,
                total_etapas,
                None,
                None,
                &logs,
                true,
                if cancelado { None } else { Some(e.clone()) },
                cancelado,
            );
            return Err(if cancelado {
                "Instalação cancelada pelo usuário.".to_string()
            } else {
                e
            });
        }

        // Marca o venv como em construção até PyTorch + TotalSegmentator concluírem
        let _ = fs::write(&sentinel, b"instalando");

        let python_venv = venv_scripts_dir(&venv_dir).join(nomes_python_candidatos()[0]);

        // Etapa 3: PyTorch + torchvision (CUDA cu124 ou CPU) ANTES do TotalSegmentator
        let rotulo_torch = if modo_gpu {
            "Instalando PyTorch com CUDA 12.4 (GPU NVIDIA)…"
        } else {
            "Instalando PyTorch (CPU)…"
        };
        emitir_progresso(
            &app_clone,
            rotulo_torch,
            3,
            total_etapas,
            Some(38),
            Some(format!(
                "Executando uv pip install torch torchvision (--index-url {})",
                if modo_gpu { URL_PYTORCH_CU124 } else { URL_PYTORCH_CPU }
            )),
            &logs,
            false,
            None,
            false,
        );

        let args_torch = args_uv_pip_pytorch(&python_venv, modo_gpu);
        if let Err(e) = executar_uv_pip_com_retentativa(
            &app_clone,
            &uv_exe,
            &args_torch,
            &base_isolada,
            &pasta_pesos,
            &controle_clone,
            &logs,
            rotulo_torch,
            3,
            total_etapas,
            52,
        ) {
            limpar_pasta_nao_fatal(&venv_dir);
            if e == "CANCELADO" {
                limpar_pasta_nao_fatal(&cache_dir);
            }
            let cancelado = e == "CANCELADO";
            emitir_progresso(
                &app_clone,
                if cancelado { "Instalação cancelada." } else { "Falha ao instalar PyTorch." },
                3,
                total_etapas,
                None,
                None,
                &logs,
                true,
                if cancelado { None } else { Some(e.clone()) },
                cancelado,
            );
            return Err(if cancelado {
                "Instalação cancelada pelo usuário.".to_string()
            } else {
                e
            });
        }

        // Etapa 4: TotalSegmentator (com proteção --extra-index-url cu124 + unsafe-best-match e retentativa)
        let rotulo_ts = "Instalando TotalSegmentator…";
        emitir_progresso(
            &app_clone,
            rotulo_ts,
            4,
            total_etapas,
            Some(58),
            Some(if modo_gpu {
                format!("Executando uv pip install TotalSegmentator --extra-index-url {URL_PYTORCH_CU124}")
            } else {
                "Executando uv pip install TotalSegmentator".to_string()
            }),
            &logs,
            false,
            None,
            false,
        );

        let args_ts = args_uv_pip_totalsegmentator(&python_venv, modo_gpu);
        if let Err(e) = executar_uv_pip_com_retentativa(
            &app_clone,
            &uv_exe,
            &args_ts,
            &base_isolada,
            &pasta_pesos,
            &controle_clone,
            &logs,
            rotulo_ts,
            4,
            total_etapas,
            72,
        ) {
            limpar_pasta_nao_fatal(&venv_dir);
            if e == "CANCELADO" {
                limpar_pasta_nao_fatal(&cache_dir);
            }
            let cancelado = e == "CANCELADO";
            emitir_progresso(
                &app_clone,
                if cancelado { "Instalação cancelada." } else { "Falha ao instalar TotalSegmentator." },
                4,
                total_etapas,
                None,
                None,
                &logs,
                true,
                if cancelado { None } else { Some(e.clone()) },
                cancelado,
            );
            return Err(if cancelado {
                "Instalação cancelada pelo usuário.".to_string()
            } else {
                e
            });
        }

        // Pacotes Python instalados com sucesso: remove o marcador de incompleto e limpa override manual antigo
        limpar_arquivo_nao_fatal(&sentinel);
        cfg.executavel_customizado = None;
        cfg.modo_instalacao = Some(if modo_gpu { "gpu" } else { "cpu" }.to_string());
        let _ = gravar_config_em_arquivo(&cfg_path, &cfg);

        // Etapa 5..: Pré-download dos pesos para uso 100% offline
        for (idx, tarefa) in tarefas_pesos.iter().enumerate() {
            let etapa_num = 5 + idx;
            let pct = 75 + (((idx + 1) * 20) / tarefas_pesos.len().max(1)) as u8;
            if let Err(e) = baixar_tarefa_pesos(
                &app_clone,
                &python_venv,
                &pasta_pesos,
                &cfg,
                tarefa,
                &controle_clone,
                &logs,
                etapa_num,
                total_etapas,
                pct.min(95),
            ) {
                limpar_pasta_nao_fatal(&cache_dir);
                let cancelado = e == "CANCELADO";
                emitir_progresso(
                    &app_clone,
                    if cancelado {
                        "Download de pesos cancelado (ambiente Python mantido)."
                    } else {
                        "Falha ao baixar pesos."
                    },
                    etapa_num,
                    total_etapas,
                    None,
                    None,
                    &logs,
                    true,
                    if cancelado { None } else { Some(e.clone()) },
                    cancelado,
                );
                return Err(if cancelado {
                    "Download cancelado pelo usuário. O ambiente Python foi mantido; você pode baixar os pesos novamente."
                        .to_string()
                } else {
                    e
                });
            }
        }

        // Etapa final: limpeza tolerante a lock do Windows Defender + validação
        limpar_pasta_nao_fatal(&cache_dir);
        emitir_progresso(
            &app_clone,
            "Validando ambiente e CUDA…",
            total_etapas,
            total_etapas,
            Some(98),
            Some("Verificando TotalSegmentator e torch.cuda.is_available()…".into()),
            &logs,
            false,
            None,
            false,
        );

        let diag = construir_diagnostico(&cfg, &base_isolada, false);
        if !diag.instalado {
            let msg = "Instalação concluída, mas a verificação não conseguiu carregar o TotalSegmentator.";
            emitir_progresso(
                &app_clone,
                msg,
                total_etapas,
                total_etapas,
                None,
                None,
                &logs,
                true,
                Some(msg.to_string()),
                false,
            );
            return Err(msg.to_string());
        }

        let linha_final = format!(
            "Concluído! TotalSegmentator {} · PyTorch {} · CUDA ativo: {}",
            diag.versao_total_seg.as_deref().unwrap_or("ok"),
            diag.versao_torch.as_deref().unwrap_or("ok"),
            match diag.cuda_disponivel {
                Some(true) => "Sim",
                Some(false) => "Não (CPU)",
                None => "Não verificado",
            }
        );
        emitir_progresso(
            &app_clone,
            "Instalação concluída!",
            total_etapas,
            total_etapas,
            Some(100),
            Some(linha_final),
            &logs,
            true,
            None,
            false,
        );

        Ok(diag)
    })
    .await
    .map_err(|e| format!("Falha interna ao aguardar instalação: {e}"))?;

    resultado
}

#[tauri::command]
pub async fn totalseg_baixar_pesos(
    app: AppHandle,
    estado: State<'_, EstadoTotalSeg>,
    tarefas: Vec<String>,
) -> Result<DiagnosticoTotalSeg, String> {
    if tarefas.is_empty() {
        return Err("Selecione ao menos um pacote de pesos para baixar.".into());
    }

    let filtradas = expandir_tarefas_com_dependencias(&tarefas);
    if filtradas.is_empty() {
        return Err("Nenhuma tarefa de pesos válida selecionada.".into());
    }

    let controle = Arc::new(ControleInstalacao::default());
    {
        let mut ativa = estado
            .ativa
            .lock()
            .map_err(|_| "Falha ao acessar estado do TotalSegmentator.".to_string())?;
        if ativa.is_some() {
            return Err("Já existe uma operação de instalação ou download em andamento.".into());
        }
        *ativa = Some(Arc::clone(&controle));
    }
    let _guarda = GuardaInstalacao { estado: &estado };

    let cfg_path = caminho_arquivo_config(&app)?;
    let base_isolada = pasta_base_isolada(Some(&app));
    let app_clone = app.clone();
    let controle_clone = Arc::clone(&controle);

    tokio::task::spawn_blocking(move || {
        let logs = Arc::new(Mutex::new(RegistroLogs::novo()));
        let cfg = ler_config_em_arquivo(&cfg_path);
        let (pasta_pesos, _) = resolver_pasta_pesos(&cfg, &base_isolada);
        fs::create_dir_all(&pasta_pesos)
            .map_err(|e| format!("Falha ao criar pasta de pesos {}: {e}", pasta_pesos.display()))?;
        garantir_config_privada_totalseg(&pasta_pesos, cfg.chave_licenca.as_deref());

        let desc = descobrir_ambiente(&cfg, &base_isolada, &pasta_pesos, true);
        let exec = desc
            .python
            .or(desc.executavel)
            .ok_or_else(|| "TotalSegmentator ainda não está instalado/configurado.".to_string())?;

        let total_etapas = filtradas.len();
        for (idx, tarefa) in filtradas.iter().enumerate() {
            let pct = (((idx + 1) * 95) / total_etapas.max(1)) as u8;
            if let Err(e) = baixar_tarefa_pesos(
                &app_clone,
                &exec,
                &pasta_pesos,
                &cfg,
                tarefa,
                &controle_clone,
                &logs,
                idx + 1,
                total_etapas,
                pct,
            ) {
                let cancelado = e == "CANCELADO";
                emitir_progresso(
                    &app_clone,
                    if cancelado {
                        "Download de pesos cancelado."
                    } else {
                        "Falha ao baixar pesos."
                    },
                    idx + 1,
                    total_etapas,
                    None,
                    None,
                    &logs,
                    true,
                    if cancelado { None } else { Some(e.clone()) },
                    cancelado,
                );
                return Err(if cancelado {
                    "Download cancelado pelo usuário.".to_string()
                } else {
                    e
                });
            }
        }

        let diag = construir_diagnostico(&cfg, &base_isolada, false);
        emitir_progresso(
            &app_clone,
            "Download de pesos concluído!",
            total_etapas,
            total_etapas,
            Some(100),
            Some("Pesos prontos para uso 100% offline.".into()),
            &logs,
            true,
            None,
            false,
        );
        Ok(diag)
    })
    .await
    .map_err(|e| format!("Falha interna ao baixar pesos: {e}"))?
}

#[tauri::command]
pub fn totalseg_cancelar_instalacao(estado: State<'_, EstadoTotalSeg>) -> Result<bool, String> {
    let controle = estado
        .ativa
        .lock()
        .map_err(|_| "Falha ao acessar estado de instalação.".to_string())?
        .clone();
    let Some(ctrl) = controle else {
        return Ok(false);
    };
    ctrl.cancelado.store(true, Ordering::SeqCst);
    let pid = ctrl.pid_atual.load(Ordering::SeqCst);
    if pid != 0 {
        matar_arvore_processos(pid);
    }
    Ok(true)
}

#[tauri::command]
pub async fn totalseg_salvar_licenca(
    app: AppHandle,
    estado: State<'_, EstadoTotalSeg>,
    chave: Option<String>,
    tarefa: Option<String>,
) -> Result<DiagnosticoTotalSeg, String> {
    let em_andamento = estado
        .ativa
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);
    let cfg_path = caminho_arquivo_config(&app)?;
    let base_isolada = pasta_base_isolada(Some(&app));
    let chave_limpa = chave.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let tarefa_limpa = tarefa.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    tokio::task::spawn_blocking(move || {
        let mut cfg = ler_config_em_arquivo(&cfg_path);
        if let Some(ref t) = tarefa_limpa {
            if let Some(ref k) = chave_limpa {
                cfg.chaves_por_tarefa.insert(t.clone(), k.clone());
            } else {
                cfg.chaves_por_tarefa.remove(t);
            }
        } else {
            cfg.chave_licenca = chave_limpa.clone();
        }
        gravar_config_em_arquivo(&cfg_path, &cfg)?;
        let (pasta_pesos, _) = resolver_pasta_pesos(&cfg, &base_isolada);
        let chave_para_config = chave_limpa
            .as_deref()
            .or_else(|| resolver_chave_para_tarefa(&cfg, tarefa_limpa.as_deref()));
        garantir_config_privada_totalseg(&pasta_pesos, chave_para_config);
        // Se nenhuma chave restou ativa, remove license_number também do config.json do TotalSegmentator
        if resolver_chave_para_tarefa(&cfg, None).is_none() {
            let arq = pasta_pesos.join("config.json");
            if let Ok(s) = fs::read_to_string(&arq) {
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&s) {
                    if let Some(obj) = v.as_object_mut() {
                        obj.remove("license_number");
                        if let Ok(txt) = serde_json::to_string_pretty(&v) {
                            let _ = fs::write(&arq, txt);
                        }
                    }
                }
            }
        }
        Ok(construir_diagnostico(&cfg, &base_isolada, em_andamento))
    })
    .await
    .map_err(|e| format!("Falha ao salvar chave de licença: {e}"))?
}

#[cfg(test)]
mod testes {
    use super::*;

    struct PastaTemp(PathBuf);
    impl PastaTemp {
        fn nova(nome: &str) -> Self {
            let p = std::env::temp_dir().join(format!("visu_ts_test_{nome}_{}", std::process::id()));
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

    #[test]
    fn persiste_e_carrega_config_totalseg() {
        let tmp = PastaTemp::nova("cfg");
        let arq = tmp.0.join("totalseg.json");
        let cfg = ConfigTotalSeg {
            executavel_customizado: Some(r"C:\Hospital\TS\TotalSegmentator.exe".into()),
            pasta_pesos: Some(r"D:\PesosTS".into()),
            modo_instalacao: Some("manual".into()),
            chave_licenca: None,
            chaves_por_tarefa: BTreeMap::new(),
        };
        gravar_config_em_arquivo(&arq, &cfg).unwrap();
        assert_eq!(ler_config_em_arquivo(&arq), cfg);
        assert_eq!(
            ler_config_em_arquivo(&tmp.0.join("nao_existe.json")),
            ConfigTotalSeg::default()
        );
    }

    #[test]
    fn resolve_pasta_pesos_padrao_curta_ou_customizada() {
        let base = Path::new(r"C:\Users\Joao\AppData\Local\VisuTS");
        let padrao = ConfigTotalSeg::default();
        assert_eq!(
            resolver_pasta_pesos(&padrao, base),
            (base.join("weights"), false)
        );

        let custom = ConfigTotalSeg {
            executavel_customizado: None,
            pasta_pesos: Some(r"  D:\TSWeights  ".into()),
            modo_instalacao: None,
            chave_licenca: None,
            chaves_por_tarefa: BTreeMap::new(),
        };
        assert_eq!(
            resolver_pasta_pesos(&custom, base),
            (PathBuf::from(r"D:\TSWeights"), true)
        );
    }

    #[test]
    fn descoberta_prioriza_customizado_depois_isolado_e_ignora_venv_incompleto() {
        let tmp = PastaTemp::nova("descoberta");
        let base = tmp.0.join("VisuTS");
        let pesos = base.join("weights");
        let scripts = venv_scripts_dir(&base.join("venv"));
        fs::create_dir_all(&scripts).unwrap();
        let ts_iso = scripts.join(nome_totalseg_binario());
        let py_iso = scripts.join(nomes_python_candidatos()[0]);
        fs::write(&ts_iso, b"fake").unwrap();
        fs::write(&py_iso, b"fake").unwrap();

        let custom_dir = tmp.0.join("Custom");
        fs::create_dir_all(&custom_dir).unwrap();
        let ts_custom = custom_dir.join(nome_totalseg_binario());
        fs::write(&ts_custom, b"fake").unwrap();

        // 1. Customizado válido vence o isolado
        let cfg_custom = ConfigTotalSeg {
            executavel_customizado: Some(ts_custom.to_string_lossy().into_owned()),
            pasta_pesos: None,
            modo_instalacao: Some("manual".into()),
            chave_licenca: None,
            chaves_por_tarefa: BTreeMap::new(),
        };
        let d1 = descobrir_ambiente(&cfg_custom, &base, &pesos, false);
        assert_eq!(d1.origem, "customizado");
        assert_eq!(d1.executavel, Some(ts_custom.clone()));

        // 2. Sem customizado, escolhe o isolado
        let d2 = descobrir_ambiente(&ConfigTotalSeg::default(), &base, &pesos, false);
        assert_eq!(d2.origem, "isolado");
        assert_eq!(d2.executavel, Some(ts_iso.clone()));
        assert_eq!(d2.python, Some(py_iso));

        // 3. Venv com marcador `.visu_incompleto` é ignorado
        fs::write(caminho_sentinel_incompleto(&base.join("venv")), b"instalando").unwrap();
        let d3 = descobrir_ambiente(&ConfigTotalSeg::default(), &base, &pesos, false);
        assert_ne!(d3.origem, "isolado");

        // 4. Customizado ausente sinaliza caminho inválido e ainda pode cair no isolado válido
        fs::remove_file(caminho_sentinel_incompleto(&base.join("venv"))).unwrap();
        let cfg_quebrado = ConfigTotalSeg {
            executavel_customizado: Some(tmp.0.join("inexistente.exe").to_string_lossy().into_owned()),
            pasta_pesos: None,
            modo_instalacao: None,
            chave_licenca: None,
            chaves_por_tarefa: BTreeMap::new(),
        };
        let d4 = descobrir_ambiente(&cfg_quebrado, &base, &pesos, false);
        assert!(d4.caminho_customizado_invalido.is_some());
        assert_eq!(d4.origem, "isolado");
    }

    #[test]
    fn inspeciona_pesos_completos_e_parciais() {
        let tmp = PastaTemp::nova("pesos");
        let results = tmp.0.join("nnunet").join("results");

        // total_fast (Dataset297) completo
        let d297 = results.join("Dataset297_TotalSegmentator_total_3mm_1559subj").join("fold_0");
        fs::create_dir_all(&d297).unwrap();
        fs::write(d297.join("checkpoint_final.pth"), vec![1u8; 2048]).unwrap();

        // total parcial (apenas 291 e 292 de 291..295)
        for pref in ["Dataset291_organs", "Dataset292_vertebrae"] {
            let p = results.join(pref).join("fold_0");
            fs::create_dir_all(&p).unwrap();
            fs::write(p.join("checkpoint_final.pth"), vec![2u8; 1024]).unwrap();
        }

        // total_mr completo (850 e 851)
        for pref in ["Dataset850_mr_organs", "Dataset851_mr_muscles"] {
            let p = results.join(pref).join("fold_0");
            fs::create_dir_all(&p).unwrap();
            fs::write(p.join("checkpoint_final.pth"), vec![3u8; 1024]).unwrap();
        }

        let lista = inspecionar_pesos(&tmp.0);
        let fast = lista.iter().find(|t| t.id == "total_fast").unwrap();
        let total = lista.iter().find(|t| t.id == "total").unwrap();
        let mr = lista.iter().find(|t| t.id == "total_mr").unwrap();

        assert!(fast.baixado && !fast.parcial);
        assert!(!total.baixado && total.parcial);
        assert!(total.detalhe.contains("2/5"));
        assert!(mr.baixado && !mr.parcial);
    }

    #[test]
    fn monta_comandos_uv_e_pytorch_cuda_corretamente() {
        let py = Path::new(r"C:\Users\Teste\AppData\Local\VisuTS\venv\Scripts\python.exe");

        let torch_gpu = args_uv_pip_pytorch(py, true);
        assert_eq!(
            torch_gpu,
            vec![
                "pip",
                "install",
                "--python",
                r"C:\Users\Teste\AppData\Local\VisuTS\venv\Scripts\python.exe",
                "torch",
                "torchvision",
                "--index-url",
                "https://download.pytorch.org/whl/cu124",
            ]
        );

        let torch_cpu = args_uv_pip_pytorch(py, false);
        assert!(torch_cpu.contains(&"https://download.pytorch.org/whl/cpu".to_string()));

        // Proteção no Passo 4: GPU inclui --extra-index-url cu124 + unsafe-best-match; CPU não inclui
        let ts_gpu = args_uv_pip_totalsegmentator(py, true);
        assert_eq!(
            ts_gpu,
            vec![
                "pip",
                "install",
                "--python",
                r"C:\Users\Teste\AppData\Local\VisuTS\venv\Scripts\python.exe",
                "TotalSegmentator",
                "--extra-index-url",
                "https://download.pytorch.org/whl/cu124",
                "--index-strategy",
                "unsafe-best-match",
            ]
        );

        let ts_cpu = args_uv_pip_totalsegmentator(py, false);
        assert!(!ts_cpu.iter().any(|a| a.contains("cu124")));

        let venv_args = args_uv_venv(Path::new(r"C:\Users\Teste\AppData\Local\VisuTS\venv"));
        assert!(venv_args.contains(&"--python-preference".to_string()));
        assert!(venv_args.contains(&"only-managed".to_string()));
        assert!(venv_args.contains(&"3.11".to_string()));
    }

    #[test]
    fn expande_dependencias_de_recorte_offline_sem_duplicatas() {
        let pedidas = vec![
            "liver_segments".to_string(),
            "liver_segments_mr".to_string(),
            "abdominal_muscles".to_string(),
            "liver_vessels".to_string(),
        ];
        let expandidas = expandir_tarefas_com_dependencias(&pedidas);
        assert_eq!(
            expandidas,
            vec![
                "total_fast",
                "liver_segments",
                "total_fast_mr",
                "liver_segments_mr",
                "body_fast",
                "abdominal_muscles",
                "liver_vessels",
            ]
        );
    }

    #[test]
    fn garante_config_privada_sem_telemetria_e_com_licenca_opcional() {
        let tmp = PastaTemp::nova("privacidade");
        garantir_config_privada_totalseg(&tmp.0, Some("  aca_12345  "));
        let texto = fs::read_to_string(tmp.0.join("config.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&texto).unwrap();
        assert_eq!(json["send_usage_stats"], serde_json::Value::Bool(false));
        assert_eq!(
            json["statistics_disclaimer_shown"],
            serde_json::Value::Bool(true)
        );
        assert_eq!(
            json["license_number"],
            serde_json::Value::String("aca_12345".into())
        );
    }

    #[test]
    fn extrai_bloco_de_erro_do_uv_em_vez_apenas_do_hint_final() {
        let linhas = vec![
            "Prepared 111 packages in 18.2s".to_string(),
            "error: Failed to install: python_gdcm-3.2.6-cp311-cp311-win_amd64.whl".to_string(),
            "  Caused by: O processo não pode acessar o arquivo (os error 32)".to_string(),
            "hint: `python-gdcm` (v3.2.6) was included because `totalsegmentator` depends on `dicom2nifti`".to_string(),
        ];
        let resumo = extrair_resumo_erro(&linhas);
        assert!(resumo.contains("error: Failed to install: python_gdcm"));
        assert!(resumo.contains("os error 32"));
    }

    #[test]
    fn resolve_chave_de_licenca_por_tarefa_com_fallback_irma_e_padrao() {
        let mut chaves = BTreeMap::new();
        chaves.insert("tissue_types".to_string(), "aca_TISSUE_111".to_string());
        chaves.insert("coronary_arteries".to_string(), "aca_CORONARY_222".to_string());

        let cfg = ConfigTotalSeg {
            executavel_customizado: None,
            pasta_pesos: None,
            modo_instalacao: None,
            chave_licenca: Some("aca_PADRAO_999".to_string()),
            chaves_por_tarefa: chaves,
        };

        assert_eq!(
            resolver_chave_para_tarefa(&cfg, Some("tissue_types")),
            Some("aca_TISSUE_111")
        );
        // Variante _mr herda da tarefa base quando não tiver chave própria
        assert_eq!(
            resolver_chave_para_tarefa(&cfg, Some("tissue_types_mr")),
            Some("aca_TISSUE_111")
        );
        assert_eq!(
            resolver_chave_para_tarefa(&cfg, Some("coronary_arteries")),
            Some("aca_CORONARY_222")
        );
        // Outra tarefa usa a chave padrão
        assert_eq!(
            resolver_chave_para_tarefa(&cfg, Some("heartchambers_highres")),
            Some("aca_PADRAO_999")
        );
    }
}
