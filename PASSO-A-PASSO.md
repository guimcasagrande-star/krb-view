# Passo a passo

Roteiro para construir o visualizador em tarefas pequenas, gastando poucos tokens. A lógica difícil já está pronta e testada; o que falta é interface e integração com o Cornerstone3D.

## Como usar este roteiro

1. **Uma tarefa por conversa.** Abra uma sessão nova para cada tarefa. Conversa longa é o que mais gasta token.
2. **Cole o prompt da tarefa como está.** O modelo lê o `CLAUDE.md` sozinho (no Gemini CLI, copie-o para `GEMINI.md`; em outras ferramentas, `AGENTS.md`).
3. **Confira antes de seguir.** Cada tarefa tem um item "Conferir". Só passe para a próxima quando ele estiver certo.
4. **Faça commit ao fim de cada tarefa.** Se a próxima estragar algo, é só voltar.

Cada tarefa indica o modelo sugerido:

- **Barato** (Gemini Flash, Haiku ou equivalente): interface, CSS, atalhos, ligações simples.
- **Forte** (Opus, Fable ou equivalente): integração com o Cornerstone3D, onde um erro não aparece na hora.

### Regras para colar no começo de qualquer sessão

```
Leia o CLAUDE.md. Regras desta sessão:
- Faça só a tarefa abaixo. Não adiante outras.
- Não altere nada em src/io, src/pet/suv.ts, src/pet/fusionPairing.ts,
  src/volume/voxelStats.ts, src/compare/sync.ts nem em tests/. Use essas funções.
- Antes de usar uma função do Cornerstone3D, abra a declaração de tipos em
  node_modules/@cornerstonejs/ e confirme nome e parâmetros. Não use exemplos de memória.
- Ao terminar, rode npm test, npm run typecheck e npm run build, e diga o que testar no navegador.
```

### Se algo der errado

- **Erro no terminal ou no console do navegador:** cole o erro inteiro na mesma sessão e peça a correção.
- **Depois de duas tentativas sem resolver:** pare, volte ao último commit e refaça a tarefa com o modelo forte.
- **Número errado (HU, mm, SUV):** não aceite "ajuste" no número. Peça ao modelo forte para achar a causa.

## Etapa 0: preparação (sem IA)

1. Instale o Node.js 22 ou mais novo.
2. Descompacte o projeto, abra um terminal na pasta e rode:

```
npm install
npm test
npm run typecheck
npm run phantom
```

Conferir: os testes passam e aparece a pasta `test-data/phantom` com 202 arquivos (`atual/CT`, `atual/PT`, `anterior/CT`). Esse phantom é o gabarito de todas as fases:

| O que | Valor esperado |
| --- | --- |
| TC: corpo / ar / "coluna" / lesões | 40 / -1000 / 700 / 80 HU |
| Lesão A | esfera de 30 mm de diâmetro, centro em z = 128 mm |
| Lesão B | esfera de 16 mm de diâmetro, centro em z = 180 mm |
| PET: fundo / lesão A / lesão B | SUV 1,00 / 10,00 / 5,00 |
| Volume da lesão A no PET | perto de 14 mL (14,1 analítico; 14,6 com voxel de 4 mm) |
| Fator de SUVbw | 0,000276337 |
| Tempo de captação | 60 min (injeção 13:30, aquisição 14:30) |
| TC anterior | cortes de 5 mm, mesa deslocada 37 mm, lesão A com 20 mm de diâmetro |

3. Separe exames reais anonimizados em `test-data/`: uma TC de ~500 cortes, uma RM com difusão, e PET/CT de pelo menos dois fabricantes (para validar o SUV contra o Weasis ou o RadiAnt).

## Fase 1: abrir pasta e ver imagens

### 1.1 Esqueleto do app (barato)

```
Monte o esqueleto do app com Vite: index.html, src/main.ts e CSS simples, tema escuro.
Layout: painel lateral à esquerda (lista de estudos), barra de ferramentas no topo,
área de viewports no centro, e no rodapé o aviso permanente
"Uso pessoal/estudo. Não validado para diagnóstico."
Adicione vite e os pacotes @cornerstonejs/core, tools e dicom-image-loader ao package.json
com versão exata, e os scripts dev e build. Ainda não inicialize o Cornerstone.
```

Conferir: `npm run dev` abre a página com o layout vazio; `npm run build` termina sem erro.

### 1.2 Abrir pasta e indexar (barato)

