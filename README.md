# Visualizador DICOM pessoal

Visualizador DICOM leve para uso pessoal e estudo. **Não é dispositivo médico e não foi validado para diagnóstico.**

Estado atual: a lógica de leitura, geometria, SUV, medidas em voxels e sincronização está pronta e testada. A interface ainda não existe; o roteiro para construí-la está em `PASSO-A-PASSO.md` e as regras do projeto em `CLAUDE.md`.

## Comandos

```
npm install         instala as dependências
npm test            roda os 168 testes
npm run typecheck   confere os tipos
npm run phantom     gera exames sintéticos em test-data/phantom
```

Requer Node.js 22 ou mais novo.

## Phantom

`npm run phantom` cria um PET/CT e uma TC anterior sintéticos, sem nenhum dado de paciente, com valores conhecidos (SUV 10,00 e 5,00 nas lesões, fundo 1,00; 40, 80 e 700 HU na TC). Serve de gabarito para conferir o visualizador a cada fase. Os valores estão no começo de `scripts/gerar-phantom.ts` e na Etapa 0 do `PASSO-A-PASSO.md`.

## Desempenho

Preencher a cada fase: tempo até a primeira imagem, tempo de montagem do volume e uso de memória.
