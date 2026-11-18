# Visualizador DICOM pessoal

## Objetivo

Visualizador DICOM leve, para uso pessoal, nos moldes do RadiAnt: abre exames locais, responde rápido e tem MPR, MIP, comparação de exames e PET/CT com SUV e fusão. Depois: reconstrução 3D, segmentação com volumetria e órgãos e vasos em 3D.

Usuário: radiologista (oncologia, PET-CT, TC e RM de abdome/pelve). A interface deve ser em português do Brasil.

## Princípios (valem para todas as fases)

1. **Leve.** Abrir rápido, rolar sem travar. Cada dependência nova precisa se justificar. Sem framework de UI pesado, sem biblioteca de componentes.
2. **100% local.** Nenhum exame, metadado ou telemetria sai da máquina. O app não faz requisições de rede em tempo de execução (fontes, CDNs e analytics incluídos).
3. **Em fases.** Implementar uma fase por vez, na ordem abaixo. Não começar a próxima antes de a atual passar nos critérios de aceite e o usuário aprovar.
4. **Sem dados de paciente no repositório.** Usar o phantom sintético (`npm run phantom`) e exames anonimizados em `test-data/` (pasta no `.gitignore`).
5. **Não é dispositivo médico.** Mostrar aviso discreto e permanente: "Uso pessoal/estudo. Não validado para diagnóstico."
6. **Números corretos acima de recursos novos.** Medidas, HU e SUV errados são piores do que a função não existir.

## O que já está pronto (não reescrever)

A lógica difícil já foi escrita e testada (168 testes, `npm test`). Ela é pura: não depende do navegador nem do Cornerstone. **O trabalho que falta é interface e integração: chamar estas funções, não refazê-las.**

| Arquivo | O que faz |
| --- | --- |
| `src/io/types.ts` | Tipos `InstanceMeta`, `PetMeta`, `Issue`, `Vec3`, `Orientation`. |
| `src/io/readHeader.ts` | `readHeaderFromBlob(file, id)` e `parseHeader(bytes, id)`: leem só o cabeçalho, inclusive tags de PET e privadas (GE, Philips), nomes com acento, arquivos sem cabeçalho Part 10. |
| `src/io/organize.ts` | `buildIndex(metas)`: árvore paciente > estudo > série > pilha, com estudos do mais recente ao mais antigo e arquivos repetidos descartados. `formatPersonName`. |
| `src/io/geometry.ts` | `sortSlices`, `splitIntoStacks` (separa difusão, dinâmico, multi-eco, localizador), `analyzeStack` (diz se a pilha pode virar volume e por que não), `gridFromStack`, `gridFromVolumeProps` (grade a partir de um volume do Cornerstone), `voxelToWorld`, `worldToVoxel`, `classifyPlane`, `estimateVolumeBytes`. |
| `src/io/dicomTime.ts` | Datas e horas DICOM; `formatDatePtBr`, `formatInstantPtBr`. |
| `src/pet/suv.ts` | `computeSuv(instances)`: fatores de SUVbw, SUL (Janmahasatian e James) e SUVbsa por imagem, com todos os parâmetros usados e os motivos quando não dá para calcular. |
| `src/pet/fusionPairing.ts` | `findFusionCandidates(study)`: pares PET + TC/RM, do melhor ao pior. |
| `src/volume/voxelStats.ts` | `sphereMask`, `maskStats`, `peakInMask` (SUVpico), `regionGrow`, `thresholdMask`, `isocontour` (41% do máximo ou limiar fixo), `lesionMetrics` (máx, média, pico, volume, TLG), `maskVolumeMl`. Base da volumetria. |
| `src/compare/sync.ts` | `createLink`, `syncedSlice`, `relink`, `invertLink`: rolagem ligada por posição em mm, com ajuste manual. |
| `tests/` | Um arquivo de teste por módulo, mais `phantom.test.ts` (ponta a ponta). |
| `scripts/gerar-phantom.ts` | Gera PET/CT e TC anterior sintéticos com valores conhecidos. |

Regras para estes arquivos:

- Não alterar sem pedir ao usuário. Se parecer haver um erro, mostrar o caso que falha e perguntar.
- Se um deles precisar mudar, a mudança vem com teste novo, e todos os testes continuam passando.
- Mensagens de `Issue.message` já estão em português e prontas para mostrar na tela. `Issue.code` é para a lógica.
- **Não trocar `computeSuv` por `@cornerstonejs/calculate-suv`.** A biblioteca (v1.1.0) decai a dose mesmo quando `DecayCorrection` é `ADMIN`, falha quando a injeção foi antes da meia-noite e não recalcula o horário em séries Siemens reprocessadas. Ela fica só como conferência nos testes.

