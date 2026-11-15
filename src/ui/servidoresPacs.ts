/**
 * Tela "Servidores PACS" (fase 11.2): cadastrar, editar, remover e testar servidores, e o AE title
 * desta estação. Conexão segura (DICOM TLS) por servidor: no primeiro teste o app mostra a
 * impressão digital do certificado do servidor e só conecta depois de o usuário confiar nela. Fica guardada no armazenamento do app (pasta de dados do programa, nunca no
 * projeto) e só existe no app empacotado (Tauri), que é quem abre conexões TCP.
 */

import { echo, type PacsServer } from '../pacs/client.ts';
import { formatFingerprint, parseConfig } from '../pacs/config.ts';
import { PacsError } from '../pacs/errors.ts';
import {
  connectTauri,
  definirServidoresPermitidos,
  obterCertificadoTauri,
  pacsDisponivel,
} from '../pacs/transporteTauri.ts';
import { carregarConfigPacs, salvarConfigPacs, type ConfigPacs } from '../state/pacsConfig';

const AVISO = 'Sem VPN ou DICOM TLS, os dados trafegam abertos.';

/** Como o servidor aparece na coluna "Conexão". */
function textoConexao(s: PacsServer): string {
  if (!s.tls) return 'aberta';
  return s.certificateSha256 ? '🔒 TLS' : '🔒 TLS (confirmar)';
}

let caixa: HTMLDialogElement | undefined;
let config: ConfigPacs;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...filhos: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const { class: classe, ...resto } = props as Record<string, unknown>;
  const e = Object.assign(document.createElement(tag), resto);
  if (classe) e.className = String(classe);
  e.append(...filhos);
  return e;
}

/** Valida com `parseConfig` (mesmas regras do pacs.json); devolve a mensagem ou null. */
function validar(c: ConfigPacs): string | null {
  if (c.servidores.length === 0) {
    // parseConfig exige ao menos um servidor; sem servidores só validamos o AE title.
    try {
      parseConfig({ meuAeTitle: c.meuAeTitle, servidores: [{ nome: 'x', host: 'x', porta: 1, aeTitle: 'X' }] });
      return null;
    } catch (e) {
      return e instanceof PacsError ? e.message : String(e);
    }
  }
  try {
    parseConfig({
      meuAeTitle: c.meuAeTitle,
      servidores: c.servidores.map((s) => ({
        nome: s.name,
        host: s.host,
        porta: s.port,
        aeTitle: s.aeTitle,
        ...(s.tls ? { tls: true } : {}),
        ...(s.certificateSha256 ? { certificado: s.certificateSha256 } : {}),
      })),
    });
    return null;
  } catch (e) {
    return e instanceof PacsError ? e.message : String(e);
  }
}

async function guardar(): Promise<string | null> {
  const erro = validar(config);
  if (erro) return erro;
  salvarConfigPacs(config);
  await definirServidoresPermitidos(config.servidores);
  return null;
}

