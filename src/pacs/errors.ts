/** Erro de comunicação com o PACS. `code` é estável; `message` está em português, pronta para a tela. */
export class PacsError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PacsError';
    this.code = code;
  }
}