## Stack

- **Vite + TypeScript** (strict). Importações sem extensão em `src/`.
- **Cornerstone3D** (`@cornerstonejs/core`, `tools`, `dicom-image-loader`) para renderização, volumes, MPR, MIP, fusão e ferramentas.
- **dicom-parser** para leitura de cabeçalhos (já em uso em `src/io/readHeader.ts`).
- UI: **Preact** ou TypeScript puro com CSS simples. Não usar OHIF.
- Testes: **Vitest** (unidade) e **Playwright** (um fluxo de fumaça por fase).
- Fase final opcional: empacotar com **Tauri** (não Electron).

Versões vistas em 12/11/2026: `@cornerstonejs/*` 5.17.1, `dicom-parser` 1.8.21, `vite` 8.3.8, `vitest` 5.1.0, `typescript` 7.0.2. Fixar as versões exatas no `package.json`.

**Antes de usar qualquer API do Cornerstone3D:** abrir a declaração de tipos instalada em `node_modules/@cornerstonejs/<pacote>/dist/esm/` e os exemplos oficiais. A biblioteca muda entre versões (a 5.x tem tipos de viewport antigos e novos, com sufixo `Next`); exemplos antigos da internet não servem. Nomes conferidos na 5.17.1, só pela leitura dos tipos, sem rodar no navegador:

- Arquivo local vira `imageId` com `wadouri.fileManager.add(file)` do `dicom-image-loader`.
- `volumeLoader.createAndCacheVolume(volumeId, { imageIds })` e `setVolumesForViewports(...)`.
- `Enums.ViewportType`: `STACK`, `ORTHOGRAPHIC`, `VOLUME_3D`.
- `viewport.setBlendMode(Enums.BlendModes.MAXIMUM_INTENSITY_BLEND | MINIMUM_INTENSITY_BLEND | AVERAGE_INTENSITY_BLEND)` e `viewport.setSlabThickness(mm)`.
- Volume: `volume.dimensions`, `volume.spacing` (`[entre colunas, entre linhas, entre cortes]`), `volume.origin`, `volume.direction` (linha, coluna, normal) e `volume.voxelManager.getCompleteScalarDataArray()`.
- SUV: `metaData.addProvider(fn, prioridade)` respondendo ao tipo `'scalingModule'` com `{ suvbw, suvlbm, suvbsa }`. Com isso o carregador já entrega o PET em SUVbw (`utilities.isPTPrescaledWithSUV` confirma).
- Ferramentas: `WindowLevelTool`, `PanTool`, `ZoomTool`, `StackScrollTool`, `LengthTool`, `AngleTool`, `EllipticalROITool`, `RectangleROITool`, `CircleROITool`, `ProbeTool`, `CrosshairsTool`, `ReferenceLinesTool`, `MIPJumpToClickTool`, `TrackballRotateTool`, `VolumeCroppingTool`, `BrushTool`, `SphereScissorsTool`, `RegionSegmentTool`, `PaintFillTool`.
- Sincronizadores prontos: `createVOISynchronizer`, `createZoomPanSynchronizer`, `createCameraPositionSynchronizer`, `createSlabThicknessSynchronizer`.
- Predefinições 3D em `CONSTANTS.VIEWPORT_PRESETS`: `CT-Bone`, `CT-AAA`, `CT-Chest-Contrast-Enhanced`, `CT-Liver-Vasculature`, `CT-Coronary-Arteries`, `CT-MIP`, `MR-Angio`, entre outras.

## Arquitetura

```
src/
  io/            (pronto) leitura de cabeçalhos, agrupamento, geometria
  pet/           (pronto: suv, fusionPairing) + fusão e colormaps
  volume/        (pronto: voxelStats) + montagem de volumes, MPR, MIP
  compare/       (pronto: sync) + ligação com os viewports
  viewer/        inicialização do Cornerstone3D, viewports, layouts
  tools/         configuração de ferramentas e atalhos
  ui/            painéis, barra de ferramentas, lista de séries
  state/         estado global mínimo (store simples, sem Redux)
  render3d/      (fase 8) reconstrução 3D
  segmentation/  (fases 9 e 10) segmentos, volumetria, superfícies
```

