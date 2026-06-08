export function authenticate(token: string): boolean {
  return token.length > 0;
}

export function parseConfig(path: string): Record<string, unknown> {
  return {};
}

export class AuthService {
  private tokens = new Set<string>();

  register(token: string): void {
    this.tokens.add(token);
  }

  verify(token: string): boolean {
    return this.tokens.has(token);
  }
}
