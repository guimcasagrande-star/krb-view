// Não abre o console no Windows na versão final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod exames;
mod ponte_pacs;

fn main() {
    tauri::Builder::default()
        .manage(ponte_pacs::Ponte::default())
        .invoke_handler(tauri::generate_handler![
            ponte_pacs::pacs_definir_servidores,
            ponte_pacs::pacs_conectar,
            ponte_pacs::pacs_certificado,
            ponte_pacs::pacs_enviar,
            ponte_pacs::pacs_fechar,
            exames::exames_pasta_padrao,
            exames::exames_gravar,
            exames::exames_listar,
            exames::exames_ler,
            exames::exames_tamanho,
            exames::exames_apagar
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o visualizador");
}