function desenhar(): void {
  if (!caixa) return;
  const corpo = caixa.querySelector<HTMLElement>('.pacs-corpo')!;
  corpo.replaceChildren();

  const aviso = el('p', { class: 'cfg-aviso', textContent: `⚠ ${AVISO}` });
  const msg = el('p', { class: 'cfg-aviso' });
  msg.hidden = true;
  const mostrar = (t: string | null): void => {
    msg.hidden = !t;
    msg.textContent = t ?? '';
  };

  const ae = el('input', { type: 'text', value: config.meuAeTitle, maxLength: 16 });
  ae.title = 'AE title desta estação, como cadastrado no PACS (até 16 caracteres, sem acentos)';
  ae.addEventListener('change', () => {
    config.meuAeTitle = ae.value.trim();
    void guardar().then(mostrar);
  });
  const linhaAe = el('label', { class: 'cfg-linha' }, el('span', {}, 'AE title desta estação'), ae);

  const limiteCache = el('input', {
    type: 'number',
    value: String(config.limiteCacheGb),
    min: '0',
    step: '1',
  });
  limiteCache.title = 'Tamanho máximo em GB da pasta de exames baixados (0 = sem limite)';
  limiteCache.addEventListener('change', () => {
    const val = Number(limiteCache.value);
    const sanitizado = Number.isFinite(val) && val >= 0 ? val : 0;
    limiteCache.value = String(sanitizado);
    config.limiteCacheGb = sanitizado;
    void guardar().then(mostrar);
  });
  const linhaCache = el(
    'label',
    { class: 'cfg-linha' },
    el('span', {}, 'Limite do cache em disco (GB)'),
    limiteCache,
  );

  const tabela = el('table', { class: 'cfg-tabela pacs-tabela' });
  tabela.append(
    el('tr', {}, el('th', {}, 'Nome'), el('th', {}, 'Endereço'), el('th', {}, 'Porta'), el('th', {}, 'AE title'), el('th', {}, 'Conexão'), el('th', {})),
  );
  config.servidores.forEach((s, i) => {
    const resultado = el('span', { class: 'pacs-resultado' });
    const testar = el('button', { type: 'button', textContent: 'Testar' });
    testar.addEventListener('click', async () => {
      resultado.textContent = '…';
      resultado.className = 'pacs-resultado';
      const t0 = performance.now();
      try {
        await definirServidoresPermitidos(config.servidores);
        // Conexão segura ainda sem certificado confirmado: mostra o que o servidor apresenta.
        if (s.tls && !s.certificateSha256) {
          const digital = await obterCertificadoTauri(s.host, s.port);
          const confiar = el('button', { type: 'button', class: 'primario', textContent: 'Confiar neste certificado' });
          confiar.addEventListener('click', () => {
            s.certificateSha256 = digital;
            void guardar().then(() => desenhar());
          });
          resultado.replaceChildren(
            el('span', {}, 'Certificado apresentado pelo servidor (SHA-256):'),
            el('code', { class: 'pacs-digital', textContent: formatFingerprint(digital) }),
            el('span', {}, 'Confira com o TI do hospital antes de confiar.'),
            confiar,
          );
          resultado.className = 'pacs-resultado pacs-certificado';
          return;
        }
        await echo(s, { connect: connectTauri, callingAeTitle: config.meuAeTitle, timeoutMs: 10_000 });
        resultado.textContent = `✓ ${Math.round(performance.now() - t0)} ms`;
        resultado.className = 'pacs-resultado ok';
      } catch (e) {
        resultado.textContent = e instanceof Error ? e.message : String(e);
        resultado.className = 'pacs-resultado erro';
      }
    });
    const editar = el('button', { type: 'button', textContent: 'Editar' });
    editar.addEventListener('click', () => formulario(i));
    const remover = el('button', { type: 'button', textContent: '✕', title: 'Remover servidor' });
    remover.addEventListener('click', () => {
      config.servidores.splice(i, 1);
      void guardar().then(() => desenhar());
    });
    tabela.append(
      el(
        'tr',
        {},
        el('td', {}, s.name),
        el('td', {}, s.host),
        el('td', {}, String(s.port)),
        el('td', {}, s.aeTitle),
        el('td', { title: s.certificateSha256 ? `Certificado confirmado (SHA-256): ${formatFingerprint(s.certificateSha256)}` : '' }, textoConexao(s)),
        el('td', { class: 'pacs-acoes' }, testar, editar, remover, resultado),
      ),
    );
  });

  const adicionar = el('button', { type: 'button', textContent: '+ Adicionar servidor' });
  adicionar.addEventListener('click', () => formulario(-1));
  corpo.append(aviso, linhaAe, linhaCache, tabela, adicionar, msg);

  function formulario(indice: number): void {
    const atual: PacsServer = indice >= 0 ? config.servidores[indice]! : { name: '', host: '', port: 104, aeTitle: '' };
    const nome = el('input', { type: 'text', value: atual.name });
    const host = el('input', { type: 'text', value: atual.host });
    const porta = el('input', { type: 'number', value: String(atual.port), min: '1', max: '65535' });
    const aet = el('input', { type: 'text', value: atual.aeTitle, maxLength: 16 });
    const seguro = el('input', { type: 'checkbox', checked: atual.tls === true });
    // Certificado já confirmado: mostra e deixa esquecer (para confirmar outro no próximo teste).
    let digital = atual.certificateSha256;
    const linhaCertificado = el('div', { class: 'cfg-linha pacs-linha-certificado' });
    const desenharCertificado = (): void => {
      linhaCertificado.hidden = !seguro.checked;
      if (!digital) {
        linhaCertificado.replaceChildren(
          el('span', {}, 'Certificado do servidor'),
          el('span', { class: 'cfg-dica' }, 'Ainda não confirmado: salve e use "Testar" para ver e confirmar o certificado.'),
        );
        return;
      }
      const esquecer = el('button', { type: 'button', textContent: 'Esquecer' });
      esquecer.title = 'Use quando o hospital trocar o certificado: o próximo teste mostra o novo para confirmar';
      esquecer.addEventListener('click', () => {
        digital = undefined;
        desenharCertificado();
      });
      linhaCertificado.replaceChildren(
        el('span', {}, 'Certificado confirmado'),
        el('code', { class: 'pacs-digital', textContent: formatFingerprint(digital) }),
        esquecer,
      );
    };
    seguro.addEventListener('change', desenharCertificado);
    desenharCertificado();
    const erro = el('p', { class: 'cfg-aviso' });
    erro.hidden = true;
    const salvar = el('button', { type: 'button', class: 'primario', textContent: 'Salvar' });
    const cancelar = el('button', { type: 'button', textContent: 'Cancelar' });
    cancelar.addEventListener('click', () => desenhar());
    salvar.addEventListener('click', async () => {
      const novo: PacsServer = { name: nome.value.trim(), host: host.value.trim(), port: Number(porta.value), aeTitle: aet.value.trim() };
      if (seguro.checked) {
        novo.tls = true;
        // Endereço ou porta diferentes são outro servidor: o certificado precisa ser confirmado de novo.
        const mesmoDestino = novo.host.toLowerCase() === atual.host.toLowerCase() && novo.port === atual.port;
        if (digital && mesmoDestino) novo.certificateSha256 = digital;
      }
      const copia = { ...config, servidores: [...config.servidores] };
      if (indice >= 0) copia.servidores[indice] = novo;
      else copia.servidores.push(novo);
      const problema = validar(copia);
      if (problema) {
        erro.hidden = false;
        erro.textContent = problema;
        return;
      }
      config = copia;
      await guardar();
      desenhar();
    });
    corpo.replaceChildren(
      el('h3', {}, indice >= 0 ? 'Editar servidor' : 'Novo servidor'),
      el('label', { class: 'cfg-linha' }, el('span', {}, 'Nome'), nome),
      el('label', { class: 'cfg-linha' }, el('span', {}, 'Endereço (IP ou nome)'), host),
      el('label', { class: 'cfg-linha' }, el('span', {}, 'Porta'), porta),
      el('label', { class: 'cfg-linha' }, el('span', {}, 'AE title do servidor'), aet),
      el(
        'label',
        { class: 'cfg-linha', title: 'Criptografa a conexão com o servidor (TLS 1.2 ou mais novo). O PACS precisa oferecer DICOM TLS nesta porta (é comum ser a 2762).' },
        el('span', {}, 'Conexão segura (DICOM TLS)'),
        seguro,
      ),
      linhaCertificado,
      erro,
      el('div', { class: 'pacs-botoes' }, salvar, cancelar),
    );
  }
}

function criarCaixa(): HTMLDialogElement {
  const d = el('dialog', { id: 'servidores-pacs' });
  d.setAttribute('aria-label', 'Servidores PACS');
  const fechar = el('button', { type: 'button', textContent: 'Fechar', class: 'cfg-fechar' });
  fechar.addEventListener('click', () => d.close());
  d.append(el('h2', {}, 'Servidores PACS'), el('div', { class: 'pacs-corpo' }), fechar);
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  return d;
}

export function abrirServidoresPacs(): void {
  caixa ??= criarCaixa();
  config = carregarConfigPacs();
  desenhar();
  if (!caixa.open) caixa.showModal();
}

/** Ao iniciar: informa à ponte os servidores já cadastrados (só no app empacotado). */
export function iniciarPacs(): void {
  if (!pacsDisponivel()) return;
  void definirServidoresPermitidos(carregarConfigPacs().servidores);
}
