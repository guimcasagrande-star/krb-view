// Não abre o console no Windows na versão final.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ponte_pacs;

fn main() {
    tauri::Builder::default()
        .manage(ponte_pacs::Ponte::default())
        .invoke_handler(tauri::generate_handler![
            ponte_pacs::pacs_definir_servidores,
            ponte_pacs::pacs_conectar,
            ponte_pacs::pacs_enviar,
            ponte_pacs::pacs_fechar
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o visualizador");
}
