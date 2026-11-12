/**
 * Substituto mínimo do módulo `events` do Node.
 * O vtk.js (dependência do Cornerstone3D) traz o xmlbuilder2, que estende EventEmitter
 * mesmo sem usá-lo na renderização. No navegador esse módulo não existe; esta classe
 * evita instalar um pacote só para isso.
 */
type Ouvinte = (...args: unknown[]) => void;

export class EventEmitter {
  private ouvintes = new Map<string | symbol, Ouvinte[]>();

  on(nome: string | symbol, fn: Ouvinte): this {
    const lista = this.ouvintes.get(nome) ?? [];
    lista.push(fn);
    this.ouvintes.set(nome, lista);
    return this;
  }
  addListener(nome: string | symbol, fn: Ouvinte): this {
    return this.on(nome, fn);
  }
  once(nome: string | symbol, fn: Ouvinte): this {
    const uma: Ouvinte = (...args) => {
      this.off(nome, uma);
      fn(...args);
    };
    return this.on(nome, uma);
  }
  off(nome: string | symbol, fn: Ouvinte): this {
    const lista = this.ouvintes.get(nome);
    if (lista) this.ouvintes.set(nome, lista.filter((f) => f !== fn));
    return this;
  }
  removeListener(nome: string | symbol, fn: Ouvinte): this {
    return this.off(nome, fn);
  }
  removeAllListeners(nome?: string | symbol): this {
    if (nome === undefined) this.ouvintes.clear();
    else this.ouvintes.delete(nome);
    return this;
  }
  emit(nome: string | symbol, ...args: unknown[]): boolean {
    const lista = this.ouvintes.get(nome);
    if (!lista || lista.length === 0) return false;
    for (const fn of [...lista]) fn(...args);
    return true;
  }
}

export default EventEmitter;