Regras:

- Lógica que dá para testar sem navegador fica em função pura, com teste em `tests/`.
- Decodificação de pixels sempre em Web Workers.
- Um único `RenderingEngine` compartilhado entre os viewports.
- Um volume carregado é compartilhado por todos os viewports que o usam (2D, MPR, MIP, fusão, 3D, segmentação). Nunca carregar a mesma série duas vezes.
- A ordem das imagens num viewport é sempre a de `stack.instances` (já ordenada). O carregador de volumes também precisa receber os `imageIds` nessa ordem.
- O volume do Cornerstone guarda os cortes em ordem crescente ao longo da normal, que pode ser a inversa da ordem de exibição. Para medir em voxels do volume, montar a grade com `gridFromVolumeProps(volume)`, nunca com `gridFromStack`.

## Fases

### Fase 1: carregamento local e funções básicas

- Abrir pasta por `showDirectoryPicker()` (Chrome/Edge), com alternativa por `<input webkitdirectory>` e por arrastar e soltar. Ler subpastas. Aceitar arquivos sem extensão; ignorar o arquivo DICOMDIR e varrer a pasta.
- Indexar com `readHeaderFromBlob` (poucos arquivos em paralelo, com barra de progresso) e `buildIndex`. Mostrar quantos arquivos foram ignorados e por quê.
- Painel lateral com estudos, séries, pilhas e miniaturas (geradas sob demanda).
- Viewport 2D: rolagem, janela/nível, zoom, pan, inverter, girar/espelhar, cine.
- Presets de janela para TC: partes moles, pulmão, osso, fígado, cérebro, mediastino.
- Medidas: distância, ângulo, ROI elíptica/retangular (média, desvio, mín, máx, área), sonda de HU. Apagar e limpar medidas.
- Overlay de texto nos quatro cantos (paciente, data, série, corte, espessura, W/L, zoom) com tecla para ocultar.
- Layouts 1x1, 1x2, 2x2.
- Sintaxes de transferência: sem compressão, JPEG Lossless, JPEG-LS, JPEG 2000, RLE. Série não suportada mostra mensagem clara, sem quebrar o app.

Aceite: abrir uma TC de ~500 cortes; a primeira imagem aparece em poucos segundos e a rolagem fica fluida após o carregamento. HU medido bate com um visualizador de referência (Weasis/RadiAnt). No phantom: corpo 40 HU, coluna 700 HU, lesões 80 HU, diâmetro da lesão A 30 mm.

### Fase 2: MPR

- Montar volume a partir da pilha (carregamento em streaming, com imagem utilizável antes de terminar).
- Só montar volume se `stack.geometry.volumeOk`. Senão, mostrar `stack.geometry.issues` e oferecer só o modo 2D.
- Layout axial + coronal + sagital com linhas de referência (crosshairs) sincronizadas.
- MPR oblíquo girando as linhas de referência.
- Espessura de slab ajustável nos três planos.

Aceite: medidas de distância no coronal/sagital corretas em série com voxel anisotrópico.

### Fase 3: MIP / MinIP

- Slab com modos MIP, MinIP e média, espessura ajustável por controle deslizante e pelo scroll com modificador.
- MIP de volume inteiro com rotação (cine rotatório), usado depois no PET.

Aceite: mudar a espessura do slab em tempo real sem travar em TC de tórax.

### Fase 4: comparação de exames

- Abrir dois estudos (ou duas séries) lado a lado, de pastas e até de pacientes diferentes (o mesmo paciente vindo de hospitais diferentes tem IDs diferentes).
- Sincronização ligável/desligável de: rolagem, janela/nível, zoom/pan.
- Rolagem sincronizada por **posição** (mm) com `createLink` e `syncedSlice`, não por índice de corte.
- **Offset manual**: com o vínculo desligado, o usuário alinha os dois exames num ponto anatômico; ao religar, `relink` guarda a diferença. Mostrar o offset atual e botão para zerar.
- Indicar em cada viewport a data do estudo; identificar claramente qual é o atual e qual é o anterior.
- Quando `syncedSlice` devolver `outOfRange`, avisar no viewport que o outro exame não cobre aquela região.
- Comparação também funciona em MPR (mesmo plano nos dois exames).

Aceite: duas TCs de datas diferentes, com espessuras de corte diferentes, rolam juntas e continuam alinhadas depois do ajuste manual. No phantom: offset inicial de 37 mm entre a TC atual e a anterior.