```
Implemente a abertura de pasta em src/ui/abrirPasta.ts: botão "Abrir pasta" com
showDirectoryPicker, alternativa com <input webkitdirectory> e arrastar e soltar.
Percorra as subpastas. Para cada arquivo chame readHeaderFromBlob(file, caminhoRelativo)
de src/io/readHeader.ts, no máximo 8 arquivos ao mesmo tempo, com barra de progresso.
Junte os resultados ok em uma lista e passe para buildIndex (src/io/organize.ts).
Guarde também um Map de fileId para File, para carregar os pixels depois.
Mostre quantos arquivos foram lidos e quantos ignorados, com os motivos ao clicar.
```

Conferir: abrir `test-data/phantom` mostra 202 arquivos lidos e nenhum ignorado; abrir uma pasta com PDFs e imagens misturados não trava e lista os ignorados.

### 1.3 Painel de estudos e séries (barato)

```
Implemente o painel lateral em src/ui/painelEstudos.ts a partir do DicomIndex:
paciente > estudo (data com formatDatePtBr, descrição, modalidades) > série
(número, descrição, modalidade, quantidade de imagens) > pilha (label, se houver).
Se stack.geometry.issues não estiver vazio, mostre um ícone de aviso com as mensagens.
Clicar numa pilha dispara um evento "abrirPilha" com o StackNode. Sem miniaturas ainda.
```

Conferir: o phantom aparece como um paciente ("SUV PHANTOM"), com o estudo de 15/01/2026 antes do de 10/07/2025. Uma RM com difusão aparece separada em pilhas "b=0", "b=800" etc.

### 1.4 Inicializar o Cornerstone e mostrar a pilha em 2D (forte)

```
Em src/viewer/, inicialize @cornerstonejs/core, @cornerstonejs/tools e
@cornerstonejs/dicom-image-loader (decodificação em web workers), com um único RenderingEngine.
Ao receber "abrirPilha", crie os imageIds na ordem de stack.instances usando o fileManager
do wadouri com o File guardado no Map, e mostre num viewport de pilha.
Carregue primeiro o corte do meio e os vizinhos. Série que não decodifica mostra mensagem
com o nome da série e o motivo, sem quebrar o app.
Antes de escrever, leia os tipos instalados e me diga quais funções vai usar.
```

Conferir: clicar na TC do phantom mostra a imagem e a rolagem do mouse passa os cortes na ordem. Em exame real comprimido (JPEG 2000 ou JPEG Lossless), a imagem também abre.

### 1.5 Ferramentas, presets e atalhos (barato)

```
Em src/tools/, configure um ToolGroup com: janela/nível (botão esquerdo por padrão),
zoom (botão direito), pan (botão do meio), rolagem (scroll), distância, ângulo,
ROI elíptica, ROI retangular e sonda. Botões na barra para escolher a ferramenta ativa,
inverter, girar 90°, espelhar e restaurar. Presets de janela de TC nas teclas 1 a 6:
partes moles 40/400, pulmão -600/1500, osso 300/1500, fígado 60/160, cérebro 40/80,
mediastino 50/350 (centro/largura). Esc cancela a ferramenta, Delete apaga a medida
selecionada, e a tecla ? abre uma tela com a lista de atalhos.
```

Conferir no phantom: sonda no corpo marca 40 HU, na "coluna" 700 HU, na lesão 80 HU; o diâmetro da lesão A mede 30 mm (aceite de 29 a 31) e o da "coluna", 36 mm.

### 1.6 Overlay de texto (barato)

```
Mostre texto nos quatro cantos do viewport: paciente (formatPersonName) e ID; data do estudo
e descrição da série; corte atual/total, espessura e posição em mm; W/L e zoom.
Atualize ao rolar e ao mudar janela ou zoom. A tecla O liga e desliga o overlay.
```

Conferir: os valores mudam ao rolar e ao mexer na janela; a contagem de cortes bate com a série.

### 1.7 Layouts, cine e miniaturas (barato)

```
Adicione layouts 1x1, 1x2 e 2x2, com um viewport ativo (borda destacada) que recebe
a pilha clicada no painel. Adicione cine (tocar/pausar, velocidade em quadros por segundo).
Gere miniaturas das séries sob demanda, só das que estão visíveis no painel.
```

Conferir: duas séries lado a lado rolam de forma independente; abrir uma pasta grande não fica lento por causa das miniaturas.

**Fim da fase 1.** Meça com uma TC real de ~500 cortes o tempo até a primeira imagem e anote no README.

