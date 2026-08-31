/**
 * Menu option item contract.
 */
export interface MenuOptionItem {
  readonly optionNumber: number;
  readonly title: string;
}

export const CONTRACTUAL_MENU_OPTIONS: readonly MenuOptionItem[] = [
  { optionNumber: 1, title: 'Ejecutar una búsqueda' },
  { optionNumber: 2, title: 'Crear una búsqueda' },
  { optionNumber: 3, title: 'Editar una búsqueda' },
  { optionNumber: 4, title: 'Ver historial' },
  { optionNumber: 5, title: 'Revisar publicaciones dudosas' },
  { optionNumber: 6, title: 'Ver errores de fuentes' },
  { optionNumber: 7, title: 'Configuración' },
  { optionNumber: 8, title: 'Salir' },
] as const;

/**
 * MenuFormatter formats the main CLI menu and navigational prompts.
 */
export class MenuFormatter {
  /**
   * Renders the complete contractual main menu text.
   */
  public formatMenu(options: readonly MenuOptionItem[] = CONTRACTUAL_MENU_OPTIONS): string {
    const lines = ['BUSCA OFERTAS AI', ''];
    for (const opt of options) {
      lines.push(`${opt.optionNumber}. ${opt.title}`);
    }
    return lines.join('\n');
  }

  /**
   * Formats the user input prompt.
   */
  public formatPrompt(): string {
    return '\nSeleccioná una opción (1-8): ';
  }

  /**
   * Formats the message when an invalid option is selected.
   */
  public formatInvalidOptionMessage(): string {
    return 'Opción inválida. Por favor, ingresá un número del 1 al 8.';
  }

  /**
   * Formats the notice when a feature is not yet implemented.
   */
  public formatNotImplementedMessage(title: string): string {
    return `\n[!] Todavía no implementado: "${title}".`;
  }

  /**
   * Formats the clean exit message.
   */
  public formatExitMessage(): string {
    return '\nSaliendo de Busca Ofertas AI. ¡Hasta luego!';
  }
}