### Fase 5: PET com SUV

O cálculo está em `src/pet/suv.ts`. Falta ligar ao Cornerstone e construir a interface.

- Registrar um provedor de metadados que responde a `'scalingModule'` com os fatores de `computeSuv` para cada imagem da série.
- Se `computeSuv` devolver `ok: false`: **não mostrar SUV.** Mostrar Bq/mL e as mensagens de `errors`. Nunca assumir valor padrão.
- Mostrar os `warnings` (injeção considerada no dia anterior, série reprocessada, altura inválida).
- Escala do PET em SUVbw, com janela em SUV (presets 0–5, 0–7, 0–10 e ajuste livre do teto).
- SUL e SUVbsa como opção quando existirem em `factors`.
- ROI esférica (VOI) com SUVmax, SUVmédio, SUVpico e volume, usando `sphereMask` e `lesionMetrics`. Segmentação da lesão por 41% do máximo ou por limiar fixo (`isocontour`), com MTV e TLG.
- Painel com os parâmetros de `params` (peso, dose, horário da injeção, horário da aquisição e de onde ele veio, tempo de captação, meia-vida, dose decaída) para conferência.
- Escala de cinza invertida como padrão do PET isolado.

Aceite: no phantom, SUVmax 10,00 na lesão A, 5,00 na lesão B, fundo 1,00, volume da lesão A perto de 14 mL. Em exames reais, SUVmax de pelo menos dois fabricantes diferentes bate com o visualizador de referência com diferença menor que 1%.

### Fase 6: fusão PET/CT

- Escolher o par com `findFusionCandidates`. `sameFrame: false` significa fusão manual, com aviso.
- Fusão por sobreposição do PET sobre a TC no mesmo viewport, com reamostragem pela geometria de cada volume (não por índice de corte).
- Controle de opacidade, colormaps (hot iron, PET/rainbow, cinza invertido) e teto de SUV independentes da janela da TC.
- Layout PET/CT: TC, PET, fusão e MIP rotatório do PET; clicar no MIP leva os outros viewports ao ponto.
- Fusão disponível nos três planos (MPR).
- ROIs de SUV funcionam sobre a fusão e medem o PET; sonda mostra HU e SUV do ponto.
- Ajuste manual de registro (translação) para corrigir desalinhamento por movimento, com botão de restaurar.
- Comparação de dois PET/CT (atual e anterior) lado a lado com a mesma escala de SUV.

Aceite: PET/CT de corpo inteiro abre em fusão, rola fluido, e o SUVmax medido na fusão é igual ao medido no PET isolado.

### Fase 7: acabamento

- Empacotar com Tauri para abrir como programa e associar a pastas/arquivos DICOM.
- Lista de pastas recentes (guardar só o caminho, nunca dados do exame).
- Exportar imagem do viewport em PNG/JPEG.
- Atalhos configuráveis.

### Fase 8: reconstrução 3D

- Viewport 3D com renderização volumétrica do mesmo volume já carregado.
- Predefinições por tecido (osso, vasos com contraste, pulmão, partes moles, MIP), com ajuste de opacidade e brilho.
- Girar, aproximar e mover com o mouse; botões para as vistas anterior, posterior, laterais, superior e inferior.
- Caixa de recorte para tirar mesa, costelas ou o que estiver na frente.
- Clicar num ponto do 3D leva os viewports 2D àquele ponto.
- Qualidade reduzida enquanto gira e completa ao soltar, para não travar.

Aceite: TC de tórax/abdome com contraste abre em 3D em poucos segundos e gira sem travar numa máquina sem placa de vídeo dedicada; no phantom, coluna e lesões aparecem nas posições certas.

### Fase 9: segmentação e volumetria

- Segmentação manual e semiautomática em labelmap: pincel, pincel com limiar de HU/SUV, esfera, preenchimento, borracha, crescimento de região a partir de um clique, interpolação entre cortes.
- Lista de segmentos: nome, cor, visibilidade, opacidade, bloquear, apagar.
- Volumetria por segmento com `maskVolumeMl` e `maskStats`: volume em mL, média, desvio, mínimo e máximo (HU ou SUV). No PET, MTV e TLG.
- Exportar a tabela de volumes em CSV.
- Salvar e reabrir a segmentação num arquivo separado, numa pasta escolhida pelo usuário. O app continua sem escrever nos arquivos do exame.