## Fase 2: MPR

### 2.1 Montar o volume (forte)

```
Em src/volume/, monte o volume de uma pilha com o carregador de volumes em streaming,
usando os mesmos imageIds. Regras: só montar se stack.geometry.volumeOk; senão mostrar
stack.geometry.issues e manter só o 2D. Antes de montar, estime a memória com
estimateVolumeBytes e recuse com aviso se passar do limite configurado.
Um volume montado é guardado e reutilizado por todos os viewports. Ao fechar a série, libere.
```

Conferir: no phantom o volume monta; numa série com gantry inclinado ou cortes faltando aparece o aviso e o 2D continua funcionando.

### 2.2 Layout MPR (forte)

```
Adicione o modo MPR: três viewports ortográficos (axial, coronal, sagital) do mesmo volume,
com linhas de referência sincronizadas (crosshairs) que também giram para MPR oblíquo,
e espessura de slab ajustável. Botão e atalho para entrar e sair do MPR.
```

Conferir no phantom: a lesão A mede 30 mm nos três planos; clicar num ponto num plano leva os outros dois ao mesmo ponto.

## Fase 3: MIP

### 3.1 Slab MIP, MinIP e média (barato)

```
Nos viewports de volume, adicione um seletor de modo (normal, MIP, MinIP, média) e um
controle deslizante de espessura do slab em mm. Ctrl + scroll também muda a espessura.
Use setBlendMode e setSlabThickness do viewport.
```

Conferir: em TC de tórax, a espessura muda em tempo real sem travar.

### 3.2 MIP rotatório (forte)

```
Adicione um viewport de MIP do volume inteiro que gira em torno do eixo crânio-caudal,
com tocar/pausar e arrastar para girar à mão. Clicar num ponto do MIP leva os viewports 2D
ao ponto mais intenso daquela linha (existe ferramenta pronta para isso; confira nos tipos).
```

Conferir: no PET do phantom, as duas lesões aparecem girando; clicar na lesão A leva ao corte z = 128 mm.

## Fase 4: comparação de exames

### 4.1 Dois exames lado a lado (barato)

```
Adicione o modo Comparar: layout 1x2 em que cada lado recebe uma pilha de um estudo
(pode ser de pacientes diferentes na lista). Mostre em cada viewport a data do estudo
e o rótulo ATUAL (mais recente) ou ANTERIOR, em cores diferentes.
```

### 4.2 Rolagem ligada por posição (barato)

```
Ligue a rolagem dos dois viewports com src/compare/sync.ts: ao entrar no modo Comparar,
crie o vínculo com createLink(geometriaA, geometriaB). Se voltar um Issue, mostre a mensagem
e deixe a rolagem independente. Quando um lado rolar, pegue a posição do corte atual
(geometry.positions[indice]) e chame syncedSlice para saber o corte do outro lado; para o
sentido contrário use invertLink. Evite laço infinito entre os dois lados.
Se syncedSlice devolver outOfRange, mostre no outro viewport "fora da cobertura".
Botão de cadeado liga e desliga o vínculo. Ao religar, chame relink com as posições atuais
dos dois lados. Mostre o deslocamento atual em mm e um botão "zerar" que refaz o createLink.
```

Conferir no phantom (TC atual × TC anterior): o deslocamento inicial é 37,0 mm; ao rolar a atual até a lesão A, a anterior mostra a lesão A (menor); desligar, desalinhar de propósito, alinhar à mão e religar mantém o alinhamento.

### 4.3 Janela e zoom ligados (barato)

```
No modo Comparar, adicione botões para ligar janela/nível e zoom/pan entre os dois lados,
usando os sincronizadores prontos do @cornerstonejs/tools.
```

Conferir: mudar a janela de um lado muda a do outro; cada vínculo desliga separadamente.

## Fase 5: PET com SUV

### 5.1 Ligar o cálculo de SUV ao carregador (forte)

```
Em src/pet/, registre um provedor de metadados (metaData.addProvider) que responde ao tipo
'scalingModule'. Ao abrir uma pilha de PET, chame computeSuv(stack.instances) e guarde,
para cada imageId, { suvbw: factors[k].bw, suvlbm: factors[k].lbm, suvbsa: factors[k].bsa }.
Se computeSuv devolver ok: false, o provedor não responde para aquela série (os valores
ficam em Bq/mL) e o resultado fica disponível para a interface mostrar os motivos.
O provedor precisa estar registrado ANTES de as imagens serem carregadas.
Confirme lendo o código do dicom-image-loader como ele usa o scalingModule e me explique.
```

