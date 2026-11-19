# KRB View — Visualizador DICOM

Visualizador DICOM leve para uso pessoal e estudo, desenvolvido com Vite, TypeScript, Cornerstone3D e Tauri. **Não é dispositivo médico e não foi validado para diagnóstico.**

## Principais recursos

- Abertura local de pastas/arquivos DICOM (com suporte a JPEG Lossless, JPEG-LS, JPEG 2000 e RLE), MPR, MIP/MinIP, comparação sincronizada, PET/CT com SUV e fusão, reconstrução 3D, segmentação/volumetria (manual e integração local opcional com TotalSegmentator), medidas avançadas (incluindo volume elipsoide automático 3D e ferramenta de 3 eixos), cliente PACS local (C-ECHO, C-FIND, C-GET, C-MOVE e DICOM TLS) e exportação de exames em DICOM + DICOMDIR ou JPEG com anonimização opcional.
- **100% local:** nenhum exame, metadado ou telemetria sai da máquina sem ação explícita do usuário.

## Comandos

```bash
npm install         # instala as dependências
npm test            # roda a suíte de testes unitários (Vitest)
npm run typecheck   # confere os tipos TypeScript
npm run build       # compila o frontend (Vite)
npm run tauri build # compila o app e os instaladores Windows (.exe / .msi)
npm run phantom     # gera exames sintéticos em test-data/phantom
```

Requer Node.js 22+ e Rust (para compilar o app Tauri).

## Phantom

`npm run phantom` cria um PET/CT e uma TC anterior sintéticos, sem nenhum dado de paciente, com valores conhecidos (SUV 10,00 e 5,00 nas lesões, fundo 1,00; 40, 80 e 700 HU na TC) para validação automatizada.

## Privacidade

O KRB View processa todos os exames, medidas, segmentações e exportações **100% localmente** na máquina do usuário. Nenhuma telemetria ou dado de paciente é enviado para servidores externos. Conexões de rede ocorrem apenas quando solicitadas explicitamente pelo usuário (PACS cadastrado ou verificação de atualizações no GitHub Releases).

## Licença

Distribuído sob a licença [MIT](LICENSE).