Aceite: no phantom, volume da lesão A (raio 15 mm) dentro de 5% de 14,1 mL; o volume não muda ao salvar e reabrir.

### Fase 10: órgãos e vasos em 3D

- Converter segmentos em superfícies e mostrá-los no viewport 3D, cada um com cor e opacidade, sozinhos ou sobre a renderização volumétrica.
- Vasos sem IA: em fase arterial ou portal, crescimento de região a partir de um clique no vaso, com faixa de HU ajustável (`regionGrow`).
- Segmentação automática de órgãos e vasos (opcional): rodar o TotalSegmentator fora do navegador e importar o resultado (DICOM SEG ou NIfTI). Regras:
  - É um programa Python à parte, pesado. Fica fora do app; o visualizador continua leve e funciona sem ele.
  - Continua 100% local. Nada de serviço em nuvem.
  - A tarefa principal (`total`) é aberta (Apache-2.0) e inclui aorta, veias cavas, veia porta e esplênica, artérias e veias ilíacas e os órgãos abdominais. `liver_vessels` e `lung_vessels` também são abertas. Coronárias, câmaras cardíacas em alta resolução e algumas outras exigem licença (gratuita para uso não comercial). Conferir a licença antes de usar cada tarefa.
  - Em CPU, usar a opção rápida (`--fast`) ou um subconjunto de estruturas.
  - O próprio TotalSegmentator declara que não é dispositivo médico.
- Volumetria automática dos órgãos segmentados (fígado, baço, rins), com a mesma tabela da fase 9.

Aceite: fígado, baço, rins e aorta de uma TC de abdome aparecem em 3D com volumes em mL; o usuário corrige um segmento com o pincel e o volume se atualiza.

## Desempenho

- Indexação só de cabeçalhos; pixels carregados sob demanda.
- Carregar primeiro o corte visível e os vizinhos, depois o restante.
- Limite de cache configurável; liberar volumes de séries fechadas. Testar com PET/CT de corpo inteiro mais um exame anterior aberto.
- Evitar cópias de arrays de pixels; preferir os tipos nativos (Int16, Float32) ao montar volumes.
- Antes de montar volume, estimar a memória com `estimateVolumeBytes`. Série grande demais: avisar e abrir em 2D, em vez de travar a aba.
- 3D e segmentação só alocam memória quando o usuário abre essas funções.
- Medir e registrar no README: tempo até a primeira imagem, tempo de montagem do volume e uso de memória, a cada fase.

## Atalhos (padrão próximo ao RadiAnt)

- Botão esquerdo: ferramenta ativa. Botão direito arrastando: zoom. Botão do meio arrastando: pan. Scroll: cortes.
- Teclas numéricas para presets de janela.
- Teclas para alternar ferramentas (janela, distância, ROI, sonda), layout, MPR, MIP, fusão e vínculo de comparação.
- Esc cancela a ferramenta atual; Delete apaga a medida selecionada.

Listar os atalhos finais numa tela de ajuda (tecla `?`).

## Fora do escopo

- Rede: PACS, DICOMweb, C-FIND/C-MOVE, nuvem.
- Emissão de laudo, impressão em filme, gravação de CD.
- Treinar modelos de IA ou rodar IA dentro do navegador.
- Imagens multiframe (Enhanced CT/MR/PET): `analyzeStack` avisa com `MULTIFRAME`; abrir só em 2D até haver suporte.
- Edição ou anonimização de arquivos DICOM. O app nunca escreve nos arquivos do exame.

## Como trabalhar neste projeto

- O roteiro de tarefas está em `PASSO-A-PASSO.md`. Fazer uma tarefa por vez, na ordem.
- Antes de cada fase: propor um plano curto e esperar aprovação.
- Commits pequenos, um por funcionalidade, com `npm run build`, `npm test` e `npm run typecheck` passando.
- Ao terminar uma fase: rodar o app, testar no navegador com o phantom e com os exames de `test-data/`, e relatar o que funciona, o que ficou pendente e as medições de desempenho.
- Dúvida sobre comportamento clínico esperado (presets, convenções de exibição, o que mostrar no overlay): perguntar ao usuário em vez de supor.
- Não adicionar funções fora da tarefa atual, mesmo que pareçam fáceis.
- Erros de leitura de DICOM devem aparecer para o usuário com a série e o motivo, nunca falhar em silêncio.