Conferir no phantom: a sonda no PET marca 1,00 no fundo e 10,00 na lesão A. Depois, edite à mão um arquivo de teste sem peso (ou use um exame real sem peso): a sonda deve mostrar Bq/mL, nunca um SUV.

### 5.2 Painel de parâmetros e avisos (barato)

```
Adicione um painel "SUV" para a série de PET ativa com os dados de result.params:
radiofármaco, peso, altura, dose injetada em MBq, meia-vida, horário da injeção e do início
da aquisição (formatInstantPtBr), de onde veio o horário da aquisição (scanTimeSource),
tempo de captação em minutos, dose decaída em MBq e fator de SUVbw.
Mostre result.warnings em amarelo. Se ok for false, mostre result.errors em vermelho
e o texto "SUV não calculado: valores em Bq/mL".
```

Conferir no phantom: FDG, 70 kg, 370 MBq, captação 60 min, fator 0,000276337, sem avisos.

### 5.3 Janela em SUV (barato)

```
Para séries de PET com SUV calculado: escala de cinza invertida por padrão, janela de 0 até
um teto em SUV, presets 0–5, 0–7 e 0–10 nas teclas 1 a 3 e um campo para o teto.
A unidade aparece no overlay (SUVbw ou Bq/mL).
```

### 5.4 Medidas de lesão (forte)

```
Adicione a ferramenta "Lesão" para PET: o usuário clica no centro e arrasta o raio de uma
esfera. Leia os voxels do volume do Cornerstone (volume.voxelManager; confira nos tipos) e
monte um ScalarVolume com a grade de gridFromVolumeProps(volume). Não use gridFromStack aqui:
a ordem dos cortes no volume pode ser a inversa da pilha. Use src/volume/voxelStats.ts:
worldToVoxel para o centro, sphereMask para a região e lesionMetrics para SUVmax, SUVmédio,
SUVpico e volume. Botões "41% do máx." e "SUV ≥ 2,5" chamam isocontour e mostram MTV e TLG,
desenhando o contorno resultante sobre a imagem.
Atenção: se o carregador já entregou os voxels em SUV, não aplique o fator de novo
(scale = 1). Escreva um teste que prove isso com o phantom.
```

Conferir no phantom: lesão A com SUVmax 10,00, SUVpico 10,00 e volume por 41% perto de 14 mL; lesão B com SUVmax 5,00. Em exames reais de dois fabricantes, SUVmax com menos de 1% de diferença para o Weasis ou RadiAnt.

## Fase 6: fusão PET/CT

### 6.1 Layout PET/CT (forte)

```
Ao abrir um estudo com PET, chame findFusionCandidates(study) e use o primeiro par.
Monte o layout PET/CT: TC, PET, fusão (os dois volumes no mesmo viewport, PET com colormap
e opacidade) e MIP rotatório do PET. Controles: opacidade, colormap (hot iron, arco-íris,
cinza invertido) e teto de SUV, independentes da janela da TC. Os quatro viewports navegam
juntos. Se o par tiver sameFrame false, avise "Fusão manual: séries de referenciais diferentes".
```

Conferir no phantom: as lesões do PET caem exatamente sobre as lesões da TC nos três planos.

### 6.2 Medidas e ajuste de registro (forte)

```
Na fusão: a sonda mostra HU e SUV do ponto; a ferramenta Lesão mede o PET.
Adicione o ajuste manual de registro: arrastar o PET sobre a TC (translação), com o
deslocamento mostrado em mm e um botão "restaurar". Use translationFromPoints e
applyTranslation de src/compare/sync.ts.
```

Conferir: SUVmax medido na fusão é igual ao medido no PET isolado.

### 6.3 Comparar dois PET/CT (barato)

```
No modo Comparar, permita dois PET (ou duas fusões) lado a lado com o mesmo teto de SUV
e o mesmo colormap, e rolagem ligada por posição como na fase 4.
```

## Fase 7: acabamento (barato)

Uma sessão para cada item: empacotar com Tauri; lista de pastas recentes (só o caminho); exportar o viewport em PNG; atalhos configuráveis.

## Fase 8: reconstrução 3D

### 8.1 Viewport 3D (forte)

```
Adicione o modo 3D: um viewport de renderização volumétrica do volume já carregado
(não carregar de novo). Seletor de predefinição a partir de CONSTANTS.VIEWPORT_PRESETS,
com nomes em português (osso, vasos, pulmão, partes moles, MIP). Girar com o botão esquerdo,
zoom com o direito, pan com o do meio. Botões para as seis vistas padrão.
Reduza a qualidade enquanto gira e restaure ao soltar.
```

Conferir no phantom: a "coluna" aparece como um cilindro atrás e as lesões nas posições certas (A à direita do paciente, B à esquerda e mais alta).

### 8.2 Recorte e navegação (barato, depois de 8.1)

```
Adicione a caixa de recorte ao viewport 3D (existe ferramenta pronta; confira nos tipos),
com botão para restaurar. Clicar num ponto do 3D leva os viewports 2D àquele ponto.
```

## Fase 9: segmentação e volumetria

### 9.1 Ferramentas de segmentação (forte)

```
Em src/segmentation/, crie a segmentação em labelmap ligada ao volume ativo, com as
ferramentas prontas do @cornerstonejs/tools: pincel, pincel com limiar, esfera, preenchimento,
borracha e crescimento de região por clique. Painel de segmentos: nome, cor, visibilidade,
opacidade, apagar, novo segmento.
```

### 9.2 Volumetria (barato, depois de 9.1)

```
Para cada segmento, monte a máscara (Uint8Array com 1 nos voxels do segmento), com a grade de
gridFromVolumeProps(volume), e calcule com
src/volume/voxelStats.ts: maskVolumeMl para o volume e maskStats para média, desvio, mínimo
e máximo. Em PET use lesionMetrics para MTV e TLG. Mostre na lista de segmentos, atualize
ao editar (com pequeno atraso para não recalcular a cada pincelada) e exporte em CSV.
```

Conferir no phantom: segmentar a lesão A na TC por crescimento de região (faixa de 60 a 100 HU) dá perto de 14,1 mL.

### 9.3 Salvar e reabrir (forte)

```
Salve a segmentação num arquivo separado, em pasta escolhida pelo usuário, e reabra.
Proponha o formato antes de implementar (DICOM SEG ou formato próprio) com prós e contras.
O app não escreve na pasta do exame.
```

## Fase 10: órgãos e vasos em 3D

### 10.1 Superfícies (forte)

```
Converta os segmentos em superfícies e mostre no viewport 3D, cada um com cor e opacidade,
sozinhos ou junto com a renderização volumétrica. Confira nos tipos do
@cornerstonejs/tools e do @cornerstonejs/polymorphic-segmentation como fazer a conversão.
```

### 10.2 Vasos por crescimento de região (barato, depois de 9.1)

```
Adicione a ferramenta "Vaso": o usuário clica dentro do vaso contrastado e define a faixa
de HU (padrão: do valor clicado menos 80 até mais 300). Use regionGrow de
src/volume/voxelStats.ts, com a grade de gridFromVolumeProps(volume) e a semente convertida
por worldToVoxel, e grave o resultado como um segmento novo.
```

Conferir: numa angio-TC, clicar na aorta segmenta a aorta e os ramos contrastados; se vazar para osso, estreitar a faixa.

### 10.3 Órgãos automáticos com TotalSegmentator (forte, opcional)

Antes de pedir código, instale e rode à mão para ver se o seu computador dá conta:

```
pip install TotalSegmentator
TotalSegmentator -i pasta_da_serie_de_TC -o saida --fast
```

Sem placa de vídeo NVIDIA ele roda em CPU, mais devagar; a opção `--fast` usa resolução menor. Se o resultado servir:

```
Adicione "Importar segmentação": o usuário escolhe o arquivo gerado pelo TotalSegmentator
(proponha qual formato de saída é mais simples de ler aqui) e cada estrutura vira um
segmento com nome em português e cor fixa por órgão. A volumetria da tarefa 9.2 passa a
valer para esses segmentos. Não chame o TotalSegmentator de dentro do navegador.
```

Só depois, se quiser um botão que rode tudo sozinho, peça a integração pelo Tauri (fase 7).

## Quando parar e chamar o modelo forte

- Qualquer valor de HU, mm, mL ou SUV diferente do gabarito do phantom.
- Imagem espelhada, de cabeça para baixo ou com cortes fora de ordem.
- PET e TC desalinhados na fusão do phantom.
- O app trava ou a memória cresce sem parar ao abrir e fechar séries.
- O modelo barato quer mudar um arquivo da lista "não reescrever".
